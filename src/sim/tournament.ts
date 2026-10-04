import { LAKES, TIER_FORMAT } from '../data/lakes';
import { TUNING } from '../data/tuning';
import { stepCast } from './cast';
import { generateConditions, nextDayConditions } from './conditions';
import { dist, emit, fishActivity, makeCtx, type SimCtx } from './context';
import { stepFight } from './fight';
import { createRivals, rivalBagAt, rollRivalDay, type Standing } from './field';
import { generatePopulation, updatePopulationSlice } from './fish/population';
import { getLakeGrid, isWater } from './lake';
import { bagWeight, resolveCull, suggestedCull } from './livewell';
import { transition } from './machine';
import { stepPresent } from './presentation';
import { Rng } from './rng';
import type { Conditions, InputFrame, RodSetup, Tier, TournamentState } from './types';

export interface NewTournamentOptions {
  lakeId: string;
  tier: Tier;
  seed: number;
  deck: RodSetup[];
  conditions?: Partial<Pick<Conditions, 'month' | 'weather'>>;
}

export function createTournament(o: NewTournamentOptions): TournamentState {
  const lake = LAKES[o.lakeId];
  const grid = getLakeGrid(lake);
  const rng = new Rng(o.seed);
  const fmt = TIER_FORMAT[o.tier];
  const conditions = generateConditions(lake, rng, o.conditions);
  const fish = generatePopulation(lake, grid, conditions, rng);
  const rivals = createRivals(rng, fmt.fieldSize - 1);
  for (const r of rivals) rollRivalDay(r, lake, o.tier, conditions, rng);

  return {
    version: 1,
    seed: o.seed,
    rngState: rng.state,
    lakeId: o.lakeId,
    tier: o.tier,
    day: 1,
    totalDays: fmt.days,
    cutAfterDay: fmt.cutAfterDay,
    clockMin: TUNING.clock.dayStartMin,
    conditions,
    phase: 'Navigate',
    boat: { pos: { x: lake.launch.x, y: lake.launch.y }, heading: lake.launch.heading, speed: 0, motor: 'trolling' },
    deck: o.deck.map((d) => ({ ...d, line: { ...d.line } })),
    activeRod: 0,
    livewell: [],
    pendingCull: null,
    lastLanded: null,
    dayWeights: [],
    fish,
    rivals,
    pressure: 0,
    cast: null,
    present: null,
    fight: null,
    events: [],
    stats: { casts: 0, bites: 0, lost: 0, bycatch: 0, bigFishLb: 0 },
    timeWarned: false,
    lastAimAngle: 0,
    popCursor: 0,
  };
}

function stepNavigate(s: TournamentState, ctx: SimCtx, input: InputFrame, dt: number) {
  const B = TUNING.boat;
  const boat = s.boat;
  const mag = Math.min(1, Math.hypot(input.stick.x, input.stick.y));
  let targetSpeed = 0;
  if (mag > 0.15) {
    const desired = Math.atan2(-input.stick.y, input.stick.x);
    let d = desired - boat.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const turn = B.turnRate * (boat.speed > 30 ? 0.6 : 1) * dt;
    boat.heading += Math.sign(d) * Math.min(Math.abs(d), turn);
    targetSpeed =
      mag <= B.trollingStickMax
        ? (mag / B.trollingStickMax) * B.trollingMaxSpeed
        : B.trollingMaxSpeed + ((mag - B.trollingStickMax) / (1 - B.trollingStickMax)) * (B.outboardMaxSpeed - B.trollingMaxSpeed);
    // Don't floor it while pointed the wrong way.
    targetSpeed *= Math.max(0.2, Math.cos(d));
  }
  boat.speed += Math.sign(targetSpeed - boat.speed) * Math.min(Math.abs(targetSpeed - boat.speed), (targetSpeed > boat.speed ? B.accel : B.decel) * dt);
  boat.motor = boat.speed > B.trollingMaxSpeed + 0.5 ? 'outboard' : 'trolling';

  const nx = boat.pos.x + Math.cos(boat.heading) * boat.speed * dt;
  const ny = boat.pos.y + Math.sin(boat.heading) * boat.speed * dt;
  const lookX = nx + Math.cos(boat.heading) * 6;
  const lookY = ny + Math.sin(boat.heading) * 6;
  if (isWater(ctx.grid, nx, ny) && isWater(ctx.grid, lookX, lookY)) boat.pos = { x: nx, y: ny };
  else boat.speed = 0;

  // Outboard noise displaces fish (TPWD telemetry); the trolling motor is far quieter.
  const radius = boat.motor === 'outboard' ? B.outboardSpookRadius : B.trollingSpookRadius;
  if (boat.speed > 0.5) {
    const pPerSec = boat.motor === 'outboard' ? B.outboardSpookChance * 1.5 : 0.3;
    const p = 1 - Math.pow(1 - Math.min(0.99, pPerSec), dt);
    for (const f of s.fish) {
      if (f.caught || f.spookUntil > s.clockMin) continue;
      if (dist(f.pos, boat.pos) < radius && ctx.rng.chance(p)) {
        f.spookUntil = s.clockMin + (boat.motor === 'outboard' ? ctx.rng.range(B.spookMinMin, B.spookMaxMin) : 5);
        f.interest = 0;
      }
    }
  }

  if (input.fishHere && boat.speed <= B.fishHereMaxSpeed) {
    boat.speed = 0;
    boat.motor = 'trolling';
    s.cast = null;
    transition(s, 'Cast');
  }
}

/**
 * Advance the tournament by one fixed step. Deterministic given (state, input sequence).
 * Mutates `s` in place for speed (the population is ~1,400 fish at 60 Hz).
 */
