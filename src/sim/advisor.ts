// Pro advice, computed from the game's own strike model.
//
// The sim (fish/attraction.ts, presentation.ts) gives every fish near the lure a leaky interest
// meter: dI/dt = gain * fit - leak * I, strike at 6. A fish therefore strikes when
//   vulnerability * proximity * F0 * gain / leak >= strikeAt
// where F0 is everything else in the fit product (activity, cadence match, depth match, cover,
// lure temperature/light/wind fit, colour vs local clarity, line visibility, species affinity).
// The advisor evaluates exactly that, per fish, for the water around each spot, using the same
// placement odds the population generator uses to decide how many bass live there. Multiplied by
// how many fish a cast passes (2 x detection range x path) and how many casts an hour the lure
// allows, it predicts bites per hour for a rig at a spot and time of day.
//
// The only empirical inputs are the cadence match an expert actually achieves per technique and the
// cycle overhead per cast, both measured with the human-proxy harness (tools/harness).
// tools/advisor-check.ts gates the advice against harness play.
import type { LakeDef } from '../data/lakes/types';
import { COLORS, LURES, type LureDef } from '../data/lures';
import { RODS } from '../data/rods';
import { SPECIES } from '../data/species';
import { TUNING } from '../data/tuning';
import { generateConditions, lightLevel } from './conditions';
import { activityFor } from './fish/activity';
import { colorFit, depthMatch, detectRange, jerkPauseWindow, lineVisibilityFit, lureConditionFit, lureTempFit } from './fish/attraction';
import { holdingDepth, speciesWeightsAt } from './fish/population';
import { COVER_CODES, getLakeGrid, HARD_COVER, type LakeGrid } from './lake';
import { Rng } from './rng';
import type { Conditions, CoverType, Line, RodSetup, Season, SpeciesId, Vec2 } from './types';

/** Parts of the tournament day the advice is broken into (game minutes). */
export const WINDOWS = [
  { id: 'dawn', label: 'Dawn', from: 360, to: 480, at: 400 },
  { id: 'morning', label: 'Morning', from: 480, to: 660, at: 570 },
  { id: 'midday', label: 'Midday', from: 660, to: 810, at: 735 },
  { id: 'late', label: 'Late', from: 810, to: 900, at: 855 },
] as const;
export type WindowId = (typeof WINDOWS)[number]['id'];
export const windowAt = (clockMin: number) => WINDOWS.find((w) => clockMin < w.to) ?? WINDOWS[WINDOWS.length - 1];

export interface Rig {
  lureId: string;
  colorId: string;
  line: Line;
  rodId?: string;
}

const A = TUNING.attraction;
const K = TUNING.lure.gameSpeedScale;
/** Radius of water a player works from one stop (m). */
const SPOT_RADIUS = 40;
/** Path a typical cast is retrieved along (m). */
const CAST_PATH_M = 20;
/** Per-cast overhead (aim, power bar, flight, pick-up), real seconds (harness: 4-5 s). */
const CAST_OVERHEAD_SEC = 4.5;
/** A slow bait is worked at most this long before the angler reels in (harness drop shot: ~57 s). */
const MAX_WORK_SEC = 55;
/** Casts a skilled angler makes per stop (harness expert: 8-14). */
const CASTS_PER_VISIT = 11;
/** Real seconds to run and idle in to the next stop. */
const MOVE_SEC = 60;
/** Real seconds a strike costs (fight, unhook, recast). */
const FIGHT_SEC = 15;

/** Cadence match a skilled player actually achieves per technique (harness expert profile). */
const EXPERT_MATCH: Record<LureDef['style'], number> = { steady: 0.88, twitchPause: 0.67, walk: 0.75, bottom: 0.75, shake: 0.91 };
/** A bladed jig counted down (as advised) loses some steadiness to the stop-start: harness 0.72. */
const expertMatch = (lure: LureDef) => (lure.motion === 'swimming' ? 0.72 : EXPERT_MATCH[lure.style]);

// ---------- Where the lure runs ----------

export function lureWorkingDepth(lure: LureDef, line: Line, bottomFt: number): number {
  const lineFactor = line.testLb <= 10 ? 1.1 : line.testLb >= 15 ? 0.9 : 1;
  switch (lure.motion) {
    case 'surface':
      return 0;
    case 'diving':
    case 'suspending':
      return Math.min(bottomFt, lure.runDepthFt * lineFactor);
    case 'sinking':
      return bottomFt;
    case 'swimming':
      // A good angler counts a bladed jig down to just above the fish.
      return Math.max(0, bottomFt * 0.7);
  }
}

