import type { LakeDef } from '../data/lakes/types';
import type { LureDef } from '../data/lures';
import { rodPowerOk, type RodDef } from '../data/rods';
import { TUNING } from '../data/tuning';
import { lightLevel } from './conditions';
import { activeTackle, dist, emit, fishActivity, type SimCtx } from './context';
import { newFightState } from './fight';
import {
  countSince,
  detectRange,
  interestRate,
  presentationMatch,
  type AttractionContext,
} from './fish/attraction';
import { coverAt, depthAt, nearCover, secchiAt } from './lake';
import { transition } from './machine';
import type { FishEntity, HookMiss, InputFrame, Line, PresentState, SpeciesId, TournamentState, Vec2 } from './types';

const L = TUNING.lure;
const A = TUNING.attraction;
const H = TUNING.hookset;
const G = TUNING.grass;

const medians = new Map<string, Partial<Record<SpeciesId, number>>>();
/** The lake's median length per species (big-fish baits lean on length relative to it). */
function medianLengths(lake: LakeDef): Partial<Record<SpeciesId, number>> {
  let m = medians.get(lake.id);
  if (!m) {
    m = Object.fromEntries(Object.entries(lake.species.sizes).map(([sp, prof]) => [sp, prof!.medianIn])) as Partial<Record<SpeciesId, number>>;
    medians.set(lake.id, m);
  }
  return m;
}

// ---------- Hookset ----------

/** Seconds into a strike when the fish has the bait: on reaching it, or a beat after a topwater blow-up. */
export function biteAtSec(lure: Pick<LureDef, 'motion'>): number {
  return A.strikeChargeSec + (lure.motion === 'surface' ? H.topwaterDelaySec : 0);
}

/** How long after it has the bait a fish holds on before spitting it (soft plastics are held longer). */
export function hookWindowSec(lure: Pick<LureDef, 'treble' | 'style' | 'weedless'>): number {
  const soft = !lure.treble && (lure.style === 'bottom' || lure.style === 'shake');
  return H.windowSec + (soft ? H.softPlasticExtraSec : 0);
}

/**
 * Chance an on-time hookset sticks. Single hooks need the line to drive them: stretchy mono or fluoro
 * on a long cast loses some; trebles on no-stretch braid tear out a little; a rod too light for a
 * heavy weedless bait can't bury the hook; hollow frogs miss more than most.
 */
export function hookUpChance(lure: LureDef, rod: RodDef, line: Line, lineOutM: number): number {
  let p = H.base * (lure.hookRate ?? 1);
  if (!lure.treble) p *= 1 - H.singleStretchPenalty * TUNING.fight.stretch[line.type] * Math.min(1, lineOutM / H.longCastM);
  else if (line.type === 'braid') p *= H.trebleBraidHook;
  if (!rodPowerOk(rod, lure)) p *= H.underpoweredRod;
  return Math.max(0, Math.min(1, p));
}

const MISS_TEXT: Record<HookMiss, (topwater: boolean) => string> = {
  early: (top) => (top ? 'Too early! You pulled it away from the fish.' : 'Too early! The fish never had it.'),
  late: () => 'Too late: it spat the bait.',
  noHook: () => "Missed! The hook didn't stick.",
};

/** The strike came to nothing: the fish lets go (or never had it), is wary for a while, and the cast goes on. */
function missStrike(s: TournamentState, p: PresentState, f: FishEntity, why: HookMiss, topwater: boolean) {
  f.interest = 0;
  f.spookUntil = s.clockMin + H.missSpookMin;
  f.hookShy = Math.min(1, f.hookShy + H.hookShyPerMiss);
  p.strikingFishId = null;
  p.strikeT = 0;
  s.stats.missed = (s.stats.missed ?? 0) + 1;
  if (why === 'early') {
    // The rod sweep yanks the bait a metre or two toward the boat.
    const b = s.boat.pos;
    const d = Math.max(0.01, dist(b, p.lurePos));
    const k = Math.min(1.5, d - 0.5) / d;
    p.lurePos = { x: p.lurePos.x + (b.x - p.lurePos.x) * k, y: p.lurePos.y + (b.y - p.lurePos.y) * k };
  }
  emit(s, 'missed', MISS_TEXT[why](topwater), p.lurePos, { miss: why, topwater });
}

