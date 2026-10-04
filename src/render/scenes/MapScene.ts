import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { LakeGrid } from '../../sim/lake';
import type { TournamentState, Vec2 } from '../../sim/types';
import { paintLakeCanvas } from '../lakeTexture';
import { PAL } from '../palette';
import { HUD_FONT, type Scene, type View } from './types';

const MAP_PX_PER_M = 0.5;
const SONAR_RANGE = 45;
const SONAR_HALF = 0.5;

/** Phase 1: top-down lake chart, bass boat, forward-facing sonar. */
export class MapScene implements Scene {
  root = new Container();
  overlay = new Container();
  private world = new Container();
  /** Waypoint ring + label groups, kept a constant size on screen whatever the zoom. */
  private pins: Container[] = [];
  private lake?: Sprite;
  private markers = new Container();
  private regionLabels: Text[] = [];
  private sonar = new Graphics();
  private boat = new Graphics();
  private wake = new Graphics();
  private mini = new Container();
  private miniLake?: Sprite;
  private miniDots = new Graphics();
  private lakeId = '';
  private wakePts: { x: number; y: number; age: number }[] = [];
  private zoom = 1.3;

  constructor() {
    this.world.addChild(this.wake, this.markers, this.sonar, this.boat);
    this.root.addChild(this.world);
    this.overlay.addChild(this.mini);
    this.mini.addChild(this.miniDots);
    this.drawBoat();
  }

  toScreen(_t: TournamentState, _view: View, p: Vec2) {
    const q = this.world.toGlobal({ x: p.x, y: p.y });
    return { x: q.x, y: q.y };
  }

  private drawBoat() {
    // Hull in metres (bass boats are ~6 m): pointed bow toward +x.
    this.boat
      .clear()
      .poly([3.2, 0, 1.2, -1.2, -3, -1.1, -3, 1.1, 1.2, 1.2])
      .fill(PAL.boat)
      .poly([1.6, -0.7, 2.6, 0, 1.6, 0.7])
      .fill(PAL.boatAccent)
      .rect(-2.9, -0.6, 0.8, 1.2)
      .fill(0x2a2a2a);
  }

  enter(t: TournamentState, grid: LakeGrid) {
    if (this.lakeId === t.lakeId) return;
    this.lakeId = t.lakeId;
    const tex = Texture.from(paintLakeCanvas(grid, MAP_PX_PER_M));
    this.lake?.destroy();
    this.lake = new Sprite(tex);
    this.lake.scale.set(1 / MAP_PX_PER_M);
    this.world.addChildAt(this.lake, 0);

    this.markers.removeChildren().forEach((c) => c.destroy());
    this.regionLabels = [];
    for (const r of grid.def.regions) {
      const label = new Text({ text: r.name.toUpperCase(), style: { fill: 0xffffff, fontSize: 30, fontFamily: HUD_FONT, fontWeight: '700', letterSpacing: 4 } });
      label.anchor.set(0.5);
      label.position.set(r.x, r.y);
      this.markers.addChild(label);
      this.regionLabels.push(label);
    }
    this.pins = [];
    for (const w of grid.def.waypoints) {
      if (!w.visible) continue;
      const pin = new Container();
      pin.position.set(w.x, w.y);
      const g = new Graphics().circle(0, 0, 8).stroke({ width: 2.5, color: 0xffd34d }).circle(0, 0, 2.5).fill(0xffd34d);
      const label = new Text({ text: w.name.toUpperCase(), style: { fill: 0xffe9a8, fontSize: 15, fontFamily: HUD_FONT, fontWeight: '700', letterSpacing: 1, stroke: { color: 0x07141a, width: 4 } } });
      label.position.set(12, -9);
      pin.addChild(g, label);
      this.markers.addChild(pin);
      this.pins.push(pin);
    }
    const ramp = new Graphics().rect(-6, -6, 12, 12).fill(0xffffff).rect(-3, -3, 6, 6).fill(0x2a6fdb);
    ramp.position.set(grid.def.launch.x, grid.def.launch.y);
    this.markers.addChild(ramp);

    this.miniLake?.destroy();
    this.miniLake = new Sprite(tex);
    this.mini.addChildAt(this.miniLake, 0);
  }