/**
 * How fast an expert's lure covers ground, as a multiple of the lure's reel speed (harness expert):
 * hops and twitches add to reeling on bottom baits and walkers; a drop shot barely moves.
 */
const PACE: Record<LureDef['style'], number> = { steady: 1, twitchPause: 1, walk: 1.2, bottom: 1.4, shake: 0.12 };
/** Share of the time the lure is actually moving (pauses, pulses), for whether a follower can catch it. */
const MOVING: Record<LureDef['style'], number> = { steady: 1, twitchPause: 0.35, walk: 0.8, bottom: 0.5, shake: 0.1 };

/** Real seconds the lure spends being worked per cast (fall plus retrieve), and the path it covers (m). */
function retrieveProfile(lure: LureDef, bottomFt: number): { workSec: number; pathM: number } {
  const v = lure.retrieveSpeed * PACE[lure.style] * K;
  const fall = lure.motion === 'sinking' ? bottomFt / (lure.fallRateFtPerSec * K) : lure.motion === 'swimming' ? (bottomFt * 0.7) / (lure.fallRateFtPerSec * K) : 0;
  const swim = Math.min(MAX_WORK_SEC, CAST_PATH_M / v);
  return { workSec: swim + fall, pathM: Math.min(CAST_PATH_M, v * swim) };
}

// ---------- Fish around a spot ----------

export interface SpotDef {
  id: string;
  name: string;
  x: number;
  y: number;
}

/** Places a player would fish: the lake's visible waypoints and its named/mapped cover. */
export function spotsFor(lake: LakeDef): SpotDef[] {
  const grid = getLakeGrid(lake);
  const out: SpotDef[] = lake.waypoints.filter((w) => w.visible).map((w) => ({ id: w.id, name: w.name, x: w.x, y: w.y }));
  lake.cover.forEach((c, i) => {
    if (c.type === 'standing' && c.r > 120) return; // big timber fields are covered by waypoints
    if (!grid.water[Math.floor(c.y / grid.cellM) * grid.cols + Math.floor(c.x / grid.cellM)]) return;
    out.push({ id: `cover-${i}`, name: c.label ?? `${COVER_NAME[c.type]}, ${nearestName(lake, c)}`, x: c.x, y: c.y });
  });
  return out;
}
/** "380 m NE of Valcour Island": unnamed cover located from the nearest named waypoint. */
function nearestName(lake: LakeDef, at: Vec2): string {
  let best = lake.waypoints[0];
  for (const w of lake.waypoints) if (Math.hypot(w.x - at.x, w.y - at.y) < Math.hypot(best.x - at.x, best.y - at.y)) best = w;
  if (!best) return '';
  const d = Math.hypot(best.x - at.x, best.y - at.y);
  if (d < 80) return `at ${best.name}`;
  // Map y grows southward.
  const dirs = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
  const dir = dirs[(Math.round(Math.atan2(at.y - best.y, at.x - best.x) / (Math.PI / 4)) + 8) % 8];
  return `${Math.round(d / 10) * 10} m ${dir} of ${best.name}`;
}
const COVER_NAME: Record<CoverType, string> = { none: 'Open water', rock: 'Rock', grass: 'Grass', dock: 'Docks', timber: 'Laydowns', reeds: 'Reeds', standing: 'Standing timber' };

interface CellEnv {
  depth: number;
  cover: CoverType;
  secchi: number;
  cellArea: number;
  /** Expected bass per m^2 by species (placement model). */
  density: Partial<Record<SpeciesId, number>>;
}

/** Placement acceptance for a species in a cell, as generatePopulation does it (expected value). */
function acceptance(sp: SpeciesId, season: Season, depth: number, cover: CoverType): number {
  const S = SPECIES[sp];
  const [lo, hi] = S.depthBySeason[season];
  const suit = depth >= lo && depth <= hi ? 1 : Math.exp(-(depth < lo ? lo - depth : depth - hi) / 6);
  const pref = Math.pow((S.cover[cover] ?? S.cover.none ?? 0.5) / 1.8, 2);
  const off = TUNING.population.offStructureFrac;
  return suit * ((1 - off) * pref + off * 0.35);
}

