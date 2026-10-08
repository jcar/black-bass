// Tournament rules (Batch D2): Lake Fork's regulations, check-in (early, late, too late), livewell
// survival and the B.A.S.S. dead-fish penalty, and the harness heading in on time.
import { describe, expect, it } from 'vitest';
import { LAKES } from '../src/data/lakes';
import { TUNING } from '../src/data/tuning';
import { debrief, newCoach } from '../src/sim/coach';
import { getLakeGrid } from '../src/sim/lake';
import { catchVerdict, healthOf, heatFactor, inSlot, isBigFish, isDead, isKeeper, keeperMinIn, landFish, resolveCull, stepLivewell, suggestedCull } from '../src/sim/livewell';
import { atLaunch, etaHomeMin, headInDue, homeDistM, lateMinutes, leaveByMin } from '../src/sim/nav';
import { Rng } from '../src/sim/rng';
import { canCheckIn, checkInResult, createTournament, drainEvents, stepTournament } from '../src/sim/tournament';
import { emptyInput, type CaughtFish, type TournamentState } from '../src/sim/types';
import { botDeck } from '../tools/simulate';
import { playDay, PROFILES } from '../tools/harness/player';

const C = TUNING.clock;
const fork = (seed = 5) => createTournament({ lakeId: 'lakefork', tier: 'SemiPro', seed, deck: botDeck('lakefork') });
const champ = (seed = 5) => createTournament({ lakeId: 'champlain', tier: 'Amateur', seed, deck: botDeck() });
const lm = (lengthIn: number) => ({ species: 'largemouth' as const, lengthIn });
const kept = (weightLb: number, i: number, extra: Partial<CaughtFish> = {}): CaughtFish => ({ fishId: 5000 + i, species: 'largemouth', weightLb, lengthIn: 15, caughtAtMin: 400, lureId: 'ned', health: 1, hardy: 1, ...extra });

/** Land a largemouth of this length and weight (as the fight would). */
function land(s: TournamentState, lengthIn: number, weightLb: number, seed = 1) {
  const f = s.fish.find((x) => x.species === 'largemouth' && !x.caught)!;
  f.lengthIn = lengthIn;
  f.weightLb = weightLb;
  s.phase = 'Fight';
  landFish(s, f, new Rng(seed));
  const ev = drainEvents(s);
  return { caught: s.lastLanded!, text: ev.find((e) => e.type === 'landed' || e.type === 'cullNeeded')?.text ?? '' };
}

/** The farthest charted waypoint from the launch by water. */
function farPoint(lakeId: string) {
  const g = getLakeGrid(LAKES[lakeId]);
  return LAKES[lakeId].waypoints.reduce((a, b) => (homeDistM(g, b) > homeDistM(g, a) ? b : a));
}

