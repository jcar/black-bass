import { LAKES } from '../data/lakes';
import type { LakeDef } from '../data/lakes/types';
import { SPECIES } from '../data/species';
import { TUNING } from '../data/tuning';
import { activeTackle, emit } from './context';
import { coverAt, depthAt, getLakeGrid, nearCover } from './lake';
import { transition } from './machine';
import type { Rng } from './rng';
import type { CaughtFish, FishEntity, TournamentState } from './types';

export const LIVEWELL_LIMIT = 5;

export const keeperMinIn = (lake?: LakeDef) => lake?.regs?.minIn ?? TUNING.population.keeperMinIn;

/** Protected-slot bass (TPWD Lake Fork: 16-24" largemouth): released immediately, never weighed. */
export const inSlot = (c: Pick<CaughtFish, 'species' | 'lengthIn'>, lake?: LakeDef) => {
  const slot = lake?.regs?.slot;
  return !!slot && c.species === 'largemouth' && c.lengthIn >= slot.minIn && c.lengthIn < slot.maxIn;
};

/** A bass under the lake's one-per-day big-fish rule (TPWD Lake Fork: 24" and longer). */
export const isBigFish = (c: Pick<CaughtFish, 'species' | 'lengthIn'>, lake?: LakeDef) => {
  const big = lake?.regs?.bigFish;
  return !!big && c.species === 'largemouth' && c.lengthIn >= big.minIn;
};

/** Legal to put in the livewell: a bass at or over the minimum and outside any protected slot. */
export const isKeeper = (c: Pick<CaughtFish, 'species' | 'lengthIn'>, lake?: LakeDef) =>
  SPECIES[c.species].isBass && c.lengthIn >= keeperMinIn(lake) && !inSlot(c, lake);

/** What the catch card calls a fish. */
export type CatchVerdict = 'keeper' | 'short' | 'slot' | 'bycatch';
export function catchVerdict(c: Pick<CaughtFish, 'species' | 'lengthIn'>, lake?: LakeDef): CatchVerdict {
  if (!SPECIES[c.species].isBass) return 'bycatch';
  if (c.lengthIn < keeperMinIn(lake)) return 'short';
  if (inSlot(c, lake)) return 'slot';
  return 'keeper';
}

export const bagWeight = (fish: CaughtFish[]) => Math.round(fish.reduce((a, f) => a + f.weightLb, 0) * 100) / 100;

// ---------- Livewell survival ----------

export type FishHealth = 'lively' | 'sluggish' | 'dead';
export const healthOf = (f: Pick<CaughtFish, 'health'>): FishHealth => {
  const h = f.health ?? 1;
  return h <= 0 ? 'dead' : h < TUNING.livewell.sluggishBelow ? 'sluggish' : 'lively';
};
export const isDead = (f: Pick<CaughtFish, 'health'>) => (f.health ?? 1) <= 0;

/** Warm water multiplies every loss: 1 up to the onset, then 1 + (excess / scale)^2. */
export function heatFactor(waterTempF: number): number {
  const L = TUNING.livewell;
  const x = Math.max(0, waterTempF - L.tempOnsetF) / L.tempScaleF;
  return 1 + x * x;
}

const sizeFactor = (weightLb: number) => Math.pow(Math.max(0.5, weightLb) / TUNING.livewell.sizeRefLb, TUNING.livewell.sizeExp);

/** Health lost per game minute in the livewell for this fish today. */
export function livewellLossPerMin(f: Pick<CaughtFish, 'weightLb' | 'hardy'>, waterTempF: number): number {
  return (TUNING.livewell.baseLossPerHour / 60) * heatFactor(waterTempF) * sizeFactor(f.weightLb) / (f.hardy ?? 1);
}

/** Health a fish comes aboard with: a long fight in hot water takes it out of a fish. */
export function landingHealth(weightLb: number, fightSec: number, hardy: number, waterTempF: number): number {
  const loss = (TUNING.livewell.fightLossPerSec * fightSec * Math.sqrt(heatFactor(waterTempF)) * sizeFactor(weightLb)) / hardy;
  return Math.max(0.05, 1 - loss);
}

/**
 * Age the livewell by `dtMin` game minutes. Returns the fish that died this step (the caller emits
 * events). Deterministic: each fish's hardiness was drawn from the sim rng when it was landed.
 */
export function stepLivewell(s: TournamentState, dtMin: number): CaughtFish[] {
  const died: CaughtFish[] = [];
  const temp = s.conditions.waterTempF;
  for (const f of s.livewell) {
    if (isDead(f)) continue;
    f.health = Math.max(0, (f.health ?? 1) - livewellLossPerMin(f, temp) * dtMin);
    if (f.health <= 0) died.push(f);
  }
  return died;
}

/** B.A.S.S. dead-fish penalty for a bag: 4 oz per dead fish at the scales. */
export const deadPenaltyLb = (fish: CaughtFish[]) => fish.filter(isDead).length * TUNING.livewell.deadPenaltyLb;

/** Index (in the livewell) of the big fish already kept today, or -1. */
const bigFishIndex = (s: TournamentState, lake: LakeDef) => s.livewell.findIndex((f) => isBigFish(f, lake));

