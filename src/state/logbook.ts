// The angler's logbook: every bass you land, with what it ate and where. The NES game kept a record
// of your biggest bass and the lure that caught it; this keeps the lot (the most recent LOG_CAP).
import { SPECIES } from '../data/species';
import type { CaughtFish, CoverType, Line, Season, SpeciesId, Tier, TournamentState, Weather } from '../sim/types';

export const LOG_CAP = 500;

export interface LogEntry {
  /** Unique per fish: tournament seed, day and fish id (a resumed day never logs a fish twice). */
  id: string;
  lakeId: string;
  tier: Tier;
  /** ISO date of the day fished and the event day number. */
  date: string;
  day: number;
  species: SpeciesId;
  weightLb: number;
  lengthIn: number;
  /** Counted toward the bag (a keeper, or a slot fish weighed and released). */
  keeper: boolean;
  lureId: string;
  colorId?: string;
  line?: Line;
  clockMin: number;
  weather: Weather;
  waterTempF: number;
  season: Season;
  depthFt?: number;
  bottomFt?: number;
  cover?: CoverType;
}

/** Keep the newest `cap` entries (the log is stored oldest first). */
export function capLog(log: LogEntry[], cap = LOG_CAP): LogEntry[] {
  return log.length > cap ? log.slice(log.length - cap) : log;
}

/** The ISO date of a tournament day (conditions hold day 1's date). */
function dayDate(t: TournamentState): string {
  const d = new Date(`${t.conditions.date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + t.day - 1);
  return d.toISOString().slice(0, 10);
}

/** A logbook line for a fish just landed, or null for anything that isn't a bass. */
export function logEntry(t: TournamentState, c: CaughtFish, keeper: boolean): LogEntry | null {
  if (!SPECIES[c.species]?.isBass) return null;
  const cond = t.conditions;
  return {
    id: `${t.seed}:${t.day}:${c.fishId}:${c.caughtAtMin.toFixed(1)}`,
    lakeId: t.lakeId,
    tier: t.tier,
    date: dayDate(t),
    day: t.day,
    species: c.species,
    weightLb: c.weightLb,
    lengthIn: c.lengthIn,
    keeper,
    lureId: c.lureId,
    colorId: c.colorId,
    line: c.line,
    clockMin: Math.round(c.caughtAtMin),
    weather: cond.weather,
    waterTempF: Math.round(cond.waterTempF),
    season: cond.season,
    depthFt: c.depthFt,
    bottomFt: c.bottomFt,
    cover: c.cover,
  };
}

/** Append (skipping a duplicate id) and cap. Returns a new array. */
export function appendLog(log: LogEntry[], e: LogEntry, cap = LOG_CAP): LogEntry[] {
  if (log.some((x) => x.id === e.id)) return log;
  return capLog([...log, e], cap);
}

export interface LureTally {
  lureId: string;
  count: number;
  totalLb: number;
  bestLb: number;
}

/** Lures ranked by bass caught (or by total weight), for a group of log entries. */
export function rankLogLures(entries: readonly LogEntry[], by: 'count' | 'weight' = 'count'): LureTally[] {
  const m = new Map<string, LureTally>();
  for (const e of entries) {
    const t = m.get(e.lureId) ?? { lureId: e.lureId, count: 0, totalLb: 0, bestLb: 0 };
    t.count++;
    t.totalLb += e.weightLb;
    t.bestLb = Math.max(t.bestLb, e.weightLb);
    m.set(e.lureId, t);
  }
  const key = (t: LureTally) => (by === 'count' ? t.count * 1e6 + t.totalLb : t.totalLb * 1e3 + t.count);
  return [...m.values()].sort((a, b) => key(b) - key(a));
}

/** Entries grouped by a key, in first-seen order of `order` when given. */
export function groupLog<K extends string>(entries: readonly LogEntry[], key: (e: LogEntry) => K, order?: readonly K[]): { key: K; entries: LogEntry[] }[] {
  const m = new Map<K, LogEntry[]>();
  for (const e of entries) {
    const k = key(e);
    m.set(k, [...(m.get(k) ?? []), e]);
  }
  const keys = [...m.keys()];
  if (order) keys.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return keys.map((k) => ({ key: k, entries: m.get(k)! }));
}

/** The heaviest bass in the log (the NES record: the fish and the lure that caught it). */
export function heaviest(entries: readonly LogEntry[]): LogEntry | null {
  let best: LogEntry | null = null;
  for (const e of entries) if (!best || e.weightLb > best.weightLb) best = e;
  return best;
}
