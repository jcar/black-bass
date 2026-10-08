import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { COVER_CODES, coverAt, type LakeGrid } from '../../sim/lake';
import { OFF_PLANE_M } from '../../sim/nav';
import type { TournamentState, Vec2 } from '../../sim/types';
import { BOAT_LENGTH_M, BOAT_SPRITE, texture } from '../../game/assets';
import { paintLakeCanvas } from '../lakeTexture';
import { PAL } from '../palette';
import { clutterPoints, COVER_CLUTTER, coverFade, markSizeNoise } from '../sonarNoise';
import { HUD_FONT, type Scene, type View } from './types';

const MAP_PX_PER_M = 0.5;
const SONAR_RANGE = 45;
const SONAR_HALF = 0.5;
/** Every return on the sonar is drawn in the one colour. */
const SONAR_MARK = 0xffe066;
/** The destination chip sits left of the minimap, about this wide (CSS px); ring labels keep clear of both. */
const CHIP_W_PX = 300;
const LABEL_CLEAR_PX = 8;
/** A PRO stop this close (m) to a waypoint is the same place: label them together. */
const PRO_MERGE_M = 30;
const PRO_GREEN = 0x5ee08a;
const OFF_PLANE_AMBER = 0xffb84d;

/** A stop on the map: the runner's NavStop (id lets the scene dim the ones you've fished). */
type MapStop = Vec2 & { id?: string };

/** A dashed ring (Pixi Graphics has no dash style): `n` dashes, each half the gap-plus-dash arc. */
function dashedCircle(g: Graphics, x: number, y: number, r: number, n: number) {
  const step = (Math.PI * 2) / n;
  for (let i = 0; i < n; i++) {
    const a = i * step;
    g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r).arc(x, y, r, a, a + step * 0.55);
  }
  return g;
}

/** Phase 1: top-down lake chart, bass boat, forward-facing sonar. */
export class MapScene implements Scene {
  root = new Container();
  overlay = new Container();
  private world = new Container();
  /** Waypoint ring + label groups, kept a constant size on screen whatever the zoom. */
  private pins: Container[] = [];
  /** Waypoint labels, so a PRO stop on a waypoint can join its label instead of overprinting it. */
  private wpLabels: { x: number; y: number; name: string; label: Text }[] = [];
  private lake?: Sprite;
  private markers = new Container();
  private regionLabels: Text[] = [];
  private sonar = new Graphics();
  private boat = new Container();
  private boatShape = new Graphics();
  private boatSprite = new Sprite();
  private wake = new Graphics();
  private mini = new Container();
  private miniLake?: Sprite;
  private miniDots = new Graphics();
  private lakeId = '';
  private wakePts: { x: number; y: number; age: number }[] = [];
  private zoom = 1.3;
  /** The advisor's stops for the active rig (coach on): numbered green rings. */
  private proLayer = new Container();
  private proPins: Container[] = [];
  private proStops: MapStop[] = [];
  /** Route numbers on the minimap (built with the route, placed every frame). */
  private miniNums: Text[] = [];
  /** Where the chip is pointing: rings for coming off plane and for casting range. */
  private dest: MapStop | null = null;
  private destRange = 25;
  private visited: ReadonlySet<string> = new Set();
  /** Water route to the destination: a dotted course on the chart. */
  private path: readonly Vec2[] = [];
  private destRings = new Graphics();
  private destLabel = new Text({ text: `IDLE IN · ${OFF_PLANE_M} m`, style: { fill: 0xffd9a0, fontSize: 13, fontFamily: HUD_FONT, fontWeight: '700', letterSpacing: 1, stroke: { color: 0x07141a, width: 4 } } });
  /** Off-screen destination: a chevron on the screen edge pointing at it. */
  private edgePtr = new Graphics();
  /** Screen rect of the minimap (the DOM hit area over it opens the full map). */
  miniRect = { x: 0, y: 0, w: 0, h: 0 };

  constructor() {
    this.destLabel.anchor.set(0.5, 1);
    this.world.addChild(this.wake, this.destRings, this.markers, this.proLayer, this.destLabel, this.sonar, this.boat);
    this.root.addChild(this.world);
    this.overlay.addChild(this.edgePtr, this.mini);
    this.mini.addChild(this.miniDots);
    this.drawBoat();
  }

