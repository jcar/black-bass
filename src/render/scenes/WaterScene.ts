import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { COLORS } from '../../data/lures';
import { SPECIES } from '../../data/species';
import { activeTackle } from '../../sim/context';
import { depthAt, secchiAt, type LakeGrid } from '../../sim/lake';
import type { TournamentState, Vec2 } from '../../sim/types';
import { paintLocalCanvas } from '../lakeTexture';
import { hexNum, PAL } from '../palette';
import type { Scene, View } from './types';

const PATCH_M = 140;
const PATCH_PX_PER_M = 7;

/** Phases 3 & 4: top-down over the water (boat at the bottom) plus a side-profile depth inset. */
export class WaterScene implements Scene {
  root = new Container();
  private world = new Container();
  private patch?: Sprite;
  private patchCenter: Vec2 | null = null;
  private shadows = new Graphics();
  private lineG = new Graphics();
  private actors = new Graphics();
  private ripples = new Graphics();
  private inset = new Graphics();
  private viewAngle = 0;
  private zoom = 10;
  private rings: { x: number; y: number; age: number; big: boolean }[] = [];
  private lastLurePos: Vec2 | null = null;

  constructor() {
    this.world.addChild(this.shadows, this.ripples, this.lineG, this.actors);
    this.root.addChild(this.world, this.inset);
  }

  enter(t: TournamentState, grid: LakeGrid) {
    const b = t.boat.pos;
    if (!this.patchCenter || Math.hypot(this.patchCenter.x - b.x, this.patchCenter.y - b.y) > 5) {
      this.patch?.destroy({ texture: true });
      this.patch = new Sprite(Texture.from(paintLocalCanvas(grid, b, PATCH_M, PATCH_PX_PER_M)));
      this.patch.scale.set(1 / PATCH_PX_PER_M);
      this.patch.position.set(b.x - PATCH_M / 2, b.y - PATCH_M / 2);
      this.world.addChildAt(this.patch, 0);
      this.patchCenter = { ...b };
    }
    const target = t.present?.lurePos ?? t.fight?.pos;
    if (target) this.viewAngle = Math.atan2(target.y - b.y, target.x - b.x);
    if (t.present) this.rings.push({ x: t.present.lurePos.x, y: t.present.lurePos.y, age: 0, big: false });
  }

  update(t: TournamentState, grid: LakeGrid, view: View, dt: number) {
    const { w, h } = view;
    const b = t.boat.pos;
    const target = t.present?.lurePos ?? t.fight?.pos ?? this.lastLurePos ?? { x: b.x + Math.cos(this.viewAngle) * 15, y: b.y + Math.sin(this.viewAngle) * 15 };
    this.lastLurePos = { ...target };
    const d = Math.hypot(target.x - b.x, target.y - b.y);

    // Keep the boat at the bottom and the lure/fish up-screen; zoom to fit.
    const targetZoom = Math.max(7, Math.min(26, (h * 0.78) / Math.max(12, d + 6)));
    this.zoom += (targetZoom - this.zoom) * Math.min(1, dt * 1.5);
    this.world.scale.set(this.zoom);
    this.world.rotation = -Math.PI / 2 - this.viewAngle;
    const cos = Math.cos(this.world.rotation);
    const sin = Math.sin(this.world.rotation);
    const ax = w / 2;
    const ay = h * 0.9;
    this.world.position.set(ax - (b.x * cos - b.y * sin) * this.zoom, ay - (b.x * sin + b.y * cos) * this.zoom);

    this.drawShadows(t, grid, view, target);
    this.drawActors(t, dt);
    this.drawInset(t, grid, view, target);
  }

