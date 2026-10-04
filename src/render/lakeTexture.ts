// Paints the data-driven lake (depth grid + cover) into canvases. The map, the local
// top-down fishing view and the minimap all come from the same grid as the simulation.
import { COVER_CODES, type LakeGrid } from '../sim/lake';
import type { Vec2 } from '../sim/types';
import { depthRGB, PAL } from './palette';

function hash01(a: number, b: number): number {
  let h = Math.imul(a * 374761393 + b * 668265263, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Per-pixel water colour with bilinear depth interpolation (smooth, no cell blocks). */
function paintDepth(ctx: CanvasRenderingContext2D, g: LakeGrid, ox: number, oy: number, pxPerM: number, w: number, h: number) {
  const img = ctx.createImageData(w, h);
  const data = img.data;
  for (let yy = 0; yy < h; yy++) {
    const wy = oy + (yy + 0.5) / pxPerM;
    const fr = wy / g.cellM - 0.5;
    const rA = Math.max(0, Math.min(g.rows - 1, Math.floor(fr)));
    const rB = Math.min(g.rows - 1, rA + 1);
    const ty = Math.max(0, Math.min(1, fr - rA));
    for (let xx = 0; xx < w; xx++) {
      const wx = ox + (xx + 0.5) / pxPerM;
      const fc = wx / g.cellM - 0.5;
      const cA = Math.max(0, Math.min(g.cols - 1, Math.floor(fc)));
      const cB = Math.min(g.cols - 1, cA + 1);
      const tx = Math.max(0, Math.min(1, fc - cA));
      const d = (cc: number, rr: number) => g.depthFt[rr * g.cols + cc] || 1;
      const depth = (d(cA, rA) * (1 - tx) + d(cB, rA) * tx) * (1 - ty) + (d(cA, rB) * (1 - tx) + d(cB, rB) * tx) * ty;
      const [r, gg, b] = depthRGB(depth, g.secchiFt[rA * g.cols + cA] || g.def.clarity.defaultSecchiFt);
      // A little deterministic grain so big flats don't look flat.
      const n = (hash01(xx, yy) - 0.5) * 6;
      const k = (yy * w + xx) * 4;
      data[k] = r + n;
      data[k + 1] = gg + n;
      data[k + 2] = b + n;
      data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Marinas: a main pier out from the nearest shore with finger slips and a few moored boats. */
function drawDocks(ctx: CanvasRenderingContext2D, g: LakeGrid, toPx: (x: number, y: number) => [number, number], pxPerM: number) {
  for (const p of g.def.cover) {
    if (p.type !== 'dock') continue;
    let best = { ang: 0, d: Infinity };
    for (let k = 0; k < 32; k++) {
      const ang = (k / 32) * Math.PI * 2;
      for (let d = 0; d < p.r * 4; d += 4) {
        const x = p.x + Math.cos(ang) * d;
        const y = p.y + Math.sin(ang) * d;
        const c = Math.floor(x / g.cellM);
        const r = Math.floor(y / g.cellM);
        if (c < 0 || r < 0 || c >= g.cols || r >= g.rows || !g.water[r * g.cols + c]) {
          if (d < best.d) best = { ang, d };
          break;
        }
      }
    }
    if (!isFinite(best.d)) continue;
    const out = best.ang + Math.PI;
    const sx = p.x + Math.cos(best.ang) * best.d;
    const sy = p.y + Math.sin(best.ang) * best.d;
    const len = best.d + p.r * 0.7;
    const ex = sx + Math.cos(out) * len;
    const ey = sy + Math.sin(out) * len;
    const w = (m: number) => Math.max(1, m * pxPerM);
    ctx.lineCap = 'butt';
    ctx.strokeStyle = PAL.dock;
    ctx.lineWidth = w(2.4);
    ctx.beginPath();
    ctx.moveTo(...toPx(sx, sy));
    ctx.lineTo(...toPx(ex, ey));
    ctx.stroke();
    const nx = -Math.sin(out);
    const ny = Math.cos(out);
    for (let d = 6; d < len - 2; d += 5) {
      const bx = sx + Math.cos(out) * d;
      const by = sy + Math.sin(out) * d;
      for (const sd of [1, -1]) {
        ctx.strokeStyle = PAL.dockDark;
        ctx.lineWidth = w(1);
        ctx.beginPath();
        ctx.moveTo(...toPx(bx, by));
        ctx.lineTo(...toPx(bx + nx * 6 * sd, by + ny * 6 * sd));
        ctx.stroke();
        if (hash01(Math.round(bx), Math.round(by) + sd) < 0.45) {
          const [cx, cy] = toPx(bx + nx * 3.2 * sd + Math.cos(out) * 2.4, by + ny * 3.2 * sd + Math.sin(out) * 2.4);
          ctx.fillStyle = '#f1f1ea';
          ctx.beginPath();
          ctx.ellipse(cx, cy, w(2.6), w(1), Math.atan2(ny, nx), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Draws land as smooth polygons over the cell raster so shorelines don't look blocky. */
function drawLand(ctx: CanvasRenderingContext2D, g: LakeGrid, toPx: (x: number, y: number) => [number, number], w: number, h: number) {
  ctx.save();
  ctx.fillStyle = PAL.land;
  ctx.beginPath();
  ctx.rect(-10, -10, w + 20, h + 20);
  const sh = g.def.shoreline;
  const [sx, sy] = toPx(sh[0][0], sh[0][1]);
  ctx.moveTo(sx, sy);
  for (const [x, y] of sh) ctx.lineTo(...toPx(x, y));
  ctx.closePath();
  ctx.fill('evenodd');
  for (const isl of g.def.islands) {
    ctx.beginPath();
    ctx.moveTo(...toPx(isl[0][0], isl[0][1]));
    for (const [x, y] of isl) ctx.lineTo(...toPx(x, y));
    ctx.closePath();
    ctx.fill();
  }
  // Sandy fringe.
  ctx.strokeStyle = PAL.sand;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(1, (toPx(8, 0)[0] - toPx(0, 0)[0]));
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  for (const [x, y] of sh) ctx.lineTo(...toPx(x, y));
  ctx.closePath();
  ctx.stroke();
  for (const isl of g.def.islands) {
    ctx.beginPath();
    ctx.moveTo(...toPx(isl[0][0], isl[0][1]));
    for (const [x, y] of isl) ctx.lineTo(...toPx(x, y));
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

/** `pxPerM` set = close-up view: size cover in metres. Unset = chart view: size by cell. */
function drawCoverCell(ctx: CanvasRenderingContext2D, type: string, px: number, py: number, cellPx: number, c: number, r: number, detail: number, pxPerM?: number) {
  const n = Math.max(1, Math.round(detail));
  for (let k = 0; k < n; k++) {
    const hx = px + hash01(c * 7 + k, r) * cellPx;
    const hy = py + hash01(c, r * 13 + k) * cellPx;
    const s = pxPerM ? pxPerM * (0.25 + 0.55 * hash01(c + k, r + k)) : cellPx * (0.08 + 0.1 * hash01(c + k, r + k));
    switch (type) {
      case 'rock':
        ctx.fillStyle = k % 2 ? PAL.rock : PAL.rockDark;
        ctx.beginPath();
        ctx.ellipse(hx, hy, s * 1.3, s, hash01(k, c) * 3, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'grass':
        ctx.strokeStyle = k % 2 ? PAL.grass : PAL.grassLight;
        ctx.lineWidth = Math.max(0.6, s * 0.35);
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.quadraticCurveTo(hx + s, hy - s * 1.5, hx + s * 0.5, hy - s * 3);
        ctx.stroke();
        break;
      case 'reeds':
        ctx.strokeStyle = PAL.reeds;
        ctx.lineWidth = Math.max(0.6, s * 0.3);
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx + s * 0.3, hy - s * 3.5);
        ctx.stroke();
        break;
      case 'timber':
        ctx.strokeStyle = PAL.timber;
        ctx.lineWidth = Math.max(1, s * 0.6);
        ctx.beginPath();
        ctx.moveTo(hx - s * 2, hy - s);
        ctx.lineTo(hx + s * 2, hy + s);
        ctx.stroke();
        break;
      case 'standing': {
        // Dead trunks breaking the surface: a dark bole with a weathered grey top.
        const rr = Math.max(0.7, s * 0.55);
        ctx.fillStyle = PAL.standing;
        ctx.beginPath();
        ctx.arc(hx, hy, rr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = PAL.standingTop;
        ctx.beginPath();
        ctx.arc(hx - rr * 0.25, hy - rr * 0.25, rr * 0.45, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'dock':
        // Piers are drawn per marina in drawDocks.
        break;
    }
  }
}

function drawContours(ctx: CanvasRenderingContext2D, g: LakeGrid, toPx: (x: number, y: number) => [number, number], cellPx: number, c0: number, r0: number, c1: number, r1: number) {
  ctx.strokeStyle = PAL.contour;
  ctx.lineWidth = Math.max(0.6, (cellPx / g.cellM) * 0.25);
  const band = (d: number) => Math.floor(d / 10);
  ctx.beginPath();
  for (let r = r0; r < r1; r++)
    for (let c = c0; c < c1; c++) {
      const i = r * g.cols + c;
      if (!g.water[i]) continue;
      const b = band(g.depthFt[i]);
      const [px, py] = toPx(c * g.cellM, r * g.cellM);
      if (c + 1 < g.cols && g.water[i + 1] && band(g.depthFt[i + 1]) !== b) {
        ctx.moveTo(px + cellPx, py);
        ctx.lineTo(px + cellPx, py + cellPx);
      }
      if (r + 1 < g.rows && g.water[i + g.cols] && band(g.depthFt[i + g.cols]) !== b) {
        ctx.moveTo(px, py + cellPx);
        ctx.lineTo(px + cellPx, py + cellPx);
      }
    }
  ctx.stroke();
}

/** Buoyed boat lanes: a dashed run line with white/orange buoys every ~120 m. */
function drawLanes(ctx: CanvasRenderingContext2D, g: LakeGrid, toPx: (x: number, y: number) => [number, number], pxPerM: number) {
  const lanes = g.def.lanes ?? [];
  if (!lanes.length) return;
  ctx.save();
  ctx.strokeStyle = PAL.lane;
  ctx.lineWidth = Math.max(1, pxPerM * 3);
  ctx.setLineDash([pxPerM * 30, pxPerM * 22]);
  for (const pl of lanes) {
    ctx.beginPath();
    ctx.moveTo(...toPx(pl[0][0], pl[0][1]));
    for (const [x, y] of pl.slice(1)) ctx.lineTo(...toPx(x, y));
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const r = Math.max(1.6, pxPerM * 7);
  for (const pl of lanes)
    for (let k = 1; k < pl.length; k++) {
      const [ax, ay] = pl[k - 1];
      const [bx, by] = pl[k];
      const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 120));
      for (let i = 0; i < n; i++) {
        const [x, y] = toPx(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n);
        ctx.fillStyle = PAL.buoy;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = PAL.buoyStripe;
        ctx.fillRect(x - r, y - r * 0.25, r * 2, r * 0.5);
      }
    }
  ctx.restore();
}

/** Whole-lake chart for the navigation map (and minimap). */
export function paintLakeCanvas(g: LakeGrid, pxPerM: number): HTMLCanvasElement {
  const w = g.def.sizeM.w * pxPerM;
  const h = g.def.sizeM.h * pxPerM;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  const cellPx = g.cellM * pxPerM;
  const toPx = (x: number, y: number): [number, number] => [x * pxPerM, y * pxPerM];
  paintDepth(ctx, g, 0, 0, pxPerM, canvas.width, canvas.height);
  drawContours(ctx, g, toPx, cellPx, 0, 0, g.cols, g.rows);
  for (let r = 0; r < g.rows; r++)
    for (let c = 0; c < g.cols; c++) {
      const i = r * g.cols + c;
      if (g.water[i] && g.cover[i]) drawCoverCell(ctx, COVER_CODES[g.cover[i]], c * cellPx, r * cellPx, cellPx, c, r, 3);
    }
  drawLanes(ctx, g, toPx, pxPerM);
  drawDocks(ctx, g, toPx, pxPerM);
  drawLand(ctx, g, toPx, w, h);
  return canvas;
}

/** High-detail square patch around `center` for the top-down lure/fight view. */
export function paintLocalCanvas(g: LakeGrid, center: Vec2, sizeM: number, pxPerM: number): HTMLCanvasElement {
  const px = sizeM * pxPerM;
  const canvas = makeCanvas(px, px);
  const ctx = canvas.getContext('2d')!;
  const ox = center.x - sizeM / 2;
  const oy = center.y - sizeM / 2;
  const toPx = (x: number, y: number): [number, number] => [(x - ox) * pxPerM, (y - oy) * pxPerM];
  const cellPx = g.cellM * pxPerM;
  const c0 = Math.max(0, Math.floor(ox / g.cellM) - 1);
  const r0 = Math.max(0, Math.floor(oy / g.cellM) - 1);
  const c1 = Math.min(g.cols, Math.ceil((ox + sizeM) / g.cellM) + 1);
  const r1 = Math.min(g.rows, Math.ceil((oy + sizeM) / g.cellM) + 1);

  paintDepth(ctx, g, ox, oy, pxPerM, canvas.width, canvas.height);
  drawContours(ctx, g, toPx, cellPx, c0, r0, c1, r1);
  for (let r = r0; r < r1; r++)
    for (let c = c0; c < c1; c++) {
      const i = r * g.cols + c;
      if (g.water[i] && g.cover[i]) {
        const [x, y] = toPx(c * g.cellM, r * g.cellM);
        drawCoverCell(ctx, COVER_CODES[g.cover[i]], x, y, cellPx, c, r, COVER_CODES[g.cover[i]] === 'standing' ? 10 : 40, pxPerM);
      }
    }
  drawLanes(ctx, g, toPx, pxPerM);
  drawDocks(ctx, g, toPx, pxPerM);
  drawLand(ctx, g, toPx, px, px);
  return canvas;
}
