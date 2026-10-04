import { TUNING } from '../data/tuning';
import { lightLevel } from './conditions';
import { activeTackle, dist, emit, fishActivity, type SimCtx } from './context';
import { newFightState } from './fight';
import {
  detectRange,
  interestRate,
  presentationMatch,
  type AttractionContext,
} from './fish/attraction';
import { coverAt, depthAt, nearCover, secchiAt } from './lake';
import { transition } from './machine';
import type { InputFrame, PresentState, TournamentState, Vec2 } from './types';

const L = TUNING.lure;
const A = TUNING.attraction;

export function newPresentState(at: Vec2, edgeCast: boolean): PresentState {
  return {
    lurePos: { ...at },
    lureDepthFt: 0,
    lureVel: { x: 0, y: 0 },
    t: 0,
    twitchTimes: [],
    lastMoveT: 0,
    pauseStartT: 0,
    avgSpeed: 0,
    movingFor: 0,
    match: 0,
    trigger: 0,
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
  p.trigger = Math.max(p.trigger, strength);
}

export function stepPresent(s: TournamentState, ctx: SimCtx, input: InputFrame, dt: number): void {
  const p = s.present;
  if (!p) return;
  const { lure, color, setup } = activeTackle(s);
  const grid = ctx.grid;
  p.t += dt;

  // A fish is charging the lure: finish the strike animation, then hook up.
  if (p.strikingFishId !== null) {
    const f = s.fish[p.strikingFishId];
    p.strikeT += dt;
    const k = Math.min(1, dt * 8);
    f.pos = { x: f.pos.x + (p.lurePos.x - f.pos.x) * k, y: f.pos.y + (p.lurePos.y - f.pos.y) * k };
    f.depthFt += (p.lureDepthFt - f.depthFt) * k;
    if (p.strikeT >= A.strikeChargeSec) {
      s.stats.bites++;
      f.hookShy = Math.min(1, f.hookShy + TUNING.multiDay.hookShyPerCatch);
      s.fight = newFightState(s, ctx, f, p.lurePos);
      emit(s, 'hooked', 'Fish on!', p.lurePos);
      s.present = null;
      transition(s, 'Fight');
    }
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
    p.movingFor = 0;
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
    case 'sinking': {
      if (p.hopT > 0) {
        p.hopT -= vdt;
        p.lureDepthFt = Math.max(0, p.lureDepthFt - (L.hopHeightFt / 0.3) * vdt);
        p.onBottom = false;
      } else if (!p.onBottom) {
        p.lureDepthFt += lure.fallRateFtPerSec * (input.reel ? 0.5 : 1) * vdt;
      }
      if (p.lureDepthFt >= bottom) {
        if (!p.onBottom && p.hopT <= 0 && p.t > 0.5) {
          // Touchdown on hard bottom is a small reaction trigger (tube on rock).
          const cov = coverAt(grid, p.lurePos.x, p.lurePos.y);
          if (cov === 'rock' || cov === 'timber') reactionImpulse(s, p, 0.3, 4);
        }
        p.onBottom = true;
      }
      // Dragging along the bottom follows the contour; a drop-off makes it fall again.
      if (p.onBottom && bottom > p.lureDepthFt + 0.5) p.onBottom = false;
      break;
    }
  }
  if (p.lureDepthFt >= bottom) {
    p.lureDepthFt = bottom;
    // Crankbait grinding into hard cover: the classic deflection reaction strike.
    if ((lure.motion === 'diving' || lure.motion === 'suspending') && moving && p.t - p.lastDeflectT > 0.7) {
      const cov = coverAt(grid, p.lurePos.x, p.lurePos.y);
      const strength = cov === 'rock' || cov === 'timber' || cov === 'dock' ? 0.8 : 0.3;
      reactionImpulse(s, p, strength, 6);
      p.lastDeflectT = p.t;
    }
  }
  p.lastCover = coverAt(grid, p.lurePos.x, p.lurePos.y);
  p.trigger = Math.max(0, p.trigger - A.reactionDecayPerSec * dt);

  // --- Attraction meter for every fish that can perceive the lure ---
  const light = lightLevel(s.clockMin, s.conditions.weather);
  const secchi = secchiAt(grid, p.lurePos.x, p.lurePos.y);
  p.match = presentationMatch(lure, p, s.conditions.waterTempF);
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
  };
  const range = detectRange(lure, secchi, light);
  let striker: number | null = null;
  let best = 0;
  for (const f of s.fish) {
    if (f.caught) continue;
    const d = dist(f.pos, p.lurePos);
    if (d > 45) {
      if (f.interest > 0) f.interest = Math.max(0, f.interest - 1.5 * dt);
      continue;
    }
    if (f.spookUntil > s.clockMin) {
      f.interest = 0;
      continue;
    }
    const act = fishActivity(s, f);
    if (d < range) {
      f.interest += interestRate(f, ctxA, act, 1 - d / range, p.lureDepthFt) * dt;
    }
    f.interest -= (A.decayPerSec + (p.match < 0.3 ? A.badMatchExtraDecay : 0)) * dt;
    f.interest = Math.max(0, Math.min(A.max, f.interest));

    // Interested fish follow the lure: the shadow you see trailing your bait.
    if (f.interest >= A.followAt) {
      const k = Math.min(1, (A.followSpeed * dt) / Math.max(0.3, d));
      f.pos = { x: f.pos.x + (p.lurePos.x - f.pos.x) * k * 0.9, y: f.pos.y + (p.lurePos.y - f.pos.y) * k * 0.9 };
      f.depthFt += (p.lureDepthFt - f.depthFt) * Math.min(1, dt * 0.8);
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
