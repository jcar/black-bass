// Human-proxy harness runner. Every rig fishes the same seeded days and the same spot itinerary
// (paired design), sharded across worker processes, reported with bootstrap 95% CIs.
//
//   npx tsx tools/harness/run.ts --lake champlain --tier Amateur --profile expert,average,naiveKeyboard \
//        --rigs lures --days 30 --jobs 10 --out docs/model-reports/baseline-champlain.json
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { LAKES } from '../../src/data/lakes';
import { COLORS, LURES } from '../../src/data/lures';
import { RODS, rodCasts, rodPowerOk } from '../../src/data/rods';
import { TUNING } from '../../src/data/tuning';
import { advisorRoute } from '../../src/sim/advisor';
import { coverAt, getLakeGrid, HARD_COVER } from '../../src/sim/lake';
import { createTournament } from '../../src/sim/tournament';
import type { RodSetup, Tier } from '../../src/sim/types';
import { playDay, PROFILES, type DayMetrics, type Spot } from './player';
import { bootstrapCI, mean } from './stats';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (!k.startsWith('--')) throw new Error(`unexpected argument "${k}" (expected --key value pairs)`);
  args.set(k.slice(2), process.argv[++i]);
}
const lakeId = args.get('lake') ?? 'champlain';
const tier = (args.get('tier') ?? 'Amateur') as Tier;
const profiles = (args.get('profile') ?? 'expert').split(',');
const days = Number(args.get('days') ?? 20);
// Bounded parallelism: one sim per core at most, and never more than 8.
const jobs = Math.max(1, Math.min(8, Number(args.get('jobs') ?? 6)));
const firstSeed = Number(args.get('seed0') ?? 20000);
const shard = args.has('shard') ? Number(args.get('shard')) : null;
/** Workers must never spawn workers: an argument mix-up here once fork-bombed the machine. */
const IS_WORKER = process.env.HARNESS_WORKER === '1';
if (IS_WORKER && shard === null) throw new Error('harness worker started without --shard; refusing to spawn more workers');
const of = Number(args.get('of') ?? 1);

/** A sensible rig for a lure, chosen by a rule a player would use (not by the advisor). */
export function plainRig(lakeId: string, lureId: string): RodSetup {
  const lake = LAKES[lakeId];
  const lure = LURES[lureId];
  const clear = lake.clarity.defaultSecchiFt >= TUNING.attraction.clearSecchiFt;
  const family = clear ? 'natural' : 'bright';
  const colorId = lure.colors.find((c) => COLORS[c].family === family) ?? lure.colors[0];
  // The lightest rod that casts it and has the power its description asks for.
  const rodId = Object.values(RODS).find((r) => rodCasts(r, lure) && rodPowerOk(r, lure))?.id ?? 'rod-m';
  const heavy = lake.cover.some((c) => c.type === 'standing');
  // Weedless cover baits go on heavy line (a frog on braid, as its description says).
  const line =
    lure.motion === 'surface'
      ? lure.weedless
        ? { type: 'braid' as const, testLb: 50 }
        : { type: 'mono' as const, testLb: 14 }
      : lure.weedless === 'full'
        ? { type: 'fluoro' as const, testLb: lure.weightOz >= 0.5 ? 20 : heavy ? 17 : 15 }
        : { type: 'fluoro' as const, testLb: heavy ? 15 : lure.weightOz <= 0.25 ? 8 : 12 };
  return { id: `rig-${lureId}`, rodId, line, lureId, colorId };
}

function rigSet(spec: string): RodSetup[] {
  if (spec === 'lures') return Object.keys(LURES).map((id) => plainRig(lakeId, id));
  return spec.split(',').map((id) => plainRig(lakeId, id));
}

// --set attraction.leakPerSec=1.2,attraction.gainPerSec=12 : tuning experiments (applied in workers).
for (const kv of (args.get('set') ?? '').split(',').filter(Boolean)) {
  const [path, v] = kv.split('=');
  const keys = path.split('.');
  let o = TUNING as unknown as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  if (!(keys[keys.length - 1] in o)) throw new Error(`unknown tuning key ${path}`);
  o[keys[keys.length - 1]] = Number(v);
}

const rigs = rigSet(args.get('rigs') ?? 'lures');
/** --plan advisor: fish the advisor's route for each rig and day instead of the default itinerary. */
const plan = args.get('plan') ?? 'itinerary';
if (plan !== 'itinerary' && plan !== 'advisor') throw new Error(`unknown --plan ${plan}`);

function planSpots(seed: number, rig: RodSetup): Spot[] | undefined {
  if (plan !== 'advisor') return undefined;
  const lake = LAKES[lakeId];
  const grid = getLakeGrid(lake);
  const c = createTournament({ lakeId, tier, seed, deck: [rig] }).conditions;
  return advisorRoute(lake, c, rig).map((p) => ({ x: p.spot.x, y: p.spot.y, hard: HARD_COVER.has(coverAt(grid, p.spot.x, p.spot.y)) }));
}
const seeds = Array.from({ length: days }, (_, i) => firstSeed + i * 7919);

interface Row {
  profile: string;
  rig: string;
  m: DayMetrics;
}

function work(index: number, count: number): Row[] {
  const rows: Row[] = [];
  let k = 0;
  for (const profile of profiles)
    for (const rig of rigs)
      for (const seed of seeds) {
        if (k++ % count !== index) continue;
        rows.push({ profile, rig: rig.lureId, m: playDay({ lakeId, tier, seed, deck: [rig], profile: PROFILES[profile], spots: planSpots(seed, rig) }) });
      }
  return rows;
}