  update(t: TournamentState, grid: LakeGrid, view: View, dt: number) {
    const boat = t.boat;
    // Zoom out at speed so you can see where you're going.
    const targetZoom = Math.max(0.35, 1.4 - boat.speed / 55);
    this.zoom += (targetZoom - this.zoom) * Math.min(1, dt * 2);
    const z = this.zoom * Math.min(view.w, view.h) / 390;
    this.world.scale.set(z);
    for (const p of this.pins) p.scale.set(1 / z);
    const lead = Math.min(80, boat.speed * 0.9);
    this.world.position.set(
      view.w / 2 - (boat.pos.x + Math.cos(boat.heading) * lead) * z,
      view.h / 2 - (boat.pos.y + Math.sin(boat.heading) * lead) * z,
    );

    // Region names only read well when zoomed out at speed.
    const labelAlpha = Math.max(0, Math.min(0.4, (1.0 - this.zoom) * 0.8));
    for (const l of this.regionLabels) l.alpha = labelAlpha;
    this.boat.position.set(boat.pos.x, boat.pos.y);
    this.boat.rotation = boat.heading;
    this.boat.scale.set(Math.max(1.5, 2.6 / this.zoom));

    // Wake trail.
    if (boat.speed > 1) this.wakePts.push({ x: boat.pos.x - Math.cos(boat.heading) * 3, y: boat.pos.y - Math.sin(boat.heading) * 3, age: 0 });
    for (const p of this.wakePts) p.age += dt;
    this.wakePts = this.wakePts.filter((p) => p.age < 2.5);
    this.wake.clear();
    for (const p of this.wakePts) this.wake.circle(p.x, p.y, 1 + p.age * 3).fill({ color: 0xffffff, alpha: 0.25 * (1 - p.age / 2.5) });

    // Forward-facing sonar: a cone ahead of the boat with a sweeping beam and fish returns.
    const s = this.sonar.clear();
    const h = boat.heading;
    const pts: number[] = [boat.pos.x, boat.pos.y];
    for (let a = -SONAR_HALF; a <= SONAR_HALF + 1e-6; a += SONAR_HALF / 6) pts.push(boat.pos.x + Math.cos(h + a) * SONAR_RANGE, boat.pos.y + Math.sin(h + a) * SONAR_RANGE);
    s.poly(pts).fill({ color: PAL.sonar, alpha: boat.motor === 'outboard' ? 0.04 : 0.1 });
    const sweep = Math.sin(view.time * 2.2) * SONAR_HALF;
    s.moveTo(boat.pos.x, boat.pos.y)
      .lineTo(boat.pos.x + Math.cos(h + sweep) * SONAR_RANGE, boat.pos.y + Math.sin(h + sweep) * SONAR_RANGE)
      .stroke({ width: 0.6, color: PAL.sonar, alpha: 0.6 });
    if (boat.motor === 'trolling') {
      for (const f of t.fish) {
        if (f.caught) continue;
        const dx = f.pos.x - boat.pos.x;
        const dy = f.pos.y - boat.pos.y;
        const d = Math.hypot(dx, dy);
        if (d > SONAR_RANGE || d < 2) continue;
        let da = Math.atan2(dy, dx) - h;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        if (Math.abs(da) > SONAR_HALF) continue;
        const size = 0.5 + Math.sqrt(f.weightLb) * 0.6;
        const ping = 0.45 + 0.55 * Math.max(0, 1 - Math.abs(da - sweep) * 3);
        s.ellipse(f.pos.x, f.pos.y, size * 1.4, size * 0.8).fill({ color: f.spookUntil > t.clockMin ? 0x9fb6c2 : 0xffe066, alpha: ping });
      }
    }

    this.updateMinimap(t, grid, view);
  }

  private updateMinimap(t: TournamentState, grid: LakeGrid, view: View) {
    if (!this.miniLake) return;
    // Top-right under the pause button, inside the notch-safe area, clear of the FISH button.
    const mh = Math.min(118, view.h * 0.3);
    const scale = mh / grid.def.sizeM.h;
    this.miniLake.scale.set(scale / MAP_PX_PER_M);
    const mw = grid.def.sizeM.w * scale;
    this.mini.position.set(view.w - mw - 14 - view.safe.r, view.safe.t + 64);
    this.miniLake.alpha = 0.92;
    const g = this.miniDots.clear();
    g.roundRect(-4, -4, mw + 8, mh + 8, 6).stroke({ width: 1, color: 0xffffff, alpha: 0.28 });
    for (const w of grid.def.waypoints) if (w.visible) g.circle(w.x * scale, w.y * scale, 2.2).fill(0xffd34d);
    g.circle(t.boat.pos.x * scale, t.boat.pos.y * scale, 3.5).fill(0xff4433).stroke({ width: 1.5, color: 0xffffff });
  }
}
