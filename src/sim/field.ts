import type { LakeDef } from '../data/lakes/types';
import { SPECIES, weightFromLength } from '../data/species';
import { TUNING } from '../data/tuning';
import { activityFor } from './fish/activity';
import { sampleLength } from './fish/population';
import { inSlot, isBigFish, isCwir, keeperMinIn } from './livewell';
import type { Rng } from './rng';
import { scaleLb } from './format';
import type { Conditions, Rival, SpeciesId, Tier } from './types';

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

/** The lake's bass mix (what rivals weigh in), normalised. Falls back to an even LM/SM split. */
export function bassMix(lake?: LakeDef): [SpeciesId, number][] {
  const mix = Object.entries(lake?.species.default ?? {}).filter(([sp, w]) => SPECIES[sp as SpeciesId].isBass && (w ?? 0) > 0) as [SpeciesId, number][];
  const out: [SpeciesId, number][] = mix.length ? mix : [['largemouth', 0.5], ['smallmouth', 0.5]];
  const sum = out.reduce((a, [, w]) => a + w, 0);
  return out.map(([sp, w]) => [sp, w / sum]);
}

/** How good the bite is today relative to an average day (sqrt-damped so the field stays sane). */
export function biteFactor(c: Conditions, lake?: LakeDef): number {
  const today = bassMix(lake).reduce((a, [sp, w]) => a + activityFor(sp, c, 9 * 60, 3) * w, 0);
  return Math.sqrt(Math.max(0.5, Math.min(1.6, today / 0.8)));
}

/**
 * Pre-sample a rival's catches for the day as individual fish. Each keeper's species and length come
 * from the lake's own population model (so trophy lakes produce real kickers), then the weights are
 * scaled so the best five equal a bag drawn from the lognormal calibrated per lake and tier
 * (e.g. Champlain Elite days: ~18-22 lb winners). Calibration is unchanged; the shape is the lake's.
 * Rivals weigh only legal fish (the minimum; at a ramp weigh-in also the slot and big-fish limits) and
 * can be late to check-in.
 */
export function rollRivalDay(r: Rival, lake: LakeDef, tier: Tier, c: Conditions, rng: Rng): void {
  const T = TUNING.clock;
  r.catches = [];
  r.feedCursor = 0;
  // Now and then a rival misses check-in: 1 lb a minute, and over 15 minutes the day counts zero.
  const C = TUNING.checkIn;
  r.lateMin = rng.chance(C.rivalLateChance) ? (rng.chance(C.rivalZeroShare) ? rng.int(C.lateMaxMin + 1, C.lateMaxMin + 10) : rng.int(1, 12)) : 0;
  if (rng.chance(0.03)) return; // zeroed: it happens
  const bag = rng.logNormal(lake.field.medianBagLb[tier] * r.skill * biteFactor(c, lake), lake.field.sigma);
  const keepers = rng.int(5, 11);
  const mix = bassMix(lake);
  const minIn = keeperMinIn(lake);
  // Rivals play by the lake's rules: shorts go back (and are re-rolled). Under catch-weigh-immediate-
  // release (Lake Fork) every legal bass is weighed on the boat and counts, slot fish included. At a
  // ramp weigh-in, protected-slot fish go back and only `regs.bigFish.perDay` fish over its length stay.
  const ramp = !isCwir(lake);
  const big = ramp ? lake.regs?.bigFish : undefined;
  let bigKept = 0;
  const fish: { species: SpeciesId; len: number; w: number }[] = [];
  for (let i = 0; i < keepers; i++) {
    const species = rng.weighted(
      mix.map(([sp]) => sp),
      (sp) => mix.find(([x]) => x === sp)![1],
    );
    let len = 0;
    for (let k = 0; k < 6 && len < minIn; k++) len = sampleLength(rng, lake, species, rng.chance(0.7));
    len = Math.max(len, minIn);
    const w = weightFromLength(species, len, lake.species.condition * rng.normal(1, 0.05));
    if (ramp && inSlot({ species, lengthIn: len }, lake)) continue;
    if (big && isBigFish({ species, lengthIn: len }, lake) && ++bigKept > big.perDay) continue;
    fish.push({ species, len, w });
  }
  if (!fish.length) return;
  const best5 = [...fish]
    .sort((a, b) => b.w - a.w)
    .slice(0, 5)
    .reduce((a, f) => a + f.w, 0);
  const k = bag / best5;
  // A weak day sometimes means fewer than 5 keepers.
  const kept = rng.chance(0.08) ? fish.slice(0, rng.int(2, 4)) : fish;
  // Never scale a fish past the biggest the lake can grow (keeps Champlain kickers plausible), nor, at a
  // ramp weigh-in, a fish under a protected slot past the slot's bottom length (it would be a slot fish).
  const slot = ramp ? lake.regs?.slot : undefined;
  const cap = (f: (typeof fish)[number]) =>
    slot && f.species === 'largemouth' && f.len < slot.minIn
      ? weightFromLength(f.species, slot.minIn, lake.species.condition)
      : weightFromLength(f.species, lake.species.sizes[f.species]?.maxIn ?? 22, lake.species.condition * 1.05);
  for (const f of kept)
    r.catches.push({ atMin: rng.range(T.dayStartMin + 10, T.dayEndMin - 15), weightLb: scaleLb(Math.max(0.9, Math.min(cap(f), f.w * k))), species: f.species });
  r.catches.sort((a, b) => a.atMin - b.atMin);
}

/** Today's reportable fish weight: the top ~8% of everything the field will catch. */
export function notableWeight(rivals: Rival[]): number {
  const all = rivals.flatMap((r) => r.catches.map((c) => c.weightLb)).sort((a, b) => b - a);
  return Math.max(2, all[Math.floor(all.length * 0.08)] ?? 4);
}

/** A rival's best-5 bag at a given clock time (the live leaderboard). */
export function rivalBagAt(r: Rival, clockMin: number): number {
  const got = r.catches.filter((c) => c.atMin <= clockMin).map((c) => c.weightLb);
  got.sort((a, b) => b - a);
  return got.slice(0, 5).reduce((a, b) => a + scaleLb(b), 0);
}

/** A rival's weight on the scales today: the best five, less the late penalty (zero if over 15 minutes late). */
export function rivalDayWeight(r: Rival): number {
  const late = r.lateMin ?? 0;
  if (late > TUNING.checkIn.lateMaxMin) return 0;
  return Math.max(0, scaleLb(rivalBagAt(r, TUNING.clock.dayEndMin) - late * TUNING.checkIn.latePenaltyLbPerMin));
}

/** A rival's bag on the live leaderboard: what's in the boat, then what's on the scales after check-in time. */
export const rivalTodayAt = (r: Rival, clockMin: number) => (clockMin >= TUNING.clock.dayEndMin ? rivalDayWeight(r) : rivalBagAt(r, clockMin));

export interface Standing {
  id: number; // -1 = player
  name: string;
  total: number;
  today: number;
  isPlayer: boolean;
  cut: boolean;
}
