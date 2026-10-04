// Lake authoring: reservoirs are a main basin plus dozens of creek arms, which are tedious to trace
// as one polygon by hand. A sketch describes the water as basins (polygons) + arms (centre-line
// paths with tapering widths) + islands; this tool rasterises the union, traces the outline and
// simplifies it into the shoreline/islands the runtime expects (src/data/lakes/types.ts).
//
//   npx tsx tools/lake-shape.ts lakefork      reads tools/lakes/lakefork.sketch.json
//                                             writes src/data/lakes/lakefork.json
//
// Everything except `shape` in the sketch is copied through as-is (it is the rest of the LakeDef).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Pt = [number, number];
interface Sketch {
  shape: {
    /** Raster resolution in metres (smaller = smoother shoreline, slower). */
    resM: number;
    /** Douglas-Peucker tolerance in metres. */
    simplifyM: number;
    basins: Pt[][];
    arms: { name?: string; path: Pt[]; width: number[]; coves?: boolean }[];
    islands: Pt[][];
    /** Natural shoreline: half-width varies by up to this fraction (smooth noise, per bank). */
    wobble?: number;
    /** Auto-generated side coves along arms: spacing (m) and length range (m). */
    coves?: { everyM: number; lenM: [number, number]; widthM: [number, number] };
  };
  sizeM: { w: number; h: number };
  [k: string]: unknown;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function pointInPoly(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from p to segment ab, and the 0..1 position along it. */
function seg(x: number, y: number, a: Pt, b: Pt): [number, number] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return [Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy)), t];
}

/** Smooth 1D value noise in [-1, 1], deterministic. */
function noise1(t: number, seed: number): number {
  const h = (i: number) => {
    let v = Math.imul((i + seed * 7919) | 0, 374761393);
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return (((v ^ (v >>> 16)) >>> 0) / 4294967296) * 2 - 1;
  };
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}

type Arm = Sketch['shape']['arms'][number];

function inArm(x: number, y: number, arm: Arm, wobble: number, seed: number): boolean {
  let along = 0;
  for (let k = 1; k < arm.path.length; k++) {
    const a = arm.path[k - 1];
    const b = arm.path[k];
    const [d, t] = seg(x, y, a, b);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const w = arm.width[k - 1] + (arm.width[k] - arm.width[k - 1]) * t;
    // Each bank wobbles independently: which side of the centre line is the point on?
    const side = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) > 0 ? 1 : 0;
    const s = (along + t * len) / 140;
    const n = 0.65 * noise1(s, seed * 2 + side) + 0.35 * noise1(s * 3.1, seed * 2 + side + 50);
    if (d <= (w / 2) * (1 + wobble * n)) return true;
    along += len;
  }
  return false;
}

/** Deterministic side coves: short tapering fingers off an arm's banks, like a real reservoir. */
function makeCoves(arm: Arm, idx: number, cfg: NonNullable<Sketch['shape']['coves']>): Arm[] {
  const out: Arm[] = [];
  let along = 0;
  let next = cfg.everyM * 0.6;
  for (let k = 1; k < arm.path.length; k++) {
    const a = arm.path[k - 1];
    const b = arm.path[k];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dir = Math.atan2(b[1] - a[1], b[0] - a[0]);
    while (next < along + len) {
      const t = (next - along) / len;
      const n = out.length;
      const r = (j: number) => (noise1(n * 1.7 + j * 13.3, idx + 31) + 1) / 2;
      const w = arm.width[k - 1] + (arm.width[k] - arm.width[k - 1]) * t;
      const side = r(1) > 0.5 ? 1 : -1;
      const ang = dir + side * (Math.PI / 2 - 0.5 + r(2) * 0.9);
      const coveLen = cfg.lenM[0] + r(3) * (cfg.lenM[1] - cfg.lenM[0]);
      const coveW = cfg.widthM[0] + r(4) * (cfg.widthM[1] - cfg.widthM[0]);
      const base: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const startOff = w / 2 - coveW * 0.3;
      const p0: Pt = [base[0] + Math.cos(ang) * startOff, base[1] + Math.sin(ang) * startOff];
      const bend = ang + (r(5) - 0.5) * 0.8;
      const p1: Pt = [p0[0] + Math.cos(ang) * coveLen * 0.55, p0[1] + Math.sin(ang) * coveLen * 0.55];
      const p2: Pt = [p1[0] + Math.cos(bend) * coveLen * 0.45, p1[1] + Math.sin(bend) * coveLen * 0.45];
      out.push({ path: [p0, p1, p2], width: [Math.min(coveW, w * 0.6), coveW * 0.6, 24] });
      next += cfg.everyM * (0.6 + r(6) * 0.8);
    }
    along += len;
  }
  return out;
}

