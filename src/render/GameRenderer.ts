import { Application, ColorMatrixFilter, Container, Graphics, type ColorMatrix } from 'pixi.js';
import { lightLevel } from '../sim/conditions';
import type { LakeGrid } from '../sim/lake';
import type { GamePhase, TournamentState } from '../sim/types';
import { CastScene } from './scenes/CastScene';
import { MapScene } from './scenes/MapScene';
import type { Scene, View } from './scenes/types';
import { WaterScene } from './scenes/WaterScene';

type SceneKey = 'map' | 'cast' | 'water';
const SCENE_FOR: Record<GamePhase, SceneKey> = {
  Navigate: 'map',
  Cast: 'cast',
  Present: 'water',
  Fight: 'water',
  Landed: 'water',
  WeighIn: 'map',
};

/**
 * Owns the Pixi application. Scenes are chosen by game phase; a colour grade handles time of
 * day / weather / season on top, so one set of generated plates covers every combination.
 */
export class GameRenderer {
  app = new Application();
  private scenes!: Record<SceneKey, Scene>;
  private active: SceneKey | null = null;
  private layer = new Container();
  private weather = new Graphics();
  private grade = new ColorMatrixFilter();
  private time = 0;
  private gradeTimer = 0;
  private drops: { x: number; y: number; v: number }[] = [];
  debug = false;

  async init(host: HTMLElement) {
    await this.app.init({
      resizeTo: host,
      background: 0x0b1d26,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      powerPreference: 'high-performance',
    });
    host.appendChild(this.app.canvas);
    this.app.canvas.style.touchAction = 'none';
    this.scenes = { map: new MapScene(), cast: new CastScene(), water: new WaterScene() };
    this.app.stage.addChild(this.layer, this.weather);
    this.layer.filters = [this.grade];
  }

  get view(): View {
    return { w: this.app.screen.width, h: this.app.screen.height, time: this.time, debug: this.debug };
  }

  render(t: TournamentState, grid: LakeGrid, dt: number) {
    this.time += dt;
    const key = SCENE_FOR[t.phase];
    const view = this.view;
    if (key !== this.active || (key === 'water' && t.phase === 'Present' && this.enteredPresent(t))) {
      if (key !== this.active) {
        this.layer.removeChildren();
        this.layer.addChild(this.scenes[key].root);
        this.active = key;
      }
      this.scenes[key].enter(t, grid, view);
    }
    this.scenes[key].update(t, grid, view, dt);
    this.gradeTimer -= dt;
    if (this.gradeTimer <= 0) {
      this.applyGrade(t);
      this.gradeTimer = 1;
    }
    this.drawWeather(t, dt);
  }

  private presentStamp: number | null = null;
  /** Re-enter the water scene on each new cast so the view re-aims at the new lure. */
  private enteredPresent(t: TournamentState): boolean {
    const stamp = t.stats.casts;
    if (stamp !== this.presentStamp) {
      this.presentStamp = stamp;
      return true;
    }
    return false;
  }

  private applyGrade(t: TournamentState) {
    const light = lightLevel(t.clockMin, t.conditions.weather);
    const g = this.grade;
    g.reset();
    const h = t.clockMin / 60;
    // Dawn warmth fading by mid-morning; overcast/rain desaturate and darken.
    const dawn = Math.max(0, 1 - (h - 6) / 2.5);
    g.brightness(0.82 + 0.25 * Math.min(1, light + 0.2), true);
    if (t.conditions.weather === 'Overcast' || t.conditions.weather === 'Rain') g.saturate(-0.25, true);
    if (dawn > 0) {
      const warm = new ColorMatrixFilter();
      warm.matrix = [1 + 0.12 * dawn, 0, 0, 0, 0.02 * dawn, 0, 1 + 0.02 * dawn, 0, 0, 0, 0, 0, 1 - 0.1 * dawn, 0, 0, 0, 0, 0, 1, 0];
      g.matrix = multiply(g.matrix, warm.matrix) as ColorMatrix;
    }
    if (t.conditions.season === 'Fall') g.matrix = multiply(g.matrix, [1.05, 0, 0, 0, 0.01, 0, 1, 0, 0, 0, 0, 0, 0.94, 0, 0, 0, 0, 0, 1, 0]) as ColorMatrix;
  }

  private drawWeather(t: TournamentState, dt: number) {
    const g = this.weather.clear();
    const { w, h } = this.view;
    const rain = t.conditions.weather === 'Rain';
    const target = rain ? 140 : 0;
    while (this.drops.length < target) this.drops.push({ x: Math.random() * w, y: Math.random() * h, v: 500 + Math.random() * 300 });
    if (this.drops.length > target) this.drops.length = target;
    const wind = Math.cos(t.conditions.windDir) * t.conditions.windMph * 8;
    for (const d of this.drops) {
      d.y += d.v * dt;
      d.x += wind * dt;
      if (d.y > h) {
        d.y = -10;
        d.x = Math.random() * w;
      }
      if (d.x < 0) d.x += w;
      if (d.x > w) d.x -= w;
      g.moveTo(d.x, d.y).lineTo(d.x - wind * 0.02, d.y - 12).stroke({ width: 1, color: 0xcfe6f2, alpha: 0.45 });
    }
  }

  destroy() {
    this.app.destroy(true, { children: true, texture: true });
  }
}

/** 4x5 colour-matrix multiply (a then b). */
function multiply(a: number[], b: number[]): number[] {
  const out = new Array(20).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      let v = c === 4 ? b[r * 5 + 4] : 0;
      for (let k = 0; k < 4; k++) v += b[r * 5 + k] * a[k * 5 + c];
      out[r * 5 + c] = v;
    }
  }
  return out;
}
