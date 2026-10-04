// Does the pro advice match how the game actually plays? For each seeded tournament day the advisor
// ranks every lure (best colour, suggested line, a fitting rod); then the bot fishes that same day
// once per lure with only that rig, and we compare the advisor's ranking with the bites it got.
//
//   npx tsx tools/advisor-check.ts [lake=champlain] [days=10] [tier=Amateur]
import { LAKES } from '../src/data/lakes';
import { LURES } from '../src/data/lures';
import { RODS } from '../src/data/rods';
import { rankLures, suggestedRod } from '../src/sim/advisor';
import { createTournament } from '../src/sim/tournament';
import type { Tier } from '../src/sim/types';
import { botDeck, runBotDay } from './simulate';

const lakeId = process.argv[2] ?? 'champlain';
const days = Number(process.argv[3] ?? 10);
const tier = (process.argv[4] ?? 'Amateur') as Tier;
const lake = LAKES[lakeId];

/** Spearman rank correlation. */
function spearman(a: number[], b: number[]): number {
  const rank = (v: number[]) => {
    const idx = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array(v.length);
    idx.forEach(([, i], k) => (r[i] = k));
    return r as number[];
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const d2 = ra.reduce((s, x, i) => s + (x - rb[i]) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}

const lureIds = Object.keys(LURES);
const pooled = new Map<string, { pred: number; bites: number }>();
const rhos: number[] = [];
let topBites = 0;
let avgBites = 0;
const t0 = Date.now();
for (let d = 0; d < days; d++) {
  const seed = 5000 + d * 7919;
  const c = createTournament({ lakeId, tier, seed, deck: botDeck(lakeId) }).conditions;
  const ranked = rankLures(lake, c);
  const pred: number[] = [];
  const bites: number[] = [];
  for (const id of lureIds) {
    const pick = ranked.find((p) => p.lureId === id)!;
    const rodId = suggestedRod(id, Object.keys(RODS)) ?? 'rod-m';
    const r = runBotDay(seed, lakeId, tier, 1, [{ id: 'only', rodId, line: pick.line, lureId: id, colorId: pick.colorId }]);
    pred.push(pick.score);
    bites.push(r.bites);
    const p = pooled.get(id) ?? { pred: 0, bites: 0 };
    p.pred += pick.score / days;
    p.bites += r.bites / days;
    pooled.set(id, p);
  }
  const rho = spearman(pred, bites);
  rhos.push(rho);
  topBites += bites[lureIds.indexOf(ranked[0].lureId)] / days;
  avgBites += bites.reduce((a, b) => a + b, 0) / bites.length / days;
  console.log(`day ${d + 1}: ${c.season} ${c.waterTempF.toFixed(0)}F ${c.weather.padEnd(8)} rho ${rho.toFixed(2)}  advisor #1 ${ranked[0].lureId.padEnd(11)} bites ${bites[lureIds.indexOf(ranked[0].lureId)]}  (day avg ${(bites.reduce((a, b) => a + b, 0) / bites.length).toFixed(1)})`);
}
const ids = [...pooled.keys()];
console.log(`\n${lakeId} (${tier}), ${days} days x ${lureIds.length} lures in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
for (const id of ids.sort((a, b) => pooled.get(b)!.pred - pooled.get(a)!.pred)) console.log(`  ${id.padEnd(12)} advisor ${pooled.get(id)!.pred.toFixed(3)}  bot bites/day ${pooled.get(id)!.bites.toFixed(2)}`);
console.log(`per-day rank correlation (mean) ${(rhos.reduce((a, b) => a + b, 0) / rhos.length).toFixed(2)}`);
console.log(`pooled rank correlation ${spearman(ids.map((i) => pooled.get(i)!.pred), ids.map((i) => pooled.get(i)!.bites)).toFixed(2)}`);
console.log(`advisor's #1 lure: ${topBites.toFixed(2)} bites/day vs ${avgBites.toFixed(2)} for the average lure`);
