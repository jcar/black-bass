// Human-proxy player for model validation. Unlike tools/simulate.ts (a teleporting bot with perfect
// inputs), this plays only through the real input surface: it drives from the launch, steers around
// land, comes off plane and idles in (or runs straight in), presses FISH, aims with the stick,
// releases the power bar with timing noise, holds REEL with lapses, and twitches with jitter.
// The keyboard profile goes through the real keyboard mapping (src/game/input.ts) via key events.
import { LAKES } from '../../src/data/lakes';
import { LURES } from '../../src/data/lures';
import { SPECIES } from '../../src/data/species';
import { TUNING } from '../../src/data/tuning';
import { inputHub } from '../../src/game/input';
import { jerkPauseWindow } from '../../src/sim/fish/attraction';
import { getLakeGrid, HARD_COVER, isWater, coverAt } from '../../src/sim/lake';
import { bagWeight, continueAfterLanded } from '../../src/sim/livewell';
import { Rng } from '../../src/sim/rng';
import { createTournament, drainEvents, stepTournament } from '../../src/sim/tournament';
import { emptyInput, type InputFrame, type RodSetup, type Tier, type TournamentState, type Vec2 } from '../../src/sim/types';

const DT = 1 / 60;

export interface Profile {
  name: string;
  input: 'touch' | 'keyboard';
  /** Come off plane early and idle in on the trolling motor, or run straight to the spot. */
  approach: 'idle' | 'run';
  idleFromM: number;
  castsPerSpot: [number, number];
  castGapSec: [number, number];
  powerTarget: number;
  powerSd: number;
  aimSdRad: number;
  /** Aim beside hard cover (docks/laydowns) instead of at it. */
  aimsBesideHardCover: boolean;
  /** Steady baits: chance per second of letting go of REEL for a moment. */
  reelLapsePerSec: number;
  /** Fractional jitter on twitch/hop/pause cadence. */
  timingJitter: number;
  /** Bottom baits: waits for the lure to touch down (reads the sonar) vs a fixed count. */
  readsBottom: boolean;
  /** Keyboard: taps ↑/↓ during a retrieve (steering / instinct). */
  arrowFidgetPerSec: number;
  bowSkill: number;
  fightSkill: 'good' | 'ok' | 'poor';
}

export const PROFILES: Record<string, Profile> = {
  expert: {
    name: 'expert',
    input: 'touch',
    approach: 'idle',
    idleFromM: 120,
    castsPerSpot: [8, 14],
    castGapSec: [1.2, 2.5],
    powerTarget: 0.92,
    powerSd: 0.04,
    aimSdRad: 0.12,
    aimsBesideHardCover: true,
    reelLapsePerSec: 0.01,
    timingJitter: 0.06,
    readsBottom: true,
    arrowFidgetPerSec: 0,
    bowSkill: 0.85,
    fightSkill: 'good',
  },
  average: {
    name: 'average',
    input: 'touch',
    approach: 'idle',
    idleFromM: 60,
    castsPerSpot: [5, 10],
    castGapSec: [2, 4],
    powerTarget: 0.82,
    powerSd: 0.12,
    aimSdRad: 0.3,
    aimsBesideHardCover: false,
    reelLapsePerSec: 0.08,
    timingJitter: 0.18,
    readsBottom: false,
    arrowFidgetPerSec: 0,
    bowSkill: 0.5,
    fightSkill: 'ok',
  },
  naiveKeyboard: {
    name: 'naiveKeyboard',
    input: 'keyboard',
    approach: 'run',
    idleFromM: 0,
    castsPerSpot: [3, 6],
    castGapSec: [2, 5],
    powerTarget: 0.72,
    powerSd: 0.2,
    aimSdRad: 0.4,
    aimsBesideHardCover: false,
    reelLapsePerSec: 0.25,
    timingJitter: 0.3,
    readsBottom: false,
    arrowFidgetPerSec: 0.4,
    bowSkill: 0.25,
    fightSkill: 'poor',
  },
};

