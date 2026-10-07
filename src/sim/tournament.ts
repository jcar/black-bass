import { LAKES, PURSE, TIER_FORMAT } from '../data/lakes';
import { SPECIES } from '../data/species';
import { TUNING } from '../data/tuning';
import { stepCast } from './cast';
import { generateConditions, nextDayConditions } from './conditions';
import { dist, emit, fishActivity, makeCtx, type SimCtx } from './context';
import { stepFight } from './fight';
import { createRivals, notableWeight, rivalBagAt, rollRivalDay, type Standing } from './field';
import { generatePopulation, updatePopulationSlice } from './fish/population';
import { getLakeGrid, isWater, stumpHazardAt } from './lake';
import { bagWeight, resolveCull, suggestedCull } from './livewell';
import { transition } from './machine';
import { stepPresent } from './presentation';
import { Rng } from './rng';
import type { BroadcastState, Conditions, InputFrame, RodSetup, Tier, TournamentState } from './types';

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
    broadcast: { notableLb: notableWeight(rivals), lastReportMin: -Infinity, leaderId: null, lastPlace: fmt.fieldSize },
  };
}

// ---------- Live broadcast feed ----------
// Rival catches are pre-rolled, so the feed just reports them as the clock passes: notable fish,
// lead changes, and the player crossing the lines that matter (money, cut, podium). Deterministic.
const FEED = {
  /** Game minutes between routine catch reports (~20 real seconds). */
  reportGapMin: 12,
  /** Leader changes before this are noise (everyone has one fish). */
  leaderAfterMin: TUNING.clock.dayStartMin + 60,
};

function broadcastFor(s: TournamentState): BroadcastState {
  if (!s.broadcast) {
    // Tournament saved before the feed existed: start the cursors at "now" so nothing replays.
    for (const r of s.rivals) r.feedCursor = r.catches.filter((c) => c.atMin <= s.clockMin).length;
    s.broadcast = { notableLb: notableWeight(s.rivals), lastReportMin: s.clockMin, leaderId: null, lastPlace: s.rivals.length + 1 };
  }
  return s.broadcast;
}

const lbText = (lb: number) => `${lb.toFixed(2)} lb`;

function stepBroadcast(s: TournamentState, bagChanged: boolean): void {
  const b = broadcastFor(s);
  let newest: { name: string; weightLb: number; species?: TournamentState['rivals'][number]['catches'][number]['species'] } | null = null;
  let changed = bagChanged;
  for (const r of s.rivals) {
    if (r.cut) continue;
    let i = r.feedCursor ?? 0;
    while (i < r.catches.length && r.catches[i].atMin <= s.clockMin) {
      const c = r.catches[i];
      if (c.weightLb >= b.notableLb && (!newest || c.weightLb > newest.weightLb)) newest = { name: r.name, weightLb: c.weightLb, species: c.species };
      changed = true;
      i++;
    }
    r.feedCursor = i;
  }
  if (!changed) return;

  const st = standings(s, false);
  if (newest) {
    const big = newest.weightLb >= b.notableLb * 1.5;
    if (big || s.clockMin - b.lastReportMin >= FEED.reportGapMin) {
      b.lastReportMin = s.clockMin;
      const sp = newest.species ? SPECIES[newest.species].name.toLowerCase() : 'bass';
      const place = st.findIndex((x) => x.name === newest!.name) + 1;
      emit(s, 'rivalCatch', `${newest.name} boats a ${lbText(newest.weightLb)} ${sp}`, undefined, { name: newest.name, weightLb: newest.weightLb, species: newest.species, place, big });
    }
  }

  const leader = st[0];
  if (leader && leader.total > 0 && leader.id !== b.leaderId) {
    if (s.clockMin >= FEED.leaderAfterMin && b.leaderId !== null)
      emit(s, 'leaderChange', leader.isPlayer ? 'You take the lead!' : `${leader.name} takes the lead with ${lbText(leader.total)}`, undefined, {
        name: leader.isPlayer ? 'You' : leader.name,
        weightLb: leader.total,
        place: 1,
      });
    b.leaderId = leader.id;
  }

  const place = st.findIndex((x) => x.isPlayer) + 1;
  if (place !== b.lastPlace) {
    const money = PURSE[s.tier].payouts.length;
    const cutTo = s.cutAfterDay === s.day ? TIER_FORMAT[s.tier].cutTo : null;
    const crossed = (line: number) => (b.lastPlace > line) !== (place > line);
    const up = place < b.lastPlace;
    let text: string | null = null;
    if (crossed(3) && up) text = `You move onto the podium: #${place}`;
    else if (cutTo && crossed(cutTo)) text = up ? `Inside the cut line: #${place}` : `Below the cut line: #${place}`;
    else if (st.length > money && crossed(money)) text = up ? `Into the money: #${place}` : `Out of the money: #${place}`;
    if (text) emit(s, 'playerPlace', text, undefined, { place });
    b.lastPlace = place;
  }
}

