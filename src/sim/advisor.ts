// Pro advice, computed from the game's own strike model rather than written by hand.
//
// A fish's interest in a lure grows at `interestRate` (fish/attraction.ts). Everything in that
// product except the player's cadence and the individual fish can be evaluated ahead of time:
// activity (temperature, time of day, pressure, front, sky, season), depth match between where the
// lure runs and where fish hold, lure temperature/light/wind fit, colour vs clarity, line
// visibility, species affinity, and how far away fish notice the lure (detectRange). The advisor
// multiplies the same functions, weighted by where the lake's bass actually live in that season,
// so its rankings move exactly when the fish's behaviour does. tools/advisor-check.ts verifies the
// rankings against bot fishing.
import type { LakeDef } from '../data/lakes/types';
import { COLORS, LURES, type LureDef } from '../data/lures';
import { RODS } from '../data/rods';
import { SPECIES } from '../data/species';
import { TUNING } from '../data/tuning';
import { generateConditions, lightLevel } from './conditions';
import { bassMix } from './field';
import { activityFor } from './fish/activity';
import { colorFit, depthMatch, detectRange, jerkPauseWindow, lineVisibilityFit, lureConditionFit, lureTempFit } from './fish/attraction';
import { holdingDepth } from './fish/population';
import { getLakeGrid } from './lake';
import { Rng } from './rng';
import type { Conditions, Line, RodSetup, Season } from './types';

/** Parts of the tournament day the advice is broken into (game minutes). */
export const WINDOWS = [
  { id: 'dawn', label: 'Dawn', from: 360, to: 480, at: 400 },
  { id: 'morning', label: 'Morning', from: 480, to: 660, at: 570 },
  { id: 'midday', label: 'Midday', from: 660, to: 810, at: 735 },
  { id: 'late', label: 'Late', from: 810, to: 900, at: 855 },
] as const;
export type WindowId = (typeof WINDOWS)[number]['id'];

/** Typical detection range used to normalise the reach factor (m). */
const REACH_REF = 5;
/** Productive seconds in a typical cast (time the lure spends being worked). */
const CAST_WORK_SEC = 20;

/**
 * Water swept per second: a lure worked at v m/s passes ~v x (2 x reach) of new water each second,
 * on top of the fish already within reach. Normalised as 1 + v. Validated against bot fishing.
 */
function coverage(lure: LureDef): number {
  return 1 + (lure.speedBand[0] + lure.speedBand[1]) / 2;
}

/** Bottom baits only fish well once they're down (presentationMatch scores the fall at 0.45). */
function fallEfficiency(lure: LureDef, spotFt: number): number {
  if (lure.motion !== 'sinking' || lure.fallRateFtPerSec <= 0) return 1;
  const fallSec = spotFt / lure.fallRateFtPerSec;
  return 1 - 0.55 * Math.min(1, fallSec / CAST_WORK_SEC);
}

export interface Rig {
  lureId: string;
  colorId: string;
  line: Line;
  rodId?: string;
}

/** Where the lure works relative to a spot of `spotFt` depth (presentation.ts depth rules). */
export function lureWorkingDepth(lure: LureDef, line: Line, spotFt: number): number {
  const lineFactor = line.testLb <= 10 ? 1.1 : line.testLb >= 15 ? 0.9 : 1;
  switch (lure.motion) {
    case 'surface':
      return 0;
    case 'diving':
    case 'suspending':
      return Math.min(spotFt, lure.runDepthFt * lineFactor);
    case 'sinking':
      return spotFt;
  }
}

export interface DepthBin {
  ft: number;
  weight: number;
}

/**
 * Where the lake's bass live this season, as weighted bottom depths. Mirrors generatePopulation:
 * placement odds = season depth suitability x cover preference over every water cell.
 */
export function fishDepthProfile(lake: LakeDef, season: Season): DepthBin[] {
  const g = getLakeGrid(lake);
  const mix = bassMix(lake);
  const bins = new Map<number, number>();
  const step = 3;
  for (let i = 0; i < g.water.length; i += step) {
    if (!g.water[i]) continue;
    const d = g.depthFt[i];
    let w = 0;
    for (const [sp, frac] of mix) {
      const [lo, hi] = SPECIES[sp].depthBySeason[season];
      const suit = d >= lo && d <= hi ? 1 : Math.exp(-(d < lo ? lo - d : d - hi) / 6);
      w += frac * suit;
    }
    // Structure concentrates fish (squared cover weight, as in placement); a floor for open water.
    const bin = Math.round(d / 3) * 3 || 2;
    bins.set(bin, (bins.get(bin) ?? 0) + w * (g.cover[i] ? 1.6 : 1));
  }
  const total = [...bins.values()].reduce((a, b) => a + b, 0) || 1;
  return [...bins.entries()].map(([ft, w]) => ({ ft, weight: w / total })).filter((b) => b.weight > 0.01);
}

