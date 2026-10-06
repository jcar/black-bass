// Where would the harness player have finished? Places each day in a harness JSON against that
// seed's real AI field (day 1 of the event), for calibrating lake.field.medianBagLb.
//
//   node --import tsx tools/harness/placement.ts docs/model-reports/gate-champlain-advisor.json [lure,...]
import { readFileSync } from 'node:fs';
import { rivalBagAt } from '../../src/sim/field';
import { createTournament } from '../../src/sim/tournament';
import { TUNING } from '../../src/data/tuning';
import type { DayMetrics } from './player';
import type { RodSetup, Tier } from '../../src/sim/types';

const run = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { lakeId: string; tier: Tier; rigs: RodSetup[]; rows: { profile: string; rig: string; m: DayMetrics }[] };
const only = process.argv[3]?.split(',');
const fieldCache = new Map<number, number[]>();
const field = (seed: number) => {
  if (!fieldCache.has(seed)) {
    const t = createTournament({ lakeId: run.lakeId, tier: run.tier, seed, deck: [run.rigs[0]] });
    fieldCache.set(seed, t.rivals.map((r) => rivalBagAt(r, TUNING.clock.dayEndMin)));
  }
  return fieldCache.get(seed)!;
};
const groups = new Map<string, number[]>();
let size = 0;
for (const row of run.rows) {
  if (only && !only.includes(row.rig)) continue;
  const f = field(row.m.seed);
  size = f.length + 1;
  const place = 1 + f.filter((b) => b > row.m.bag).length;
  const k = `${row.profile} ${row.rig}`;
  groups.set(k, [...(groups.get(k) ?? []), place]);
}
const all = [...fieldCache.values()].flat().sort((a, b) => a - b);
const q = (p: number) => all[Math.floor(p * (all.length - 1))];
console.log(`${run.lakeId} ${run.tier}: field of ${size}; field bag median ${q(0.5).toFixed(1)}, 3rd-place-ish (p${Math.round((1 - 3 / size) * 100)}) ${q(1 - 3 / size).toFixed(1)} lb`);
for (const [k, places] of groups) {
  const top3 = places.filter((p) => p <= 3).length / places.length;
  const top10 = places.filter((p) => p <= 10).length / places.length;
  const med = [...places].sort((a, b) => a - b)[places.length >> 1];
  console.log(`  ${k.padEnd(24)} median place ${String(med).padStart(3)}  top3 ${(top3 * 100).toFixed(0).padStart(3)}%  top10 ${(top10 * 100).toFixed(0).padStart(3)}%`);
}
