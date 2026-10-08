import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { COLORS } from '../../data/lures';
import { SPECIES } from '../../data/species';
import { TUNING } from '../../data/tuning';
import { activeTackle } from '../../sim/context';
import { cellIndex, coverAt, depthAt, secchiAt, type LakeGrid } from '../../sim/lake';
import type { TournamentState, Vec2 } from '../../sim/types';
import { BOAT_LENGTH_M, BOAT_SPRITE, texture } from '../../game/assets';
import { paintLocalCanvas } from '../lakeTexture';
import { hexNum, PAL } from '../palette';
import { clutterPoints, COVER_CLUTTER, coverFade, markSizeNoise } from '../sonarNoise';

const SONAR_MARK = 0xffe066;
import { HUD_FONT, sonarInsetRect, type Scene, type View } from './types';

const PATCH_M = 140;
const PATCH_PX_PER_M = 7;
const A = TUNING.attraction;
/** Interest bands for the shadows (the follow line, 3, and strike line, 6, come from tuning). */
const CURIOUS_AT = 2;
const HOT_AT = 5;
const DART_AT = 5.6;
const DART_SEC = 0.18;
/** Seconds a follower takes to turn away and fade. */
const LEAVE_SEC = 1.1;

interface FishVis {
  /** Drawn position (the sim position plus render-only offsets). */
  x: number;
  y: number;
  /** Swim-away offset while turning away (decays back once out of sight). */
  ox: number;
  oy: number;
  heading: number;
  alpha: number;
  /** Tail-beat phase. */
  tail: number;
  /** 0 idle, 1 curious, 2 following, 3 hot, 4 striking. */
  band: number;
  prevI: number;
  /** Seconds left of turning away. */
  leaving: number;
  leaveDir: number;
  dart: number;
  darted: boolean;
  seen: number;
}

/** An unbothered fish's heading: its own slow wander, not the lure. */
const idleHeading = (id: number, now: number) => id * 2.399 + Math.sin(now * 0.15 + id) * 0.6;

/** Phases 3 & 4: top-down over the water (boat at the bottom) plus a side-profile depth inset. */
/** The mouth sits this far ahead of the body's centre, in body lengths (the nose of the fish outline). */
const MOUTH = 0.55;

export class WaterScene implements Scene {
  root = new Container();
  overlay = new Container();
  private world = new Container();
  private insetTitle = new Text({ text: 'SONAR', style: { fontFamily: HUD_FONT, fontWeight: '600', fontSize: 11, fill: 0x9fb6c2, letterSpacing: 2 } });
  private lureReadout = new Text({ text: '', style: { fontFamily: HUD_FONT, fontWeight: '700', fontSize: 15, fill: 0xffd34d } });
  private bottomReadout = new Text({ text: '', style: { fontFamily: HUD_FONT, fontWeight: '700', fontSize: 15, fill: 0xeef6f8 } });
  private readouts = { lure: '', bottom: '' };
  private patch?: Sprite;
  private patchCenter: Vec2 | null = null;
  private shadows = new Graphics();
  private lineG = new Graphics();
  private actors = new Graphics();
  private boatSprite = new Sprite();
  private boatShadow = new Graphics();
  private ripples = new Graphics();
  private inset = new Graphics();
  private viewAngle = 0;
  private zoom = 10;
  private rings: { x: number; y: number; age: number; big: boolean }[] = [];
  private lastLurePos: Vec2 | null = null;
  private fishVis = new Map<number, FishVis>();
  private reducedMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** Called when a fish starts following the lure (sound/haptic cue). */
  onFollow?: () => void;

  constructor() {
    this.boatSprite.anchor.set(0.5);
    this.boatSprite.visible = false;
    this.world.addChild(this.shadows, this.ripples, this.boatShadow, this.boatSprite, this.lineG, this.actors);
    this.root.addChild(this.world);
    this.overlay.addChild(this.inset, this.insetTitle, this.lureReadout, this.bottomReadout);
    this.bottomReadout.anchor.set(1, 0);
  }

  dispose() {
    this.patch?.destroy({ texture: true });
    this.patch = undefined;
  }

  toScreen(_t: TournamentState, _view: View, p: Vec2) {
    const q = this.world.toGlobal({ x: p.x, y: p.y });
    return { x: q.x, y: q.y };
  }

