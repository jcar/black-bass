// The attraction meter: our successor to the NES game's hidden lure-action number (the one the
// "MIRUN" name-entry cheat displays; the target there is 6.0 or higher).
// Every nearby fish keeps a 0..10 interest score toward the lure. It rises when the lure is
// worked the way that lure is meant to be worked, at the depth the fish holds, where the fish
// can perceive it. It decays otherwise. Crossing the strike line triggers a strike.

import { type ColorDef, type LureDef } from '../../data/lures';
import { SPECIES } from '../../data/species';
import { TUNING } from '../../data/tuning';
import type { Conditions, FishEntity, Line, PresentState, SpeciesId } from '../types';

const A = TUNING.attraction;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Ideal jerkbait pause window by water temp: 40-45F pause 4-8 s, warmer water shorter. */
export function jerkPauseWindow(tempF: number): [number, number] {
  if (tempF < 45) return [4, 8];
  if (tempF < 52) return [2.5, 6];
  if (tempF < 62) return [1.5, 4];
  return [0.8, 2.5];
}

export function countSince(times: number[], since: number, until = Infinity): number {
  let n = 0;
  for (const t of times) if (t >= since && t <= until) n++;
  return n;
}

/** How well the current cadence matches the lure's intended action, 0..1. */
export function presentationMatch(lure: LureDef, p: PresentState, tempF: number): number {
  const now = p.t;
  const lastTwitch = p.twitchTimes.length ? p.twitchTimes[p.twitchTimes.length - 1] : -Infinity;
  const paused = p.pauseStartT !== null;
  const pauseLen = paused ? now - (p.pauseStartT as number) : 0;

  switch (lure.style) {
    case 'steady': {
      if (p.avgSpeed < 0.05) return 0.1;
      const [lo, hi] = lure.speedBand;
      const off = p.avgSpeed < lo ? lo - p.avgSpeed : p.avgSpeed > hi ? p.avgSpeed - hi : 0;
      const inBand = Math.exp(-off / 0.3);
      const steadiness = clamp01(p.movingFor / 1.0);
      return 0.2 + 0.8 * inBand * steadiness;
    }
    case 'twitchPause': {
      if (paused) {
        const [lo, hi] = jerkPauseWindow(tempF);
        const burst = countSince(p.twitchTimes, (p.pauseStartT as number) - 1.6, p.pauseStartT as number);
        const burstOk = burst >= 1 && burst <= 3 ? 1 : burst > 3 ? 0.6 : 0.2;
        const pauseFit = pauseLen < lo ? 0.3 + 0.5 * (pauseLen / lo) : pauseLen <= hi ? 1 : Math.max(0.15, 1 - (pauseLen - hi) / hi);
        return burstOk * pauseFit;
      }
      return now - lastTwitch < 0.6 ? 0.5 : 0.25;
    }
    case 'walk': {
      const ideal = 1 / (lure.rhythmHz ?? 2);
      const recent = p.twitchTimes.filter((t) => t >= now - 2.5);
      if (recent.length < 3) {
        // A short pause after a good walking cadence is when many topwater strikes happen.
        const priorRhythm = countSince(p.twitchTimes, now - 4.5, now - 0.3) >= 4;
        return paused && pauseLen < 2.2 && priorRhythm ? 0.75 : p.avgSpeed > 0.1 ? 0.2 : 0.15;
      }
      const intervals: number[] = [];
      for (let i = 1; i < recent.length; i++) intervals.push(recent[i] - recent[i - 1]);
      const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const sd = Math.sqrt(intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length);
      const fitI = Math.exp(-Math.abs(mean - ideal) / 0.25);
      const fitR = Math.exp(-(sd / Math.max(0.05, mean)) * 2.5);
      return 0.15 + 0.85 * fitI * fitR;
    }
    case 'bottom': {
      if (!p.onBottom) return 0.45; // bites on the fall
      const hi = lure.speedBand[1];
      const speedFit = p.avgSpeed <= hi ? 1 : Math.exp(-(p.avgSpeed - hi) / 0.2);
      const age = now - lastTwitch;
      const hopFit = age < 1.5 ? 1 : age < 6 ? 0.9 : 0.6;
      const boredom = p.stillFor > 12 ? 0.55 : 1;
      return speedFit * hopFit * boredom;
    }
    case 'shake': {
      // Shaken on the bottom, or held mid-water at a suspended fish (spool thumbed on the fall).
      if (!p.onBottom && !p.held) return 0.3;
      const speedFit = p.avgSpeed <= 0.15 ? 1 : 0.3;
      const shakes = countSince(p.twitchTimes, now - 3);
      return speedFit * (shakes >= 2 ? 1 : shakes === 1 ? 0.8 : 0.55);
    }
  }
}

/** Soft fit of the lure's best temperature range. */
export function lureTempFit(lure: LureDef, tempF: number): number {
  const [lo, hi] = lure.tempRangeF;
  const off = tempF < lo ? lo - tempF : tempF > hi ? tempF - hi : 0;
  return Math.max(0.25, Math.exp(-off / 6));
}