/** Moore-neighbour boundary trace of the largest water region; returns cell-centre points. */
function trace(mask: Uint8Array, cols: number, rows: number): Pt[] {
  const at = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && mask[r * cols + c] === 1;
  // Start at the first water cell in raster order: its west neighbour is land.
  let start = -1;
  for (let i = 0; i < mask.length && start < 0; i++) if (mask[i]) start = i;
  const dirs: Pt[] = [
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
  ];
  const sc = start % cols;
  const sr = Math.floor(start / cols);
  const out: Pt[] = [[sc, sr]];
  let [c, r] = [sc, sr];
  let back = 0; // index into dirs of where we came from (west)
  for (let guard = 0; guard < cols * rows * 4; guard++) {
    let found = false;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8;
      const nc = c + dirs[d][0];
      const nr = r + dirs[d][1];
      if (at(nc, nr)) {
        back = (d + 4) % 8;
        [c, r] = [nc, nr];
        found = true;
        break;
      }
    }
    if (!found || (c === sc && r === sr)) break;
    out.push([c, r]);
  }
  return out;
}

function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let best = -1;
    let bestD = tol;
    for (let k = i + 1; k < j; k++) {
      const [d] = seg(pts[k][0], pts[k][1], pts[i], pts[j]);
      if (d > bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([i, best], [best, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

const id = process.argv[2];
if (!id) throw new Error('usage: tsx tools/lake-shape.ts <lakeId>');
const sketch = JSON.parse(readFileSync(join(ROOT, 'tools/lakes', `${id}.sketch.json`), 'utf8')) as Sketch;
const { shape, ...lake } = sketch;
const res = shape.resM;
const cols = Math.ceil(sketch.sizeM.w / res);
const rows = Math.ceil(sketch.sizeM.h / res);
const mask = new Uint8Array(cols * rows);
const wobble = shape.wobble ?? 0;
const coves = shape.coves ? shape.arms.flatMap((a, i) => (a.coves === false ? [] : makeCoves(a, i, shape.coves!))) : [];
const strokes: [Arm, number][] = [...shape.arms.map((a, i) => [a, i] as [Arm, number]), ...coves.map((a, i) => [a, 1000 + i] as [Arm, number])];
for (let r = 0; r < rows; r++)
  for (let c = 0; c < cols; c++) {
    const x = (c + 0.5) * res;
    const y = (r + 0.5) * res;
    const water = shape.basins.some((b) => pointInPoly(x, y, b)) || strokes.some(([a, i]) => inArm(x, y, a, i >= 1000 ? wobble * 0.5 : wobble, i));
    // Islands are kept as separate polygons (the runtime subtracts them), so don't carve them here.
    mask[r * cols + c] = water ? 1 : 0;
  }
const ring = trace(mask, cols, rows).map(([c, r]) => [Math.round((c + 0.5) * res), Math.round((r + 0.5) * res)] as Pt);
const shoreline = simplify([...ring, ring[0]], shape.simplifyM).slice(0, -1);
const total = mask.reduce((a, v) => a + v, 0);
const out = { ...lake, shoreline, islands: shape.islands };
writeFileSync(join(ROOT, 'src/data/lakes', `${id}.json`), JSON.stringify(out, null, 1) + '\n');
console.log(`${coves.length} generated coves`);
console.log(`${id}: ${shoreline.length}-point shoreline from ${ring.length} boundary cells, ${shape.islands.length} islands, ~${Math.round((total * res * res) / 4047)} acres of water`);