  private drawShadows(t: TournamentState, grid: LakeGrid, view: View, center: Vec2) {
    const g = this.shadows.clear();
    const secchi = secchiAt(grid, center.x, center.y);
    // You can see fish down to roughly the Secchi depth; followers rise and become visible.
    const visibleFt = Math.max(3, secchi * 0.9);
    const radius = (view.h / this.zoom) * 1.2;
    const strikeId = t.present?.strikingFishId ?? null;
    for (const f of t.fish) {
      if (f.caught) continue;
      if (t.fight && t.fight.fishId === f.id) continue;
      const dd = Math.hypot(f.pos.x - center.x, f.pos.y - center.y);
      if (dd > radius) continue;
      const depth = f.id === strikeId ? 0 : f.depthFt;
      const vis = f.interest >= 2 || f.id === strikeId ? 1 : 1 - depth / visibleFt;
      if (vis <= 0.05) continue;
      const len = 0.25 + f.lengthIn * 0.025;
      const ang = Math.atan2(center.y - f.pos.y, center.x - f.pos.x);
      const alpha = Math.min(0.6, 0.15 + 0.45 * vis);
      const cx = f.pos.x;
      const cy = f.pos.y;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      // Fish silhouette as a polygon (body + tail) oriented toward the lure.
      const pts = [
        [len * 0.55, 0], [len * 0.2, len * 0.16], [-len * 0.3, len * 0.12], [-len * 0.55, len * 0.22],
        [-len * 0.5, 0], [-len * 0.55, -len * 0.22], [-len * 0.3, -len * 0.12], [len * 0.2, -len * 0.16],
      ].flatMap(([px, py]) => [cx + px * ca - py * sa, cy + px * sa + py * ca]);
      g.poly(pts).fill({ color: 0x0b1a22, alpha });
    }
  }

  private drawActors(t: TournamentState, dt: number) {
    const g = this.actors.clear();
    const lg = this.lineG.clear();
    const rg = this.ripples.clear();
    const b = t.boat.pos;
    const a = this.viewAngle;
    const tip = { x: b.x + Math.cos(a) * 2.6, y: b.y + Math.sin(a) * 2.6 };

    // Boat hull (pointing toward the cast).
    const hull = [3.2, 0, 1.2, -1.2, -3, -1.1, -3, 1.1, 1.2, 1.2];
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    g.poly(hull.reduce<number[]>((acc, v, i) => {
      if (i % 2 === 0) acc.push(b.x + v * ca - hull[i + 1] * sa, b.y + v * sa + hull[i + 1] * ca);
      return acc;
    }, [])).fill(PAL.boat).stroke({ width: 0.12, color: 0x444444 });

    if (t.present) {
      const p = t.present;
      const { color } = activeTackle(t);
      const slack = p.avgSpeed < 0.05 ? 1.2 : 0.2;
      const mid = { x: (tip.x + p.lurePos.x) / 2 + Math.cos(a + Math.PI / 2) * slack, y: (tip.y + p.lurePos.y) / 2 + Math.sin(a + Math.PI / 2) * slack };
      lg.moveTo(tip.x, tip.y).quadraticCurveTo(mid.x, mid.y, p.lurePos.x, p.lurePos.y).stroke({ width: Math.max(0.05, 1.5 / this.zoom), color: PAL.line, alpha: 0.8 });
      const depthFade = Math.max(0.35, 1 - p.lureDepthFt / 25);
      g.circle(p.lurePos.x, p.lurePos.y, Math.max(0.3, 6 / this.zoom) * (0.6 + 0.4 * depthFade)).fill({ color: hexNum(COLORS[color.id].hex), alpha: depthFade }).stroke({ width: 0.06, color: 0xffffff, alpha: depthFade });
      if (p.lureDepthFt < 0.5 && p.avgSpeed > 0.05) this.rings.push({ x: p.lurePos.x, y: p.lurePos.y, age: 0.6, big: false });
      if (p.strikingFishId !== null && p.strikeT < dt * 1.5) this.rings.push({ x: p.lurePos.x, y: p.lurePos.y, age: 0, big: true });
    }

    if (t.fight) {
      const f = t.fight;
      const tension = Math.min(1, f.tension);
      const lineColor = tension > 0.85 ? 0xff4d4d : tension > 0.6 ? 0xffd34d : PAL.line;
      lg.moveTo(tip.x, tip.y).lineTo(f.pos.x, f.pos.y).stroke({ width: 0.07 + tension * 0.08, color: lineColor });
      const len = 0.3 + (SPECIES[f.species].isBass ? 0.6 : 0.8) * Math.cbrt(f.weightLb);
      const ang = f.heading;
      const c2 = Math.cos(ang);
      const s2 = Math.sin(ang);
      const air = f.jumpT > 0;
      const pts = [
        [len * 0.55, 0], [len * 0.2, len * 0.18], [-len * 0.3, len * 0.12], [-len * 0.55, len * 0.24],
        [-len * 0.5, 0], [-len * 0.55, -len * 0.24], [-len * 0.3, -len * 0.12], [len * 0.2, -len * 0.18],
      ].flatMap(([px, py]) => [f.pos.x + px * c2 - py * s2, f.pos.y + px * s2 + py * c2]);
      g.poly(pts).fill({ color: air ? 0x6b7f3a : 0x0b1a22, alpha: air ? 1 : 0.55 });
      if (air || f.burstT > 0) this.rings.push({ x: f.pos.x, y: f.pos.y, age: air ? 0 : 0.5, big: air });
    }

    for (const r of this.rings) r.age += dt;
    this.rings = this.rings.filter((r) => r.age < 1);
    for (const r of this.rings) {
      const rad = (r.big ? 1.2 : 0.4) + r.age * (r.big ? 3 : 1.4);
      rg.circle(r.x, r.y, rad).stroke({ width: 0.08, color: 0xffffff, alpha: (1 - r.age) * (r.big ? 0.9 : 0.4) });
    }
    if (this.rings.length > 120) this.rings.splice(0, this.rings.length - 120);
  }