/** Light/wind fit: topwater wants low light and calm water; moving baits like wind; finesse likes bright sun. */
export function lureConditionFit(lure: LureDef, c: Conditions, light: number): number {
  let f = 1;
  if (lure.motion === 'surface') {
    f *= 1.15 - 0.6 * light;
    if (c.windMph > 12) f *= 0.75;
  }
  if (lure.style === 'steady' && c.windMph >= 8) f *= 1.15;
  if (lure.style === 'bottom' || lure.style === 'shake') f *= 1 + 0.25 * light;
  return f;
}

/**
 * Colour matters less than anglers think (Moraga et al. 2015: no catch-rate difference at constant
 * clarity). Bass have red and green cones only, so model contrast against the water, capped at ~10%.
 */
export function colorFit(color: ColorDef, secchiFt: number, light: number): number {
  let score: number;
  if (secchiFt >= A.clearSecchiFt) {
    score = { natural: 1, bright: -0.5, dark: 0, red: 0.3 }[color.family];
    if (light < 0.4 && color.family === 'dark') score += 0.5;
  } else if (secchiFt <= A.muddySecchiFt) {
    score = { natural: -1, bright: 1, dark: 1, red: 0.3 }[color.family];
  } else {
    score = color.family === 'red' ? 0.3 : 0;
    if (light < 0.4 && color.family === 'dark') score += 0.5;
  }
  return 1 + A.colorEffect * score;
}

export function lineVisibilityFit(line: Line, secchiFt: number, lure: LureDef): number {
  if (secchiFt < A.clearSecchiFt || lure.motion === 'surface') return 1;
  return line.type === 'fluoro' ? 1 : line.type === 'mono' ? 0.96 : 0.9;
}

/** Detection radius (m): sight scales with clarity and light, vibration carries in dirty water. */
export function detectRange(lure: LureDef, secchiFt: number, light: number): number {
  const visual = Math.min(A.visualRangeMax, Math.max(A.visualRangeMin, secchiFt * 0.3048 * A.visualRangePerSecchiM)) * (0.6 + 0.4 * light);
  const vib = lure.vibration * (A.vibrationRangeM + (secchiFt <= A.muddySecchiFt ? A.muddyVibrationBonusM : 0));
  return Math.max(visual, vib, 1.2);
}

export function depthMatch(lureDepthFt: number, fishDepthFt: number, activity: number): number {
  const sigma = A.depthSigmaBaseFt + A.depthSigmaActiveFt * Math.min(1.2, activity);
  const dz = lureDepthFt - fishDepthFt;
  return Math.exp(-(dz * dz) / (2 * sigma * sigma));
}

export interface AttractionContext {
  lure: LureDef;
  color: ColorDef;
  line: Line;
  conditions: Conditions;
  light: number;
  secchiFt: number;
  match: number;
  coverNear: boolean;
  pressure: number;
  clockMin: number;
  /** The lake's median length by species (for big-fish baits); absent = no size lean. */
  medianIn?: Partial<Record<SpeciesId, number>>;
}

/**
 * Big-fish baits (swimbaits, frogs, flipping jigs): fit scales with the fish's length against the
 * lake's median, (L / median)^(3 x lean), roughly weight^lean. Lengths are lognormal around the
 * median, so the lean shifts bites toward big fish while barely changing the mean.
 */
export function sizeLeanFit(lure: LureDef, f: Pick<FishEntity, 'species' | 'lengthIn'>, medianIn?: Partial<Record<SpeciesId, number>>): number {
  const lean = lure.bigFishLean ?? 0;
  const med = medianIn?.[f.species];
  if (!lean || !med) return 1;
  return Math.min(A.sizeLeanMax, Math.max(A.sizeLeanMin, Math.pow(f.lengthIn / med, 3 * lean)));
}

/** Per-fish gain rate for the interest meter (per second). Exported for tests and the debug overlay. */
export function interestRate(f: FishEntity, ctx: AttractionContext, activity: number, proximity: number, lureDepthFt: number): number {
  const sp = SPECIES[f.species];
  const affinity = sp.lureAffinity?.[ctx.lure.id] ?? 1;
  return (
    A.gainPerSec *
    activity *
    ctx.match *
    depthMatch(lureDepthFt, f.depthFt, activity) *
    proximity *
    (ctx.coverNear ? A.coverBonus : 1) *
    f.vulnerability *
    (1 - A.hookShyPenalty * f.hookShy) *
    lureTempFit(ctx.lure, ctx.conditions.waterTempF) *
    lureConditionFit(ctx.lure, ctx.conditions, ctx.light) *
    colorFit(ctx.color, ctx.secchiFt, ctx.light) *
    lineVisibilityFit(ctx.line, ctx.secchiFt, ctx.lure) *
    affinity *
    sizeLeanFit(ctx.lure, f, ctx.medianIn) *
    (1 - ctx.pressure * 0.4)
  );
}
