// "Rig me up like the pro": turn the advisor's picks into a deck and a shopping list in one step.
// Pure and deterministic: the UI previews the plan, then applies it with buyLure/buyRod so the
// shop's rules stay in career.ts. The player can change anything afterwards in the rod locker.
import type { LakeDef } from '../data/lakes/types';
import { COLORS, LURES, lureKey } from '../data/lures';
import { RODS, rodCasts, rodPowerOk } from '../data/rods';
import { suggestedLine, suggestedRod, WINDOWS, type LurePick, type WindowId } from '../sim/advisor';
import type { RodSetup } from '../sim/types';
import { buyLure, buyRod, MAX_DECK } from './career';
import type { SaveData } from './save';

/** What the planner needs from a pick (scoutLake's season picks or rankLures' picks for a day). */
export type ProPick = Pick<LurePick, 'lureId' | 'colorId' | 'score' | 'windows' | 'reasons'>;

export interface ProBuy {
  kind: 'lure' | 'rod';
  lureId?: string;
  colorId?: string;
  rodId?: string;
  price: number;
}

export interface ProRig {
  setup: RodSetup;
  /** 1-based place in the pro's ranking. */
  rank: number;
  /** Windows the bait is strong in, and the ones it was picked as the best bait for. */
  windows: WindowId[];
  bestFor: WindowId[];
  reasons: string[];
  /** This rig needs the lure (and maybe the rod) bought. */
  buysLure: boolean;
  buysRod: boolean;
}

export interface ProRigPlan {
  deck: RodSetup[];
  rigs: ProRig[];
  buys: ProBuy[];
  cost: number;
  cashAfter: number;
  /** Rigs the pro would tie on with unlimited cash that didn't fit the budget. */
  skipped: { lureId: string; reason: string }[];
  /** Everything is owned and the deck already holds these rigs: applying changes nothing. */
  unchanged: boolean;
}

export interface ProRigInput {
  save: Pick<SaveData, 'player' | 'ownedLures' | 'ownedRods' | 'deck'>;
  lake: LakeDef;
  picks: ProPick[];
  /** Cash to keep back (the entry fee when planning before entering an event). */
  reserveCash: number;
}

const usd = (n: number) => `$${n.toLocaleString('en-US')}`;

/** Cheapest rod that casts the lure and has the power it asks for (ties: the lighter rod). */
function cheapestRodFor(lureId: string): string | null {
  const lure = LURES[lureId];
  const fits = Object.values(RODS).filter((r) => rodCasts(r, lure) && rodPowerOk(r, lure));
  fits.sort((a, b) => a.price - b.price);
  return fits[0]?.id ?? null;
}

const sameRig = (a: RodSetup, b: RodSetup) => a.rodId === b.rodId && a.lureId === b.lureId && a.colorId === b.colorId && a.line.type === b.line.type && a.line.testLb === b.line.testLb;

/**
 * The order the pro fills the deck: for each tournament window its best bait (the top-scoring pick
 * strong in that window), then the rest by score. `fits` decides whether a pick can be had; a window
 * whose best bait doesn't fit falls to its next best. Returns the chosen picks in that order.
 */
function choose(picks: ProPick[], fits: (p: ProPick) => boolean): { chosen: ProPick[]; bestFor: Map<string, WindowId[]> } {
  const chosen: ProPick[] = [];
  const rejected = new Set<string>();
  const bestFor = new Map<string, WindowId[]>();
  const tryAdd = (p: ProPick) => {
    if (chosen.includes(p)) return true;
    if (rejected.has(p.lureId) || chosen.length >= MAX_DECK) return false;
    if (!fits(p)) {
      rejected.add(p.lureId);
      return false;
    }
    chosen.push(p);
    return true;
  };
  for (const w of WINDOWS) {
    for (const p of picks.filter((x) => x.windows.includes(w.id))) {
      if (tryAdd(p)) {
        bestFor.set(p.lureId, [...(bestFor.get(p.lureId) ?? []), w.id]);
        break;
      }
    }
  }
  for (const p of picks) {
    if (chosen.length >= MAX_DECK) break;
    tryAdd(p);
  }
  return { chosen, bestFor };
}