describe('Lake Fork regulations (TPWD + tournament minimum)', () => {
  const lake = LAKES.lakefork;
  it('has a 14" tournament minimum, a 16-24" protected slot and one 24"+ a day', () => {
    expect(keeperMinIn(lake)).toBe(14);
    expect(catchVerdict(lm(13.75), lake)).toBe('short');
    expect(catchVerdict(lm(14), lake)).toBe('keeper');
    expect(catchVerdict(lm(16), lake)).toBe('slot');
    expect(catchVerdict(lm(23.75), lake)).toBe('slot');
    expect(catchVerdict(lm(24), lake)).toBe('keeper');
    expect(isBigFish(lm(24), lake)).toBe(true);
    expect(isBigFish(lm(23.75), lake)).toBe(false);
  });

  it('leaves Champlain on a 12" minimum with no slot', () => {
    expect(keeperMinIn(LAKES.champlain)).toBe(12);
    expect(inSlot(lm(18), LAKES.champlain)).toBe(false);
    expect(isKeeper(lm(18), LAKES.champlain)).toBe(true);
    expect(isBigFish(lm(26), LAKES.champlain)).toBe(false);
  });

  it('releases a slot fish immediately: never in the livewell, never weighed', () => {
    const s = fork();
    const { caught, text } = land(s, 19, 3.6);
    expect(caught.released).toBe('slot');
    expect(s.livewell).toHaveLength(0);
    expect(s.pendingCull).toBeNull();
    expect(text).toMatch(/slot/i);
    expect(text).toMatch(/Released immediately/);
  });

  it('keeps only one 24"+ bass a day: the heavier stays', () => {
    const s = fork();
    land(s, 25, 10.2);
    s.phase = 'Cast';
    land(s, 24.5, 9.1);
    expect(s.livewell.filter((f) => isBigFish(f, LAKES.lakefork))).toHaveLength(1);
    expect(s.livewell[0].weightLb).toBe(10.2);
    expect(s.lastLanded!.released).toBe('bigFish');
    s.phase = 'Cast';
    const { text } = land(s, 26, 12.4);
    expect(s.livewell.map((f) => f.weightLb)).toEqual([12.4]);
    expect(text).toMatch(/Only 1 bass 24" or longer/);
    // A dead big fish can't be swapped out.
    s.livewell[0].health = 0;
    s.phase = 'Cast';
    land(s, 27, 13.5);
    expect(s.livewell.map((f) => f.weightLb)).toEqual([12.4]);
    expect(s.lastLanded!.released).toBe('bigFish');
  });
});

describe('check-in', () => {
  it('lets you check in early at the launch once check-in opens, and only there', () => {
    const s = champ();
    s.clockMin = C.dayStartMin + 10;
    expect(canCheckIn(s)).toBe(false); // not open yet
    s.clockMin = C.dayStartMin + TUNING.checkIn.openAfterMin + 1;
    expect(canCheckIn(s)).toBe(true);
    s.livewell = [kept(2, 1), kept(3, 2)];
    stepTournament(s, { ...emptyInput(), checkIn: true }, 1 / 60);
    expect(s.phase).toBe('WeighIn');
    expect(s.checkIns![0]).toMatchObject({ lateMin: 0, zeroed: false, netLb: 5, grossLb: 5 });
    expect(s.dayWeights).toEqual([5]);
  });

  it("can't check in away from the launch", () => {
    const s = champ();
    s.clockMin = 12 * 60;
    const p = farPoint('champlain');
    s.boat.pos = { x: p.x, y: p.y };
    expect(canCheckIn(s)).toBe(false);
    stepTournament(s, { ...emptyInput(), checkIn: true }, 1 / 60);
    expect(s.phase).toBe('Navigate');
  });

  it('checks you in at check-in time if you are sitting at the launch', () => {
    const s = champ();
    s.clockMin = C.dayEndMin - 0.005;
    stepTournament(s, emptyInput(), 1 / 60);
    expect(s.phase).toBe('WeighIn');
    expect(s.checkIns![0].lateMin).toBe(0);
  });

  it('charges 1 lb a minute late (B.A.S.S.), and zeroes the day after 15 minutes', () => {
    expect(lateMinutes(C.dayEndMin)).toBe(0);
    expect(lateMinutes(C.dayEndMin + 0.5)).toBe(1);
    expect(lateMinutes(C.dayEndMin + 4.2)).toBe(5);
    const bag = [kept(4, 1), kept(4, 2), kept(4, 3), kept(4, 4), kept(4, 5)];
    expect(checkInResult(bag, C.dayEndMin + 3.5)).toMatchObject({ lateMin: 4, latePenaltyLb: 4, netLb: 16, zeroed: false });
    expect(checkInResult(bag, C.dayEndMin + 15)).toMatchObject({ lateMin: 15, netLb: 5, zeroed: false });
    expect(checkInResult(bag, C.dayEndMin + 15.5)).toMatchObject({ lateMin: 16, netLb: 0, zeroed: true });
    expect(checkInResult([kept(1.5, 1)], C.dayEndMin + 3)).toMatchObject({ netLb: 0 });
  });

  it('runs the day on past check-in time while you are out, then zeroes it', () => {
    const s = champ();
    const p = farPoint('champlain');
    s.boat.pos = { x: p.x, y: p.y };
    s.clockMin = C.dayEndMin - 1;
    s.livewell = [kept(3, 1)];
    const events: string[] = [];
    let n = 0;
    while (s.phase !== 'WeighIn' && n++ < 20000) {
      stepTournament(s, emptyInput(), 1 / 10);
      events.push(...drainEvents(s).map((e) => e.type));
    }
    expect(events).toContain('late');
    expect(s.clockMin).toBeGreaterThan(C.dayEndMin + TUNING.checkIn.lateMaxMin);
    expect(s.checkIns![0].zeroed).toBe(true);
    expect(s.dayWeights).toEqual([0]);
  });

  it('warns you to head in with the run back counted, earlier the farther out you are', () => {
    for (const lakeId of ['champlain', 'lakefork']) {
      const g = getLakeGrid(LAKES[lakeId]);
      const L = LAKES[lakeId].launch;
      const far = farPoint(lakeId);
      expect(etaHomeMin(g, L)).toBe(0);
      expect(atLaunch(g, L)).toBe(true);
      const eta = etaHomeMin(g, far);
      expect(eta).toBeGreaterThan(3);
      expect(eta).toBeLessThan(60);
      expect(headInDue(leaveByMin(eta) - 1, eta)).toBe(false);
      expect(headInDue(leaveByMin(eta), eta)).toBe(true);
      const s = createTournament({ lakeId, tier: 'Amateur', seed: 3, deck: botDeck(lakeId) });
      s.boat.pos = { x: far.x, y: far.y };
      s.clockMin = leaveByMin(eta) - 0.5;
      let warned: string | undefined;
      for (let i = 0; i < 120 && !warned; i++) {
        stepTournament(s, emptyInput(), 1 / 60);
        warned = drainEvents(s).find((e) => e.type === 'timeWarning')?.text;
      }
      expect(warned).toMatch(/Head in: \d+ min run/);
    }
  });

  it('rivals are sometimes late, and pay for it', () => {
    let late = 0;
    let rivals = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const s = champ(seed);
      for (const r of s.rivals) {
        rivals++;
        if (r.lateMin) late++;
      }
    }
    expect(late).toBeGreaterThan(0);
    expect(late / rivals).toBeLessThan(0.08);
  });
});