  /**
   * Show the advisor's route (empty list hides it). A stop on a waypoint (within PRO_MERGE_M) joins
   * the waypoint's label ("ROCK PILE · PRO 2"); any other stop is labelled below-left of its ring,
   * away from waypoint labels, which sit to the right of theirs.
   */
  setProStops(stops: MapStop[]) {
    this.proStops = stops;
    // Route numbers are just 1..n: keep the ones already built (hidden when the route is shorter).
    this.miniNums.forEach((n, i) => (n.visible = i < stops.length));
    while (this.miniNums.length < stops.length) {
      const n = new Text({ text: `${this.miniNums.length + 1}`, resolution: 2, style: { fill: 0x07141a, fontSize: 9, fontFamily: HUD_FONT, fontWeight: '700' } });
      n.anchor.set(0.5);
      this.mini.addChild(n);
      this.miniNums.push(n);
    }
    // Pins are pooled and their labels reused: destroying and rebuilding Text objects that were drawn
    // last frame left Pixi binding destroyed textures ("BindGroup ... destroyed" warnings).
    while (this.proPins.length < stops.length) {
      const i = this.proPins.length;
      const pin = new Container();
      const label = new Text({ text: `PRO ${i + 1}`, style: { fill: 0xbaf5cf, fontSize: 14, fontFamily: HUD_FONT, fontWeight: '700', letterSpacing: 1, stroke: { color: 0x07141a, width: 4 } } });
      label.position.set(-label.width - 6, 8);
      pin.addChild(new Graphics().circle(0, 0, 11).stroke({ width: 2.5, color: PRO_GREEN }), label);
      this.proLayer.addChild(pin);
      this.proPins.push(pin);
    }
    const joined = new Map<Text, string[]>();
    this.proPins.forEach((pin, i) => {
      const s = stops[i];
      pin.visible = !!s;
      if (!s) return;
      pin.position.set(s.x, s.y);
      const wp = this.wpLabels.find((w) => Math.hypot(w.x - s.x, w.y - s.y) < PRO_MERGE_M);
      if (wp) joined.set(wp.label, [...(joined.get(wp.label) ?? []), `PRO ${i + 1}`]);
      pin.children[1].visible = !wp;
    });
    // Only touch a waypoint label when its text actually changes (each change re-rasterises it).
    for (const w of this.wpLabels) {
      const text = joined.has(w.label) ? `${w.name} · ${joined.get(w.label)!.join(' · ')}` : w.name;
      if (w.label.text !== text) w.label.text = text;
    }
  }

  /** The destination the chip points at (null hides the rings), its casting range, and the stops already fished. */
  setDestination(dest: MapStop | null, rangeM: number, visited: ReadonlySet<string>, path: readonly Vec2[] = []) {
    this.dest = dest;
    this.path = path;
    this.destRange = rangeM;
    this.visited = visited;
  }

  dispose() {
    // The chart texture is shared by the chart and the minimap sprites.
    const tex = this.lake?.texture;
    this.lake?.destroy();
    this.miniLake?.destroy();
    tex?.destroy(true);
    this.lake = this.miniLake = undefined;
  }

  toScreen(_t: TournamentState, _view: View, p: Vec2) {
    const q = this.world.toGlobal({ x: p.x, y: p.y });
    return { x: q.x, y: q.y };
  }

  private drawBoat() {
    // Generated top-down sprite when loaded; the vector hull is the fallback.
    this.boatSprite.anchor.set(0.5);
    this.boatSprite.visible = false;
    this.boat.addChild(this.boatShape, this.boatSprite);
    // Hull in metres (bass boats are ~6 m): pointed bow toward +x.
    this.boatShape
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
    this.wpLabels = [];
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
      this.wpLabels.push({ x: w.x, y: w.y, name: w.name.toUpperCase(), label });
    }
    // The route may have been set before this lake's waypoints existed.
    this.setProStops(this.proStops);
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
    this.proPins.forEach((p, i) => {
      if (!p.visible) return;
      p.scale.set(1 / z);
      p.alpha = this.isVisited(this.proStops[i]) ? 0.45 : 1;
    });
    const lead = Math.min(80, boat.speed * 0.9);
    this.world.position.set(
      view.w / 2 - (boat.pos.x + Math.cos(boat.heading) * lead) * z,
      view.h / 2 - (boat.pos.y + Math.sin(boat.heading) * lead) * z,
    );
    this.drawDestination(view, z, boat.pos);