export function planProRig({ save, lake, picks: rawPicks, reserveCash }: ProRigInput): ProRigPlan {
  // Best first; ties keep the advisor's order. One rig per bait.
  const seen = new Set<string>();
  const picks = rawPicks
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p.score - a.p.score || a.i - b.i)
    .map((x) => x.p)
    .filter((p) => LURES[p.lureId] && COLORS[p.colorId] && !seen.has(p.lureId) && (seen.add(p.lureId), true));
  const rank = new Map(picks.map((p, i) => [p.lureId, i + 1]));

  const cash = save.player.cash;
  const budget = cash - Math.max(0, reserveCash);
  const lures = new Set(save.ownedLures);
  const rods = [...save.ownedRods];
  let spent = 0;
  const buys: ProBuy[] = [];
  const rigOf = new Map<string, { rodId: string; buysLure: boolean; buysRod: boolean }>();
  const shortOf = new Map<string, string>();

  // What a pick costs on top of what's owned (or planned to be bought already).
  const needs = (p: ProPick) => {
    const lure = LURES[p.lureId];
    const lurePrice = lures.has(lureKey(p.lureId, p.colorId)) ? 0 : lure.price;
    const owned = suggestedRod(p.lureId, rods);
    const rodId = owned ?? cheapestRodFor(p.lureId);
    const rodPrice = owned || !rodId ? 0 : RODS[rodId].price;
    return { rodId, lurePrice, rodPrice };
  };

  // The rigs the pro would tie on with cash to burn: the ones worth explaining when they're skipped.
  const ideal = new Set(choose(picks, (p) => needs(p).rodId !== null).chosen.map((p) => p.lureId));

  const { chosen, bestFor } = choose(picks, (p) => {
    const lure = LURES[p.lureId];
    const n = needs(p);
    if (!n.rodId) {
      shortOf.set(p.lureId, `${lure.name}: no rod in the shop casts it`);
      return false;
    }
    const price = n.lurePrice + n.rodPrice;
    if (price > 0 && spent + price > budget) {
      const parts = [n.rodPrice && `the ${RODS[n.rodId].power} rod (${usd(n.rodPrice)})`, n.lurePrice && `the bait in ${COLORS[p.colorId].name} (${usd(n.lurePrice)})`].filter(Boolean);
      const left = Math.max(0, budget - spent);
      shortOf.set(p.lureId, `${lure.name} needs ${parts.join(' and ')}; ${usd(left)} left to spend`);
      return false;
    }
    spent += price;
    if (n.rodPrice) {
      rods.push(n.rodId);
      buys.push({ kind: 'rod', rodId: n.rodId, price: n.rodPrice });
    }
    if (n.lurePrice) {
      lures.add(lureKey(p.lureId, p.colorId));
      buys.push({ kind: 'lure', lureId: p.lureId, colorId: p.colorId, price: n.lurePrice });
    }
    rigOf.set(p.lureId, { rodId: n.rodId, buysLure: n.lurePrice > 0, buysRod: n.rodPrice > 0 });
    return true;
  });

  // Rod 1 is the pro's top bait. Keep the ids of rigs already on the deck so nothing else moves.
  const ordered = [...chosen].sort((a, b) => rank.get(a.lureId)! - rank.get(b.lureId)!);
  const usedIds = new Set<string>();
  const freshId = (lureId: string) => {
    let id = `pro-${lureId}`;
    for (let n = 2; usedIds.has(id) || save.deck.some((d) => d.id === id); n++) id = `pro-${lureId}-${n}`;
    return id;
  };
  const rigs: ProRig[] = ordered.map((p) => {
    const r = rigOf.get(p.lureId)!;
    const setup: Omit<RodSetup, 'id'> = { rodId: r.rodId, line: suggestedLine(lake, p.lureId), lureId: p.lureId, colorId: p.colorId };
    const prev = save.deck.find((d) => !usedIds.has(d.id) && d.lureId === p.lureId);
    const id = prev?.id ?? freshId(p.lureId);
    usedIds.add(id);
    return { setup: { id, ...setup }, rank: rank.get(p.lureId)!, windows: [...p.windows], bestFor: bestFor.get(p.lureId) ?? [], reasons: [...p.reasons], buysLure: r.buysLure, buysRod: r.buysRod };
  });

  const skipped = picks.filter((p) => ideal.has(p.lureId) && !rigOf.has(p.lureId) && shortOf.has(p.lureId)).map((p) => ({ lureId: p.lureId, reason: shortOf.get(p.lureId)! }));
  const planned = rigs.map((r) => r.setup);
  // Same rigs already on the deck (in any order) and nothing to buy: nothing to do.
  const sameSet = planned.length === save.deck.length && planned.every((d) => save.deck.some((x) => sameRig(x, d)));
  const unchanged = buys.length === 0 && (sameSet || planned.length === 0);
  return {
    deck: unchanged ? save.deck.map((d) => ({ ...d, line: { ...d.line } })) : planned,
    rigs,
    buys,
    cost: spent,
    cashAfter: cash - spent,
    skipped,
    unchanged,
  };
}

/** Buy what the plan lists (through the shop's own rules) and put its rigs on the deck. */
export function applyProRig(save: SaveData, plan: ProRigPlan): boolean {
  if (plan.unchanged) return true;
  for (const b of plan.buys) {
    const ok = b.kind === 'rod' ? buyRod(save, b.rodId!) : buyLure(save, b.lureId!, b.colorId!);
    if (!ok) return false;
  }
  save.deck = plan.deck.map((d) => ({ ...d, line: { ...d.line } }));
  return true;
}