export interface DayMetrics {
  seed: number;
  casts: number;
  bassStrikes: number;
  otherStrikes: number;
  followCasts: number;
  crashes: number;
  snags: number;
  stumps: number;
  arrivals: number;
  spookedAtArrival: number; // mean fraction of fish within 30 m spooked when fishing starts
  avgMatch: number;
  bassLanded: number;
  bag: number;
  presentSec: number;
}

// ---------- Keyboard emulation through the real input mapping ----------
const kbListeners: Record<string, (e: unknown) => void> = {};
let kbAttached = false;
function keyboard() {
  if (!kbAttached) {
    inputHub.attachKeyboard({ addEventListener: (t: string, fn: (e: unknown) => void) => (kbListeners[t] = fn), removeEventListener: () => {} } as unknown as Window);
    kbAttached = true;
  }
  const held = new Set<string>();
  return {
    down(k: string) {
      if (held.has(k)) return;
      held.add(k);
      kbListeners.keydown?.({ key: k, repeat: false, preventDefault() {} });
    },
    up(k: string) {
      if (!held.has(k)) return;
      held.delete(k);
      kbListeners.keyup?.({ key: k, preventDefault() {} });
    },
    tap(k: string) {
      this.down(k);
      this.up(k);
    },
    set(keys: string[]) {
      for (const k of [...held]) if (!keys.includes(k)) this.up(k);
      for (const k of keys) this.down(k);
    },
    releaseAll() {
      for (const k of [...held]) this.up(k);
    },
  };
}

/** Steer toward a heading with simple obstacle avoidance: first clear ray among offsets. */
function clearHeading(s: TournamentState, want: number, rayM: number): number {
  const grid = getLakeGrid(LAKES[s.lakeId]);
  for (const off of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.3, -1.3, 1.8, -1.8, 2.4, -2.4]) {
    const h = want + off;
    let ok = true;
    for (let d = 8; d <= rayM; d += 8) if (!isWater(grid, s.boat.pos.x + Math.cos(h) * d, s.boat.pos.y + Math.sin(h) * d)) ok = false;
    if (ok) return h;
  }
  return want + Math.PI;
}

/** Stick vector that makes stepNavigate head toward world heading h at magnitude m. */
const stickFor = (h: number, m: number) => ({ x: Math.cos(h) * m, y: -Math.sin(h) * m });

/** 8-way keyboard combo closest to a world heading. */
function keysFor(h: number): string[] {
  const dx = Math.cos(h);
  const dy = -Math.sin(h); // stick y up = +1
  const keys: string[] = [];
  if (dx > 0.38) keys.push('d');
  if (dx < -0.38) keys.push('a');
  if (dy > 0.38) keys.push('w');
  if (dy < -0.38) keys.push('s');
  return keys;
}

export interface Spot {
  x: number;
  y: number;
  hard: boolean;
}

/** A human's itinerary: the visible waypoints first (shuffled), then cover they can see on the map. */
export function itinerary(lakeId: string, seed: number): Spot[] {
  const lake = LAKES[lakeId];
  const grid = getLakeGrid(lake);
  const rng = new Rng(seed ^ 0x51a7e);
  const wps = lake.waypoints.filter((w) => w.visible).map((w) => ({ x: w.x, y: w.y, hard: HARD_COVER.has(coverAt(grid, w.x, w.y)) }));
  const cover = lake.cover.filter((c) => isWater(grid, c.x, c.y)).map((c) => ({ x: c.x, y: c.y, hard: HARD_COVER.has(c.type) }));
  const shuffle = <T>(a: T[]) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  return [...shuffle(wps), ...shuffle(cover)];
}

