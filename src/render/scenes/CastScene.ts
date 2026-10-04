import { Container, Graphics, Sprite } from 'pixi.js';
import { plateId, texture } from '../../game/assets';
import { maxCastDistance, powerToDistanceFrac } from '../../sim/cast';
import { activeTackle } from '../../sim/context';
import { COVER_CODES, isWater, nearCover, type LakeGrid } from '../../sim/lake';
import type { TournamentState } from '../../sim/types';
import { PAL, SKY } from '../palette';
import type { Scene, View } from './types';

const CAM_H = 3.5;
const FAN = 1.35; // radians either side of heading that we draw

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (((ar + (br - ar) * t) | 0) << 16) | (((ag + (bg - ag) * t) | 0) << 8) | ((ab + (bb - ab) * t) | 0);
}

/** Phase 2: looking out from the casting deck. Aim, power, and thumb the spool. */
export class CastScene implements Scene {
  root = new Container();
  private plate = new Sprite();
  private bg = new Graphics();
  private world = new Graphics();
  private fx = new Graphics();
  private hud = new Graphics();
  private splashes: { x: number; y: number; age: number; color: number }[] = [];
  private plateKey = '';

  constructor() {
    this.root.addChild(this.bg, this.plate, this.world, this.fx, this.hud);
  }

  enter(t: TournamentState, grid: LakeGrid) {
    const cover = nearCover(grid, t.boat.pos.x + Math.cos(t.boat.heading) * 20, t.boat.pos.y + Math.sin(t.boat.heading) * 20, 25);
    this.plateKey = plateId(t.lakeId, t.conditions.weather, cover);
    this.splashes = [];
  }

  private project(t: TournamentState, view: View, x: number, y: number, hM = 0): { sx: number; sy: number; s: number; f: number } | null {
    const dx = x - t.boat.pos.x;
    const dy = y - t.boat.pos.y;
    const ch = Math.cos(t.boat.heading);
    const sh = Math.sin(t.boat.heading);
    const f = dx * ch + dy * sh;
    const l = -dx * sh + dy * ch;
    if (f < 1.5) return null;
    const focal = view.h * 0.95;
    const horizon = view.h * 0.36;
    return { sx: view.w / 2 + (l * focal) / f, sy: horizon + ((CAM_H - hM) * focal) / f, s: focal / f, f };
  }