describe('livewell survival and the dead-fish penalty', () => {
  it('is lively in cool water all day, and kills a morning fish in hot water', () => {
    const cool = champ();
    cool.conditions.waterTempF = 70;
    cool.livewell = [kept(3, 1)];
    stepLivewell(cool, 540);
    expect(healthOf(cool.livewell[0])).toBe('lively');
    const hot = fork();
    hot.conditions.waterTempF = 88;
    hot.livewell = [kept(4, 1)];
    expect(heatFactor(88)).toBeGreaterThan(heatFactor(80));
    expect(heatFactor(70)).toBe(1);
    stepLivewell(hot, 360);
    expect(healthOf(hot.livewell[0])).toBe('sluggish');
    expect(stepLivewell(hot, 240)).toHaveLength(1);
    expect(isDead(hot.livewell[0])).toBe(true);
  });

  it('is deterministic: the same seed and play give the same livewell', () => {
    const run = () => {
      const s = fork(9);
      s.conditions.waterTempF = 84;
      land(s, 15, 1.9, 4);
      s.phase = 'Cast';
      land(s, 25, 9.5, 5);
      stepLivewell(s, 300);
      return s.livewell.map((f) => `${f.hardy}:${f.health!.toFixed(6)}`).join();
    };
    expect(run()).toBe(run());
  });

  it("charges 4 oz per dead fish at the scales, and dead fish can't be culled", () => {
    const bag = [kept(3, 1, { health: 0 }), kept(2, 2, { health: 0 }), kept(4, 3)];
    expect(checkInResult(bag, C.dayEndMin)).toMatchObject({ deadFish: 2, deadPenaltyLb: 0.5, netLb: 8.5 });
    const s = champ();
    s.livewell = [kept(1.5, 1, { health: 0 }), kept(2, 2), kept(3, 3), kept(4, 4), kept(5, 5)];
    s.pendingCull = kept(2.5, 6);
    expect(suggestedCull(s)).toBe(1); // the 2 lb fish, not the smaller dead one
    const released = resolveCull(s, 0); // asking to release the dead fish releases the suggestion instead
    expect(released!.weightLb).toBe(2);
    expect(s.livewell.some((f) => f.weightLb === 1.5)).toBe(true);
  });

  it('the debrief calls out dead fish and a late check-in', () => {
    const notes = debrief(newCoach().stats, 86, { atMin: C.dayEndMin + 3, grossLb: 10, lateMin: 3, latePenaltyLb: 3, deadFish: 1, deadPenaltyLb: 0.25, zeroed: false, netLb: 6.75 });
    expect(notes.join(' ')).toMatch(/late to check-in/);
    expect(notes.join(' ')).toMatch(/Hot water: cull and weigh early, fish shorter fights/);
  });
});

describe('harness check-in', () => {
  it('the expert heads in from the far end of the lake and checks in on time', () => {
    const far = farPoint('lakefork');
    const g = getLakeGrid(LAKES.lakefork);
    // The last stretch of the day: run out to the farthest stop, fish it, then head in.
    const m = playDay({
      lakeId: 'lakefork',
      tier: 'Amateur',
      seed: 101,
      deck: [botDeck('lakefork')[0]],
      profile: PROFILES.expert,
      spots: [{ x: far.x, y: far.y, hard: false }],
      startMin: leaveByMin(2 * etaHomeMin(g, far), 20),
      maxRealSec: 240,
    });
    expect(m.checkInMin).toBeLessThanOrEqual(C.dayEndMin);
    expect(m.lateMin).toBe(0);
    expect(m.zeroed).toBe(false);
  });
});