  /** Text re-rasterises on change, so only touch it when the rounded value moves. */
  private setReadout(key: 'lure' | 'bottom', text: string) {
    if (this.readouts[key] === text) return;
    this.readouts[key] = text;
    (key === 'lure' ? this.lureReadout : this.bottomReadout).text = text;
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

    this.drawShadows(t, grid, view, target, dt);
    this.drawActors(t, dt);
    this.drawInset(t, grid, view, target);
  }

  /**
   * Fish shadows, drawn from each fish's real interest in the lure (the leaky meter in
   * fish/attraction.ts), so what you see is what the fish think:
   * - idle (< 2): only fish shallow enough to see, faint, minding their own business;
   * - curious (2-3): faint, slow, half-looking at the lure;
   * - following (>= 3, the follow line): clearer, nose on the lure, trailing it at its depth;
   * - hot (>= 5): closer, faster tail, fins flared and a bright edge: it's close to committing;
   * - strike imminent (rising through 5.6): a quick dart at the bait.
   * A follower that drops below the follow line (or is left behind when the retrieve ends) turns
   * away and fades instead of vanishing. Only fish near the lure are drawn.
   */
  private drawShadows(t: TournamentState, grid: LakeGrid, view: View, center: Vec2, dt: number) {
    const g = this.shadows.clear();
    const secchi = secchiAt(grid, center.x, center.y);
    // You can see fish down to roughly the Secchi depth; followers rise and become visible.
    const visibleFt = Math.max(3, secchi * 0.9);
    const radius = (view.h / this.zoom) * 1.2;
    const strikeId = t.present?.strikingFishId ?? null;
    const lure = t.present?.lurePos ?? null;
    const now = view.time;
    const calm = this.reducedMotion;
    // Drawn sizes have a floor in screen px so a shadow still reads on a phone; interested fish get a
    // bigger floor than idle ones so the ones that matter stand out from the crowd.
    const pxK = Math.max(0.75, Math.min(1.3, view.h / 720));
    const minLen = (px: number) => (px * pxK) / this.zoom;
    const MIN_PX = [12, 20, 26, 30, 32];
    for (const f of t.fish) {
      if (f.caught) continue;
      if (t.fight && t.fight.fishId === f.id) continue;
      const dd = Math.hypot(f.pos.x - center.x, f.pos.y - center.y);
      let v = this.fishVis.get(f.id);
      if (dd > radius && !v?.leaving) continue;
      const I = lure ? f.interest : 0;
      const striking = f.id === strikeId;
      const band = striking ? 4 : I >= HOT_AT ? 3 : I >= A.followAt ? 2 : I >= CURIOUS_AT ? 1 : 0;
      if (!v) {
        if (band === 0 && 1 - f.depthFt / visibleFt <= 0.05) continue;
        v = { x: f.pos.x, y: f.pos.y, ox: 0, oy: 0, heading: idleHeading(f.id, now), alpha: 0, tail: f.id, band: 0, prevI: I, leaving: 0, leaveDir: 0, dart: 0, darted: false, seen: now };
        this.fishVis.set(f.id, v);
      }
      v.seen = now;
      // A follower losing interest (or left behind at the end of the retrieve) turns away.
      if (v.band >= 2 && band < 2 && !striking) {
        v.leaving = LEAVE_SEC;
        const from = lure ?? center;
        v.leaveDir = Math.atan2(f.pos.y - from.y, f.pos.x - from.x) + (((f.id * 7919) % 100) / 100 - 0.5) * 1.2;
      }
      if (band >= 2) v.leaving = 0;
      if (band >= 2 && v.band < 2 && !striking && lure) this.onFollow?.();
      // Strike imminent: rising through the dart line, one quick lunge per approach.
      if (I >= DART_AT && I > v.prevI && !v.darted && !calm) {
        v.dart = DART_SEC;
        v.darted = true;
      }
      if (I < HOT_AT) v.darted = false;
      v.prevI = I;
      v.band = band;

      // Target look for the band.
      const toLure = lure ? Math.atan2(lure.y - f.pos.y, lure.x - f.pos.x) : v.heading;
      let heading: number;
      let alpha: number;
      let tailHz: number;
      let size = 1;
      let px = f.pos.x;
      let py = f.pos.y;
      const depth = striking ? 0 : f.depthFt;
      const depthK = Math.max(0.55, Math.min(1, 1 - depth / (visibleFt * 2.5)));
      if (v.leaving > 0) {
        v.leaving = Math.max(0, v.leaving - dt);
        const k = v.leaving / LEAVE_SEC;
        heading = v.leaveDir;
        alpha = 0.5 * k;
        tailHz = 3.5;
        if (!calm) {
          // Swim off along the new heading as it fades.
          const sp = 1.6 * dt;
          v.ox += Math.cos(v.heading) * sp;
          v.oy += Math.sin(v.heading) * sp;
        }
      } else if (band === 0) {
        const vis = 1 - depth / visibleFt;
        heading = idleHeading(f.id, now);
        alpha = vis > 0.05 ? Math.min(0.2, 0.06 + 0.16 * vis) : 0;
        tailHz = 0.8;
      } else if (band === 1) {
        heading = toLure + Math.sin(now * 0.55 + f.id) * 0.9;
        alpha = 0.4 * depthK;
        tailHz = 1.2;
      } else if (band === 2) {
        heading = toLure;
        alpha = 0.66 * depthK;
        tailHz = 2.4;
        size = 1.05;
      } else {
        heading = toLure;
        alpha = striking ? 0.95 : 0.85;
        tailHz = striking ? 7 : 4.5;
        size = 1.12;
        // Hot fish crowd the bait: drawn a little tighter on it than the sim's follow distance.
        if (lure && !striking) {
          const d = Math.hypot(lure.x - f.pos.x, lure.y - f.pos.y);
          const pull = Math.min(0.25, Math.max(0, (d - 0.6) / Math.max(d, 1e-6)) * 0.25);
          px += (lure.x - f.pos.x) * pull;
          py += (lure.y - f.pos.y) * pull;
        }
      }
      if (v.leaving <= 0) {
        // Drift any swim-away offset back while the fish is out of sight.
        const decay = Math.min(1, dt * 0.4);
        v.ox -= v.ox * decay;
        v.oy -= v.oy * decay;
      }
      if (v.dart > 0 && lure) {
        v.dart = Math.max(0, v.dart - dt);
        const lunge = Math.sin((1 - v.dart / DART_SEC) * Math.PI) * 0.45;
        px += Math.cos(toLure) * lunge;
        py += Math.sin(toLure) * lunge;
      }
      // Smooth toward the target: slow turns for curious fish, quick for hot ones.
      const turnRate = v.leaving > 0 ? 6 : band >= 3 ? 10 : band === 2 ? 6 : 1.5;
      let dh = Math.atan2(Math.sin(heading - v.heading), Math.cos(heading - v.heading));
      if (calm && v.leaving > 0) dh = heading - v.heading;
      v.heading += dh * Math.min(1, dt * turnRate);
      v.alpha += (alpha - v.alpha) * Math.min(1, dt * 8);
      v.x = px + v.ox;
      v.y = py + v.oy;
      v.tail += dt * tailHz * Math.PI * 2;
      if (v.alpha <= 0.02) continue;

      const len = Math.max(0.25 + f.lengthIn * 0.025, minLen(MIN_PX[v.leaving > 0 ? 2 : band])) * size;
      const ca = Math.cos(v.heading);
      const sa = Math.sin(v.heading);
      const wag = calm ? 0 : Math.sin(v.tail) * (band >= 3 ? 0.2 : 0.12);
      const cx = v.x;
      const cy = v.y;
      // The fish's position is its mouth (where it meets the lure): the body hangs behind it and turns about it.
      const tx = (x: number, y: number) => [cx + (x - MOUTH) * len * ca - y * len * sa, cy + (x - MOUTH) * len * sa + y * len * ca];
      // Body + a tail that beats (faster as interest climbs).
      const tailY = wag;
      const pts = [
        tx(0.55, 0), tx(0.2, 0.16), tx(-0.3, 0.12), tx(-0.55, 0.22 + tailY), tx(-0.48, tailY), tx(-0.55, -0.22 + tailY), tx(-0.3, -0.12), tx(0.2, -0.16),
      ].flat();
      const hot = band >= 3 && v.leaving <= 0;
      if (hot) {
        // Brighten: a soft light glow around a fish that's about to commit.
        const glow = calm ? 0.22 : 0.2 + 0.08 * Math.sin(now * 9);
        const [bx, by] = tx(0, 0);
        g.ellipse(bx, by, len * 0.75, len * 0.75).fill({ color: 0xe8fbff, alpha: glow * v.alpha });
      }
      g.poly(pts).fill({ color: 0x0b1a22, alpha: v.alpha });
      if (band >= 2 && v.leaving <= 0) {
        // Followers get a light edge so they read on any water; hot fish a bright one.
        g.poly(pts).stroke({ width: (hot ? 2 : 1.3) / this.zoom, color: hot ? 0xffffff : 0x9fd8ea, alpha: (hot ? 0.9 : 0.55) * v.alpha });
      }
      if (hot) {
        // Fin flare: pectoral fins spread out (the tell before a strike).
        const flare = calm ? 0.32 : 0.28 + 0.06 * Math.sin(now * 12 + f.id);
        for (const side of [1, -1]) {
          g.poly([...tx(0.12, 0.13 * side), ...tx(-0.05, (0.13 + flare) * side), ...tx(-0.02, 0.1 * side)]).fill({ color: 0xffd34d, alpha: 0.7 * v.alpha });
        }
      }
    }
    // Forget fish we haven't drawn for a while.
    if (this.fishVis.size > 64)
      for (const [id, v] of this.fishVis) if (now - v.seen > 2 && !v.leaving) this.fishVis.delete(id);
  }

