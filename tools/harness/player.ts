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
import { RODS } from '../../src/data/rods';
import { maxCastDistance } from '../../src/sim/cast';
import { jerkPauseWindow } from '../../src/sim/fish/attraction';
import { biteAtSec } from '../../src/sim/presentation';
import { getLakeGrid, HARD_COVER, isWater, coverAt, depthAt, stumpHazardAt } from '../../src/sim/lake';
import { bagWeight, continueAfterLanded, isDead } from '../../src/sim/livewell';
import { atLaunch, etaHomeMin, steerPoint, waterPath } from '../../src/sim/nav';
import { Rng } from '../../src/sim/rng';
import { createTournament, drainEvents, stepTournament } from '../../src/sim/tournament';
import { emptyInput, type InputFrame, type RodSetup, type Tier, type TournamentEvent, type TournamentState, type Vec2 } from '../../src/sim/types';

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
  /**
   * Hookset timing: reaction to the bite cue (the thump, or the weight after a topwater blow-up),
   * normal(mean, sd) seconds; and the chance of setting on the strike itself (the fish's charge, or
   * the blow-up on topwater) before the fish has the bait.
   */
  hookReactSec: [number, number];
  hookEarly: number;
  hookEarlyTopwater: number;
  /** Drop shot: casts at fish seen on the forward sonar and stops the bait at a suspended fish's depth. */
  sonarTargets: boolean;
  /** Drop shot: seconds of shaking before reeling up for another cast (longer while a fish is looking). */
  dropShotWorkSec: number;
  /** Seconds before ripping a treble bait free of grass (null: never notices). */
  ripDelaySec: number | null;
  /**
   * Check-in: leaves for the launch when the clock plus the run back (the HUD's ETA) plus this margin
   * (game minutes, normal(mean, sd), drawn per day) reaches check-in time. A negative margin is late.
   */
  headInMarginMin: [number, number];
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
    hookReactSec: [0.28, 0.08],
    hookEarly: 0.01,
    hookEarlyTopwater: 0.05,
    sonarTargets: true,
    dropShotWorkSec: 18,
    ripDelaySec: 0.3,
    headInMarginMin: [10, 1.5],
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
    hookReactSec: [0.5, 0.22],
    hookEarly: 0.05,
    hookEarlyTopwater: 0.25,
    sonarTargets: true,
    dropShotWorkSec: 25,
    ripDelaySec: 1,
    headInMarginMin: [5, 2],
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
    hookReactSec: [0.7, 0.35],
    hookEarly: 0.25,
    hookEarlyTopwater: 0.5,
    sonarTargets: false,
    dropShotWorkSec: 40,
    ripDelaySec: null,
    // Keeps fishing past the warning "for one more cast": sometimes cuts it close, now and then late.
    headInMarginMin: [4, 4],
  },
};