export function stepTournament(s: TournamentState, input: InputFrame, dt: number): void {
  if (s.phase === 'WeighIn') return;
  const ctx = makeCtx(s);

  if (s.phase !== 'Landed') s.clockMin += TUNING.clock.gameMinPerSec * dt;

  if (!s.timeWarned && s.clockMin >= TUNING.clock.warnAtMin) {
    s.timeWarned = true;
    emit(s, 'timeWarning', '30 minutes to weigh-in!');
  }

  s.popCursor = updatePopulationSlice(s.fish, ctx.grid, s.conditions, s.clockMin, s.popCursor, 24, (f) => fishActivity(s, f));

  switch (s.phase) {
    case 'Navigate':
      stepNavigate(s, ctx, input, dt);
      break;
    case 'Cast':
      stepCast(s, ctx, input, dt);
      if (s.cast) s.lastAimAngle = s.cast.aimAngle;
      break;
    case 'Present':
      stepPresent(s, ctx, input, dt);
      break;
    case 'Fight':
      stepFight(s, ctx, input, dt);
      break;
    case 'Landed':
      break;
  }

  if (s.clockMin >= TUNING.clock.dayEndMin) endDay(s);
  s.rngState = ctx.rng.state;
}

export function endDay(s: TournamentState): void {
  if (s.phase === 'WeighIn') return;
  if (s.pendingCull) resolveCull(s, suggestedCull(s));
  s.cast = null;
  s.present = null;
  s.fight = null;
  s.lastLanded = null;
  s.clockMin = TUNING.clock.dayEndMin;
  s.dayWeights.push(bagWeight(s.livewell));
  for (const r of s.rivals) r.dayWeights.push(r.cut ? 0 : rivalBagAt(r, TUNING.clock.dayEndMin));
  emit(s, 'dayOver', 'Time! Head to the weigh-in.');
  transition(s, 'WeighIn');
}

export const playerTotal = (s: TournamentState) => Math.round(s.dayWeights.reduce((a, b) => a + b, 0) * 100) / 100;

export function playerCut(s: TournamentState): boolean {
  if (!s.cutAfterDay || s.day < s.cutAfterDay) return false;
  const st = standings(s, true);
  const fmt = TIER_FORMAT[s.tier];
  return st.findIndex((x) => x.isPlayer) >= fmt.cutTo;
}

/** Live (during the day) or final standings, sorted by total weight. */
export function standings(s: TournamentState, final = s.phase === 'WeighIn'): Standing[] {
  const daysDone = final ? s.dayWeights.length : s.dayWeights.length;
  const playerToday = final ? (s.dayWeights[s.dayWeights.length - 1] ?? 0) : bagWeight(s.livewell);
  const playerPrev = s.dayWeights.slice(0, final ? daysDone - 1 : daysDone).reduce((a, b) => a + b, 0);
  const rows: Standing[] = s.rivals.map((r) => {
    const today = final ? (r.dayWeights[r.dayWeights.length - 1] ?? 0) : r.cut ? 0 : rivalBagAt(r, s.clockMin);
    const prev = r.dayWeights.slice(0, final ? r.dayWeights.length - 1 : r.dayWeights.length).reduce((a, b) => a + b, 0);
    return { id: r.id, name: r.name, total: Math.round((prev + today) * 100) / 100, today, isPlayer: false, cut: r.cut };
  });
  rows.push({ id: -1, name: 'You', total: Math.round((playerPrev + playerToday) * 100) / 100, today: playerToday, isPlayer: true, cut: false });
  rows.sort((a, b) => Number(a.cut) - Number(b.cut) || b.total - a.total);
  return rows;
}

export function isTournamentOver(s: TournamentState): boolean {
  return s.phase === 'WeighIn' && (s.day >= s.totalDays || playerCut(s));
}

/** Start the next day of a multi-day event. Applies the cut after the cut day. */
export function startNextDay(s: TournamentState): void {
  if (s.phase !== 'WeighIn' || isTournamentOver(s)) return;
  const ctx = makeCtx(s);
  const lake = LAKES[s.lakeId];
  if (s.cutAfterDay && s.day === s.cutAfterDay) {
    const st = standings(s, true);
    const keep = new Set(st.slice(0, TIER_FORMAT[s.tier].cutTo).map((x) => x.id));
    for (const r of s.rivals) if (!keep.has(r.id)) r.cut = true;
  }
  s.day++;
  s.clockMin = TUNING.clock.dayStartMin;
  s.livewell = [];
  s.timeWarned = false;
  s.conditions = nextDayConditions(lake, ctx.rng, s.conditions);
  s.pressure = Math.min(1, s.pressure + TUNING.multiDay.pressurePerDay);
  for (const f of s.fish) {
    f.spookUntil = 0;
    f.interest = 0;
  }
  for (const r of s.rivals) if (!r.cut) rollRivalDay(r, lake, s.tier, s.conditions, ctx.rng);
  s.boat = { pos: { x: lake.launch.x, y: lake.launch.y }, heading: lake.launch.heading, speed: 0, motor: 'trolling' };
  s.rngState = ctx.rng.state;
  transition(s, 'Navigate');
}

export function switchRod(s: TournamentState, index: number): boolean {
  // You can only change rods between casts.
  if (s.phase !== 'Navigate' && s.phase !== 'Cast') return false;
  if (s.cast?.flying) return false;
  if (index < 0 || index >= s.deck.length) return false;
  s.activeRod = index;
  return true;
}

/** Drain events emitted since the last call (audio, toasts, effects). */
export function drainEvents(s: TournamentState) {
  const ev = s.events;
  s.events = [];
  return ev;
}