export function newPresentState(at: Vec2, edgeCast: boolean): PresentState {
  return {
    lurePos: { ...at },
    lureDepthFt: 0,
    lureVel: { x: 0, y: 0 },
    t: 0,
    twitchTimes: [],
    lastMoveT: 0,
    // Not paused at splashdown: a pause only starts once the lure has stopped (stillFor > 0.15 s).
    pauseStartT: null,
    avgSpeed: 0,
    movingFor: 0,
    match: 0,
    hopT: 0,
    onBottom: false,
    strikingFishId: null,
    strikeT: 0,
    lastCover: 'none',
    twitchT: 0,
    twitchVel: { x: 0, y: 0 },
    walkSide: 1,
    edgeCast,
    lastDeflectT: -10,
    stillFor: 0,
  };
}

/** Reaction-strike impulse: deflection off cover, a sudden pause, or a speed change. */
function reactionImpulse(s: TournamentState, p: PresentState, strength: number, range: number) {
  for (const f of s.fish) {
    if (f.caught || f.spookUntil > s.clockMin) continue;
    const d = dist(f.pos, p.lurePos);
    if (d > range) continue;
    const act = fishActivity(s, f);
    f.interest = Math.min(A.max, f.interest + A.reactionSpike * strength * Math.sqrt(act) * f.vulnerability * (1 - d / range));
  }
}

