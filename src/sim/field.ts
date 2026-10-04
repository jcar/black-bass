import type { LakeDef } from '../data/lakes/types';
import { TUNING } from '../data/tuning';
import { activityFor } from './fish/activity';
import type { Rng } from './rng';
import type { Conditions, Rival, Tier } from './types';

// Clearly fictional names for the simulated field.
const FIRST = ['Cody', 'Wade', 'Brandt', 'Luke', 'Dale', 'Rory', 'Tate', 'Hank', 'Mason', 'Jesse', 'Colt', 'Reid', 'Shane', 'Beau', 'Trey', 'Jory', 'Kai', 'Nate', 'Sam', 'Dusty', 'Ty', 'Gabe', 'Abel', 'Rhett', 'Casey', 'Jordan', 'Ray', 'Kendall', 'Quinn', 'Avery'];
const LAST = ['Marsh', 'Hollow', 'Pickett', 'Stroud', 'Kettle', 'Bramley', 'Fenwick', 'Larue', 'Sutter', 'Gaines', 'Holloway', 'Tackett', 'Varner', 'Bixby', 'Crane', 'Dunmore', 'Ellery', 'Fairbank', 'Greer', 'Haskins', 'Ivers', 'Judd', 'Kimble', 'Lockhart', 'Mayfield', 'Norwood', 'Oakes', 'Prather', 'Quarles', 'Rowan'];
const TOWNS = ['Elmwood, TN', 'Cedar Fork, AL', 'Pine Hollow, TX', 'Red Bluff, LA', 'Maple Point, NY', 'Stillwater, VT', 'Grand Shoals, MN', 'Lake City, SC', 'Twin Oaks, AR', 'Clear Fork, OK', 'Bayside, FL', 'Granite Falls, NC'];

export function createRivals(rng: Rng, n: number): Rival[] {
  const used = new Set<string>();
  const rivals: Rival[] = [];
  for (let i = 0; i < n; i++) {
    let name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
    while (used.has(name)) name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
    used.add(name);
    rivals.push({ id: i, name, hometown: rng.pick(TOWNS), skill: Math.max(0.6, rng.logNormal(1, 0.16)), catches: [], dayWeights: [], cut: false });
  }
  return rivals;
}

/** How good the bite is today relative to an average day (sqrt-damped so the field stays sane). */
export function biteFactor(c: Conditions): number {
  const today = activityFor('largemouth', c, 9 * 60, 3) * 0.5 + activityFor('smallmouth', c, 9 * 60, 3) * 0.5;
  return Math.sqrt(Math.max(0.5, Math.min(1.6, today / 0.8)));
}

/**
 * Pre-sample a rival's catches for the day. The bag is drawn from a lognormal calibrated per lake
 * and tier (e.g. Champlain Elite days: ~18-22 lb winners), then split into 5 fish plus smaller culls.
 */
export function rollRivalDay(r: Rival, lake: LakeDef, tier: Tier, c: Conditions, rng: Rng): void {
  const T = TUNING.clock;
  r.catches = [];
  if (rng.chance(0.03)) return; // zeroed: it happens
  const bag = rng.logNormal(lake.field.medianBagLb[tier] * r.skill * biteFactor(c), lake.field.sigma);
  const keepers = rng.int(5, 11);
  const parts = Array.from({ length: 5 }, () => rng.range(0.6, 1.4));
  const sum = parts.reduce((a, b) => a + b, 0);
  const top = parts.map((p) => Math.max(0.9, Math.round(((bag * p) / sum) * 100) / 100));
  const smallest = Math.min(...top);
  const weights = [...top];
  for (let i = 5; i < keepers; i++) weights.push(Math.round(rng.range(0.9, smallest) * 100) / 100);
  // A weak day sometimes means fewer than 5 keepers.
  const kept = rng.chance(0.08) ? weights.slice(0, rng.int(2, 4)) : weights;
  for (const wt of kept) r.catches.push({ atMin: rng.range(T.dayStartMin + 10, T.dayEndMin - 15), weightLb: wt });
  r.catches.sort((a, b) => a.atMin - b.atMin);
}

/** A rival's best-5 bag at a given clock time (the live leaderboard). */
export function rivalBagAt(r: Rival, clockMin: number): number {
  const got = r.catches.filter((c) => c.atMin <= clockMin).map((c) => c.weightLb);
  got.sort((a, b) => b - a);
  return Math.round(got.slice(0, 5).reduce((a, b) => a + b, 0) * 100) / 100;
}

export interface Standing {
  id: number; // -1 = player
  name: string;
  total: number;
  today: number;
  isPlayer: boolean;
  cut: boolean;
}
