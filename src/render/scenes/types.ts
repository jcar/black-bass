import type { Container } from 'pixi.js';
import type { LakeGrid } from '../../sim/lake';
import type { TournamentState } from '../../sim/types';

export interface View {
  w: number;
  h: number;
  /** Seconds since the renderer started (for animation). */
  time: number;
  debug: boolean;
}

export interface Scene {
  root: Container;
  enter(t: TournamentState, grid: LakeGrid, view: View): void;
  update(t: TournamentState, grid: LakeGrid, view: View, dt: number): void;
}