export interface DayMetrics {
  seed: number;
  casts: number;
  /** Strikes (a fish charges the lure), whether or not the hook is then set. */
  bassStrikes: number;
  otherStrikes: number;
  /** Bass hooked (fights started) and strikes missed at the hookset (early, late or the hook didn't stick). */
  bassHooked: number;
  missedSets: number;
  followCasts: number;
  crashes: number;
  snags: number;
  stumps: number;
  arrivals: number;
  spookedAtArrival: number; // mean fraction of fish within 30 m spooked when fishing starts
  avgMatch: number;
  bassLanded: number;
  /** On the scales, after the late and dead-fish penalties (zero if more than 15 minutes late). */
  bag: number;
  /** The livewell before penalties. */
  grossBag: number;
  /** Check-in: clock (game minutes), minutes late, the day zeroed, dead fish, and the penalties (lb). */
  checkInMin: number;
  lateMin: number;
  zeroed: boolean;
  deadFish: number;
  latePenaltyLb: number;
  deadPenaltyLb: number;
  presentSec: number;
  /** Where and when the player fished, and how many casts each stop got (for the advisor gate). */
  visits: { x: number; y: number; clockMin: number; casts: number }[];
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

/**
 * Route around land: BFS over water cells (8-connected), then keep only the waypoints where the
 * straight line would leave the water. Humans steer around points and islands by eye.
 */
function planRoute(lakeId: string, from: Vec2, to: Vec2): Vec2[] {
  const g = getLakeGrid(LAKES[lakeId]);
  const cell = (p: Vec2) => Math.floor(p.y / g.cellM) * g.cols + Math.floor(p.x / g.cellM);
  const ok = (i: number) => g.water[i] === 1 && g.shoreDistM[i] >= g.cellM;
  const start = cell(from);
  let goal = cell(to);
  if (!ok(goal)) {
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < g.water.length; i++)
      if (ok(i)) {
        const d = Math.hypot((i % g.cols) * g.cellM - to.x, Math.floor(i / g.cols) * g.cellM - to.y);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
    goal = best;
  }
  const prev = new Int32Array(g.water.length).fill(-2);
  prev[start] = -1;
  const q = [start];
  for (let h = 0; h < q.length && prev[goal] === -2; h++) {
    const i = q[h];
    const c = i % g.cols;
    const r = Math.floor(i / g.cols);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue;
      const j = nr * g.cols + nc;
      if (prev[j] !== -2 || !(ok(j) || j === goal)) continue;
      prev[j] = i;
      q.push(j);
    }
  }
  if (prev[goal] === -2) return [to];
  const cells: number[] = [];
  for (let i = goal; i !== -1; i = prev[i]) cells.push(i);
  cells.reverse();
  const pts = cells.map((i) => ({ x: ((i % g.cols) + 0.5) * g.cellM, y: (Math.floor(i / g.cols) + 0.5) * g.cellM }));
  const clear = (a: Vec2, b: Vec2) => {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 8);
    for (let k = 1; k <= n; k++) if (!isWater(g, a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n)) return false;
    return true;
  };
  const out: Vec2[] = [];
  let anchor = from;
  for (let k = 1; k < pts.length; k++)
    if (!clear(anchor, pts[k])) {
      out.push(pts[k - 1]);
      anchor = pts[k - 1];
    }
  out.push(to);
  return out;
}

/**
 * Fish returns on the forward-facing sonar (MapScene: trolling motor, 45 m, +/-0.5 rad cone; spooked
 * fish show grey) near the spot and within a cast, nearest the spot first. The chart (and its sonar)
 * is only on screen while driving, so a player remembers these marks when they press FISH and casts to
 * where the fish were, not where they've wandered since.
 */