  /**
   * Followers on screen, or fish still turning away: when a retrieve ends with any, the renderer holds
   * this view a moment so you see them turn and go.
   */
  hasFollowers(): boolean {
    for (const v of this.fishVis.values()) if ((v.band >= 2 || v.leaving > 0) && v.alpha > 0.05) return true;
    return false;
  }

  private drawActors(t: TournamentState, dt: number) {
    const g = this.actors.clear();
    const lg = this.lineG.clear();
    const rg = this.ripples.clear();
    const b = t.boat.pos;
    const a = this.viewAngle;
    const tip = { x: b.x + Math.cos(a) * 2.6, y: b.y + Math.sin(a) * 2.6 };

    // Boat (pointing toward the cast): generated sprite when loaded, vector hull as the fallback.
    const tex = texture(BOAT_SPRITE);
    this.boatShadow.clear();
    if (tex) {
      this.boatSprite.texture = tex;
      this.boatSprite.scale.set(BOAT_LENGTH_M / tex.width);
      this.boatSprite.position.set(b.x, b.y);
      this.boatSprite.rotation = a;
      this.boatSprite.visible = true;
      this.boatShadow.ellipse(b.x + 0.25, b.y + 0.35, BOAT_LENGTH_M * 0.5, 1.15).fill({ color: 0x04121a, alpha: 0.35 });
    } else {
      const hull = [3.2, 0, 1.2, -1.2, -3, -1.1, -3, 1.1, 1.2, 1.2];
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      g.poly(hull.reduce<number[]>((acc, v, i) => {
        if (i % 2 === 0) acc.push(b.x + v * ca - hull[i + 1] * sa, b.y + v * sa + hull[i + 1] * ca);
        return acc;
      }, [])).fill(PAL.boat).stroke({ width: 0.12, color: 0x444444 });
    }

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
      const lineColor = tension > TUNING.fight.tensionDanger ? 0xff4d4d : tension > TUNING.fight.tensionWarn ? 0xffd34d : PAL.line;
      lg.moveTo(tip.x, tip.y).lineTo(f.pos.x, f.pos.y).stroke({ width: 0.07 + tension * 0.08, color: lineColor });
      const len = 0.3 + (SPECIES[f.species].isBass ? 0.6 : 0.8) * Math.cbrt(f.weightLb);
      const ang = f.heading;
      const c2 = Math.cos(ang);
      const s2 = Math.sin(ang);
      const air = f.jumpT > 0;
      // The hook is in the mouth: the line meets the fish there and the body swings behind it.
      const pts = [
        [len * 0.55, 0], [len * 0.2, len * 0.18], [-len * 0.3, len * 0.12], [-len * 0.55, len * 0.24],
        [-len * 0.5, 0], [-len * 0.55, -len * 0.24], [-len * 0.3, -len * 0.12], [len * 0.2, -len * 0.18],
      ].flatMap(([px, py]) => [f.pos.x + (px - len * MOUTH) * c2 - py * s2, f.pos.y + (px - len * MOUTH) * s2 + py * c2]);
      g.poly(pts).fill({ color: air ? 0x6b7f3a : 0x0b1a22, alpha: air ? 1 : 0.55 });
      if (air || f.burstT > 0) this.rings.push({ x: f.pos.x - len * MOUTH * c2, y: f.pos.y - len * MOUTH * s2, age: air ? 0 : 0.5, big: air });
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
    // Broadcast panel under the scorebug strip, inside the notch-safe area, clear of the fight panel.
    const { x: x0, y: y0, w: W, h: H } = sonarInsetRect(view);
    g.roundRect(x0, y0, W, H, 8).fill({ color: 0x081820, alpha: 0.88 }).stroke({ width: 1, color: 0xffffff, alpha: 0.14 });
    this.insetTitle.position.set(x0 + 9, y0 + 5);
    this.lureReadout.position.set(x0 + 52, y0 + 2);
    this.bottomReadout.position.set(x0 + W - 9, y0 + 2);
    const head = 20;
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
    const py = (dep: number) => y0 + head + 4 + ((H - head - 10) * dep) / maxDepth;
    const lureFt = t.present ? t.present.lureDepthFt : null;
    const bottomFt = samples[Math.min(40, Math.round((40 * Math.hypot(target.x - b.x, target.y - b.y)) / range))];
    this.setReadout('lure', lureFt === null ? '' : `LURE ${lureFt.toFixed(lureFt < 10 ? 1 : 0)} FT`);
    this.setReadout('bottom', `BOTTOM ${Math.round(bottomFt)} FT`);
    const pts: number[] = [px(0), py(0)];
    samples.forEach((dep, i) => pts.push(px((range * i) / 40), py(dep)));
    pts.push(px(range), py(maxDepth), px(0), py(maxDepth));
    g.poly(pts).fill({ color: 0x8a6b3d, alpha: 0.85 });
    g.moveTo(px(0), py(0)).lineTo(px(range), py(0)).stroke({ width: 1, color: PAL.sonar, alpha: 0.4 });
    // Cover returns: wood and grass stand up off the bottom, docks hang from the top, as clutter.
    const pingN = Math.floor(view.time * 1.5);
    for (let i = 0; i <= 40; i++) {
      const dd = (range * i) / 40;
      const x = b.x + Math.cos(a) * dd;
      const y = b.y + Math.sin(a) * dd;
      const cover = coverAt(grid, x, y);
      const k = COVER_CLUTTER[cover];
      if (!k) continue;
      const cell = cellIndex(grid, x, y);
      const tall = cover === 'standing' ? 0.9 : cover === 'timber' ? 0.45 : cover === 'dock' ? 0.25 : 0.3;
      for (const p of clutterPoints(cell * 41 + i, cover, 3)) {
        const dep = cover === 'dock' ? p.v * samples[i] * tall : samples[i] * (1 - p.v * tall);
        g.circle(px(dd + (p.u - 0.5) * (range / 40)), py(dep), 0.8 + p.s).fill({ color: SONAR_MARK, alpha: 0.35 * k });
      }
    }

    for (const f of t.fish) {
      if (f.caught) continue;
      const rx = f.pos.x - b.x;
      const ry = f.pos.y - b.y;
      const along = rx * Math.cos(a) + ry * Math.sin(a);
      const lateral = Math.abs(-rx * Math.sin(a) + ry * Math.cos(a));
      if (along < 0 || along > range || lateral > 6) continue;
      // Same mark for every fish (species and spooked fish look alike), with a per-fish size error,
      // faded into the clutter inside cover.
      const sz = (2 + Math.sqrt(f.weightLb) * 1.6) * markSizeNoise(f.id, t.seed);
      const ax = px(along);
      const ay = py(f.depthFt);
      const fade = coverFade(coverAt(grid, f.pos.x, f.pos.y), f.id, pingN);
      g.moveTo(ax + Math.cos(Math.PI * 1.15) * sz, ay + Math.sin(Math.PI * 1.15) * sz)
        .arc(ax, ay, sz, Math.PI * 1.15, Math.PI * 1.85)
        .stroke({ width: 2, color: f.interest >= 3 ? 0xff6b3d : SONAR_MARK, alpha: 0.9 * fade });
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