/** Land the fish on the line and decide what happens to it. */
export function landFish(s: TournamentState, f: FishEntity, rng?: Rng): void {
  const { setup } = activeTackle(s);
  const lake = LAKES[s.lakeId];
  const hook = s.fight?.hook;
  const fightSec = s.fight?.t ?? 0;
  const caught: CaughtFish = {
    fishId: f.id,
    species: f.species,
    weightLb: f.weightLb,
    lengthIn: f.lengthIn,
    caughtAtMin: s.clockMin,
    lureId: setup.lureId,
    colorId: setup.colorId,
    line: { ...setup.line },
  };
  if (hook) {
    const g = getLakeGrid(lake);
    const at = coverAt(g, hook.x, hook.y);
    caught.depthFt = Math.round(hook.depthFt * 10) / 10;
    caught.bottomFt = Math.round(depthAt(g, hook.x, hook.y) * 10) / 10;
    caught.cover = at !== 'none' ? at : nearCover(g, hook.x, hook.y, 6);
  }
  f.caught = true;
  f.interest = 0;
  s.fight = null;
  s.lastLanded = caught;

  const verdict = catchVerdict(caught, lake);
  if (verdict === 'bycatch') {
    s.stats.bycatch++;
    s.clockMin += TUNING.clock.unhookBycatchMin;
    emit(s, 'landed', `${SPECIES[f.species].name}. Doesn't count, and it cost you ${TUNING.clock.unhookBycatchMin} minutes.`);
  } else if (verdict === 'short') {
    s.clockMin += TUNING.clock.unhookBassMin;
    emit(s, 'landed', `Short fish: ${caught.lengthIn}" is under the ${keeperMinIn(lake)}" limit.`);
  } else if (verdict === 'slot') {
    // TPWD: a protected-slot bass goes straight back. It can't go in the livewell or to the scales.
    s.clockMin += TUNING.clock.unhookBassMin;
    caught.released = 'slot';
    const slot = lake.regs!.slot!;
    emit(s, 'landed', `Slot fish: ${caught.lengthIn}" is in the protected ${slot.minIn}-${slot.maxIn}" slot. Released immediately; it doesn't count.`);
  } else {
    s.clockMin += TUNING.clock.unhookBassMin;
    const hardy = rng ? Math.max(0.3, rng.logNormal(1, TUNING.livewell.hardinessSigma)) : 1;
    caught.hardy = Math.round(hardy * 1000) / 1000;
    caught.health = landingHealth(caught.weightLb, fightSec, hardy, s.conditions.waterTempF);
    s.stats.bigFishLb = Math.max(s.stats.bigFishLb, caught.weightLb);
    const bi = isBigFish(caught, lake) ? bigFishIndex(s, lake) : -1;
    if (bi >= 0) {
      // One bass of 24" or longer per day: keep the better of the two (a dead one can't be swapped out).
      const kept = s.livewell[bi];
      const lim = lake.regs!.bigFish!;
      if (!isDead(kept) && caught.weightLb > kept.weightLb) {
        s.livewell[bi] = caught;
        emit(s, 'landed', `Only ${lim.perDay} bass ${lim.minIn}" or longer a day: kept this ${caught.weightLb.toFixed(2)} lb fish and released your ${kept.weightLb.toFixed(2)}.`);
      } else {
        caught.released = 'bigFish';
        emit(s, 'landed', `Only ${lim.perDay} bass ${lim.minIn}" or longer a day: you already have one${isDead(kept) ? ' (dead, so it stays)' : ''}. Released.`);
      }
    } else if (s.livewell.length < LIVEWELL_LIMIT) {
      s.livewell.push(caught);
      emit(s, 'landed', `${caught.weightLb.toFixed(2)} lb ${SPECIES[f.species].name} into the livewell.`);
    } else {
      s.pendingCull = caught;
      emit(s, 'cullNeeded', 'Livewell full: cull a fish.');
    }
  }
  transition(s, 'Landed');
}

/** Index of the fish to release among livewell + pending (smallest live fish by default; dead fish can't be culled). */
export function suggestedCull(s: TournamentState): number {
  const all = [...s.livewell, ...(s.pendingCull ? [s.pendingCull] : [])];
  let idx = -1;
  for (let i = 0; i < all.length; i++) if (!isDead(all[i]) && (idx < 0 || all[i].weightLb < all[idx].weightLb)) idx = i;
  return Math.max(0, idx);
}

/** Can this fish (index into livewell + pending) be released? Dead fish must go to the scales. */
export const canCull = (s: TournamentState, index: number) => {
  const all = [...s.livewell, ...(s.pendingCull ? [s.pendingCull] : [])];
  return !!all[index] && !isDead(all[index]);
};

/** Release one of the 6 fish (index into livewell + pending). Keeps the livewell at 5. Dead fish can't be culled. */
export function resolveCull(s: TournamentState, releaseIndex: number): CaughtFish | null {
  if (!s.pendingCull) return null;
  const all = [...s.livewell, s.pendingCull];
  let i = Math.max(0, Math.min(all.length - 1, releaseIndex));
  if (isDead(all[i])) i = suggestedCull(s);
  const [released] = all.splice(i, 1);
  s.livewell = all;
  s.pendingCull = null;
  return released;
}

/** Continue fishing after the Landed card. */
export function continueAfterLanded(s: TournamentState): void {
  if (s.pendingCull) resolveCull(s, suggestedCull(s));
  s.lastLanded = null;
  transition(s, 'Cast');
}
