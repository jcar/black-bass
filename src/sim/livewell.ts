import { SPECIES } from '../data/species';
import { TUNING } from '../data/tuning';
import { activeTackle, emit } from './context';
import { transition } from './machine';
import type { CaughtFish, FishEntity, TournamentState } from './types';

export const LIVEWELL_LIMIT = 5;

export const isKeeper = (c: Pick<CaughtFish, 'species' | 'lengthIn'>) =>
  SPECIES[c.species].isBass && c.lengthIn >= TUNING.population.keeperMinIn;

export const bagWeight = (fish: CaughtFish[]) => Math.round(fish.reduce((a, f) => a + f.weightLb, 0) * 100) / 100;

/** Land the fish on the line and decide what happens to it. */
export function landFish(s: TournamentState, f: FishEntity): void {
  const { setup } = activeTackle(s);
  const caught: CaughtFish = {
    fishId: f.id,
    species: f.species,
    weightLb: f.weightLb,
    lengthIn: f.lengthIn,
    caughtAtMin: s.clockMin,
    lureId: setup.lureId,
  };
  f.caught = true;
  f.interest = 0;
  s.fight = null;
  s.lastLanded = caught;

  if (!SPECIES[f.species].isBass) {
    s.stats.bycatch++;
    s.clockMin += TUNING.clock.unhookBycatchMin;
    emit(s, 'landed', `${SPECIES[f.species].name}. Doesn't count, and it cost you ${TUNING.clock.unhookBycatchMin} minutes.`);
  } else if (!isKeeper(caught)) {
    s.clockMin += TUNING.clock.unhookBassMin;
    emit(s, 'landed', `Short fish: ${caught.lengthIn}" is under the ${TUNING.population.keeperMinIn}" limit.`);
  } else {
    s.clockMin += TUNING.clock.unhookBassMin;
    s.stats.bigFishLb = Math.max(s.stats.bigFishLb, caught.weightLb);
    if (s.livewell.length < LIVEWELL_LIMIT) {
      s.livewell.push(caught);
      emit(s, 'landed', `${caught.weightLb.toFixed(2)} lb ${SPECIES[f.species].name} into the livewell.`);
    } else {
      s.pendingCull = caught;
      emit(s, 'cullNeeded', 'Livewell full: cull a fish.');
    }
  }
  transition(s, 'Landed');
}

/** Index of the fish to release among livewell + pending (smallest by default). */
export function suggestedCull(s: TournamentState): number {
  const all = [...s.livewell, ...(s.pendingCull ? [s.pendingCull] : [])];
  let idx = 0;
  for (let i = 1; i < all.length; i++) if (all[i].weightLb < all[idx].weightLb) idx = i;
  return idx;
}

/** Release one of the 6 fish (index into livewell + pending). Keeps the livewell at 5. */
export function resolveCull(s: TournamentState, releaseIndex: number): CaughtFish | null {
  if (!s.pendingCull) return null;
  const all = [...s.livewell, s.pendingCull];
  const [released] = all.splice(Math.max(0, Math.min(all.length - 1, releaseIndex)), 1);
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