async function main() {
  if (shard !== null) {
    process.stdout.write(JSON.stringify(work(shard, of)));
    return;
  }
  if (IS_WORKER) throw new Error('worker reached coordinator code');
  const t0 = Date.now();
  // A coordinator killed by a timeout must take its workers with it, or they run on as orphans.
  const children: ReturnType<typeof spawn>[] = [];
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const)
    process.on(sig, () => {
      for (const c of children) c.kill('SIGKILL');
      process.exit(130);
    });
  const outputs = await Promise.all(
    Array.from(
      { length: jobs },
      (_, i) =>
        new Promise<Row[]>((resolve, reject) => {
          // Rebuild worker args from the parsed map (never by filtering argv, which shifts pairs).
          const workerArgs = [...args.entries()].filter(([k]) => k !== 'out' && k !== 'shard' && k !== 'of').flatMap(([k, v]) => [`--${k}`, v]);
          const child = spawn(process.execPath, ['--import', 'tsx', 'tools/harness/run.ts', ...workerArgs, '--shard', String(i), '--of', String(jobs)], {
            stdio: ['ignore', 'pipe', 'inherit'],
            env: { ...process.env, HARNESS_WORKER: '1' },
          });
          children.push(child);
          let buf = '';
          child.stdout.on('data', (d) => (buf += d));
          child.on('close', (code) => (code === 0 ? resolve(JSON.parse(buf)) : reject(new Error(`shard ${i} exited ${code}`))));
        }),
    ),
  );
  const rows = outputs.flat();
  const report: Record<string, Record<string, ReturnType<typeof summarise>>> = {};
  for (const profile of profiles) {
    report[profile] = {};
    for (const rig of rigs) report[profile][rig.lureId] = summarise(rows.filter((r) => r.profile === profile && r.rig === rig.lureId).map((r) => r.m));
  }
  console.log(`${lakeId} (${tier}) · plan ${plan} · ${days} paired days · ${rigs.length} rigs · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  for (const profile of profiles) {
    console.log(`\n${profile}`);
    console.log('rig           bass/day  [95% CI]        other  casts  follow%  match  spooked  crash/day  bag   hooked  missed  s/cast  late%  zero%  dead/day');
    const sorted = [...rigs].sort((a, b) => report[profile][b.lureId].bass.mean - report[profile][a.lureId].bass.mean);
    for (const rig of sorted) {
      const r = report[profile][rig.lureId];
      console.log(
        `${rig.lureId.padEnd(13)} ${r.bass.mean.toFixed(2).padStart(6)}  [${r.bass.lo.toFixed(2)}, ${r.bass.hi.toFixed(2)}]`.padEnd(40) +
          `${r.other.toFixed(1).padStart(5)}  ${r.casts.toFixed(0).padStart(5)}  ${(r.followRate * 100).toFixed(0).padStart(6)}%  ${r.match.toFixed(2)}  ${(r.spooked * 100).toFixed(0).padStart(6)}%  ${r.crashes.toFixed(1).padStart(8)}  ${r.bag.toFixed(1).padStart(5)}  ${r.hooked.toFixed(1).padStart(6)}  ${r.missed.toFixed(1).padStart(6)}  ${r.secPerCast.toFixed(1).padStart(6)}  ${(r.late * 100).toFixed(0).padStart(4)}%  ${(r.zeroed * 100).toFixed(0).padStart(4)}%  ${r.dead.toFixed(2).padStart(8)}`,
      );
    }
  }
  const out = args.get('out');
  if (out) writeFileSync(out, JSON.stringify({ lakeId, tier, plan, days, firstSeed, profiles, rigs, report, rows }, null, 1));
}

function summarise(ms: DayMetrics[]) {
  const bass = ms.map((m) => m.bassStrikes);
  const [lo, hi] = bootstrapCI(bass);
  const casts = mean(ms.map((m) => m.casts));
  return {
    bass: { mean: mean(bass), lo, hi },
    perDay: bass,
    other: mean(ms.map((m) => m.otherStrikes)),
    casts,
    followRate: mean(ms.map((m) => (m.casts ? m.followCasts / m.casts : 0))),
    match: mean(ms.map((m) => m.avgMatch)),
    spooked: mean(ms.map((m) => m.spookedAtArrival)),
    crashes: mean(ms.map((m) => m.crashes)),
    /** On the scales, after the late and dead-fish penalties. */
    bag: mean(ms.map((m) => m.bag)),
    late: mean(ms.map((m) => ((m.lateMin ?? 0) > 0 ? 1 : 0))),
    zeroed: mean(ms.map((m) => (m.zeroed ? 1 : 0))),
    dead: mean(ms.map((m) => m.deadFish ?? 0)),
    landed: mean(ms.map((m) => m.bassLanded)),
    hooked: mean(ms.map((m) => m.bassHooked ?? 0)),
    missed: mean(ms.map((m) => m.missedSets ?? 0)),
    /** Real seconds the lure is in the water per cast (the advisor's retrieve time per cast). */
    secPerCast: mean(ms.map((m) => (m.casts ? m.presentSec / m.casts : 0))),
  };
}

if (process.argv[1]?.endsWith("run.ts")) void main();