export function playDay(opts: { lakeId: string; tier: Tier; seed: number; deck: RodSetup[]; profile: Profile; maxRealSec?: number }): DayMetrics {
  const { profile: P } = opts;
  const s = createTournament({ lakeId: opts.lakeId, tier: opts.tier, seed: opts.seed, deck: opts.deck });
  const rng = new Rng(opts.seed ^ 0xbadc0de); // the player's own randomness, separate from the sim
  const kb = P.input === 'keyboard' ? keyboard() : null;
  if (kb) inputHub.reset();
  const spots = itinerary(opts.lakeId, opts.seed);
  let spotIdx = 0;
  let castsLeft = 0;
  let t = 0;
  let phaseT = 0;
  let lastPhase = s.phase;
  let wait = 0; // seconds until the next action
  let reelLapse = 0;
  let twitchCount = 0;
  let nextTwitch = 0;
  let bottomAt: number | null = null;
  let powerTarget = 0;
  let aimTarget = 0;
  let stuck = 0;
  let lastPos: Vec2 = { ...s.boat.pos };
  let bowAt: number | null = null;
  let arrived = false;
  let castMaxInterest = 0;
  let matchSum = 0;
  let matchN = 0;
  const m: DayMetrics = { seed: opts.seed, casts: 0, bassStrikes: 0, otherStrikes: 0, followCasts: 0, crashes: 0, snags: 0, stumps: 0, arrivals: 0, spookedAtArrival: 0, avgMatch: 0, bassLanded: 0, bag: 0, presentSec: 0 };
  let spookSum = 0;
  const jit = (v: number) => v * (1 + (rng.next() * 2 - 1) * P.timingJitter);
  const maxSec = opts.maxRealSec ?? 3600;

  const standOff = (sp: Spot): Vec2 => {
    // Stop ~18-22 m off the spot on the side we're approaching from.
    const a = Math.atan2(s.boat.pos.y - sp.y, s.boat.pos.x - sp.x);
    return { x: sp.x + Math.cos(a) * 20, y: sp.y + Math.sin(a) * 20 };
  };

  while (s.phase !== 'WeighIn' && t < maxSec) {
    let input: InputFrame = emptyInput();
    if (s.phase !== lastPhase) {
      // Fight just started: record what took the bait.
      if (s.phase === 'Fight' && s.fight) {
        if (SPECIES[s.fight.species].isBass) m.bassStrikes++;
        else m.otherStrikes++;
      }
      if (lastPhase === 'Present') {
        if (castMaxInterest >= TUNING.attraction.followAt) m.followCasts++;
        castMaxInterest = 0;
      }
      arrived = lastPhase === 'Navigate' && s.phase === 'Cast';
      lastPhase = s.phase;
      phaseT = 0;
      wait = 0;
      twitchCount = 0;
      nextTwitch = 0;
      bottomAt = null;
      bowAt = null;
      kb?.releaseAll();
    }
    phaseT += DT;
    const sp = spots[spotIdx % spots.length];

    switch (s.phase) {
      case 'Navigate': {
        const target = standOff(sp);
        const d = Math.hypot(target.x - s.boat.pos.x, target.y - s.boat.pos.y);
        if (d < 6 || (s.boat.speed < 1 && d < 14 && phaseT > 2)) {
          // Arrived: let it coast down, then FISH.
          if (s.boat.speed <= TUNING.boat.fishHereMaxSpeed) {
            if (kb) kb.tap('f');
            else input.fishHere = true;
          }
          break;
        }
        const want = Math.atan2(target.y - s.boat.pos.y, target.x - s.boat.pos.x);
        const run = P.approach === 'run' ? d > 8 : d > P.idleFromM;
        const h = clearHeading(s, want, run ? 60 : 20);
        const mag = run ? 1 : 0.32;
        if (kb) {
          // Keys give whatever speed the mapping gives; a keyboard player lets off ~a boat-stop early
          // and fishes where the boat coasts to a halt.
          const stopDist = (s.boat.speed * s.boat.speed) / (2 * TUNING.boat.decel) + 6;
          if (d > stopDist) kb.set([...keysFor(h), ...(run ? ['shift'] : [])]);
          else {
            kb.set([]);
            if (s.boat.speed <= TUNING.boat.fishHereMaxSpeed) kb.tap('f');
          }
        } else input.stick = stickFor(h, mag);
        // Stuck against land: move on to the next spot.
        if (Math.hypot(s.boat.pos.x - lastPos.x, s.boat.pos.y - lastPos.y) < 0.02) stuck += DT;
        else stuck = 0;
        lastPos = { ...s.boat.pos };
        if (stuck > 6) {
          spotIdx++;
          stuck = 0;
        }
        break;
      }
      case 'Cast': {
        const cs = s.cast;
        if (arrived) {
          // Fresh arrival at a spot.
          arrived = false;
          castsLeft = rng.int(P.castsPerSpot[0], P.castsPerSpot[1]);
          m.arrivals++;
          if (process.env.HARNESS_TRACE) console.log('arrive', spotIdx, 'boat', s.boat.pos.x.toFixed(0), s.boat.pos.y.toFixed(0), 'spot', sp.x, sp.y, 'clock', s.clockMin.toFixed(0));
          let near = 0;
          let spooked = 0;
          for (const f of s.fish)
            if (!f.caught && Math.hypot(f.pos.x - s.boat.pos.x, f.pos.y - s.boat.pos.y) < 30) {
              near++;
              if (f.spookUntil > s.clockMin) spooked++;
            }
          spookSum += near ? spooked / near : 0;
          aimTarget = Math.atan2(sp.y - s.boat.pos.y, sp.x - s.boat.pos.x) - s.boat.heading;
        }
        if (!cs || cs.flying) break;
        if (castsLeft <= 0) {
          spotIdx++;
          if (kb) kb.tap('m');
          else input.moveOn = true;
          break;
        }
        if (wait > 0) {
          wait -= DT;
          break;
        }
        if (!cs.powerCharging) {
          // Aim with the stick, then start the power bar.
          let goal = Math.atan2(sp.y - s.boat.pos.y, sp.x - s.boat.pos.x) - s.boat.heading;
          if (sp.hard && P.aimsBesideHardCover) goal += 0.35 * (rng.next() < 0.5 ? -1 : 1);
          if (Math.abs(aimTarget - goal) > 1) aimTarget = goal;
          const diff = Math.atan2(Math.sin(aimTarget - cs.aimAngle), Math.cos(aimTarget - cs.aimAngle));
          if (Math.abs(diff) > 0.06 && Math.abs(cs.aimAngle) < TUNING.cast.aimLimit - 0.01) {
            if (kb) kb.set([diff > 0 ? 'd' : 'a']);
            else input.stick = { x: Math.sign(diff), y: 0 };
            break;
          }
          kb?.set([]);
          aimTarget = goal + rng.normal(0, P.aimSdRad);
          powerTarget = Math.min(0.99, Math.max(0.15, rng.normal(P.powerTarget, P.powerSd)));
          if (kb) kb.tap('c');
          else input.castTap = true;
        } else if (cs.power >= powerTarget && cs.powerDir === 1) {
          if (kb) kb.tap('c');
          else input.castTap = true;
          m.casts++;
          castsLeft--;
          wait = rng.range(P.castGapSec[0], P.castGapSec[1]);
        }
        break;
      }
      case 'Present': {
        const p = s.present!;
        const lure = LURES[s.deck[s.activeRod].lureId];
        m.presentSec += DT;
        matchSum += p.match;
        matchN++;
        if (Math.round(t * 60) % 6 === 0) {
          for (const f of s.fish) if (!f.caught && f.interest > castMaxInterest && Math.abs(f.pos.x - p.lurePos.x) < 45 && Math.abs(f.pos.y - p.lurePos.y) < 45) castMaxInterest = f.interest;
        }
        let reel = false;
        let twitch = false;
        switch (lure.style) {
          case 'steady':
            reel = phaseT > jit(0.35);
            if (reelLapse > 0) {
              reelLapse -= DT;
              reel = false;
            } else if (rng.chance(P.reelLapsePerSec * DT)) reelLapse = rng.range(0.15, 0.5);
            break;
          case 'bottom': {
            const down = P.readsBottom ? p.onBottom : phaseT > jit(2.5);
            if (down && bottomAt === null) bottomAt = phaseT;
            if (bottomAt !== null) {
              const k = phaseT - bottomAt;
              reel = k % jit(3.2) < 1.6;
              if (k >= nextTwitch) {
                twitch = true;
                nextTwitch = k + jit(3);
              }
            }
            break;
          }
          case 'shake': {
            const down = P.readsBottom ? p.onBottom : phaseT > jit(2.5);
            if (down && bottomAt === null) bottomAt = phaseT;
            if (bottomAt !== null) {
              const k = phaseT - bottomAt;
              if (k >= nextTwitch) {
                twitch = true;
                twitchCount++;
                nextTwitch = k + jit(0.95) + (twitchCount % 8 === 0 ? 2 : 0);
              }
              reel = twitchCount % 10 === 9;
            }
            break;
          }
          case 'twitchPause': {
            const [lo, hi] = jerkPauseWindow(s.conditions.waterTempF);
            const pause = P.name === 'expert' ? (lo + hi) / 2 : P.name === 'average' ? 2 : 0.8;
            reel = phaseT < 0.8;
            if (phaseT >= nextTwitch) {
              twitch = true;
              twitchCount++;
              nextTwitch = phaseT + (twitchCount % 2 === 1 ? jit(0.3) : jit(pause));
            }
            break;
          }
          case 'walk':
            if (phaseT >= nextTwitch) {
              twitch = true;
              twitchCount++;
              nextTwitch = phaseT + (twitchCount % 9 === 0 ? jit(1.5) : jit(1 / (lure.rhythmHz ?? 2)));
            }
            break;
        }
        if (kb) {
          const keys: string[] = reel ? [' '] : [];
          kb.set(keys);
          if (twitch) kb.tap('t');
          // Instinct: reach for ↑ while reeling, or to steer the lure.
          if (rng.chance(P.arrowFidgetPerSec * DT)) kb.tap(rng.next() < 0.7 ? 'arrowup' : 'arrowdown');
        } else {
          input.reel = reel;
          input.twitch = twitch;
        }
        break;
      }
      case 'Fight': {
        const f = s.fight!;
        if (f.jumpT > 0 && !f.jumpBowed) {
          if (bowAt === null) bowAt = rng.chance(P.bowSkill) ? phaseT + rng.range(0.15, 0.4) : Infinity;
          if (phaseT >= bowAt) {
            if (kb) kb.tap('v');
            else input.bowFlick = true;
            bowAt = Infinity;
          }
        } else bowAt = null;
        const reel = f.tension < (P.fightSkill === 'good' ? 0.7 : P.fightSkill === 'ok' ? 0.8 : 0.95);
        const brake = P.fightSkill === 'good' && !reel && f.tension < 0.85 && f.stamina > 0.4;
        if (P.fightSkill === 'good') input.stick = { x: -Math.sign(Math.sin(f.heading)) * 0.8, y: 0 };
        if (kb) kb.set([...(reel ? [' '] : []), ...(brake ? ['b'] : [])]);
        else {
          input.reel = reel;
          input.brake = brake;
        }
        break;
      }
      case 'Landed':
        kb?.set([]);
        if (s.lastLanded && SPECIES[s.lastLanded.species].isBass && s.lastLanded.weightLb > 0) m.bassLanded++;
        continueAfterLanded(s);
        break;
    }

    if (kb) {
      const k = inputHub.frame(s.phase);
      input = k;
    }
    stepTournament(s, input, DT);
    for (const e of drainEvents(s)) {
      if (e.type === 'crash') m.crashes++;
      if (process.env.HARNESS_TRACE && (e.type === 'crash' || e.type === 'edge' || e.type === 'splash') && m.casts < 30) console.log(e.type, 'boat', s.boat.pos.x.toFixed(0), s.boat.pos.y.toFixed(0), 'at', e.at?.x.toFixed(0), e.at?.y.toFixed(0), 'spot', spots[spotIdx % spots.length].x, spots[spotIdx % spots.length].y);
      if (e.type === 'shore') m.snags++;
      if (e.type === 'stump') m.stumps++;
    }
    t += DT;
  }
  kb?.releaseAll();
  m.avgMatch = matchN ? matchSum / matchN : 0;
  m.spookedAtArrival = m.arrivals ? spookSum / m.arrivals : 0;
  m.bag = s.dayWeights[s.dayWeights.length - 1] ?? bagWeight(s.livewell);
  return m;
}