  update(t: TournamentState, grid: LakeGrid, view: View, dt: number) {
    const { w, h } = view;
    const horizon = h * 0.36;
    const sky = SKY[t.conditions.weather];

    // Generated plate if available, else a procedural sky + water.
    const tex = texture(this.plateKey);
    this.plate.visible = !!tex;
    if (tex) {
      this.plate.texture = tex;
      const sc = Math.max(w / tex.width, (horizon * 1.25) / tex.height);
      this.plate.scale.set(sc);
      this.plate.position.set((w - tex.width * sc) / 2, horizon * 1.15 - tex.height * sc);
    }
    const bg = this.bg.clear();
    const bands = 16;
    for (let i = 0; i < bands; i++) bg.rect(0, (horizon * i) / bands, w, horizon / bands + 1).fill(lerpColor(sky.top, sky.bottom, i / (bands - 1)));
    for (let i = 0; i < bands; i++) {
      const y0 = horizon + ((h - horizon) * i) / bands;
      bg.rect(0, y0, w, (h - horizon) / bands + 1).fill(lerpColor(0x5b8fa3, 0x173f55, i / (bands - 1)));
    }

    // Shoreline silhouette: ray-march across the view to find where land starts, then draw a
    // tree line at that distance. Far hills sit in haze on the horizon.
    const g = this.world.clear();
    g.rect(0, horizon - 10, w, 10).fill({ color: 0x7f9aa3, alpha: 0.55 });
    const tops: number[] = [];
    const bases: number[] = [];
    const RAYS = 90;
    for (let k = 0; k <= RAYS; k++) {
      const da = -FAN + (2 * FAN * k) / RAYS;
      const ang = t.boat.heading + da;
      let hit = -1;
      for (let d = 3; d < 420; d += d < 60 ? 2 : 6) {
        const x = t.boat.pos.x + Math.cos(ang) * d;
        const y = t.boat.pos.y + Math.sin(ang) * d;
        if (!isWater(grid, x, y)) {
          hit = d;
          break;
        }
      }
      const fwd = (hit < 0 ? 600 : hit) * Math.cos(da);
      if (fwd < 1.5) continue;
      const focal = h * 0.95;
      const sx = w / 2 + (Math.sin(da) * (hit < 0 ? 600 : hit) * focal) / fwd;
      const treeH = 9 + 7 * Math.abs(Math.sin(k * 1.7 + t.boat.pos.x * 0.01));
      const base = horizon + (CAM_H * focal) / fwd;
      tops.push(sx, horizon + ((CAM_H - treeH) * focal) / fwd);
      bases.push(sx, base);
    }
    if (tops.length >= 4) {
      const poly = [...tops];
      for (let i = bases.length - 2; i >= 0; i -= 2) poly.push(bases[i], bases[i + 1]);
      g.poly(poly).fill(0x3f5a3c);
      // Sandy/rocky waterline.
      for (let i = 0; i + 3 < bases.length; i += 2) g.moveTo(bases[i], bases[i + 1]).lineTo(bases[i + 2], bases[i + 3]);
      g.stroke({ width: 2, color: 0xb9a77a, alpha: 0.8 });
    }

    const items: { f: number; draw: () => void }[] = [];
    const b = t.boat.pos;
    const span = Math.ceil(160 / grid.cellM);
    const rc = Math.floor(b.y / grid.cellM);
    const cc = Math.floor(b.x / grid.cellM);
    for (let r = Math.max(0, rc - span); r < Math.min(grid.rows, rc + span + 1); r++) {
      const cy = (r + 0.5) * grid.cellM;
      for (let c = Math.max(0, cc - span); c < Math.min(grid.cols, cc + span + 1); c++) {
        const cx = (c + 0.5) * grid.cellM;
        const d = Math.hypot(cx - b.x, cy - b.y);
        if (d > 160) continue;
        let da = Math.atan2(cy - b.y, cx - b.x) - t.boat.heading;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        if (Math.abs(da) > FAN) continue;
        const i = r * grid.cols + c;
        if (!grid.water[i]) {
          continue;
        } else if (grid.cover[i] && d < 70) {
          const type = COVER_CODES[grid.cover[i]];
          for (let k = 0; k < 3; k++) {
            const ox = cx + (((c * 13 + k * 7) % 10) / 10 - 0.5) * grid.cellM;
            const oy = cy + (((r * 11 + k * 5) % 10) / 10 - 0.5) * grid.cellM;
            const p = this.project(t, view, ox, oy, 0);
            if (!p) continue;
            items.push({ f: p.f, draw: () => this.drawCover(g, type, p.sx, p.sy, p.s) });
          }
        }
      }
    }
    items.sort((a, b2) => b2.f - a.f);
    for (const it of items) it.draw();

    // Aim line, reticle and the lure in flight.
    const fx = this.fx.clear();
    const cs = t.cast;
    const { lure, rod, setup } = activeTackle(t);
    const tipX = w * 0.62;
    const tipY = h * 0.92;
    if (cs) {
      const dir = t.boat.heading + cs.aimAngle;
      const maxD = maxCastDistance(lure, rod, setup.line, t.conditions, dir);
      if (!cs.flying) {
        const dist = maxD * (cs.powerCharging ? powerToDistanceFrac(cs.power) : 0.75);
        for (let k = 1; k <= 14; k++) {
          const p = this.project(t, view, b.x + Math.cos(dir) * dist * (k / 14), b.y + Math.sin(dir) * dist * (k / 14));
          if (p) fx.circle(p.sx, p.sy, Math.max(1.5, p.s * 0.08)).fill({ color: 0xffffff, alpha: cs.powerCharging ? 0.8 : 0.4 });
        }
        const pt = this.project(t, view, b.x + Math.cos(dir) * dist, b.y + Math.sin(dir) * dist);
        if (pt) fx.ellipse(pt.sx, pt.sy, pt.s * 1.2, pt.s * 0.35).stroke({ width: 2, color: 0xffd34d });
      } else {
        const p = this.project(t, view, cs.lurePos.x, cs.lurePos.y, cs.lureHeight);
        if (p) {
          fx.moveTo(tipX, tipY).quadraticCurveTo((tipX + p.sx) / 2, Math.min(tipY, p.sy) - 30, p.sx, p.sy).stroke({ width: 1, color: PAL.line, alpha: 0.7 });
          fx.circle(p.sx, p.sy, Math.max(3, p.s * 0.12)).fill(cs.braked ? 0xffd34d : 0xffffff);
          const shadow = this.project(t, view, cs.lurePos.x, cs.lurePos.y, 0);
          if (shadow) fx.ellipse(shadow.sx, shadow.sy, Math.max(2, shadow.s * 0.15), Math.max(1, shadow.s * 0.05)).fill({ color: 0x000000, alpha: 0.3 });
          if (cs.flightT + dt >= cs.flightDuration && shadow) this.splashes.push({ x: shadow.sx, y: shadow.sy, age: 0, color: 0xffffff });
        }
      }
    }
    for (const s of this.splashes) {
      s.age += dt;
      fx.ellipse(s.x, s.y, 6 + s.age * 60, 2 + s.age * 18).stroke({ width: 2, color: s.color, alpha: Math.max(0, 1 - s.age * 1.5) });
    }
    this.splashes = this.splashes.filter((s) => s.age < 0.7);

    // Rod from the bottom of the screen.
    fx.moveTo(w * 0.7, h + 10).lineTo(tipX, tipY).stroke({ width: 5, color: 0x222222 });

    // Power meter: horizontal, bottom centre (clear of both thumbs).
    const hud = this.hud.clear();
    if (cs && (cs.powerCharging || cs.flying)) {
      const bw = Math.min(300, w * 0.36);
      const bx = (w - bw) / 2;
      const by = h - 40;
      hud.roundRect(bx, by, bw, 20, 8).fill({ color: 0x000000, alpha: 0.5 }).stroke({ width: 2, color: 0xffffff, alpha: 0.7 });
      hud.rect(bx + bw * 0.92, by + 3, bw * 0.08 - 3, 14).fill({ color: 0x5cf27a, alpha: 0.45 });
      const fill = (bw - 6) * (cs.flying ? 0 : cs.power);
      if (fill > 0) hud.roundRect(bx + 3, by + 3, fill, 14, 5).fill(cs.power > 0.92 ? 0x5cf27a : 0xffd34d);
    }
  }

