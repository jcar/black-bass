import { LAKE_LADDER, PURSE, payoutFor } from '../data/lakes';
import { COLORS, LURES, lureKey } from '../data/lures';
import { RODS } from '../data/rods';
import { playerTotal, standings } from '../sim/tournament';
import type { Rank, Tier, TournamentState } from '../sim/types';
import type { SaveData, TournamentResult } from './save';

export const RANK_FOR_TIER: Record<Tier, Rank> = { Amateur: 'CoAngler', SemiPro: 'SemiPro', Pro: 'Pro', Elite: 'Elite' };
export const RANK_LABEL: Record<Rank, string> = { CoAngler: 'Co-Angler', SemiPro: 'Semi-Pro', Pro: 'Pro', Elite: 'Elite Pro' };
const RANK_ORDER: Rank[] = ['CoAngler', 'SemiPro', 'Pro', 'Elite'];
/** Finish in the top 3 to earn promotion to the next lake/tier. */
export const PROMOTE_TOP = 3;

/** What finishing well here unlocks: the next stop on the ladder, if it isn't open yet. */
export function promotionTarget(lakeId: string, unlocked: string[]): { name: string; id: string; place: number } | null {
  const idx = LAKE_LADDER.findIndex((l) => l.id === lakeId);
  const next = LAKE_LADDER[idx + 1];
  return next && !unlocked.includes(next.id) ? { name: next.name, id: next.id, place: PROMOTE_TOP } : null;
}

/** The career's next goal: the first locked stop and the event that opens it. */
export function nextCareerGoal(unlocked: string[]): { from: string; to: string; place: number } | null {
  const idx = LAKE_LADDER.findIndex((l) => !unlocked.includes(l.id));
  if (idx <= 0) return null;
  return { from: LAKE_LADDER[idx - 1].name, to: LAKE_LADDER[idx].name, place: PROMOTE_TOP };
}

export function tierOfLake(lakeId: string): Tier {
  return LAKE_LADDER.find((l) => l.id === lakeId)?.tier ?? 'Amateur';
}

/** Apply a finished tournament to the career: payout, points, history, bests, unlocks. */
export function applyResult(save: SaveData, t: TournamentState): { result: TournamentResult; promoted: string | null } {
  const st = standings(t, true);
  const place = st.findIndex((x) => x.isPlayer) + 1;
  const purse = PURSE[t.tier];
  const payout = payoutFor(t.tier, place);
  const points = purse.points[place - 1] ?? 10;
  const totalLb = playerTotal(t);
  const bigFishLb = t.stats.bigFishLb;
  const result: TournamentResult = {
    lakeId: t.lakeId,
    tier: t.tier,
    date: t.conditions.date,
    place,
    fieldSize: st.length,
    totalLb,
    bigFishLb,
    payout,
    points,
  };
  save.player.cash += payout;
  save.player.rankPoints += points;
  save.history = [result, ...save.history].slice(0, 50);
  save.personalBests.bestBagLb = Math.max(save.personalBests.bestBagLb, ...t.dayWeights);
  save.personalBests.bigFishLb = Math.max(save.personalBests.bigFishLb, bigFishLb);

  let promoted: string | null = null;
  if (place <= PROMOTE_TOP) {
    const idx = LAKE_LADDER.findIndex((l) => l.id === t.lakeId);
    const next = LAKE_LADDER[idx + 1];
    if (next && !save.unlockedLakes.includes(next.id)) {
      save.unlockedLakes.push(next.id);
      const nextRank = RANK_FOR_TIER[next.tier];
      if (RANK_ORDER.indexOf(nextRank) > RANK_ORDER.indexOf(save.player.rank)) save.player.rank = nextRank;
      promoted = next.name;
    }
  }
  return { result, promoted };
}

export function buyLure(save: SaveData, lureId: string, colorId: string): boolean {
  const key = lureKey(lureId, colorId);
  const lure = LURES[lureId];
  if (!lure || !COLORS[colorId] || save.ownedLures.includes(key) || save.player.cash < lure.price) return false;
  save.player.cash -= lure.price;
  save.ownedLures.push(key);
  return true;
}

export function buyRod(save: SaveData, rodId: string): boolean {
  const rod = RODS[rodId];
  if (!rod || save.ownedRods.includes(rodId) || save.player.cash < rod.price) return false;
  save.player.cash -= rod.price;
  save.ownedRods.push(rodId);
  return true;
}

export const MAX_DECK = 5;