const lakeNorm = new Map<string, Map<SpeciesId, number>>();
/** Expected bass per m^2 in a cell (count x share of the lake's acceptance mass). */
function cellDensity(lake: LakeDef, g: LakeGrid, season: Season, i: number): Partial<Record<SpeciesId, number>> {
  const key = `${lake.id}:${season}`;
  let norm = lakeNorm.get(key);
  if (!norm) {
    // sum_cells weight(sp, cell) * acceptance(sp, cell) over the whole lake.
    norm = new Map();
    let total = 0;
    for (let j = 0; j < g.water.length; j++) {
      if (!g.water[j]) continue;
      const x = ((j % g.cols) + 0.5) * g.cellM;
      const y = (Math.floor(j / g.cols) + 0.5) * g.cellM;
      const w = speciesWeightsAt(lake, x, y);
      for (const [sp, frac] of Object.entries(w) as [SpeciesId, number][]) total += frac * acceptance(sp, season, g.depthFt[j], COVER_CODES[g.cover[j]]);
    }
    norm.set('largemouth', total); // single shared normaliser (stored under any key)
    lakeNorm.set(key, norm);
  }
  const total = norm.get('largemouth')!;
  const x = ((i % g.cols) + 0.5) * g.cellM;
  const y = (Math.floor(i / g.cols) + 0.5) * g.cellM;
  const w = speciesWeightsAt(lake, x, y);
  const out: Partial<Record<SpeciesId, number>> = {};
  const cellArea = g.cellM * g.cellM;
  for (const [sp, frac] of Object.entries(w) as [SpeciesId, number][]) {
    if (!SPECIES[sp].isBass) continue;
    out[sp] = (lake.species.count * frac * acceptance(sp, season, g.depthFt[i], COVER_CODES[g.cover[i]])) / total / cellArea;
  }
  return out;
}

const envCache = new Map<string, CellEnv[]>();
/** The water cells within reach of a stop at (x, y). */
export function spotEnv(lake: LakeDef, season: Season, at: Vec2): CellEnv[] {
  const key = `${lake.id}:${season}:${Math.round(at.x)}:${Math.round(at.y)}`;
  const hit = envCache.get(key);
  if (hit) return hit;
  const g = getLakeGrid(lake);
  const out: CellEnv[] = [];
  const r = Math.ceil(SPOT_RADIUS / g.cellM);
  const c0 = Math.floor(at.x / g.cellM);
  const r0 = Math.floor(at.y / g.cellM);
  for (let rr = r0 - r; rr <= r0 + r; rr++)
    for (let cc = c0 - r; cc <= c0 + r; cc++) {
      if (cc < 0 || rr < 0 || cc >= g.cols || rr >= g.rows) continue;
      const i = rr * g.cols + cc;
      if (!g.water[i]) continue;
      if (Math.hypot((cc + 0.5) * g.cellM - at.x, (rr + 0.5) * g.cellM - at.y) > SPOT_RADIUS) continue;
      out.push({ cellArea: g.cellM * g.cellM, depth: g.depthFt[i], cover: COVER_CODES[g.cover[i]], secchi: g.secchiFt[i] || lake.clarity.defaultSecchiFt, density: cellDensity(lake, g, season, i) });
    }
  if (envCache.size > 4000) envCache.clear();
  envCache.set(key, out);
  return out;
}

// ---------- Strike probability ----------

/** Vulnerability quantiles of lognormal(1, 0.45) clipped to [0.2, 2.5] (population.ts). */
const VULN_Q = Array.from({ length: 24 }, (_, i) => {
  const p = (i + 0.5) / 24;
  // Inverse normal via Acklam's rational approximation (good to ~1e-4, plenty here).
  const z = invNorm(p);
  return Math.min(2.5, Math.max(0.2, Math.exp(0.45 * z)));
});
function invNorm(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const q = Math.min(p, 1 - p);
  let x: number;
  if (q < 0.02425) {
    const t = Math.sqrt(-2 * Math.log(q));
    x = (((((c[0] * t + c[1]) * t + c[2]) * t + c[3]) * t + c[4]) * t + c[5]) / ((((d[0] * t + d[1]) * t + d[2]) * t + d[3]) * t + 1);
  } else {
    const t = q - 0.5;
    const r = t * t;
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * t) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  return p < 0.5 ? x : -x;
}

