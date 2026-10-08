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
  /** Bottom of the DOM scorebug + notice strip (CSS px from the top): Pixi panels go below it. */
  hudTop: number;
}

/** The side-profile sonar panel, top-left under the scorebug strip and clear of the fight panel. */
export function sonarInsetRect(view: Pick<View, 'w' | 'h' | 'safe' | 'hudTop'>): { x: number; y: number; w: number; h: number } {
  return {
    x: view.safe.l + 10,
    y: Math.max(view.safe.t + 100, view.hudTop + 6),
    w: Math.min(210, view.w * 0.25),
    h: Math.min(124, view.h * 0.32),
  };
}

export interface Scene {
  /** World layer: colour-graded for time of day and weather. */
  root: Container;
  /** Screen-space HUD layer (minimap, sonar inset, power meter): never graded or rained on. */
  overlay: Container;
  enter(t: TournamentState, grid: LakeGrid, view: View): void;
  update(t: TournamentState, grid: LakeGrid, view: View, dt: number): void;
  /** Free textures the scene painted itself (the app's teardown keeps shared, cached art). */
  dispose?(): void;
  /** World position (m) to screen px, for callouts. Null when off-screen/behind the camera. */
  toScreen(t: TournamentState, view: View, p: Vec2): { x: number; y: number } | null;
}

/** Broadcast-style text for Pixi overlays (Barlow Condensed is self-hosted and preloaded). */
export const HUD_FONT = "'Barlow Condensed', 'Arial Narrow', sans-serif";