function stepNavigate(s: TournamentState, ctx: SimCtx, input: InputFrame, dt: number) {
  const B = TUNING.boat;
  const boat = s.boat;
  const mag = Math.min(1, Math.hypot(input.stick.x, input.stick.y));
  let targetSpeed = 0;
  /** Which way the stick wants to turn (+1 starboard): the side the boat glances off a bank. */
  let side = 1;
  if (mag > 0.15) {
    const desired = Math.atan2(-input.stick.y, input.stick.x);
    let d = desired - boat.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    side = d < 0 ? -1 : 1;
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

  /** Where a move of `step` m along `a` ends, if that water and the 6 m ahead of it are clear. */
  const clear = (a: number, step: number) => {
    const x = boat.pos.x + Math.cos(a) * step;
    const y = boat.pos.y + Math.sin(a) * step;
    return isWater(ctx.grid, x, y) && isWater(ctx.grid, x + Math.cos(a) * B.bankLookM, y + Math.sin(a) * B.bankLookM) ? { x, y } : null;
  };
  const ahead = clear(boat.heading, boat.speed * dt);
  if (ahead) {
    boat.pos = ahead;
    boat.onBank = false;
  } else if (!boat.onBank && boat.speed >= B.bankBumpSpeed) {
    // Ran into the bank: a hit stops you dead and reports one bump (sound, shake, callout).
    const a = boat.heading;
    emit(s, 'bank', 'Ran into the bank', { x: boat.pos.x + Math.cos(a) * B.bankLookM, y: boat.pos.y + Math.sin(a) * B.bankLookM });
    boat.speed = 0;
    boat.onBank = true;
  } else {
    // Against the bank: scrape along it at trolling speed, glancing off toward the way the stick turns,
    // so an oblique bank or a point never wedges the boat. Steering away (heading still turns) backs off.
    boat.onBank = true;
    boat.speed = Math.min(boat.speed, B.trollingMaxSpeed);
    let moved = false;
    for (const da of [B.bankGlance, -B.bankGlance, 2 * B.bankGlance, -2 * B.bankGlance, Math.PI / 2, -Math.PI / 2]) {
      const p = clear(boat.heading + da * side, boat.speed * Math.max(B.bankScrapeMin, Math.cos(da)) * dt);
      if (p) {
        boat.pos = p;
        moved = true;
        break;
      }
    }
    if (!moved) boat.speed = 0;
  }

  // Stumps just under the surface: running on plane outside the buoyed lanes is a gamble.
  if (boat.speed > B.stumpSpeed && stumpHazardAt(ctx.grid, boat.pos.x, boat.pos.y) && ctx.rng.chance(B.stumpChancePerSec * dt)) {
    boat.speed = 0;
    s.clockMin += TUNING.clock.stumpMin;
    emit(s, 'stump', `Hit a stump! Lost ${TUNING.clock.stumpMin} minutes checking the lower unit.`, { ...boat.pos });
  }

  // Outboard noise displaces fish (TPWD telemetry); the trolling motor is far quieter.
  const radius = boat.motor === 'outboard' ? B.outboardSpookRadius : B.trollingSpookRadius;
  if (boat.speed > 0.5) {
    const pPerSec = boat.motor === 'outboard' ? B.outboardSpookPerSec : B.trollingSpookPerSec;
    const p = 1 - Math.pow(1 - Math.min(0.99, pPerSec), dt);
    for (const f of s.fish) {
      if (f.caught || f.spookUntil > s.clockMin) continue;
      if (dist(f.pos, boat.pos) < radius && ctx.rng.chance(p)) {
        f.spookUntil = s.clockMin + (boat.motor === 'outboard' ? ctx.rng.range(B.spookMinMin, B.spookMaxMin) : B.trollingSpookMin);
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
  const bagBefore = s.livewell.length + (s.pendingCull ? 1 : 0);

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

  stepBroadcast(s, s.livewell.length + (s.pendingCull ? 1 : 0) !== bagBefore);
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
  s.broadcast = { notableLb: notableWeight(s.rivals.filter((r) => !r.cut)), lastReportMin: -Infinity, leaderId: null, lastPlace: standings(s, false).findIndex((x) => x.isPlayer) + 1 };
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