/**
 * P(strike) for a fish the lure passes within detection range, given the fit product F0 excluding
 * vulnerability and proximity. Lateral offset is uniform across the detection band, so
 * proximity = 1 - u; the fish strikes when vuln * (1 - u) * F0 * gain / leak >= strikeAt.
 */
export function strikeChance(f0: number): number {
  const theta = (A.strikeAt * A.leakPerSec) / (A.gainPerSec * Math.max(1e-6, f0));
  let p = 0;
  for (const v of VULN_Q) p += Math.max(0, 1 - theta / v);
  return p / VULN_Q.length;
}

// ---------- Rig at a spot ----------

export interface RigEstimate {
  /** Expected bass strikes from one visit to the spot (CASTS_PER_VISIT casts). */
  bitesPerVisit: number;
  /** The same rate sustained over a whole tournament day (visits of similar spots). */
  bitesPerDay: number;
  /** Real seconds per cast cycle (aim, flight, fall, retrieve). */
  cycleSec: number;
  /** Mean strike chance per bass in the spot over the visit. */
  strikeChance: number;
  /** Typical bottom depth, fish depth and lure depth over the spot (fish-weighted). */
  depthFt: number;
  fishDepthFt: number;
  lureDepthFt: number;
}

/**
 * Chance a bass in the spot strikes during a visit. Within a visit the same fish see the lure again
 * and again, and interest is deterministic given fit, so a fish strikes on its closest pass or not at
 * all: with K ~ Poisson(lambda) passes at uniform lateral offsets, P = 1 - exp(-lambda (1 - x)) where
 * x is the proximity it needs. A fish that reaches the follow line swims at the lure and takes its
 * depth; on a bait slow enough to catch (closing chance c) it then strikes at full proximity if its
 * depth-matched fit clears the strike line, which is why slow baits convert followers fast ones lose.
 */
function visitStrikeChance(f0: number, f0Closed: number, lambda: number, closing: number): number {
  const th = (A.strikeAt * A.leakPerSec) / A.gainPerSec;
  const followFrac = A.followAt / A.strikeAt;
  let p = 0;
  for (const v of VULN_Q) {
    const xd = th / (v * Math.max(1e-6, f0));
    const direct = xd < 1 ? 1 - Math.exp(-lambda * (1 - xd)) : 0;
    const xf = xd * followFrac;
    const follow = v * f0Closed >= th && xf < 1 ? 1 - Math.exp(-lambda * (1 - xf)) : direct;
    p += closing * Math.max(follow, direct) + (1 - closing) * direct;
  }
  return p / VULN_Q.length;
}

/** Share of the retrieve a following fish can keep up with the lure (follow speed vs lure speed). */
function closingChance(lure: LureDef): number {
  return Math.min(1, (A.followSpeed * 0.9) / Math.max(0.05, lure.retrieveSpeed * MOVING[lure.style] * K));
}

export function estimateRig(c: Conditions, clockMin: number, rig: Rig, env: CellEnv[], casts = CASTS_PER_VISIT, match = expertMatch(LURES[rig.lureId])): RigEstimate {
  const lure = LURES[rig.lureId];
  const color = COLORS[rig.colorId];
  const light = lightLevel(clockMin, c.weather);
  const temp = lureTempFit(lure, c.waterTempF);
  const lightWind = lureConditionFit(lure, c, light);
  const closing = closingChance(lure);
  const g = env.length ? env[0].cellArea : 400;
  const area = Math.max(1, env.length) * g;
  // Cycle time and the footprint one retrieve sweeps, averaged over where casts land in the spot.
  let work = 0;
  let pathM = 0;
  for (const cell of env) {
    const r = retrieveProfile(lure, cell.depth);
    work += r.workSec;
    pathM += r.pathM;
  }
  const n = Math.max(1, env.length);
  const cycleSec = CAST_OVERHEAD_SEC + work / n;
  pathM /= n;
  let strikes = 0;
  let fishN = 0;
  let dsum = 0;
  let fsum = 0;
  let lsum = 0;
  for (const cell of env) {
    const R = detectRange(lure, cell.secchi, light);
    const lambda = (casts * (2 * R * pathM + Math.PI * R * R)) / area;
    const lureFt = lureWorkingDepth(lure, rig.line, cell.depth);
    const common =
      match * (cell.cover !== 'none' ? A.coverBonus : 1) * temp * lightWind * colorFit(color, cell.secchi, light) * lineVisibilityFit(rig.line, cell.secchi, lure);
    const hard = HARD_COVER.has(cell.cover) ? 0.85 : 1; // some casts at hard cover crash and spook
    for (const [sp, dens] of Object.entries(cell.density) as [SpeciesId, number][]) {
      const act = activityFor(sp, c, clockMin, 3);
      const fishFt = holdingDepth(cell.depth, light, act);
      const base = act * common * (SPECIES[sp].lureAffinity?.[lure.id] ?? 1);
      const fishHere = dens * cell.cellArea;
      strikes += fishHere * hard * visitStrikeChance(base * depthMatch(lureFt, fishFt, act), base, lambda, closing);
      fishN += fishHere;
      dsum += fishHere * cell.depth;
      fsum += fishHere * fishFt;
      lsum += fishHere * lureFt;
    }
  }
  const visitSec = MOVE_SEC + casts * cycleSec + strikes * FIGHT_SEC;
  const daySec = (TUNING.clock.dayEndMin - TUNING.clock.dayStartMin) / TUNING.clock.gameMinPerSec;
  const w = fishN || 1;
  return {
    bitesPerVisit: strikes,
    bitesPerDay: (strikes * daySec) / visitSec,
    cycleSec,
    strikeChance: fishN ? strikes / fishN : 0,
    depthFt: dsum / w,
    fishDepthFt: fsum / w,
    lureDepthFt: lsum / w,
  };
}

