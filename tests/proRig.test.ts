// "Rig me up like the pro": the planner that turns the advisor's picks into a deck and a shopping list.
import { describe, expect, it } from 'vitest';
import { LAKES } from '../src/data/lakes';
import { LURES, lureKey } from '../src/data/lures';
import { RODS } from '../src/data/rods';
import { scoutLake, WINDOWS, type WindowId } from '../src/sim/advisor';
import { MAX_DECK } from '../src/state/career';
import { applyProRig, planProRig, type ProPick } from '../src/state/proRig';
import { newSave, type SaveData } from '../src/state/save';

const lake = LAKES.champlain;
const ALL: WindowId[] = WINDOWS.map((w) => w.id);

const pick = (lureId: string, score: number, windows: WindowId[] = ALL, colorId = LURES[lureId].colors[0]): ProPick => ({ lureId, colorId, score, windows, reasons: [`${lureId} reason`] });

function save(cash = 500, patch: Partial<SaveData> = {}): SaveData {
  const s = newSave();
  s.player.cash = cash;
  return Object.assign(s, patch);
}

describe('planProRig', () => {
  const season = scoutLake(lake).picks;

  it('rigs at most five rods with no bait twice', () => {
    const p = planProRig({ save: save(5000), lake, picks: [...season, ...season], reserveCash: 0 });
    expect(p.deck.length).toBe(MAX_DECK);
    expect(new Set(p.deck.map((d) => d.lureId)).size).toBe(p.deck.length);
    expect(new Set(p.deck.map((d) => d.id)).size).toBe(p.deck.length);
    expect(p.cost).toBe(p.buys.reduce((a, b) => a + b.price, 0));
    expect(p.cashAfter).toBe(5000 - p.cost);
  });

  it("puts every window's best bait on the deck before filling by score", () => {
    const picks = [
      pick('deepCrank', 20, ['morning', 'midday']),
      pick('carolinaRig', 19, ['morning']),
      pick('dropShot', 18, ['midday']),
      pick('tube', 17, ['midday']),
      pick('lipless', 16, ['morning']),
      pick('ned', 15, ['midday']),
      pick('walker', 9, ['dawn']),
      pick('jerkbait', 8, ['late']),
    ];
    const p = planProRig({ save: save(5000), lake, picks, reserveCash: 0 });
    const lures = p.deck.map((d) => d.lureId);
    expect(lures).toContain('walker');
    expect(lures).toContain('jerkbait');
    expect(lures).toContain('deepCrank');
    expect(lures.length).toBe(MAX_DECK);
    // The rest by score: the top three of the others, not ned.
    expect(lures).not.toContain('ned');
    expect(p.rigs.find((r) => r.setup.lureId === 'walker')!.bestFor).toEqual(['dawn']);
    expect(p.rigs.find((r) => r.setup.lureId === 'deepCrank')!.bestFor).toEqual(['morning', 'midday']);
    // Rod 1 is the top bait.
    expect(p.deck[0].lureId).toBe('deepCrank');
  });

  it("doesn't buy what you own and buys a shared rod once", () => {
    const picks = [pick('swimbait', 20), pick('frog', 19), pick('tube', 18, ALL, 'greenPumpkin'), pick('ned', 17, ALL, 'greenPumpkin')];
    const s = save(2000);
    const p = planProRig({ save: s, lake, picks, reserveCash: 0 });
    const rodBuys = p.buys.filter((b) => b.kind === 'rod');
    expect(rodBuys).toEqual([{ kind: 'rod', rodId: 'rod-h', price: RODS['rod-h'].price }]);
    expect(p.deck.filter((d) => d.rodId === 'rod-h').map((d) => d.lureId)).toEqual(['swimbait', 'frog']);
    // Tube and Ned in green pumpkin come with the starter kit; ML and M rods too.
    expect(p.buys.some((b) => b.lureId === 'tube' || b.lureId === 'ned')).toBe(false);
    expect(p.buys.some((b) => b.rodId && s.ownedRods.includes(b.rodId))).toBe(false);
    expect(p.cost).toBe(RODS['rod-h'].price + LURES.swimbait.price + LURES.frog.price);
  });

  it('keeps the reserve (the entry fee) back', () => {
    const picks = [pick('swimbait', 20), pick('deepCrank', 19), pick('carolinaRig', 18), pick('tube', 17, ALL, 'greenPumpkin')];
    const p = planProRig({ save: save(500), lake, picks, reserveCash: 300 });
    expect(p.cost).toBeLessThanOrEqual(200);
    expect(p.cashAfter).toBeGreaterThanOrEqual(300);
    expect(p.deck.map((d) => d.lureId)).not.toContain('swimbait');
    const none = planProRig({ save: save(500), lake, picks, reserveCash: 500 });
    expect(none.cost).toBe(0);
    expect(none.deck.map((d) => d.lureId)).toEqual(['tube']);
  });

  it("records the rigs it can't afford, and falls back to the next pick", () => {
    const picks = [pick('swimbait', 20), pick('frog', 19), pick('tube', 10, ALL, 'greenPumpkin'), pick('ned', 9, ALL, 'greenPumpkin')];
    const p = planProRig({ save: save(100), lake, picks, reserveCash: 0 });
    expect(p.skipped.map((x) => x.lureId)).toEqual(['swimbait', 'frog']);
    expect(p.skipped[0].reason).toBe(`Swimbait needs the H rod ($260) and the bait in Ghost Minnow ($${LURES.swimbait.price}); $100 left to spend`);
    expect(p.deck.map((d) => d.lureId)).toEqual(['tube', 'ned']);
    expect(p.cost).toBe(0);
  });

  it('is deterministic', () => {
    const a = planProRig({ save: save(800), lake, picks: season, reserveCash: 0 });
    const b = planProRig({ save: save(800), lake, picks: season, reserveCash: 0 });
    expect(a).toEqual(b);
  });

  it("says so when you're already rigged like the pro", () => {
    const s = save(800);
    const first = planProRig({ save: s, lake, picks: season, reserveCash: 0 });
    expect(first.unchanged).toBe(false);
    expect(applyProRig(s, first)).toBe(true);
    expect(s.player.cash).toBe(800 - first.cost);
    for (const b of first.buys) if (b.kind === 'lure') expect(s.ownedLures).toContain(lureKey(b.lureId!, b.colorId!));
    expect(s.deck).toEqual(first.deck);
    // Same rigs in another order still count as rigged.
    s.deck.reverse();
    const again = planProRig({ save: s, lake, picks: season, reserveCash: 0 });
    expect(again.unchanged).toBe(true);
    expect(again.buys).toEqual([]);
    expect(again.cost).toBe(0);
    expect(again.deck).toEqual(s.deck);
  });
});