export function stepPresent(s: TournamentState, ctx: SimCtx, input: InputFrame, dt: number): void {
  const p = s.present;
  if (!p) return;
  const { lure, color, setup, rod } = activeTackle(s);
  const grid = ctx.grid;
  p.t += dt;

  // A fish is charging the lure, then holding it: the player has to set the hook in time.
  if (p.strikingFishId !== null) {
    const f = s.fish[p.strikingFishId];
    const prevT = p.strikeT;
    p.strikeT += dt;
    const topwater = lure.motion === 'surface';
    const reachAt = A.strikeChargeSec;
    const biteAt = biteAtSec(lure);
    const k = p.strikeT < reachAt ? Math.min(1, dt * 8) : 1;
    f.pos = { x: f.pos.x + (p.lurePos.x - f.pos.x) * k, y: f.pos.y + (p.lurePos.y - f.pos.y) * k };
    f.depthFt += (p.lureDepthFt - f.depthFt) * k;
    // The cue to set: the thump (or, on topwater, the weight after the blow-up).
    if (prevT < biteAt && p.strikeT >= biteAt) emit(s, 'bite', undefined, p.lurePos, { topwater });
    const set = input.hookSet || (!!s.autoHookset && p.strikeT >= biteAt + H.autoDelaySec);
    if (set) {
      if (p.strikeT < biteAt) return missStrike(s, p, f, 'early', topwater);
      if (!ctx.rng.chance(hookUpChance(lure, rod, setup.line, dist(p.lurePos, s.boat.pos)))) return missStrike(s, p, f, 'noHook', topwater);
      s.stats.bites++;
      f.hookShy = Math.min(1, f.hookShy + TUNING.multiDay.hookShyPerCatch);
      s.fight = newFightState(s, ctx, f, p.lurePos);
      if (lure.treble && setup.line.type === 'braid') s.fight.tearOut = true;
      emit(s, 'hooked', 'Fish on!', p.lurePos);
      s.present = null;
      transition(s, 'Fight');
      return;
    }
    if (p.strikeT >= biteAt + hookWindowSec(lure)) missStrike(s, p, f, 'late', topwater);
    return;
  }

  const boat = s.boat.pos;
  // Burn it back: skip the rest of a bad cast (costs a little time).
  if (input.moveOn) {
    for (const f of s.fish) if (f.interest > 0) f.interest = 0;
    s.present = null;
    s.clockMin += 0.3;
    emit(s, 'retrieved');
    transition(s, 'Cast');
    return;
  }
  const prev = { ...p.lurePos };
  const toBoat = Math.atan2(boat.y - p.lurePos.y, boat.x - p.lurePos.x);
  const fwd = { x: Math.cos(toBoat), y: Math.sin(toBoat) };
  const side = { x: -fwd.y, y: fwd.x };

  // --- Rod input -> lure motion ---
  let vx = 0;
  let vy = 0;
  if (input.reel) {
    vx += fwd.x * lure.retrieveSpeed;
    vy += fwd.y * lure.retrieveSpeed;
  }
  // Sweeping the rod sideways steers the lure path a little (guide a crankbait into cover).
  if (Math.abs(input.stick.x) > 0.3 && (input.reel || lure.style === 'steady')) {
    vx += side.x * input.stick.x * 0.35;
    vy += side.y * input.stick.x * 0.35;
  }

  if (input.twitch) {
    // Ripping a fouled bait free of the grass: the classic lipless reaction strike.
    if (p.fouled) {
      p.fouled = false;
      p.ripT = p.t;
      p.lureDepthFt = Math.max(0, p.lureDepthFt - G.ripLiftFt);
      reactionImpulse(s, p, lure.ripsGrass ? G.ripSpikeLipless : G.ripSpike, G.ripRangeM);
    }
    p.twitchTimes.push(p.t);
    if (p.twitchTimes.length > 24) p.twitchTimes.shift();
    switch (lure.style) {
      case 'bottom':
        p.hopT = 0.3;
        p.onBottom = false;
        p.twitchT = L.twitchSec;
        p.twitchVel = { x: (fwd.x * 0.5) / L.twitchSec, y: (fwd.y * 0.5) / L.twitchSec };
        break;
      case 'shake':
        p.twitchT = 0.12;
        p.twitchVel = { x: (fwd.x * 0.03) / 0.12, y: (fwd.y * 0.03) / 0.12 };
        break;
      case 'walk':
        p.walkSide = p.walkSide === 1 ? -1 : 1;
        p.twitchT = L.twitchSec;
        p.twitchVel = {
          x: (fwd.x * L.twitchDistM + side.x * 0.35 * p.walkSide) / L.twitchSec,
          y: (fwd.y * L.twitchDistM + side.y * 0.35 * p.walkSide) / L.twitchSec,
        };
        break;
      case 'twitchPause':
        p.twitchT = L.twitchSec;
        p.twitchVel = { x: (fwd.x * 0.6) / L.twitchSec, y: (fwd.y * 0.6) / L.twitchSec };
        p.lureDepthFt = Math.min(lure.runDepthFt, p.lureDepthFt + 0.9);
        break;
      case 'steady':
        p.twitchT = L.twitchSec;
        p.twitchVel = { x: (fwd.x * 0.4) / L.twitchSec, y: (fwd.y * 0.4) / L.twitchSec };
        if (p.movingFor > 0.8) reactionImpulse(s, p, 0.35, 5);
        break;
    }
  }
  if (p.twitchT > 0) {
    vx += p.twitchVel.x;
    vy += p.twitchVel.y;
    p.twitchT -= dt;
  }

  const k = L.gameSpeedScale;
  p.lureVel = { x: vx * k, y: vy * k };
  p.lurePos = { x: p.lurePos.x + vx * k * dt, y: p.lurePos.y + vy * k * dt };
  // Speed in real-world units (m/s) so cadence bands match the research tables.
  const speed = dist(prev, p.lurePos) / dt / k;
  p.avgSpeed += (speed - p.avgSpeed) * Math.min(1, dt / 0.6);

  // Pause tracking (used for jerkbait / topwater cadence and stop-and-go reaction strikes).
  if (speed < 0.05) {
    p.stillFor += dt;
    if (p.pauseStartT === null && p.stillFor > 0.15) {
      p.pauseStartT = p.t - p.stillFor;
      if (lure.style === 'steady' && p.movingFor > 1.2) reactionImpulse(s, p, 0.45, 5);
    }
    // A momentary slip off REEL isn't a new retrieve: the steady count only resets after a real stop.
    if (p.stillFor > L.steadyGraceSec) p.movingFor = 0;
  } else {
    if (speed > 0.1) p.pauseStartT = null;
    p.stillFor = 0;
    p.movingFor += dt;
    p.lastMoveT = p.t;
  }

  // --- Depth in the water column ---
  const bottom = depthAt(grid, p.lurePos.x, p.lurePos.y);
  const vdt = dt * k; // vertical motion is time-compressed too
  const lineFactor = setup.line.testLb <= 10 ? 1.1 : setup.line.testLb >= 15 ? 0.9 : 1;
  const moving = speed > 0.1;
  switch (lure.motion) {
    case 'surface':
      p.lureDepthFt = 0;
      p.onBottom = false;
      break;
    case 'diving': {
      const target = moving ? lure.runDepthFt * lineFactor * Math.min(1, speed / lure.retrieveSpeed) : 0;
      if (p.lureDepthFt < target) p.lureDepthFt = Math.min(target, p.lureDepthFt + L.reelDiveRateFtPerSec * vdt);
      else p.lureDepthFt = Math.max(target, p.lureDepthFt - L.floatUpFtPerSec * vdt);
      break;
    }
    case 'suspending':
      if (moving) p.lureDepthFt = Math.min(lure.runDepthFt * lineFactor, p.lureDepthFt + L.reelDiveRateFtPerSec * vdt);
      break;
    case 'swimming':
      // Bladed/swim jigs sink on slack line (count them down to the depth you want) and hold
      // depth on a steady retrieve, planing up slightly; heavier line planes them up more.
      if (moving) p.lureDepthFt = Math.max(0, p.lureDepthFt - L.swimRiseFtPerSec * (2 - lineFactor) * vdt);
      else p.lureDepthFt += lure.fallRateFtPerSec * vdt;
      p.onBottom = p.lureDepthFt >= bottom;
      break;
    case 'sinking': {
      // Leader rigs: the bait rides above the weight, so "on the bottom" is the leader's height off it.
      const floorFt = Math.max(0, bottom - (lure.leaderFt ?? 0));
      // Drop shot: thumbing the spool on the fall stops it mid-water (a press toggles the hold).
      if (lure.style === 'shake' && input.brake && !p.brakeDown && p.t > 0.2) p.held = !p.held && !p.onBottom;
      p.brakeDown = input.brake;
      if (p.hopT > 0) {
        p.hopT -= vdt;
        p.lureDepthFt = Math.max(0, p.lureDepthFt - (L.hopHeightFt / 0.3) * vdt);
        p.onBottom = false;
      } else if (!p.onBottom && !p.held) {
        p.lureDepthFt += lure.fallRateFtPerSec * (input.reel ? 0.5 : 1) * vdt;
      }
      if (p.lureDepthFt >= floorFt) {
        if (!p.onBottom && p.hopT <= 0 && p.t > 0.5) {
          // Touchdown on hard bottom is a small reaction trigger (tube on rock).
          const cov = coverAt(grid, p.lurePos.x, p.lurePos.y);
          if (cov === 'rock' || cov === 'timber') reactionImpulse(s, p, 0.3, 4);
        }
        p.onBottom = true;
        p.held = false;
        p.lureDepthFt = floorFt;
      }
      // Dragging along the bottom follows the contour; a drop-off makes it fall again.
      if (p.onBottom && floorFt > p.lureDepthFt + 0.5) p.onBottom = false;
      break;
    }
  }
  if (p.lureDepthFt >= bottom) {
    p.lureDepthFt = bottom;
    // Crankbait grinding into hard cover: the classic deflection reaction strike.
    if ((lure.motion === 'diving' || lure.motion === 'suspending' || lure.motion === 'swimming') && moving && p.t - p.lastDeflectT > 0.7) {
      const cov = coverAt(grid, p.lurePos.x, p.lurePos.y);
      const strength = cov === 'rock' || cov === 'timber' || cov === 'dock' ? 0.8 : 0.3;
      reactionImpulse(s, p, strength, 6);
      p.lastDeflectT = p.t;
    }
  }
  p.lastCover = coverAt(grid, p.lurePos.x, p.lurePos.y);
  // Exposed trebles running through the grass canopy pick up weeds; weedless baits come through clean.
  if (
    !p.fouled &&
    p.t - (p.ripT ?? -10) > G.ripClearSec &&
    lure.treble &&
    !lure.weedless &&
    lure.motion !== 'surface' &&
    moving &&
    (p.lastCover === 'grass' || p.lastCover === 'reeds') &&
    p.lureDepthFt >= bottom - G.canopyFt
  ) {
    p.fouled = true;
    emit(s, 'fouled', 'Grass on the hooks: rip it free!', p.lurePos);
  }

  // --- Attraction meter for every fish that can perceive the lure ---
  const light = lightLevel(s.clockMin, s.conditions.weather);
  const secchi = secchiAt(grid, p.lurePos.x, p.lurePos.y);
  p.match = presentationMatch(lure, p, s.conditions.waterTempF) * (p.fouled ? G.fouledMatch : 1);
  const ctxA: AttractionContext = {
    lure,
    color,
    line: setup.line,
    conditions: s.conditions,
    light,
    secchiFt: secchi,
    match: p.match,
    coverNear: p.lastCover !== 'none' || (p.edgeCast && p.t < 4) || nearCover(grid, p.lurePos.x, p.lurePos.y, 4) !== 'none',
    pressure: s.pressure,
    clockMin: s.clockMin,
    medianIn: medianLengths(ctx.lake),
  };
  const range = detectRange(lure, secchi, light);
  // Fish react in the same compressed game time the lure moves in (lure motion runs k x real time),
  // so a fast bait gets the same exposure per metre it would in the real world.
  const fdt = dt * k;
  // Shaken in place (on the bottom or held mid-water): nearby fish drift in to look (dwell).
  const shaking = lure.style === 'shake';
  const inPlace = shaking && (p.onBottom || !!p.held) && p.avgSpeed < A.dwellMaxSpeed && countSince(p.twitchTimes, p.t - 3) >= 1;
  if (shaking) p.dwell ??= {};
  let striker: number | null = null;
  let best = 0;
  for (const f of s.fish) {
    if (f.caught) continue;
    const d = dist(f.pos, p.lurePos);
    if (d > 45) {
      if (f.interest > 0) f.interest = Math.max(0, f.interest - A.leakPerSec * f.interest * fdt - 0.05 * fdt);
      continue;
    }
    if (f.spookUntil > s.clockMin) {
      f.interest = 0;
      continue;
    }
    const act = fishActivity(s, f);
    let prox = d < range ? 1 - d / range : 0;
    if (p.dwell) {
      if (prox <= 0) delete p.dwell[f.id];
      else {
        const dw = (p.dwell[f.id] ?? 0) + (inPlace ? fdt : 0);
        if (dw > 0) p.dwell[f.id] = dw;
        prox += (1 - prox) * Math.min(A.dwellCap, (A.dwellCap * dw) / A.dwellFullSec);
      }
    }
    // Leaky interest: rises toward gain*fit/leak while the fish can perceive the lure, fades otherwise.
    const gain = prox > 0 ? interestRate(f, ctxA, act, prox, p.lureDepthFt) : 0;
    f.interest += (gain - A.leakPerSec * f.interest) * fdt;
    f.interest = Math.max(0, Math.min(A.max, f.interest));

    // Interested fish follow the lure: the shadow you see trailing your bait.
    if (f.interest >= A.followAt) {
      const k = Math.min(1, (A.followSpeed * fdt) / Math.max(0.3, d));
      f.pos = { x: f.pos.x + (p.lurePos.x - f.pos.x) * k * 0.9, y: f.pos.y + (p.lurePos.y - f.pos.y) * k * 0.9 };
      f.depthFt += (p.lureDepthFt - f.depthFt) * Math.min(1, fdt * 0.8);
    }
    if (f.interest >= A.strikeAt && f.interest > best) {
      best = f.interest;
      striker = f.id;
    }
  }

  if (striker !== null) {
    p.strikingFishId = striker;
    p.strikeT = 0;
    emit(s, 'strike', undefined, p.lurePos);
    return;
  }

  // Lure back at the boat: the retrieve is over. Followers turn away.
  if (dist(p.lurePos, boat) < L.retrieveDoneM) {
    for (const f of s.fish) if (f.interest > 0) f.interest = 0;
    s.present = null;
    emit(s, 'retrieved');
    transition(s, 'Cast');
  }
}