export interface RigScore {
  /** Relative bite pull (comparable within the same lake and day). */
  score: number;
  temp: number;
  light: number;
  color: number;
  line: number;
  reach: number;
  depth: number;
  affinity: number;
  coverage: number;
}

/** Expected interest gain for a rig at a time of day, averaged over where fish hold. */
export function scoreRig(lake: LakeDef, c: Conditions, clockMin: number, rig: Rig, profile: DepthBin[]): RigScore {
  const lure = LURES[rig.lureId];
  const color = COLORS[rig.colorId];
  const light = lightLevel(clockMin, c.weather);
  const secchi = lake.clarity.defaultSecchiFt;
  const mix = bassMix(lake);
  let bite = 0;
  let depth = 0;
  let affinity = 0;
  for (const [sp, frac] of mix) {
    const act = activityFor(sp, c, clockMin, 3);
    const aff = SPECIES[sp].lureAffinity?.[lure.id] ?? 1;
    let dm = 0;
    for (const b of profile) dm += b.weight * depthMatch(lureWorkingDepth(lure, rig.line, b.ft), holdingDepth(b.ft, light, act), act) * fallEfficiency(lure, b.ft);
    bite += frac * act * dm * aff;
    depth += frac * dm;
    affinity += frac * aff;
  }
  const temp = lureTempFit(lure, c.waterTempF);
  const lightFit = lureConditionFit(lure, c, light);
  const colorF = colorFit(color, secchi, light);
  const lineF = lineVisibilityFit(rig.line, secchi, lure);
  const reach = detectRange(lure, secchi, light) / REACH_REF;
  const cov = coverage(lure);
  return { score: bite * temp * lightFit * colorF * lineF * reach * cov, temp, light: lightFit, color: colorF, line: lineF, reach, depth, affinity, coverage: cov };
}

/** Day-long score: mean over the four windows. */
export function scoreRigDay(lake: LakeDef, c: Conditions, rig: Rig, profile = fishDepthProfile(lake, c.season)): number {
  return WINDOWS.reduce((a, w) => a + scoreRig(lake, c, w.at, rig, profile).score, 0) / WINDOWS.length;
}

/** Best colour of a lure for the lake's clarity and the day's light (colour is a small effect). */
export function bestColor(lake: LakeDef, c: Conditions, lureId: string): string {
  const lure = LURES[lureId];
  const secchi = lake.clarity.defaultSecchiFt;
  let best = lure.colors[0];
  let bestF = -Infinity;
  for (const id of lure.colors) {
    const f = WINDOWS.reduce((a, w) => a + colorFit(COLORS[id], secchi, lightLevel(w.at, c.weather)), 0);
    if (f > bestF) {
      bestF = f;
      best = id;
    }
  }
  return best;
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
  switch (lure.style) {
    case 'steady':
      return `Steady retrieve: hold REEL and keep it moving. Bump cover for reaction strikes.`;
    case 'twitchPause': {
      const [lo, hi] = jerkPauseWindow(waterTempF);
      return `Twitch 1-3 times, then pause ${lo}-${hi} s at ${Math.round(waterTempF)}°F. The strike comes on the pause.`;
    }
    case 'walk':
      return `Walk it with an even rhythm (about ${lure.rhythmHz ?? 2} twitches a second), then a short pause.`;
    case 'bottom':
      return `Let it hit bottom, drag slowly and hop it every few seconds. Don't leave it dead for more than ~12 s.`;
    case 'shake':
      return `Keep it on the bottom and shake it in place: two or more shakes every few seconds, barely moving.`;
  }
}

// ---------- Reports ----------

export interface LurePick {
  lureId: string;
  colorId: string;
  line: Line;
  score: number;
  /** Best time windows for it. */
  windows: WindowId[];
  reasons: string[];
}

function reasonsFor(lake: LakeDef, c: Conditions, lureId: string, profile: DepthBin[]): string[] {
  const lure = LURES[lureId];
  const r: string[] = [];
  const [lo, hi] = lure.tempRangeF;
  if (c.waterTempF >= lo && c.waterTempF <= hi) r.push(`${Math.round(c.waterTempF)}°F water is in its ${lo}-${hi}°F range`);
  else r.push(`${Math.round(c.waterTempF)}°F is outside its ${lo}-${hi}°F range`);
  const fishFt = profile.reduce((a, b) => a + b.ft * b.weight, 0);
  if (lure.motion === 'sinking') r.push(`fishes the bottom where bass hold (~${Math.round(fishFt)} ft)`);
  else if (lure.motion === 'surface') r.push('pulls fish up in low light');
  else r.push(`runs ${lure.runDepthFt} ft; bass are holding ~${Math.round(fishFt)} ft`);
  if (lure.vibration >= 0.6 && lake.clarity.defaultSecchiFt < TUNING.attraction.clearSecchiFt) r.push('vibration carries in stained water');
  const aff = bassMix(lake).reduce((a, [sp, w]) => a + w * (SPECIES[sp].lureAffinity?.[lureId] ?? 1), 0);
  if (aff >= 1.08) r.push(`the lake's ${bassMix(lake)[0][0] === 'smallmouth' ? 'smallmouth' : 'largemouth'} love it`);
  if (lure.style === 'steady' && c.windMph >= 8) r.push('wind makes moving baits better');
  if (coverage(lure) >= 1.6) r.push('covers water fast');
  return r;
}