    // Region names only read well when zoomed out at speed.
    const labelAlpha = Math.max(0, Math.min(0.4, (1.0 - this.zoom) * 0.8));
    for (const l of this.regionLabels) l.alpha = labelAlpha;
    const tex = texture(BOAT_SPRITE);
    if (tex && !this.boatSprite.visible) {
      this.boatSprite.texture = tex;
      this.boatSprite.scale.set(BOAT_LENGTH_M / tex.width);
      this.boatSprite.visible = true;
      this.boatShape.visible = false;
    }
    this.boat.position.set(boat.pos.x, boat.pos.y);
    this.boat.rotation = boat.heading;
    // Drawn larger than life so the boat reads as the player's marker on the chart.
    this.boat.scale.set(Math.max(3.6, 6 / this.zoom));

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
      // Real returns, not a fish finder from a game: every target is the same colour (a spooked fish
      // or a drum looks like a bass), sizes carry a per-fish error, and cover returns clutter.
      const inCone = (x: number, y: number) => {
        const dx = x - boat.pos.x;
        const dy = y - boat.pos.y;
        const d = Math.hypot(dx, dy);
        if (d > SONAR_RANGE || d < 2) return null;
        const da = Math.atan2(Math.sin(Math.atan2(dy, dx) - h), Math.cos(Math.atan2(dy, dx) - h));
        return Math.abs(da) > SONAR_HALF ? null : da;
      };
      const pingN = Math.floor((view.time * 2.2) / Math.PI);
      const c0 = Math.max(0, Math.floor((boat.pos.x - SONAR_RANGE) / grid.cellM));
      const c1 = Math.min(grid.cols - 1, Math.floor((boat.pos.x + SONAR_RANGE) / grid.cellM));
      const r0 = Math.max(0, Math.floor((boat.pos.y - SONAR_RANGE) / grid.cellM));
      const r1 = Math.min(grid.rows - 1, Math.floor((boat.pos.y + SONAR_RANGE) / grid.cellM));
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const i = r * grid.cols + c;
          const cover = COVER_CODES[grid.cover[i]];
          if (!grid.water[i] || !COVER_CLUTTER[cover]) continue;
          for (const p of clutterPoints(i, cover)) {
            const x = (c + p.u) * grid.cellM;
            const y = (r + p.v) * grid.cellM;
            const da = inCone(x, y);
            if (da === null) continue;
            const ping = 0.25 + 0.4 * Math.max(0, 1 - Math.abs(da - sweep) * 3);
            s.ellipse(x, y, p.s * 1.2, p.s * 0.7).fill({ color: SONAR_MARK, alpha: ping * 0.55 });
          }
        }
      for (const f of t.fish) {
        if (f.caught) continue;
        const da = inCone(f.pos.x, f.pos.y);
        if (da === null) continue;
        const size = (0.5 + Math.sqrt(f.weightLb) * 0.6) * markSizeNoise(f.id, t.seed);
        const ping = 0.45 + 0.55 * Math.max(0, 1 - Math.abs(da - sweep) * 3);
        const fade = coverFade(coverAt(grid, f.pos.x, f.pos.y), f.id, pingN);
        s.ellipse(f.pos.x, f.pos.y, size * 1.4, size * 0.8).fill({ color: SONAR_MARK, alpha: ping * fade });
      }
    }

    this.drawEdgePointer(view);
    this.updateMinimap(t, grid, view);
  }

  /** When the destination is off screen, a chevron on the edge of the chart points the way to it. */
  private drawEdgePointer(view: View) {
    const g = this.edgePtr.clear();
    const d = this.dest;
    if (!d) return;
    const p = this.world.toGlobal({ x: d.x, y: d.y });
    const top = Math.max(view.hudTop, view.safe.t) + 24;
    const box = { x0: view.safe.l + 30, x1: view.w - view.safe.r - 30, y0: top, y1: view.h - view.safe.b - 30 };
    if (p.x > box.x0 && p.x < box.x1 && p.y > box.y0 && p.y < box.y1) return;
    const cx = view.w / 2;
    const cy = view.h / 2;
    const a = Math.atan2(p.y - cy, p.x - cx);
    // Where the ray from the centre leaves the box.
    const tx = Math.cos(a) > 0 ? (box.x1 - cx) / Math.cos(a) : Math.cos(a) < 0 ? (box.x0 - cx) / Math.cos(a) : Infinity;
    const ty = Math.sin(a) > 0 ? (box.y1 - cy) / Math.sin(a) : Math.sin(a) < 0 ? (box.y0 - cy) / Math.sin(a) : Infinity;
    const r = Math.min(tx, ty);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    const pt = (fwd: number, side: number) => [x + Math.cos(a) * fwd - Math.sin(a) * side, y + Math.sin(a) * fwd + Math.cos(a) * side];
    g.poly([...pt(14, 0), ...pt(-8, -11), ...pt(-3, 0), ...pt(-8, 11)])
      .fill({ color: 0xffffff, alpha: 0.92 })
      .stroke({ width: 2, color: 0x07141a });
  }

  private isVisited(s: MapStop | undefined) {
    return !!s?.id && this.visited.has(s.id);
  }

  /**
   * Around the destination: the advisor's off-plane distance (dashed amber, "IDLE IN") and the rig's
   * casting range (green). Inside the green ring you can reach the stop: FISH lights up.
   */
  private drawDestination(view: View, z: number, boat: Vec2) {
    const g = this.destRings.clear();
    const d = this.dest;
    this.destLabel.visible = !!d;
    if (!d) return;
    // Dotted course along the water route (dots a constant ~10 px apart on screen).
    const gap = 10 / z;
    let prev = boat;
    let carry = 0;
    for (const p of this.path) {
      const len = Math.hypot(p.x - prev.x, p.y - prev.y);
      for (let s = gap - carry; s < len; s += gap) g.circle(prev.x + ((p.x - prev.x) * s) / len, prev.y + ((p.y - prev.y) * s) / len, 1.6 / z);
      carry = len > 0 ? (carry + len) % gap : carry;
      prev = p;
    }
    g.fill({ color: 0xffffff, alpha: 0.7 });
    dashedCircle(g, d.x, d.y, OFF_PLANE_M, 36).stroke({ width: 2.5 / z, color: OFF_PLANE_AMBER, alpha: 0.85 });
    g.circle(d.x, d.y, this.destRange).fill({ color: PRO_GREEN, alpha: 0.1 }).stroke({ width: 2 / z, color: PRO_GREEN, alpha: 0.9 });
    const pulse = 15 + 4 * Math.sin(view.time * 4);
    g.circle(d.x, d.y, pulse / z).stroke({ width: 3 / z, color: 0xffffff, alpha: 0.85 });
    this.destLabel.scale.set(1 / z);
    // Over the ring's top, unless that's under the HUD (scorebug, minimap, destination chip): then under it.
    const lw = this.destLabel.width * z;
    const lh = this.destLabel.height * z;
    const sx = this.world.position.x + d.x * z;
    const topY = this.world.position.y + (d.y - OFF_PLANE_M) * z - 3;
    const m = this.miniRect;
    const underHud = (y0: number, y1: number) =>
      y0 < view.hudTop + 4 || (m.w > 0 && y1 > m.y && y0 < m.y + m.h + LABEL_CLEAR_PX && sx + lw / 2 > m.x - CHIP_W_PX && sx - lw / 2 < m.x + m.w);
    if (underHud(topY - lh, topY)) {
      this.destLabel.anchor.set(0.5, 0);
      this.destLabel.position.set(d.x, d.y + OFF_PLANE_M + 3 / z);
    } else {
      this.destLabel.anchor.set(0.5, 1);
      this.destLabel.position.set(d.x, d.y - OFF_PLANE_M - 3 / z);
    }
  }

  private updateMinimap(t: TournamentState, grid: LakeGrid, view: View) {
    if (!this.miniLake) return;
    // Top-right under the pause button, inside the notch-safe area, clear of the FISH button.
    const mh = Math.min(118, view.h * 0.3);
    const scale = mh / grid.def.sizeM.h;
    this.miniLake.scale.set(scale / MAP_PX_PER_M);
    const mw = grid.def.sizeM.w * scale;
    this.mini.position.set(view.w - mw - 14 - view.safe.r, view.safe.t + 64);
    this.miniRect = { x: this.mini.x - 4, y: this.mini.y - 4, w: mw + 8, h: mh + 8 };
    this.miniLake.alpha = 0.92;
    const g = this.miniDots.clear();
    g.roundRect(-4, -4, mw + 8, mh + 8, 6).stroke({ width: 1, color: 0xffffff, alpha: 0.28 });
    for (const w of grid.def.waypoints) if (w.visible) g.circle(w.x * scale, w.y * scale, 2.2).fill(0xffd34d);
    const d = this.dest;
    if (d) {
      // A heading line from the boat to where the chip points, and a white ring on the destination.
      g.moveTo(t.boat.pos.x * scale, t.boat.pos.y * scale);
      for (const p of this.path) g.lineTo(p.x * scale, p.y * scale);
      if (!this.path.length) g.lineTo(d.x * scale, d.y * scale);
      g.stroke({ width: 1, color: 0xffffff, alpha: 0.55 });
      g.circle(d.x * scale, d.y * scale, 7.5).stroke({ width: 2, color: 0xffffff });
    }
    // Numbered PRO stops (route order): filled discs so the number reads at minimap size; fished ones dim.
    this.proStops.forEach((p, i) => {
      const done = this.isVisited(p);
      g.circle(p.x * scale, p.y * scale, 5.5).fill({ color: PRO_GREEN, alpha: done ? 0.4 : 1 });
      const n = this.miniNums[i];
      if (n) {
        n.position.set(p.x * scale, p.y * scale + 0.5);
        n.alpha = done ? 0.6 : 1;
      }
    });
    g.circle(t.boat.pos.x * scale, t.boat.pos.y * scale, 3.5).fill(0xff4433).stroke({ width: 1.5, color: 0xffffff });
  }
}