  /** Side-profile sonar: bottom contour from the boat out past the lure, lure depth, fish arcs. */
  private drawInset(t: TournamentState, grid: LakeGrid, view: View, target: Vec2) {
    const g = this.inset.clear();
    const W = Math.min(230, view.w * 0.3);
    const H = Math.min(120, view.h * 0.3);
    const x0 = 12;
    const y0 = 70;
    g.roundRect(x0, y0, W, H, 10).fill({ color: 0x041018, alpha: 0.8 }).stroke({ width: 1.5, color: PAL.sonar, alpha: 0.6 });
    const b = t.boat.pos;
    const a = this.viewAngle;
    const range = Math.max(20, Math.hypot(target.x - b.x, target.y - b.y) + 8);
    let maxDepth = 10;
    const samples: number[] = [];
    for (let i = 0; i <= 40; i++) {
      const dd = (range * i) / 40;
      const dep = depthAt(grid, b.x + Math.cos(a) * dd, b.y + Math.sin(a) * dd);
      samples.push(dep);
      maxDepth = Math.max(maxDepth, dep);
    }
    maxDepth = Math.ceil((maxDepth * 1.15) / 5) * 5;
    const px = (dd: number) => x0 + 8 + ((W - 16) * dd) / range;
    const py = (dep: number) => y0 + 8 + ((H - 16) * dep) / maxDepth;
    const pts: number[] = [px(0), py(0)];
    samples.forEach((dep, i) => pts.push(px((range * i) / 40), py(dep)));
    pts.push(px(range), py(maxDepth), px(0), py(maxDepth));
    g.poly(pts).fill({ color: 0x8a6b3d, alpha: 0.85 });
    g.moveTo(px(0), py(0)).lineTo(px(range), py(0)).stroke({ width: 1, color: PAL.sonar, alpha: 0.4 });

    for (const f of t.fish) {
      if (f.caught) continue;
      const rx = f.pos.x - b.x;
      const ry = f.pos.y - b.y;
      const along = rx * Math.cos(a) + ry * Math.sin(a);
      const lateral = Math.abs(-rx * Math.sin(a) + ry * Math.cos(a));
      if (along < 0 || along > range || lateral > 6) continue;
      const sz = 2 + Math.sqrt(f.weightLb) * 1.6;
      const ax = px(along);
      const ay = py(f.depthFt);
      g.moveTo(ax + Math.cos(Math.PI * 1.15) * sz, ay + Math.sin(Math.PI * 1.15) * sz)
        .arc(ax, ay, sz, Math.PI * 1.15, Math.PI * 1.85)
        .stroke({ width: 2, color: f.interest >= 3 ? 0xff6b3d : 0xffe066, alpha: 0.9 });
    }
    if (t.present) {
      const p = t.present;
      const along = Math.hypot(p.lurePos.x - b.x, p.lurePos.y - b.y);
      g.circle(px(along), py(p.lureDepthFt), 3.5).fill(0xffffff);
    }
    if (t.fight) {
      const f = t.fight;
      const along = Math.hypot(f.pos.x - b.x, f.pos.y - b.y);
      g.circle(px(Math.min(range, along)), py(f.jumpT > 0 ? 0 : 3), 4).fill(0xff4d4d);
    }
  }
}