// ---------- Gear rules (from cast.ts, fight.ts and the attraction model) ----------

export function needsHeavyLine(lake: LakeDef): boolean {
  return lake.cover.some((p) => p.type === 'standing');
}

/** The line a pro would spool for this lure on this lake. */
export function suggestedLine(lake: LakeDef, lureId: string): Line {
  const lure = LURES[lureId];
  const clear = lake.clarity.defaultSecchiFt >= TUNING.attraction.clearSecchiFt;
  if (lure.motion === 'surface') return { type: 'mono', testLb: needsHeavyLine(lake) ? 17 : 14 };
  if (needsHeavyLine(lake)) return lure.style === 'bottom' && lure.weightOz >= 0.375 ? { type: 'fluoro', testLb: 17 } : { type: 'fluoro', testLb: 15 };
  if (lure.weightOz <= 0.25) return { type: 'fluoro', testLb: clear ? 8 : 10 };
  return { type: 'fluoro', testLb: 12 };
}

/** Lightest owned rod whose lure-weight range fits (cast distance penalty otherwise). */
export function suggestedRod(lureId: string, ownedRods: string[]): string | null {
  const w = LURES[lureId].weightOz;
  const fits = ownedRods.filter((r) => w >= RODS[r].lureOz[0] && w <= RODS[r].lureOz[1]);
  return fits[0] ?? null;
}

/** Best colour of a lure for the clarity where it will be fished and the day's light. */
export function bestColor(lake: LakeDef, c: Conditions, lureId: string, secchiFt = lake.clarity.defaultSecchiFt): string {
  const lure = LURES[lureId];
  let best = lure.colors[0];
  let bestF = -Infinity;
  for (const id of lure.colors) {
    const f = WINDOWS.reduce((a, w) => a + colorFit(COLORS[id], secchiFt, lightLevel(w.at, c.weather)), 0);
    if (f > bestF) {
      bestF = f;
      best = id;
    }
  }
  return best;
}

export interface RigIssue {
  severity: 'warn' | 'tip';
  text: string;
}

/** What a pro would change about a rig, using the same rules the sim applies. */
export function rigIssues(lake: LakeDef, rig: RodSetup): RigIssue[] {
  const out: RigIssue[] = [];
  const lure = LURES[rig.lureId];
  const rod = RODS[rig.rodId];
  if (lure.weightOz < rod.lureOz[0] || lure.weightOz > rod.lureOz[1])
    out.push({ severity: 'warn', text: `${lure.weightOz} oz is outside the rod's ${rod.lureOz[0]}-${rod.lureOz[1]} oz range: casts lose ${Math.round((1 - TUNING.cast.rodMismatchPenalty) * 100)}% distance.` });
  const clear = lake.clarity.defaultSecchiFt >= TUNING.attraction.clearSecchiFt;
  if (clear && lure.motion !== 'surface' && rig.line.type !== 'fluoro')
    out.push({ severity: 'tip', text: `Clear water: fish see ${rig.line.type} line (${rig.line.type === 'braid' ? '-10' : '-4'}% bites). Fluoro is invisible.` });
  if (needsHeavyLine(lake) && rig.line.type !== 'braid' && rig.line.testLb < 15)
    out.push({ severity: 'warn', text: `${rig.line.testLb} lb in standing timber: a running fish can wrap and fray it. 15 lb+ or braid survives.` });
  return out;
}

