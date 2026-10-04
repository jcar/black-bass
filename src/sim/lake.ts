import type { LakeDef, Pt } from '../data/lakes/types';
import type { CoverType, Vec2 } from './types';

export const COVER_CODES: CoverType[] = ['none', 'rock', 'grass', 'dock', 'timber', 'reeds'];
/** Hard cover: a lure landing on it crashes and spooks fish. */
export const HARD_COVER: ReadonlySet<CoverType> = new Set(['dock', 'timber']);

/** Rasterised lake: the single source of truth for collision, sonar, fish placement and rendering. */
export interface LakeGrid {
  def: LakeDef;
  cols: number;
  rows: number;
  cellM: number;
  water: Uint8Array;
  depthFt: Float32Array;
  cover: Uint8Array;
  secchiFt: Float32Array;
  shoreDistM: Float32Array;
}

function pointInPoly(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Deterministic per-cell noise so cover patches get ragged, natural edges. */
function hash01(i: number, j: number): number {
  let h = Math.imul(i * 374761393 + j * 668265263, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function buildLakeGrid(def: LakeDef): LakeGrid {
  const cellM = def.cellM;
  const cols = Math.ceil(def.sizeM.w / cellM);
  const rows = Math.ceil(def.sizeM.h / cellM);
  const n = cols * rows;
  const water = new Uint8Array(n);
  const depthFt = new Float32Array(n);
  const cover = new Uint8Array(n);
  const secchiFt = new Float32Array(n);
  const shoreDistM = new Float32Array(n);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * cellM;
      const y = (r + 0.5) * cellM;
      const inLake = pointInPoly(x, y, def.shoreline) && !def.islands.some((isl) => pointInPoly(x, y, isl));
      water[r * cols + c] = inLake ? 1 : 0;
    }
  }

  // Chamfer distance transform from land cells (two passes) gives distance-to-shore.
  const INF = 1e9;
  for (let i = 0; i < n; i++) shoreDistM[i] = water[i] ? INF : 0;
  const d1 = cellM;
  const d2 = cellM * Math.SQRT2;
  const at = (c: number, r: number) => (c < 0 || r < 0 || c >= cols || r >= rows ? 0 : shoreDistM[r * cols + c]);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!water[i]) continue;
      shoreDistM[i] = Math.min(shoreDistM[i], at(c - 1, r) + d1, at(c, r - 1) + d1, at(c - 1, r - 1) + d2, at(c + 1, r - 1) + d2);
    }
  for (let r = rows - 1; r >= 0; r--)
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c;
      if (!water[i]) continue;
      shoreDistM[i] = Math.min(shoreDistM[i], at(c + 1, r) + d1, at(c, r + 1) + d1, at(c + 1, r + 1) + d2, at(c - 1, r + 1) + d2);
    }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!water[i]) continue;
      const x = (c + 0.5) * cellM;
      const y = (r + 0.5) * cellM;
      let num = 0;
      let den = 0;
      for (const [px, py, pd] of def.depthPoints) {
        const w = 1 / Math.max(1, (px - x) ** 2 + (py - y) ** 2);
        num += w * pd;
        den += w;
      }
      const idw = num / den;
      depthFt[i] = Math.max(1.5, Math.min(idw, (shoreDistM[i] - cellM * 0.5) * def.shoreSlopeFtPerM + 1.5));

      let secchi = def.clarity.defaultSecchiFt;
      for (const z of def.clarity.zones) {
        const d = Math.hypot(z.x - x, z.y - y);
        if (d < z.r) {
          const t = d / z.r;
          secchi = Math.min(secchi, z.secchiFt + (secchi - z.secchiFt) * t * t);
        }
      }
      secchiFt[i] = secchi;

      for (const p of def.cover) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < p.r * (0.7 + 0.35 * hash01(c, r))) cover[i] = COVER_CODES.indexOf(p.type);
      }
    }
  }

  return { def, cols, rows, cellM, water, depthFt, cover, secchiFt, shoreDistM };
}

export function cellIndex(g: LakeGrid, x: number, y: number): number {
  const c = Math.floor(x / g.cellM);
  const r = Math.floor(y / g.cellM);
  if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return -1;
  return r * g.cols + c;
}

export function isWater(g: LakeGrid, x: number, y: number): boolean {
  const i = cellIndex(g, x, y);
  return i >= 0 && g.water[i] === 1;
}

export function depthAt(g: LakeGrid, x: number, y: number): number {
  const i = cellIndex(g, x, y);
  return i >= 0 && g.water[i] ? g.depthFt[i] : 0;
}

export function coverAt(g: LakeGrid, x: number, y: number): CoverType {
  const i = cellIndex(g, x, y);
  return i >= 0 && g.water[i] ? COVER_CODES[g.cover[i]] : 'none';
}

export function secchiAt(g: LakeGrid, x: number, y: number): number {
  const i = cellIndex(g, x, y);
  return i >= 0 ? g.secchiFt[i] || g.def.clarity.defaultSecchiFt : g.def.clarity.defaultSecchiFt;
}

/** True if cover other than 'none' is within `radiusM` (used for "edge" casts and cover bonuses). */
export function nearCover(g: LakeGrid, x: number, y: number, radiusM: number): CoverType {
  const steps = Math.ceil(radiusM / g.cellM);
  let best: CoverType = 'none';
  let bestD = Infinity;
  for (let dr = -steps; dr <= steps; dr++)
    for (let dc = -steps; dc <= steps; dc++) {
      const px = x + dc * g.cellM;
      const py = y + dr * g.cellM;
      const cv = coverAt(g, px, py);
      const d = Math.hypot(dc, dr) * g.cellM;
      if (cv !== 'none' && d <= radiusM && d < bestD) {
        best = cv;
        bestD = d;
      }
    }
  return best;
}

export function randomWaterPoint(g: LakeGrid, rnd: () => number): Vec2 {
  for (;;) {
    const x = rnd() * g.def.sizeM.w;
    const y = rnd() * g.def.sizeM.h;
    if (isWater(g, x, y)) return { x, y };
  }
}

const gridCache = new Map<string, LakeGrid>();
export function getLakeGrid(def: LakeDef): LakeGrid {
  let g = gridCache.get(def.id);
  if (!g) {
    g = buildLakeGrid(def);
    gridCache.set(def.id, g);
  }
  return g;
}
