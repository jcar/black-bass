import { LAKES } from '../data/lakes';
import type { LakeDef } from '../data/lakes/types';
import { COLORS, LURES, type ColorDef, type LureDef } from '../data/lures';
import { RODS, type RodDef } from '../data/rods';
import { activityFor } from './fish/activity';
import { getLakeGrid, type LakeGrid } from './lake';
import { Rng } from './rng';
import type { FishEntity, RodSetup, TournamentState } from './types';

/** Per-step context derived from state. Cheap to build; nothing here is persisted. */
export interface SimCtx {
  lake: LakeDef;
  grid: LakeGrid;
  rng: Rng;
}

export function makeCtx(s: TournamentState): SimCtx {
  const lake = LAKES[s.lakeId];
  const rng = new Rng(0);
  rng.state = s.rngState;
  return { lake, grid: getLakeGrid(lake), rng };
}

export interface ActiveTackle {
  setup: RodSetup;
  rod: RodDef;
  lure: LureDef;
  color: ColorDef;
}

export function activeTackle(s: TournamentState): ActiveTackle {
  const setup = s.deck[s.activeRod];
  return { setup, rod: RODS[setup.rodId], lure: LURES[setup.lureId], color: COLORS[setup.colorId] };
}

export function fishActivity(s: TournamentState, f: FishEntity): number {
  return activityFor(f.species, s.conditions, s.clockMin, f.weightLb);
}

type SimEvent = TournamentState['events'][number];
export function emit(s: TournamentState, type: SimEvent['type'], text?: string, at?: { x: number; y: number }, data?: SimEvent['data']) {
  s.events.push({ type, text, at: at ? { x: at.x, y: at.y } : undefined, ...(data ? { data } : {}) });
}

export const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