/** How to work the lure so the attraction model rewards it (presentationMatch). */
export function techniqueTip(lureId: string, waterTempF: number): string {
  const lure = LURES[lureId];
  if (lure.motion === 'swimming') return `Count it down on a slack line to just above the fish, then hold REEL steadily. A slip under ⅓ s is fine; longer stops kill it.`;
  switch (lure.style) {
    case 'steady':
      return `Hold REEL steadily from splashdown to the boat. A slip under ⅓ s is fine; tapping or pumping REEL kills it.`;
    case 'twitchPause': {
      const [lo, hi] = jerkPauseWindow(waterTempF);
      return `Twitch 1-3 times, then pause ${lo}-${hi} s at ${Math.round(waterTempF)}°F. The strike comes on the pause.`;
    }
    case 'walk':
      return `Walk it with an even rhythm (about ${lure.rhythmHz ?? 2} twitches a second), then a short pause.`;
    case 'bottom':
      return `Let it hit bottom first (watch the sonar), then drag slowly and hop it every few seconds. Don't leave it dead for more than ~12 s.`;
    case 'shake':
      return `Let it reach bottom, then shake it in place: two or more shakes every few seconds, barely moving.`;
  }
}

/** How to approach a spot so you don't spook what you came for (stepNavigate). */
export const APPROACH_TIP = `Come off plane ${Math.round(TUNING.boat.outboardSpookRadius * 3)} m out and idle in on the trolling motor: running the outboard within ${TUNING.boat.outboardSpookRadius} m spooks fish for 15-40 minutes.`;

// ---------- Reports ----------

export interface SpotPick {
  spot: SpotDef;
  bitesPerDay: number;
  depthFt: number;
  why: string;
}

export interface LurePick {
  lureId: string;
  colorId: string;
  line: Line;
  /** Expected bites per hour at its best spots (mean of the top 3), averaged over the day. */
  score: number;
  windows: WindowId[];
  spots: SpotPick[];
  reasons: string[];
}

function rigFor(lake: LakeDef, c: Conditions, lureId: string): Rig {
  return { lureId, colorId: bestColor(lake, c, lureId), line: suggestedLine(lake, lureId) };
}