/** Rank every lure in the game for a given day (best colour and line for each). */
export function rankLures(lake: LakeDef, c: Conditions, profile = fishDepthProfile(lake, c.season)): LurePick[] {
  const picks = Object.keys(LURES).map((lureId) => {
    const colorId = bestColor(lake, c, lureId);
    const line = suggestedLine(lake, lureId);
    const per = WINDOWS.map((w) => ({ id: w.id, s: scoreRig(lake, c, w.at, { lureId, colorId, line }, profile).score }));
    const score = per.reduce((a, x) => a + x.s, 0) / per.length;
    const top = Math.max(...per.map((x) => x.s));
    return { lureId, colorId, line, score, windows: per.filter((x) => x.s >= top * 0.85).map((x) => x.id), reasons: reasonsFor(lake, c, lureId, profile) };
  });
  return picks.sort((a, b) => b.score - a.score);
}

/**
 * Pre-tournament scouting: the lake's tournament months sampled through the real conditions
 * generator, every lure scored on each sample, then averaged. Deterministic per lake.
 */
export function scoutLake(lake: LakeDef, samples = 24): { picks: LurePick[]; tempRange: [number, number]; seasons: Season[] } {
  const rng = new Rng(0x5c0017 + lake.id.length);
  const totals = new Map<string, { score: number; windows: Map<WindowId, number> }>();
  let tMin = Infinity;
  let tMax = -Infinity;
  const seasons = new Map<Season, number>();
  const profiles = new Map<Season, DepthBin[]>();
  let last: Conditions | null = null;
  for (let i = 0; i < samples; i++) {
    const c = generateConditions(lake, rng);
    last = c;
    tMin = Math.min(tMin, c.waterTempF);
    tMax = Math.max(tMax, c.waterTempF);
    seasons.set(c.season, (seasons.get(c.season) ?? 0) + 1);
    if (!profiles.has(c.season)) profiles.set(c.season, fishDepthProfile(lake, c.season));
    for (const p of rankLures(lake, c, profiles.get(c.season)!)) {
      const t = totals.get(p.lureId) ?? { score: 0, windows: new Map() };
      t.score += p.score / samples;
      for (const w of p.windows) t.windows.set(w, (t.windows.get(w) ?? 0) + 1);
      totals.set(p.lureId, t);
    }
  }
  const typical = last!;
  const profile = profiles.get(typical.season)!;
  const picks: LurePick[] = [...totals.entries()]
    .map(([lureId, t]) => ({
      lureId,
      colorId: bestColor(lake, typical, lureId),
      line: suggestedLine(lake, lureId),
      score: t.score,
      windows: [...t.windows.entries()].filter(([, n]) => n >= samples * 0.4).map(([w]) => w),
      reasons: reasonsFor(lake, { ...typical, waterTempF: (tMin + tMax) / 2 }, lureId, profile),
    }))
    .sort((a, b) => b.score - a.score);
  const seasonList = [...seasons.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  return { picks, tempRange: [Math.round(tMin), Math.round(tMax)], seasons: seasonList };
}

/** For each time window, which of the player's rigs pulls the most bites (index into deck). */
export function dayPlan(lake: LakeDef, c: Conditions, deck: RodSetup[]): { window: (typeof WINDOWS)[number]; best: number; scores: number[] }[] {
  const profile = fishDepthProfile(lake, c.season);
  return WINDOWS.map((w) => {
    const scores = deck.map((d) => scoreRig(lake, c, w.at, d, profile).score);
    const best = scores.reduce((bi, s, i) => (s > scores[bi] ? i : bi), 0);
    return { window: w, best, scores };
  });
}

/** In-game pick for right now, at the depth under the boat. Returns the deck index. */
export function proPickNow(lake: LakeDef, c: Conditions, deck: RodSetup[], clockMin: number, spotFt: number): number {
  const profile = [{ ft: Math.max(2, spotFt), weight: 1 }];
  let best = 0;
  let bestS = -Infinity;
  deck.forEach((d, i) => {
    const s = scoreRig(lake, c, clockMin, d, profile).score;
    if (s > bestS) {
      bestS = s;
      best = i;
    }
  });
  return best;
}

export const windowAt = (clockMin: number) => WINDOWS.find((w) => clockMin < w.to) ?? WINDOWS[WINDOWS.length - 1];