  private drawCover(g: Graphics, type: string, x: number, y: number, s: number) {
    switch (type) {
      case 'rock':
        g.ellipse(x, y - s * 0.2, s * 0.9, s * 0.45).fill(0x8d8a83).ellipse(x - s * 0.2, y - s * 0.35, s * 0.4, s * 0.2).fill(0xb1aea6);
        break;
      case 'grass':
        for (let k = -2; k <= 2; k++) g.moveTo(x + k * s * 0.3, y).lineTo(x + k * s * 0.45, y - s * 0.9).stroke({ width: Math.max(1, s * 0.08), color: 0x5f9a45 });
        break;
      case 'reeds':
        for (let k = -3; k <= 3; k++) g.moveTo(x + k * s * 0.2, y).lineTo(x + k * s * 0.25, y - s * 2.4).stroke({ width: Math.max(1, s * 0.06), color: 0xb5c46e });
        break;
      case 'timber':
        g.moveTo(x, y).lineTo(x + s * 0.2, y - s * 3).stroke({ width: Math.max(2, s * 0.18), color: 0x4c3b2a });
        g.moveTo(x + s * 0.1, y - s * 1.6).lineTo(x + s * 0.9, y - s * 2.3).stroke({ width: Math.max(1, s * 0.1), color: 0x4c3b2a });
        break;
      case 'standing':
        // Bare grey trunks rising out of the water, a couple of broken limbs.
        for (let k = -1; k <= 1; k++) {
          const tx = x + k * s * 0.9;
          const th = s * (2.6 + 0.8 * ((k + 2) % 2));
          g.moveTo(tx, y).lineTo(tx + s * 0.05, y - th).stroke({ width: Math.max(2, s * 0.16), color: 0x6b6258 });
          g.moveTo(tx, y - th * 0.6).lineTo(tx + s * 0.45 * (k || 1), y - th * 0.85).stroke({ width: Math.max(1, s * 0.07), color: 0x6b6258 });
        }
        break;
      case 'dock':
        g.rect(x - s * 1.6, y - s * 0.75, s * 3.2, s * 0.35).fill(0x8a6a45);
        for (let k = -1; k <= 1; k++) g.rect(x + k * s * 1.3 - s * 0.08, y - s * 0.45, s * 0.16, s * 0.6).fill(0x5e4428);
        break;
    }
  }
}