function sonarMarks(s: TournamentState, spot: Spot, maxD: (aim: number) => number): Vec2[] {
  if (s.boat.motor !== 'trolling') return [];
  const out: { at: Vec2; toSpot: number }[] = [];
  for (const f of s.fish) {
    if (f.caught || f.spookUntil > s.clockMin) continue;
    const dx = f.pos.x - s.boat.pos.x;
    const dy = f.pos.y - s.boat.pos.y;
    const d = Math.hypot(dx, dy);
    if (d < 6 || d > 45) continue;
    const da = Math.atan2(Math.sin(Math.atan2(dy, dx) - s.boat.heading), Math.cos(Math.atan2(dy, dx) - s.boat.heading));
    if (Math.abs(da) > 0.5 || d > maxD(da) * 0.95) continue;
    const toSpot = Math.hypot(f.pos.x - spot.x, f.pos.y - spot.y);
    if (toSpot < 25) out.push({ at: { ...f.pos }, toSpot });
  }
  return out.sort((a, b) => a.toSpot - b.toSpot).map((m) => m.at);
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

export function playDay(opts: {
  lakeId: string;
  tier: Tier;
  seed: number;
  deck: RodSetup[];
  profile: Profile;
  maxRealSec?: number;
  spots?: Spot[];
  /** Start the day at this clock (game minutes) instead of blast-off: tests play just the end of a day. */
  startMin?: number;
  onStep?: (s: TournamentState, events: TournamentEvent[], t: number) => void;
}): DayMetrics {
  const { profile: P } = opts;
  const s = createTournament({ lakeId: opts.lakeId, tier: opts.tier, seed: opts.seed, deck: opts.deck });
  if (opts.startMin !== undefined) s.clockMin = opts.startMin;
  const rng = new Rng(opts.seed ^ 0xbadc0de); // the player's own randomness, separate from the sim
  const kb = P.input === 'keyboard' ? keyboard() : null;
  if (kb) inputHub.reset();
  const dayGrid = getLakeGrid(LAKES[opts.lakeId]);
  const spots = opts.spots?.length ? opts.spots : itinerary(opts.lakeId, opts.seed);
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
  let route: Vec2[] = [];
  let routeFor = -1;
  let bestD = Infinity;
  let sinceBest = 0;
  let bowAt: number | null = null;
  let arrived = false;
  let castMaxInterest = 0;
  // Hookset plan for the strike in progress (strike seconds at which the player sets).
  let setAt: number | null = null;
  // Drop shot: the sonar mark this cast is aimed at, the aim/power for it, and whether it was thumbed.
  let marks: Vec2[] = [];
  let markIdx = 0;
  let dsTarget: Vec2 | null = null;
  let dsAim = 0;
  let dsPower = 0;
  let heldDone = false;
  let fouledAt: number | null = null;
  let matchSum = 0;
  let matchN = 0;
  const m: DayMetrics = {
    seed: opts.seed,
    casts: 0,
    bassStrikes: 0,
    otherStrikes: 0,
    bassHooked: 0,
    missedSets: 0,
    followCasts: 0,
    crashes: 0,
    snags: 0,
    stumps: 0,
    arrivals: 0,
    spookedAtArrival: 0,
    avgMatch: 0,
    bassLanded: 0,
    bag: 0,
    grossBag: 0,
    checkInMin: 0,
    lateMin: 0,
    zeroed: false,
    deadFish: 0,
    latePenaltyLb: 0,
    deadPenaltyLb: 0,
    presentSec: 0,
    visits: [],
  };
  // Check-in: when this player leaves for the launch (its own rng, so the rest of its play is unchanged).
  const homeMargin = new Rng(opts.seed ^ 0x7e7c4).normal(P.headInMarginMin[0], P.headInMarginMin[1]);
  let headingHome = false;
  // The run home follows the destination chip: the water route in the boat lanes (re-planned as it goes).
  let homePath: { from: Vec2; at: number; pts: Vec2[] } | null = null;
  let homeSteer: { at: number; p: Vec2 } | null = null;
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
      if (s.phase === 'Fight' && s.fight && SPECIES[s.fight.species].isBass) m.bassHooked++;
      if (lastPhase === 'Present') dsTarget = null;
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
      setAt = null;
      heldDone = false;
      fouledAt = null;
      kb?.releaseAll();
    }
    phaseT += DT;
    const sp = spots[spotIdx % spots.length];
    // Time to head in: the run back (the HUD's ETA) plus this player's margin reaches check-in time.
    if (!headingHome && s.clockMin + etaHomeMin(dayGrid, s.boat.pos) + homeMargin >= TUNING.clock.dayEndMin) headingHome = true;

    switch (s.phase) {
      case 'Navigate': {
        if (headingHome) {
          const L = LAKES[opts.lakeId].launch;
          const d = Math.hypot(L.x - s.boat.pos.x, L.y - s.boat.pos.y);
          if (atLaunch(dayGrid, s.boat.pos) && d < TUNING.checkIn.radiusM * 0.7) {
            // At the ramp: stop and check in (it opens an hour after blast-off).
            if (kb) {
              kb.set([]);
              kb.tap('k');
            } else input.checkIn = true;
            break;
          }
          if (!homePath || t - homePath.at > 2 || Math.hypot(homePath.from.x - s.boat.pos.x, homePath.from.y - s.boat.pos.y) > 15) {
            homePath = { from: { ...s.boat.pos }, at: t, pts: waterPath(dayGrid, s.boat.pos, L, true) };
            homeSteer = null;
          }
          if (!homeSteer || t - homeSteer.at > 0.25) homeSteer = { at: t, p: steerPoint(dayGrid, s.boat.pos, homePath.pts, true) };
          const leg = homeSteer.p;
          const h = clearHeading(s, Math.atan2(leg.y - s.boat.pos.y, leg.x - s.boat.pos.x), 40);
          // Run it on the outboard, below stump speed through an off-lane stump field ("Stay in the lane");
          // ease off in the last stretch to the ramp. Keys only give trolling or wide open.
          const stumps = [0, 20, 40].some((k) => stumpHazardAt(dayGrid, s.boat.pos.x + Math.cos(s.boat.heading) * k, s.boat.pos.y + Math.sin(s.boat.heading) * k));
          const run = d > 40;
          // On keys, feather Shift through stumps to stay under stump speed (a naive player lets it creep over).
          const feather = stumps && s.boat.speed > (P.name === 'naiveKeyboard' ? 27 : 22);
          if (kb) kb.set([...keysFor(h), ...(run && !feather ? ['shift'] : [])]);
          else input.stick = stickFor(h, !run ? 0.32 : stumps ? 0.58 : 1);
          break;
        }
        const target = standOff(sp);
        if (routeFor !== spotIdx) {
          route = planRoute(opts.lakeId, s.boat.pos, target);
          routeFor = spotIdx;
          bestD = Infinity;
          sinceBest = 0;
        }
        // Advance along the route; head for the next leg's point.
        while (route.length > 1 && Math.hypot(route[0].x - s.boat.pos.x, route[0].y - s.boat.pos.y) < 30) route.shift();
        const leg = route[0] ?? target;
        const d = Math.hypot(target.x - s.boat.pos.x, target.y - s.boat.pos.y);
        // No progress for 25 s (pinned on a bank, unreachable cove): give up on this spot.
        if (d < bestD - 5) {
          bestD = d;
          sinceBest = 0;
        } else if ((sinceBest += DT) > 25) {
          spotIdx++;
          break;
        }
        if (process.env.HARNESS_TRACE_NAV && Math.round(t * 60) % 300 === 0) console.log('nav', spotIdx, 'boat', s.boat.pos.x.toFixed(0), s.boat.pos.y.toFixed(0), 'tgt', target.x.toFixed(0), target.y.toFixed(0), 'd', d.toFixed(0), 'spd', s.boat.speed.toFixed(1), 'motor', s.boat.motor, 'clock', s.clockMin.toFixed(0));
        if (d < 6 || (s.boat.speed < 1 && d < 14 && phaseT > 2)) {
          // Arrived: let it coast down, then FISH.
          if (s.boat.speed <= TUNING.boat.fishHereMaxSpeed) {
            if (kb) kb.tap('f');
            else input.fishHere = true;
          }
          break;
        }
        const want = Math.atan2(leg.y - s.boat.pos.y, leg.x - s.boat.pos.x);
        const run = P.approach === 'run' ? d > 8 : d > P.idleFromM;
        const h = clearHeading(s, want, run ? 40 : 16);
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
        break;
      }
      case 'Cast': {
        const cs = s.cast;
        if (arrived) {
          // Fresh arrival at a spot.
          arrived = false;
          castsLeft = rng.int(P.castsPerSpot[0], P.castsPerSpot[1]);
          m.arrivals++;
          m.visits.push({ x: sp.x, y: sp.y, clockMin: s.clockMin, casts: 0 });
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
          // A drop-shotter notes the marks on the sonar as they stop.
          const rig = s.deck[s.activeRod];
          const lure0 = LURES[rig.lureId];
          marks = lure0.style === 'shake' && P.sonarTargets ? sonarMarks(s, sp, (a) => maxCastDistance(lure0, RODS[rig.rodId], rig.line, s.conditions, s.boat.heading + a)) : [];
          markIdx = 0;
        }
        if (!cs || cs.flying) break;
        if (castsLeft <= 0 || (headingHome && !cs.powerCharging)) {
          spotIdx++;
          if (kb) kb.tap('m');
          else input.moveOn = true;
          break;
        }
        if (wait > 0) {
          wait -= DT;
          break;
        }
        const castLure = LURES[s.deck[s.activeRod].lureId];
        if (!cs.powerCharging && castLure.style === 'shake' && P.sonarTargets) {
          // Drop shot: cast at a fish on the forward sonar near the spot (the technique), aim and power for it.
          if (dsTarget === null && marks.length) {
            // Work the best few marks in turn.
            const tgt = marks[markIdx++ % Math.min(3, marks.length)];
            const rig = s.deck[s.activeRod];
            dsTarget = tgt;
            const a = Math.atan2(tgt.y - s.boat.pos.y, tgt.x - s.boat.pos.x) - s.boat.heading;
            dsAim = Math.atan2(Math.sin(a), Math.cos(a)) + rng.normal(0, P.aimSdRad);
            const frac = Math.hypot(tgt.x - s.boat.pos.x, tgt.y - s.boat.pos.y) / maxCastDistance(castLure, RODS[rig.rodId], rig.line, s.conditions, s.boat.heading + dsAim);
            dsPower = Math.min(0.99, Math.max(0.05, (2 / Math.PI) * Math.asin(Math.min(1, Math.max(0, (frac - 0.15) / 0.85))) + rng.normal(0, P.powerSd)));
          }
          if (dsTarget !== null) {
            const diff = Math.atan2(Math.sin(dsAim - cs.aimAngle), Math.cos(dsAim - cs.aimAngle));
            if (Math.abs(diff) > 0.03 && Math.abs(cs.aimAngle) < TUNING.cast.aimLimit - 0.01) {
              if (kb) kb.set([diff > 0 ? 'd' : 'a']);
              else input.stick = { x: Math.sign(diff) * Math.min(1, Math.abs(diff) * 4 + 0.2), y: 0 };
              break;
            }
            kb?.set([]);
            powerTarget = dsPower;
            if (kb) kb.tap('c');
            else input.castTap = true;
            break;
          }
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
          if (m.visits.length) m.visits[m.visits.length - 1].casts++;
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
        if (process.env.HARNESS_TRACE_MATCH && Math.round(t * 60) % 60 === 0) console.log('present', spotIdx, phaseT.toFixed(1), 'match', p.match.toFixed(2), 'spd', p.avgSpeed.toFixed(2), 'depth', p.lureDepthFt.toFixed(1), 'boatDist', Math.hypot(p.lurePos.x - s.boat.pos.x, p.lurePos.y - s.boat.pos.y).toFixed(0), 'clock', s.clockMin.toFixed(0));
        if (Math.round(t * 60) % 6 === 0) {
          for (const f of s.fish) if (!f.caught && f.interest > castMaxInterest && Math.abs(f.pos.x - p.lurePos.x) < 45 && Math.abs(f.pos.y - p.lurePos.y) < 45) castMaxInterest = f.interest;
        }
        let reel = false;
        let twitch = false;
        let brake = false;
        let moveOn = false;
        let hookSet = false;
        if (p.strikingFishId !== null) {
          // A strike: set on the bite cue (the thump, or the weight after a topwater blow-up) with this
          // player's reaction time, or jump the gun on the charge / blow-up itself.
          const topwater = lure.motion === 'surface';
          if (setAt === null) {
            const react = Math.max(0.08, rng.normal(P.hookReactSec[0], P.hookReactSec[1]));
            setAt = rng.chance(topwater ? P.hookEarlyTopwater : P.hookEarly) ? (topwater ? TUNING.attraction.strikeChargeSec : 0) + react * 0.5 : biteAtSec(lure) + react;
          }
          if (p.strikeT >= setAt) {
            hookSet = true;
            setAt = Infinity;
          }
        } else {
          setAt = null;
        }
        if (p.strikingFishId === null) switch (lure.style) {
          case 'steady':
            // A swimming bait (bladed jig) is counted down first by a player who reads the sonar, per the tip.
            if (lure.motion === 'swimming' && P.readsBottom) {
              // Lipless: count it to the grass tops so it ticks the grass (then rip it free).
              const bottomHere = depthAt(dayGrid, p.lurePos.x, p.lurePos.y);
              const grassHere = ['grass', 'reeds'].includes(coverAt(dayGrid, p.lurePos.x, p.lurePos.y));
              const countTo = lure.ripsGrass && grassHere ? bottomHere - TUNING.grass.canopyFt + 0.3 : 0.7 * bottomHere;
              if (bottomAt === null && (p.onBottom || p.lureDepthFt >= countTo || phaseT > 8)) bottomAt = phaseT;
              reel = bottomAt !== null;
            } else reel = phaseT > jit(0.35);
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
            // A suspended fish's arc beside the bait on the sonar inset: thumb the spool at its depth.
            if (P.sonarTargets && !heldDone && !p.onBottom && !p.held) {
              const bottomHere = depthAt(dayGrid, p.lurePos.x, p.lurePos.y);
              for (const f of s.fish)
                if (!f.caught && Math.hypot(f.pos.x - p.lurePos.x, f.pos.y - p.lurePos.y) < 3 && bottomHere - f.depthFt > 4 && p.lureDepthFt >= f.depthFt - 0.5) {
                  brake = true;
                  heldDone = true;
                  break;
                }
            }
            const down = P.readsBottom ? p.onBottom || !!p.held : phaseT > jit(2.5);
            if (down && bottomAt === null) bottomAt = phaseT;
            if (bottomAt !== null) {
              const k = phaseT - bottomAt;
              if (k >= nextTwitch) {
                twitch = true;
                twitchCount++;
                nextTwitch = k + jit(0.95) + (twitchCount % 8 === 0 ? 2 : 0);
              }
              reel = twitchCount % 10 === 9;
              // Reel up and make another cast after a while, longer while a fish is looking at it.
              let looking = false;
              for (const f of s.fish) if (!f.caught && f.interest >= TUNING.attraction.followAt && Math.hypot(f.pos.x - p.lurePos.x, f.pos.y - p.lurePos.y) < 12) looking = true;
              if (k > P.dropShotWorkSec * (looking ? 2 : 1)) moveOn = true;
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
        // Heading in: reel up and go (a naive player finishes the cast it's on).
        if (headingHome && P.name !== 'naiveKeyboard' && p.strikingFishId === null) moveOn = true;
        // A treble bait fouled in the grass: rip it free (a twitch) once the player notices.
        if (p.fouled && P.ripDelaySec !== null && p.strikingFishId === null) {
          fouledAt ??= phaseT;
          if (phaseT - fouledAt >= P.ripDelaySec) {
            twitch = true;
            fouledAt = null;
          }
        } else fouledAt = null;
        if (kb) {
          const keys: string[] = [...(reel ? [' '] : []), ...(brake ? ['b'] : [])];
          kb.set(keys);
          if (twitch) kb.tap('t');
          if (hookSet) kb.tap('h');
          if (moveOn) kb.tap('m');
          // Instinct: reach for ↑ while reeling, or to steer the lure.
          if (rng.chance(P.arrowFidgetPerSec * DT)) kb.tap(rng.next() < 0.7 ? 'arrowup' : 'arrowdown');
        } else {
          input.reel = reel;
          input.twitch = twitch;
          input.brake = brake;
          input.hookSet = hookSet;
          input.moveOn = moveOn;
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
    const events = drainEvents(s);
    opts.onStep?.(s, events, t);
    for (const e of events) {
      if (e.type === 'crash') m.crashes++;
      if (e.type === 'strike' && s.present?.strikingFishId != null) {
        if (SPECIES[s.fish[s.present.strikingFishId].species].isBass) m.bassStrikes++;
        else m.otherStrikes++;
      }
      if (e.type === 'missed') m.missedSets++;
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
  const ci = s.checkIns?.[s.checkIns.length - 1];
  m.grossBag = ci?.grossLb ?? bagWeight(s.livewell);
  m.checkInMin = ci?.atMin ?? s.clockMin;
  m.lateMin = ci?.lateMin ?? 0;
  m.zeroed = !!ci?.zeroed;
  m.deadFish = ci?.deadFish ?? s.livewell.filter(isDead).length;
  m.latePenaltyLb = ci?.latePenaltyLb ?? 0;
  m.deadPenaltyLb = ci?.deadPenaltyLb ?? 0;
  return m;
}