function spotWhy(est: RigEstimate, env: CellEnv[]): string {
  const cover = env.filter((e) => e.cover !== 'none');
  const main = cover.length ? COVER_NAME[mode(cover.map((e) => e.cover))].toLowerCase() : 'open water';
  return `${main}, ${Math.round(est.depthFt)} ft; fish holding ~${Math.round(est.fishDepthFt)} ft`;
}
function mode<T>(v: T[]): T {
  const m = new Map<T, number>();
  for (const x of v) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function reasonsFor(lake: LakeDef, c: Conditions, lureId: string, est: RigEstimate): string[] {
  const lure = LURES[lureId];
  const r: string[] = [];
  const [lo, hi] = lure.tempRangeF;
  r.push(c.waterTempF >= lo && c.waterTempF <= hi ? `${Math.round(c.waterTempF)}°F is in its ${lo}-${hi}°F range` : `${Math.round(c.waterTempF)}°F is outside its ${lo}-${hi}°F range`);
  r.push(`runs ~${Math.round(est.lureDepthFt)} ft where fish hold ~${Math.round(est.fishDepthFt)} ft`);
  if (est.cycleSec < 12) r.push('covers water fast');
  else if (est.cycleSec > 30) r.push('slow: lets followers catch up and commit');
  if (lure.vibration >= 0.6 && lake.clarity.defaultSecchiFt < TUNING.attraction.clearSecchiFt) r.push('vibration carries in stained water');
  return r;
}

/** Rank every lure for a day: its best spots, best windows, and expected bites per hour. */
export function rankLures(lake: LakeDef, c: Conditions, rigs?: Rig[]): LurePick[] {
  const spots = spotsFor(lake).map((s) => ({ s, env: spotEnv(lake, c.season, s) }));
  return (rigs ?? Object.keys(LURES).map((id) => rigFor(lake, c, id)))
    .map((rig) => {
      const lureId = rig.lureId;
      const perWindow = WINDOWS.map((w) => {
        const ests = spots.map(({ s, env }) => ({ s, env, e: estimateRig(c, w.at, rig, env) })).sort((a, b) => b.e.bitesPerDay - a.e.bitesPerDay);
        return { w, ests, top: ests.slice(0, 3).reduce((a, x) => a + x.e.bitesPerDay, 0) / 3 };
      });
      const score = perWindow.reduce((a, x) => a + x.top, 0) / perWindow.length;
      const best = Math.max(...perWindow.map((x) => x.top));
      const morning = perWindow[1].ests;
      return {
        lureId,
        colorId: rig.colorId,
        line: rig.line,
        score,
        windows: perWindow.filter((x) => x.top >= best * 0.85).map((x) => x.w.id),
        spots: morning.slice(0, 3).map(({ s, env, e }) => ({ spot: s, bitesPerDay: e.bitesPerDay, depthFt: e.depthFt, why: spotWhy(e, env) })),
        reasons: reasonsFor(lake, c, lureId, morning[0].e),
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Pre-tournament scouting: the lake's tournament season sampled through the real conditions
 * generator, every lure ranked on each sample, averaged. Deterministic per lake.
 */
export function scoutLake(lake: LakeDef, samples = 16): { picks: LurePick[]; tempRange: [number, number]; seasons: Season[] } {
  const rng = new Rng(0x5c0017 + lake.id.length);
  const totals = new Map<string, { score: number; windows: Map<WindowId, number>; spots: Map<string, { pick: SpotPick; n: number }> }>();
  let tMin = Infinity;
  let tMax = -Infinity;
  const seasons = new Map<Season, number>();
  let last: Conditions | null = null;
  let lastPicks: LurePick[] = [];
  for (let i = 0; i < samples; i++) {
    const c = generateConditions(lake, rng);
    last = c;
    tMin = Math.min(tMin, c.waterTempF);
    tMax = Math.max(tMax, c.waterTempF);
    seasons.set(c.season, (seasons.get(c.season) ?? 0) + 1);
    lastPicks = rankLures(lake, c);
    for (const p of lastPicks) {
      const t = totals.get(p.lureId) ?? { score: 0, windows: new Map(), spots: new Map() };
      t.score += p.score / samples;
      for (const w of p.windows) t.windows.set(w, (t.windows.get(w) ?? 0) + 1);
      for (const sp of p.spots) {
        const cur = t.spots.get(sp.spot.id) ?? { pick: sp, n: 0 };
        cur.n++;
        t.spots.set(sp.spot.id, cur);
      }
      totals.set(p.lureId, t);
    }
  }
  const typical = { ...last!, waterTempF: (tMin + tMax) / 2 };
  const picks: LurePick[] = [...totals.entries()]
    .map(([lureId, t]) => {
      const ref = lastPicks.find((p) => p.lureId === lureId)!;
      return {
        lureId,
        colorId: bestColor(lake, typical, lureId),
        line: suggestedLine(lake, lureId),
        score: t.score,
        windows: [...t.windows.entries()].filter(([, n]) => n >= samples * 0.4).map(([w]) => w),
        spots: [...t.spots.values()].sort((a, b) => b.n - a.n).slice(0, 3).map((x) => x.pick),
        reasons: ref.reasons,
      };
    })
    .sort((a, b) => b.score - a.score);
  return { picks, tempRange: [Math.round(tMin), Math.round(tMax)], seasons: [...seasons.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s) };
}

export interface WindowPlan {
  window: (typeof WINDOWS)[number];
  /** Deck index of the best rig, and every rig's expected bites/hour at its best spot. */
  best: number;
  scores: number[];
  spot: SpotPick;
}

/** For each part of the day: which of your rigs, and where. */
export function dayPlan(lake: LakeDef, c: Conditions, deck: RodSetup[]): WindowPlan[] {
  const spots = spotsFor(lake).map((s) => ({ s, env: spotEnv(lake, c.season, s) }));
  return WINDOWS.map((w) => {
    let bestSpot: SpotPick | null = null;
    const scores = deck.map((d) => Math.max(...spots.map(({ env }) => estimateRig(c, w.at, d, env).bitesPerDay)));
    const best = scores.reduce((bi, sc, i) => (sc > scores[bi] ? i : bi), 0);
    for (const { s, env } of spots) {
      const e = estimateRig(c, w.at, deck[best], env);
      if (!bestSpot || e.bitesPerDay > bestSpot.bitesPerDay) bestSpot = { spot: s, bitesPerDay: e.bitesPerDay, depthFt: e.depthFt, why: spotWhy(e, env) };
    }
    return { window: w, best, scores, spot: bestSpot! };
  });
}

/** In-game pick for right now, for the water around the boat. Returns the deck index. */
export function proPickNow(lake: LakeDef, c: Conditions, deck: RodSetup[], clockMin: number, at: Vec2): number {
  const env = spotEnv(lake, c.season, { x: Math.round(at.x / 20) * 20, y: Math.round(at.y / 20) * 20 });
  let best = 0;
  let bestS = -Infinity;
  deck.forEach((d, i) => {
    const s = estimateRig(c, clockMin, d, env).bitesPerDay;
    if (s > bestS) {
      bestS = s;
      best = i;
    }
  });
  return best;
}

/**
 * Harness bites per advisor-predicted bite (tools/advisor-check.ts CALIB, expert, both lakes): the
 * analytic estimate leaves out spooked arrivals, missed casts and fish that move off.
 */
export const PLAY_CALIBRATION = 0.75;

/** An honest expectation for the day with your best rig on the advisor's route (expert play). */
export function dayOutlook(lake: LakeDef, c: Conditions, deck: RodSetup[]): { bites: number; tough: boolean; text: string } {
  let best = 0;
  for (const d of deck) best = Math.max(best, rankLures(lake, c, [d])[0].score);
  const bites = best * PLAY_CALIBRATION;
  const scout = scoutLake(lake, 8).picks[0].score * PLAY_CALIBRATION;
  const tough = bites < scout * 0.6;
  const text = tough
    ? `Tough day: about ${Math.round(bites)} bites for a pro on the best water (a normal day here is ~${Math.round(scout)}). Slow down and fish the spots below thoroughly.`
    : `A pro fishing the spots below should get around ${Math.round(bites)} bites today.`;
  return { bites, tough, text };
}

/** Expected bites per day of a rig fished at a point (used by the coach). */
export function bitesPerDayAt(lake: LakeDef, c: Conditions, clockMin: number, rig: Rig, at: Vec2): number {
  return estimateRig(c, clockMin, rig, spotEnv(lake, c.season, at)).bitesPerDay;
}

/**
 * A milk run for a rig: the best distinct stops for the day (no two within 80 m, which would share
 * fish), in nearest-neighbour order from the launch.
 */
export function advisorRoute(lake: LakeDef, c: Conditions, rig: Rig, stops = 6): SpotPick[] {
  const ranked = spotsFor(lake)
    .map((s) => {
      const env = spotEnv(lake, c.season, s);
      const v = WINDOWS.reduce((a, w) => a + estimateRig(c, w.at, rig, env).bitesPerDay, 0) / WINDOWS.length;
      return { s, env, v };
    })
    .sort((a, b) => b.v - a.v);
  const chosen: typeof ranked = [];
  for (const r of ranked) {
    if (chosen.length >= stops) break;
    if (chosen.every((o) => Math.hypot(o.s.x - r.s.x, o.s.y - r.s.y) > 80)) chosen.push(r);
  }
  const out: SpotPick[] = [];
  let at: Vec2 = lake.launch;
  while (chosen.length) {
    let bi = 0;
    chosen.forEach((o, i) => {
      if (Math.hypot(o.s.x - at.x, o.s.y - at.y) < Math.hypot(chosen[bi].s.x - at.x, chosen[bi].s.y - at.y)) bi = i;
    });
    const [o] = chosen.splice(bi, 1);
    const e = estimateRig(c, 570, rig, o.env);
    out.push({ spot: o.s, bitesPerDay: o.v, depthFt: e.depthFt, why: spotWhy(e, o.env) });
    at = o.s;
  }
  return out;
}

/** Expected bites from one stop at a point with a given number of casts (the harness gate). */
export function bitesPerVisitAt(lake: LakeDef, c: Conditions, clockMin: number, rig: Rig, at: Vec2, casts: number): number {
  return estimateRig(c, clockMin, rig, spotEnv(lake, c.season, at), casts).bitesPerVisit;
}
