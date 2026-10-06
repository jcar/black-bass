// Acceptance gate for the pro advice, against human-proxy play (tools/harness).
//
// Run the harness twice on the same seeds, expert profile, every lure: once on the default
// itinerary (waypoints then visible cover, as a player finds them) and once on the advisor's route:
//
//   node --import tsx tools/harness/run.ts --lake champlain --profile expert --rigs lures --days 30 --jobs 8 \
//        --plan itinerary --out docs/model-reports/gate-champlain-itinerary.json
//   (same with --plan advisor --out docs/model-reports/gate-champlain-advisor.json)
//   node --import tsx tools/advisor-check.ts champlain
//
// Checks (95% bootstrap CIs over days; a check passes when its CI excludes zero in the right direction):
//   WHERE  the advisor's route beats the default itinerary for the advisor's top lure (paired).
//   WHAT   the advisor's top lure beats the median lure on its route (paired).
//   RANK   per-day Spearman between the advisor's lure scores and harness bites is positive.
//   CALIB  predicted vs harness bites per stop visit (Spearman over visits, and the ratio).
// If a check fails, fix the advisor, never the harness.
import { readFileSync } from 'node:fs';
import { LAKES } from '../src/data/lakes';
import { bitesPerVisitAt, rankLures, type Rig } from '../src/sim/advisor';
import { createTournament } from '../src/sim/tournament';
import type { RodSetup, Tier } from '../src/sim/types';
import type { DayMetrics } from './harness/player';
import { bootstrapCI, mean, pairedDiffCI, spearman } from './harness/stats';

interface Run {
  lakeId: string;
  tier: Tier;
  plan: string;
  rigs: RodSetup[];
  rows: { profile: string; rig: string; m: DayMetrics }[];
}

const lakeId = process.argv[2] ?? 'champlain';
const dir = process.argv[3] ?? 'docs/model-reports';
const load = (plan: string) => JSON.parse(readFileSync(`${dir}/gate-${lakeId}-${plan}.json`, 'utf8')) as Run;
const itin = load('itinerary');
const adv = load('advisor');
const lake = LAKES[lakeId];
const seeds = [...new Set(adv.rows.map((r) => r.m.seed))].sort((a, b) => a - b);
const lures = adv.rigs.map((r) => r.lureId);
const bites = (run: Run, seed: number, lure: string) => run.rows.find((r) => r.profile === 'expert' && r.m.seed === seed && r.rig === lure)!.m.bassStrikes;
const fmt = (ci: [number, number] | { lo: number; hi: number }) => (Array.isArray(ci) ? `[${ci[0].toFixed(2)}, ${ci[1].toFixed(2)}]` : `[${ci.lo.toFixed(2)}, ${ci.hi.toFixed(2)}]`);

let failed = 0;
const verdict = (name: string, ok: boolean, text: string) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(6)} ${text}`);
};

// The advisor's pre-day ranking for each day.
const picks = new Map<number, string[]>();
const scores = new Map<number, Map<string, number>>();
for (const seed of seeds) {
  const c = createTournament({ lakeId, tier: adv.tier, seed, deck: [adv.rigs[0]] }).conditions;
  // Score the exact rigs the harness fished (same colour and line), not the advisor's own choice.
  const ranked = lures.map((lure) => {
    const rig = adv.rigs.find((r) => r.lureId === lure)! as Rig;
    return { lure, score: rankLures(lake, c, [rig])[0].score };
  });
  ranked.sort((a, b) => b.score - a.score);
  picks.set(seed, ranked.map((r) => r.lure));
  scores.set(seed, new Map(ranked.map((r) => [r.lure, r.score])));
}

console.log(`${lakeId}: ${seeds.length} paired days, expert, ${lures.length} lures\n`);

// WHERE
{
  const a = seeds.map((s) => bites(adv, s, picks.get(s)![0]));
  const b = seeds.map((s) => bites(itin, s, picks.get(s)![0]));
  const all = lures.map((l) => mean(seeds.map((s) => bites(adv, s, l) - bites(itin, s, l))));
  const ci = pairedDiffCI(a, b);
  verdict('WHERE', ci.lo > 0, `advisor route ${mean(a).toFixed(2)} vs itinerary ${mean(b).toFixed(2)} bass/day, diff CI ${fmt(ci)}; every lure: +${Math.min(...all).toFixed(1)} to +${Math.max(...all).toFixed(1)}`);
}

// WHAT
{
  const top = seeds.map((s) => bites(adv, s, picks.get(s)![0]));
  const med = seeds.map((s) => {
    const v = lures.map((l) => bites(adv, s, l)).sort((x, y) => x - y);
    return (v[(v.length - 1) >> 1] + v[v.length >> 1]) / 2;
  });
  const ci = pairedDiffCI(top, med);
  const counts = new Map<string, number>();
  for (const s of seeds) counts.set(picks.get(s)![0], (counts.get(picks.get(s)![0]) ?? 0) + 1);
  verdict('WHAT', ci.lo > 0, `top pick ${mean(top).toFixed(2)} vs median lure ${mean(med).toFixed(2)} bass/day, diff CI ${fmt(ci)}; picks: ${[...counts].map(([l, n]) => `${l} ${n}`).join(', ')}`);
}

// RANK
{
  const rhos = seeds.map((s) => spearman(lures.map((l) => scores.get(s)!.get(l)!), lures.map((l) => bites(adv, s, l))));
  const ci = bootstrapCI(rhos);
  const pooledPred = lures.map((l) => mean(seeds.map((s) => scores.get(s)!.get(l)!)));
  const pooledReal = lures.map((l) => mean(seeds.map((s) => bites(adv, s, l))));
  verdict('RANK', ci[0] > 0, `per-day Spearman ${mean(rhos).toFixed(2)} ${fmt(ci)}; pooled over days ${spearman(pooledPred, pooledReal).toFixed(2)}`);
  console.log('        lure          advisor/day  harness/day');
  lures
    .map((l, i) => ({ l, p: pooledPred[i], r: pooledReal[i] }))
    .sort((x, y) => y.r - x.r)
    .forEach((x) => console.log(`        ${x.l.padEnd(13)} ${x.p.toFixed(1).padStart(10)}  ${x.r.toFixed(1).padStart(11)}`));
}

// CALIB: every stop the harness made, predicted with the casts it actually made there.
{
  const pred: number[] = [];
  const real: number[] = [];
  for (const run of [itin, adv])
    for (const row of run.rows) {
      if (row.profile !== 'expert') continue;
      const rig = run.rigs.find((r) => r.lureId === row.rig)! as Rig;
      const c = createTournament({ lakeId, tier: run.tier, seed: row.m.seed, deck: [run.rigs[0]] }).conditions;
      const p = row.m.visits.reduce((a, v) => a + bitesPerVisitAt(lake, c, v.clockMin, rig, v, v.casts), 0);
      pred.push(p);
      real.push(row.m.bassStrikes);
    }
  const rho = spearman(pred, real);
  const ratio = mean(real) / Math.max(1e-6, mean(pred));
  verdict('CALIB', rho > 0.3, `Spearman over ${pred.length} lure-days ${rho.toFixed(2)}; harness/predicted ${ratio.toFixed(2)} (1.0 = calibrated)`);
}

process.exitCode = failed ? 1 : 0;
