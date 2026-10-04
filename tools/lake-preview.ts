// Render a lake's simulation grid to a PNG for authoring review: depth shading, cover, boat lanes,
// stump fields, launch and waypoints, plus a list of any data that lands on dry ground.
//
//   npx tsx tools/lake-preview.ts lakefork [out.png] [pxPerCell=3]
import sharp from 'sharp';
import { LAKES } from '../src/data/lakes';
import { COVER_CODES, getLakeGrid, isWater } from '../src/sim/lake';

const COVER_RGB: Record<string, [number, number, number]> = {
  rock: [150, 146, 138],
  grass: [80, 150, 60],
  dock: [150, 110, 70],
  timber: [90, 70, 50],
  reeds: [180, 190, 100],
  standing: [118, 98, 80],
};

const id = process.argv[2] ?? 'champlain';
const out = process.argv[3] ?? `${id}-preview.png`;
const px = Number(process.argv[4] ?? 3);
const lake = LAKES[id];
if (!lake) throw new Error(`unknown lake ${id}`);
const g = getLakeGrid(lake);
const W = g.cols * px;
const H = g.rows * px;
const buf = Buffer.alloc(W * H * 3);
for (let r = 0; r < g.rows; r++)
  for (let c = 0; c < g.cols; c++) {
    const i = r * g.cols + c;
    let rgb: [number, number, number] = [61, 90, 58];
    if (g.water[i]) {
      const t = Math.min(1, Math.pow(g.depthFt[i] / 70, 0.6));
      rgb = [Math.round(130 - 120 * t), Math.round(200 - 160 * t), Math.round(200 - 125 * t)];
      const cov = COVER_CODES[g.cover[i]];
      if (cov !== 'none') {
        const k = cov === 'standing' ? 0.45 : 0.75;
        rgb = rgb.map((v, j) => Math.round(v * (1 - k) + COVER_RGB[cov][j] * k)) as [number, number, number];
      }
      if (g.lane[i]) rgb = [235, 235, 235];
      else if (g.stump[i] && (c + r) % 4 === 0) rgb = rgb.map((v) => Math.round(v * 0.6)) as [number, number, number];
    }
    for (let y = 0; y < px; y++)
      for (let x = 0; x < px; x++) {
        const o = ((r * px + y) * W + c * px + x) * 3;
        buf[o] = rgb[0];
        buf[o + 1] = rgb[1];
        buf[o + 2] = rgb[2];
      }
  }
const s = px / g.cellM;
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const dots = [
  ...lake.waypoints.map((w) => ({ x: w.x, y: w.y, label: w.name, color: '#ffd34d' })),
  { x: lake.launch.x, y: lake.launch.y, label: `LAUNCH: ${lake.launch.name}`, color: '#ff5d4d' },
];
const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
${lake.regions.map((r) => `<text x="${r.x * s}" y="${r.y * s}" font-size="${Math.max(12, px * 5)}" font-family="sans-serif" font-weight="700" fill="white" fill-opacity="0.55" text-anchor="middle">${esc(r.name)}</text>`).join('\n')}
${dots.map((d) => `<circle cx="${d.x * s}" cy="${d.y * s}" r="${px * 2}" fill="${d.color}" stroke="black"/><text x="${d.x * s + px * 3}" y="${d.y * s + 4}" font-size="${Math.max(10, px * 3.5)}" font-family="sans-serif" fill="${d.color}" stroke="black" stroke-width="0.4">${esc(d.label)}</text>`).join('\n')}
</svg>`;
await sharp(buf, { raw: { width: W, height: H, channels: 3 } })
  .composite([{ input: Buffer.from(svg) }])
  .png()
  .toFile(out);

const dry = dots.filter((d) => !isWater(g, d.x, d.y)).map((d) => d.label);
const lanesDry = (lake.lanes ?? []).flatMap((pl, i) => pl.filter(([x, y]) => !isWater(g, x, y)).map((p) => `lane ${i} at ${p}`));
let water = 0;
const cover: Record<string, number> = {};
for (let i = 0; i < g.water.length; i++)
  if (g.water[i]) {
    water++;
    const k = COVER_CODES[g.cover[i]];
    cover[k] = (cover[k] ?? 0) + 1;
  }
console.log(`${id}: ${g.cols}x${g.rows} cells, water ${water}, cover %`, Object.fromEntries(Object.entries(cover).map(([k, v]) => [k, Math.round((v / water) * 100)])));
console.log(dry.length || lanesDry.length ? `ON LAND: ${[...dry, ...lanesDry].join('; ')}` : 'all waypoints, launch and lane points are on water');
console.log(`wrote ${out}`);
