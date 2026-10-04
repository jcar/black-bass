import type { Container } from 'pixi.js';
import type { LakeGrid } from '../../sim/lake';
import type { TournamentState, Vec2 } from '../../sim/types';

export interface Insets {
  l: number;
  r: number;
  t: number;
  b: number;
}

export interface View {
  w: number;
  h: number;
  /** Seconds since the renderer started (for animation). */
  time: number;
  debug: boolean;
  /** Device safe-area insets (notch, home indicator) in CSS px. */
  safe: Insets;
}

export interface Scene {
  /** World layer: colour-graded for time of day and weather. */
  root: Container;
  /** Screen-space HUD layer (minimap, sonar inset, power meter): never graded or rained on. */
  overlay: Container;
  enter(t: TournamentState, grid: LakeGrid, view: View): void;
  update(t: TournamentState, grid: LakeGrid, view: View, dt: number): void;
  /** World position (m) to screen px, for callouts. Null when off-screen/behind the camera. */
  toScreen(t: TournamentState, view: View, p: Vec2): { x: number; y: number } | null;
}

/** Broadcast-style text for Pixi overlays (Barlow Condensed is self-hosted and preloaded). */
export const HUD_FONT = "'Barlow Condensed', 'Arial Narrow', sans-serif";
