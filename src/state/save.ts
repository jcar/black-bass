import { LAKE_LADDER } from '../data/lakes';
import { lureKey, STARTER_LURES } from '../data/lures';
import { STARTER_RODS } from '../data/rods';
import type { Rank, RodSetup, Tier, TournamentState } from '../sim/types';
import { capLog, type LogEntry } from './logbook';

export const SAVE_VERSION = 2;
const KEY = 'blackbass.save';

export interface TournamentResult {
  lakeId: string;
  tier: Tier;
  date: string;
  place: number;
  fieldSize: number;
  totalLb: number;
  bigFishLb: number;
  payout: number;
  points: number;
}

export interface SaveData {
  version: number;
  player: { name: string; rank: Rank; cash: number; rankPoints: number };
  unlockedLakes: string[];
  /** "lureId:colorId" keys. */
  ownedLures: string[];
  ownedRods: string[];
  deck: RodSetup[];
  personalBests: { bigFishLb: number; bestBagLb: number };
  history: TournamentResult[];
  settings: {
    leftHanded: boolean;
    sound: boolean;
    debugMeter: boolean;
    seenWeighIn: boolean;
    coach: boolean;
    /** Angler's Eye: show the lure-action number (the top fish's interest) while working a lure. */
    anglersEye: boolean;
    /** Set the hook automatically when a fish has the bait (off: you set it, H / HOOK). */
    autoHookset: boolean;
  };
  /** Every bass landed, newest last (capped at LOG_CAP). */
  logbook: LogEntry[];
  activeTournament?: TournamentState;
}

export function defaultDeck(): RodSetup[] {
  return [
    { id: 'deck-1', rodId: 'rod-ml', line: { type: 'fluoro', testLb: 8 }, lureId: 'ned', colorId: 'greenPumpkin' },
    { id: 'deck-2', rodId: 'rod-m', line: { type: 'fluoro', testLb: 12 }, lureId: 'squarebill', colorId: 'sexyShad' },
    { id: 'deck-3', rodId: 'rod-mh', line: { type: 'mono', testLb: 14 }, lureId: 'walker', colorId: 'bone' },
  ];
}

export function newSave(): SaveData {
  return {
    version: SAVE_VERSION,
    player: { name: 'Angler', rank: 'CoAngler', cash: 500, rankPoints: 0 },
    unlockedLakes: [LAKE_LADDER[0].id],
    ownedLures: STARTER_LURES.map((l) => lureKey(l.lureId, l.colorId)),
    ownedRods: [...STARTER_RODS],
    deck: defaultDeck(),
    personalBests: { bigFishLb: 0, bestBagLb: 0 },
    history: [],
    settings: { leftHanded: false, sound: true, debugMeter: false, seenWeighIn: false, coach: true, anglersEye: false, autoHookset: false },
    logbook: [],
  };
}

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;
/** Migrations keyed by the version they upgrade FROM. Add one per schema change. */
const MIGRATIONS: Record<number, Migration> = {
  // v2: the logbook, and the Angler's Eye setting (off).
  1: (d) => ({ ...d, logbook: [], settings: { ...(d.settings as object), anglersEye: false } }),
};

export function migrate(raw: unknown): SaveData {
  if (!raw || typeof raw !== 'object') return newSave();
  let data = raw as Record<string, unknown>;
  let v = typeof data.version === 'number' ? data.version : 0;
  while (v < SAVE_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) return newSave();
    data = m(data);
    v++;
    data.version = v;
  }
  // Fill any fields added since (defensive merge with defaults).
  const base = newSave();
  const merged = { ...base, ...(data as unknown as SaveData) };
  merged.player = { ...base.player, ...merged.player };
  merged.settings = { ...base.settings, ...merged.settings };
  merged.personalBests = { ...base.personalBests, ...merged.personalBests };
  merged.logbook = capLog(Array.isArray(merged.logbook) ? merged.logbook : []);
  // Lake Fork was inserted as career stop 2 ahead of Guntersville. A promotion earned at Champlain
  // before that unlocked 'guntersville' (then stop 2, not yet playable): it now opens Lake Fork.
  if (merged.unlockedLakes.includes('guntersville') && !merged.unlockedLakes.includes('lakefork'))
    merged.unlockedLakes = merged.unlockedLakes.map((id) => (id === 'guntersville' ? 'lakefork' : id));
  return merged;
}

/** localStorage can throw (private mode, quota, disabled): never let that crash the game. */
export function loadSave(): SaveData {
  try {
    const text = localStorage.getItem(KEY);
    return text ? migrate(JSON.parse(text)) : newSave();
  } catch {
    return newSave();
  }
}

export function writeSave(save: SaveData): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
