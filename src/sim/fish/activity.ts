import { SPECIES } from '../../data/species';
import { TUNING } from '../../data/tuning';
import { timeOfDayFactor } from '../conditions';
import type { Conditions, SpeciesId } from '../types';

/** Asymmetric Gaussian: activity drops off faster above the optimum than below it. */
export function tempFactor(species: SpeciesId, tempF: number): number {
  const A = TUNING.activity;
  const opt = SPECIES[species].tempOptF;
  const sigma = tempF < opt ? A.tempSigmaBelowF : A.tempSigmaAboveF;
  const g = Math.exp(-((tempF - opt) ** 2) / (2 * sigma * sigma));
  return A.tempFloor + (1 - A.tempFloor) * g;
}

/**
 * How willing a fish is to feed right now, roughly 0..1.6.
 * Combines temperature, time of day, barometric trend (Manns: 65% struck on a falling
 * barometer vs 30% rising), post-front lockjaw (bigger fish affected more), sky and season.
 */
export function activityFor(species: SpeciesId, c: Conditions, clockMin: number, weightLb: number): number {
  const A = TUNING.activity;
  let a = tempFactor(species, c.waterTempF);
  a *= timeOfDayFactor(clockMin);
  a *= A.pressure[c.pressureTrend];
  if (c.postFront) a *= Math.pow(A.postFront, Math.min(2, 0.5 + weightLb / 4));
  a *= 1 + Math.max(-A.trendCap, Math.min(A.trendCap, c.tempTrendFPerDay * A.trendPerF));
  a *= A.weather[c.weather];
  a *= A.season[c.season];
  return a;
}
