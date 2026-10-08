import { describe, expect, it } from 'vitest';
import { LAKES, PURSE, payoutFor } from '../src/data/lakes';
import { LURES } from '../src/data/lures';
import { weightFromLength } from '../src/data/species';
import { seasonFor } from '../src/sim/conditions';
import { breakingStrengthLb, newFightState } from '../src/sim/fight';
import { makeCtx } from '../src/sim/context';
import { debrief } from '../src/sim/coach';
import { advisorRoute, bitesPerDayAt, dayPlan, proPickNow, rankLures, rigIssues, spotEnv, spotsFor, strikeChance, suggestedLine } from '../src/sim/advisor';
import { applyResult } from '../src/state/career';
import { migrate, newSave } from '../src/state/save';
import { jerkPauseWindow, presentationMatch } from '../src/sim/fish/attraction';
import { tempFactor } from '../src/sim/fish/activity';
import { coverAt, depthAt, getLakeGrid, inLane, isWater, nearCover, stumpHazardAt } from '../src/sim/lake';
import { inputHub } from '../src/game/input';
import { TUNING } from '../src/data/tuning';
import { continueAfterLanded, countsToBag, inSlot, isKeeper, resolveCull, suggestedCull } from '../src/sim/livewell';
import { IllegalTransitionError, transition } from '../src/sim/machine';
import { newPresentState } from '../src/sim/presentation';
import { createTournament, drainEvents, endDay, standings, stepTournament } from '../src/sim/tournament';
import { emptyInput, type CaughtFish, type InputFrame, type RodSetup, type TournamentState } from '../src/sim/types';
import { botDeck } from '../tools/simulate';

const DT = 1 / 60;
const newT = (seed = 42) => createTournament({ lakeId: 'champlain', tier: 'Amateur', seed, deck: botDeck() });
const fishOf = (w: number, i: number): CaughtFish => ({ fishId: 1000 + i, species: 'smallmouth', weightLb: w, lengthIn: 15, caughtAtMin: 400, lureId: 'ned' });

describe('standard weight curves', () => {
  it('matches published reference points', () => {
    expect(weightFromLength('largemouth', 20)).toBeCloseTo(4.7, 1);
    expect(weightFromLength('smallmouth', 18)).toBeCloseTo(3.4, 1);
  });
});

describe('lake grid', () => {
  it('has the launch in the water and land outside the shoreline', () => {
    const lake = LAKES.champlain;
    const g = getLakeGrid(lake);
    expect(isWater(g, lake.launch.x, lake.launch.y)).toBe(true);
    expect(isWater(g, 5, 5)).toBe(false);
    for (const w of lake.waypoints) expect(isWater(g, w.x, w.y)).toBe(true);
  });
});

describe('phase state machine', () => {
  it('rejects illegal transitions', () => {
    const s = newT();
    expect(() => transition(s, 'Fight')).toThrow(IllegalTransitionError);
    transition(s, 'Cast');
    expect(s.phase).toBe('Cast');
  });
});

describe('livewell and culling', () => {
  it('keeps the best five when a sixth bass is caught', () => {
    const s = newT();
    s.livewell = [3.1, 2.2, 4.0, 1.4, 2.8].map(fishOf);
    s.pendingCull = fishOf(2.5, 9);
    const idx = suggestedCull(s);
    const released = resolveCull(s, idx);
    expect(released?.weightLb).toBe(1.4);
    expect(s.livewell).toHaveLength(5);
    expect(s.livewell.map((f) => f.weightLb).sort()).toEqual([2.2, 2.5, 2.8, 3.1, 4.0].sort());
  });

  it('auto-culls the smallest when continuing from the landed card', () => {
    const s = newT();
    s.phase = 'Landed';
    s.livewell = [3, 3, 3, 3, 3].map(fishOf);
    s.pendingCull = fishOf(1, 9);
    continueAfterLanded(s);
    expect(s.livewell.every((f) => f.weightLb === 3)).toBe(true);
    expect(s.phase).toBe('Cast');
  });
});

describe('fight', () => {
  it('snaps the line when tension exceeds knot-adjusted breaking strength', () => {
    const s = newT();
    s.deck[0] = { ...s.deck[0], line: { type: 'braid', testLb: 6 } };
    s.activeRod = 0;
    const fish = s.fish.reduce((a, b) => (b.weightLb > a.weightLb ? b : a));
    s.phase = 'Fight';
    s.fight = {
      fishId: fish.id, species: fish.species, weightLb: fish.weightLb, pos: { x: s.boat.pos.x + 15, y: s.boat.pos.y },
      heading: 0, speed: 0, lineOut: 15, stamina: 1, tensionLb: 0, tension: 0, burstT: 5, nextBurstIn: 5,
      jumpT: 0, jumpBowed: false, jumps: 0, revealed: false, t: 0, rodSide: 0,
    };
    const input: InputFrame = { ...emptyInput(), reel: true, brake: true };
    const types: string[] = [];
    for (let i = 0; i < 600 && s.phase === 'Fight'; i++) {
      stepTournament(s, input, DT);
      types.push(...drainEvents(s).map((e) => e.type));
    }
    expect(breakingStrengthLb(6)).toBeCloseTo(5.4);
    expect(types).toContain('snap');
    expect(s.phase).toBe('Cast');
  });

  const hooked = (seed: number, species: 'smallmouth' | 'largemouth', lb: number, line: RodSetup['line'], distM = 20) => {
    const s = newT(seed);
    s.deck[0] = { ...s.deck[0], rodId: 'rod-ml', line };
    s.activeRod = 0;
    const fish = s.fish.filter((f) => f.species === species).reduce((a, b) => (Math.abs(b.weightLb - lb) < Math.abs(a.weightLb - lb) ? b : a));
    const b = s.boat;
    s.phase = 'Fight';
    s.fight = newFightState(s, makeCtx(s), fish, { x: b.pos.x + Math.cos(b.heading) * distM, y: b.pos.y + Math.sin(b.heading) * distM });
    return s;
  };

  it('slips the drag so 8 lb fluoro lands a 1.5 lb smallmouth on a steady reel', () => {
    let landed = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const s = hooked(seed, 'smallmouth', 1.5, { type: 'fluoro', testLb: 8 });
      const types: string[] = [];
      let peak = 0;
      for (let i = 0; i < 60 * 60 && s.phase === 'Fight'; i++) {
        stepTournament(s, { ...emptyInput(), reel: true }, DT);
        peak = Math.max(peak, s.fight?.tension ?? 0);
        types.push(...drainEvents(s).map((e) => e.type));
      }
      expect(types).not.toContain('snap');
      expect(peak).toBeLessThan(1);
      if (s.phase === 'Landed') landed++;
    }
    // The rest threw the hook on an unbowed jump; none broke the line.
    expect(landed).toBeGreaterThanOrEqual(5);
  });

  it('lets light line survive the first run of a bigger fish through the drag, but not with the spool thumbed', () => {
    // Over a few seeds (the first run's strength is random): the drag never lets 8 lb break in the
    // first two seconds; thumbing the spool often does.
    const run = (seed: number, thumb: boolean) => {
      const s = hooked(seed, 'largemouth', 5, { type: 'fluoro', testLb: 8 });
      const types: string[] = [];
      for (let i = 0; i < 120 && s.phase === 'Fight'; i++) {
        stepTournament(s, { ...emptyInput(), reel: true, brake: thumb }, DT);
        types.push(...drainEvents(s).map((e) => e.type));
      }
      return types.includes('snap');
    };
    const seeds = [1, 2, 3, 4, 5, 6];
    expect(seeds.filter((k) => run(k, false))).toEqual([]);
    expect(seeds.filter((k) => run(k, true)).length).toBeGreaterThanOrEqual(2);
  });

  it('brings a beaten fish to the boat quickly', () => {
    const s = hooked(4, 'smallmouth', 1.5, { type: 'fluoro', testLb: 10 }, 25);
    s.fight!.stamina = TUNING.fight.beatStamina;
    s.fight!.burstT = 0;
    let t = 0;
    while (s.phase === 'Fight' && t < 30) {
      stepTournament(s, { ...emptyInput(), reel: true }, DT);
      t += DT;
    }
    expect(s.phase).toBe('Landed');
    expect(t).toBeLessThan(10);
  });
});

describe('casting', () => {
  it('thumbing the spool drops the lure straight down short of the target', () => {
    const s = newT();
    transition(s, 'Cast');
    stepTournament(s, { ...emptyInput(), castTap: true }, DT);
    for (let i = 0; i < 25; i++) stepTournament(s, emptyInput(), DT);
    stepTournament(s, { ...emptyInput(), castTap: true }, DT);
    expect(s.cast?.flying).toBe(true);
    const fullTarget = { ...s.cast!.target };
    for (let i = 0; i < 10; i++) stepTournament(s, emptyInput(), DT);
    const before = { ...s.cast!.lurePos };
    stepTournament(s, { ...emptyInput(), brake: true }, DT);
    expect(s.cast!.braked).toBe(true);
    const dropAt = { ...s.cast!.target };
    expect(Math.hypot(dropAt.x - before.x, dropAt.y - before.y)).toBeLessThan(1);
    expect(Math.hypot(fullTarget.x - s.boat.pos.x, fullTarget.y - s.boat.pos.y)).toBeGreaterThan(Math.hypot(dropAt.x - s.boat.pos.x, dropAt.y - s.boat.pos.y));
  });
});

describe('attraction model', () => {
  it('rewards a jerkbait pause inside the temperature window', () => {
    const lure = LURES.jerkbait;
    const p = newPresentState({ x: 0, y: 0 }, false);
    p.twitchTimes = [10, 10.4];
    p.pauseStartT = 10.6;
    const [lo, hi] = jerkPauseWindow(42);
    p.t = 10.6 + (lo + hi) / 2;
    const good = presentationMatch(lure, p, 42);
    p.t = 10.6 + 0.3;
    const short = presentationMatch(lure, p, 42);
    expect(good).toBeGreaterThan(0.9);
    expect(short).toBeLessThan(good);
  });

  it('peaks activity near each species optimum temperature', () => {
    expect(tempFactor('largemouth', 81)).toBeCloseTo(1, 2);
    expect(tempFactor('smallmouth', 72)).toBeGreaterThan(tempFactor('smallmouth', 88));
  });

  it('classifies season by temperature trend', () => {
    expect(seasonFor(62, 0.3, 0.9)).toBe('Spawn');
    expect(seasonFor(62, -0.3, 0.9)).toBe('Fall');
    expect(seasonFor(44, 0.3, 0.9)).toBe('Winter');
  });
});

describe('determinism and save round-trip', () => {
  const run = (s: TournamentState) => {
    for (let i = 0; i < 1200; i++) {
      const input = emptyInput();
      if (s.phase === 'Navigate') input.fishHere = true;
      if (s.phase === 'Cast') input.castTap = i % 40 === 0;
      if (s.phase === 'Present') input.reel = true;
      if (s.phase === 'Fight') input.reel = i % 3 !== 0;
      stepTournament(s, input, DT);
      drainEvents(s);
    }
    return s;
  };

  it('replays identically from the same seed and inputs', () => {
    const a = run(newT(7));
    const b = run(newT(7));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('survives a JSON snapshot mid-tournament', () => {
    const a = run(newT(9));
    const snap = JSON.parse(JSON.stringify(a)) as TournamentState;
    run(a);
    run(snap);
    expect(JSON.stringify(snap)).toBe(JSON.stringify(a));
  });
});

describe('weigh-in', () => {
  it('ranks the player against the field', () => {
    const s = newT(3);
    s.livewell = [4, 4, 4, 4, 4].map(fishOf);
    endDay(s);
    const st = standings(s, true);
    expect(st).toHaveLength(30);
    expect(st.find((x) => x.isPlayer)?.total).toBe(20);
    expect(s.phase).toBe('WeighIn');
  });

  it('pays every finish, so a career can always afford the next entry', () => {
    const s = newT(3);
    endDay(s); // a zero bag: last place
    const save = newSave();
    save.player.cash = 0;
    const { result } = applyResult(save, s);
    expect(result.place).toBe(30);
    expect(result.payout).toBe(PURSE.Amateur.participation);
    expect(save.player.cash).toBeGreaterThanOrEqual(PURSE.Amateur.entry);
    expect(PURSE.Amateur.entry).toBe(0);
    for (const tier of Object.keys(PURSE) as (keyof typeof PURSE)[]) {
      expect(payoutFor(tier, 1)).toBe(PURSE[tier].payouts[0]);
      expect(payoutFor(tier, 99)).toBeGreaterThan(0);
    }
  });
});

// ---------- Lakes, regulations, hazards and the broadcast feed ----------
const forkT = (seed = 5) => createTournament({ lakeId: 'lakefork', tier: 'SemiPro', seed, deck: botDeck('lakefork') });

describe('every lake', () => {
  for (const [id, lake] of Object.entries(LAKES)) {
    it(`${id}: launch, waypoints and boat lanes are on water`, () => {
      const g = getLakeGrid(lake);
      expect(isWater(g, lake.launch.x, lake.launch.y)).toBe(true);
      for (const w of lake.waypoints) expect(isWater(g, w.x, w.y), w.name).toBe(true);
      for (const pl of lake.lanes ?? []) for (const [x, y] of pl) expect(isWater(g, x, y)).toBe(true);
    });
  }
});

describe('Lake Fork regulations', () => {
  const lake = LAKES.lakefork;
  const fish = (lengthIn: number) => ({ species: 'largemouth' as const, lengthIn });
  it('protects 16-24" largemouth: slot fish can\'t be kept, but under CWIR they are weighed and count', () => {
    expect(inSlot(fish(18), lake)).toBe(true);
    expect(isKeeper(fish(18), lake)).toBe(false);
    expect(countsToBag(fish(18), lake)).toBe(true);
    expect(inSlot(fish(15.75), lake)).toBe(false);
    expect(inSlot(fish(24), lake)).toBe(false);
    expect(inSlot(fish(18), LAKES.champlain)).toBe(false);
  });
});

describe('boat lanes and stumps', () => {
  const runAt = (x: number, y: number) => {
    const s = forkT(11);
    let hits = 0;
    for (let i = 0; i < 600; i++) {
      s.boat = { pos: { x, y }, heading: 0, speed: 60, motor: 'outboard' };
      const input = emptyInput();
      input.stick = { x: 1, y: 0 };
      stepTournament(s, input, DT);
      hits += drainEvents(s).filter((e) => e.type === 'stump').length;
    }
    return hits;
  };
  it('only punishes running on plane outside the lanes', () => {
    const g = getLakeGrid(LAKES.lakefork);
    expect(stumpHazardAt(g, 1250, 2600)).toBe(false); // the main-channel lane
    expect(inLane(g, 1250, 2600)).toBe(true);
    expect(stumpHazardAt(g, 1100, 2700)).toBe(true); // timber flat beside it
    expect(runAt(1250, 2600)).toBe(0);
    expect(runAt(1100, 2700)).toBeGreaterThan(0);
  });
});

describe('standing timber', () => {
  const wraps = (line: RodSetup['line'], seed: number) => {
    const s = forkT(seed);
    s.deck[0] = { ...s.deck[0], line };
    s.activeRod = 0;
    const f = s.fish.find((x) => x.species === 'largemouth' && x.weightLb > 4)!;
    const g = getLakeGrid(LAKES.lakefork);
    let at = { x: 1250, y: 2700 };
    for (let k = 0; k < 400 && coverAt(g, at.x, at.y) !== 'standing'; k++) at = { x: 1000 + (k % 20) * 25, y: 2500 + Math.floor(k / 20) * 25 };
    s.phase = 'Fight';
    s.boat.pos = { x: at.x - 30, y: at.y };
    s.fight = newFightState(s, makeCtx(s), f, at);
    for (let i = 0; i < 240 && s.fight; i++) {
      s.fight.pos = { ...at };
      s.fight.tensionLb = breakingStrengthLb(line.testLb) * 0.9;
      const input = emptyInput();
      input.brake = true;
      stepTournament(s, input, DT);
    }
    return drainEvents(s).some((e) => e.text?.startsWith('Wrapped'));
  };
  it('wraps light line more often than heavy braid', () => {
    let light = 0;
    let braid = 0;
    for (let seed = 1; seed <= 12; seed++) {
      if (wraps({ type: 'fluoro', testLb: 8 }, seed)) light++;
      if (wraps({ type: 'braid', testLb: 50 }, seed)) braid++;
    }
    expect(light).toBeGreaterThan(braid);
  });
});

describe('rival field', () => {
  it('catches individual fish of the lake species within the lake size limits', () => {
    const s = forkT(21);
    const caught = s.rivals.flatMap((r) => r.catches);
    // Catch-weigh-immediate-release: every legal fish a rival catches counts, slot fish included.
    expect(caught.length).toBeGreaterThan(100);
    expect(caught.every((c) => c.species === 'largemouth')).toBe(true);
    expect(Math.max(...caught.map((c) => c.weightLb))).toBeLessThan(weightFromLength('largemouth', 28, 1.08 * 1.05) + 0.01);
    const champ = newT(21).rivals.flatMap((r) => r.catches);
    expect(new Set(champ.map((c) => c.species))).toEqual(new Set(['smallmouth', 'largemouth']));
  });

  it('reports the day like a broadcast, deterministically', () => {
    const day = (seed: number) => {
      const s = newT(seed);
      const feed: string[] = [];
      while (s.phase !== 'WeighIn') {
        stepTournament(s, emptyInput(), 0.5);
        for (const e of drainEvents(s)) if (e.type === 'rivalCatch' || e.type === 'leaderChange') feed.push(`${e.type}:${e.text}`);
      }
      return feed;
    };
    const a = day(8);
    expect(a.filter((x) => x.startsWith('rivalCatch')).length).toBeGreaterThan(3);
    expect(a.some((x) => x.startsWith('leaderChange'))).toBe(true);
    expect(day(8)).toEqual(a);
  });
});

describe('Lake Fork determinism', () => {
  it('replays identically from the same seed', () => {
    const run = (s: TournamentState) => {
      for (let i = 0; i < 900; i++) {
        const input = emptyInput();
        if (s.phase === 'Navigate') input.fishHere = true;
        if (s.phase === 'Cast') input.castTap = i % 40 === 0;
        if (s.phase === 'Present') input.reel = true;
        if (s.phase === 'Fight') input.reel = i % 3 !== 0;
        stepTournament(s, input, DT);
        drainEvents(s);
      }
      return JSON.stringify(s);
    };
    expect(run(forkT(3))).toBe(run(forkT(3)));
  });
});

describe('save migration', () => {
  it('turns a pre-Lake-Fork promotion into a Lake Fork unlock', () => {
    const old = { ...newSave(), unlockedLakes: ['champlain', 'guntersville'] };
    expect(migrate(old).unlockedLakes).toEqual(['champlain', 'lakefork']);
    expect(migrate(migrate(old)).unlockedLakes).toEqual(['champlain', 'lakefork']);
  });
});

describe('pro advisor', () => {
  const lake = LAKES.champlain;
  const base = newT(4).conditions;
  const rig = (lureId: string, colorId: string, line: RodSetup['line'] = { type: 'fluoro', testLb: 10 }) => ({ lureId, colorId, line });

  it('strike chance follows the leaky meter: zero below the strike line, rising with fit', () => {
    expect(strikeChance(0.05)).toBe(0);
    expect(strikeChance(0.5)).toBeGreaterThan(strikeChance(0.3));
    expect(strikeChance(5)).toBeLessThanOrEqual(1);
  });
  it('favours topwater at dawn over midday (light fit)', () => {
    const c = { ...base, waterTempF: 72, weather: 'Bluebird' as const };
    const at = spotsFor(lake)[0];
    const r = rig('walker', 'bone', { type: 'mono', testLb: 14 });
    expect(bitesPerDayAt(lake, c, 400, r, at)).toBeGreaterThan(bitesPerDayAt(lake, c, 735, r, at));
  });
  it('ranks the jerkbait above topwater in cold water (temperature fit)', () => {
    const c = { ...base, waterTempF: 45, season: 'Prespawn' as const };
    const ranked = rankLures(lake, c).map((p) => p.lureId);
    expect(ranked.indexOf('jerkbait')).toBeLessThan(ranked.indexOf('walker'));
  });
  it('prefers fluoro to braid for subsurface baits in clear water (line visibility)', () => {
    const at = spotsFor(lake)[0];
    const f = bitesPerDayAt(lake, base, 570, rig('ned', 'greenPumpkin', { type: 'fluoro', testLb: 8 }), at);
    const b = bitesPerDayAt(lake, base, 570, rig('ned', 'greenPumpkin', { type: 'braid', testLb: 8 }), at);
    expect(f).toBeGreaterThan(b);
  });
  it('expects more bass on mapped structure than in open water', () => {
    const fishy = (at: { x: number; y: number }) => spotEnv(lake, base.season, at).reduce((a, e) => a + Object.values(e.density).reduce((x, y) => x + (y ?? 0), 0), 0);
    const cover = lake.cover.find((c) => c.type === 'rock')!;
    const g = getLakeGrid(lake);
    let open = { x: 0, y: 0 };
    for (let i = 0; i < g.water.length; i++)
      if (g.water[i] && g.cover[i] === 0 && g.depthFt[i] > 40) {
        open = { x: ((i % g.cols) + 0.5) * g.cellM, y: (Math.floor(i / g.cols) + 0.5) * g.cellM };
        break;
      }
    expect(fishy(cover)).toBeGreaterThan(fishy(open));
  });
  it('plans a milk run of distinct stops on the water', () => {
    const route = advisorRoute(lake, base, rig('tube', 'greenPumpkin'));
    expect(route.length).toBeGreaterThanOrEqual(4);
    const g = getLakeGrid(lake);
    for (const [i, a] of route.entries()) {
      expect(isWater(g, a.spot.x, a.spot.y)).toBe(true);
      for (const b of route.slice(i + 1)) expect(Math.hypot(a.spot.x - b.spot.x, a.spot.y - b.spot.y)).toBeGreaterThan(80);
    }
  });
  it('keeps the in-game pick on the day plan unless another rig clearly suits the water here', () => {
    const t = newT(4);
    const at = { x: Math.round(spotsFor(lake)[0].x / 20) * 20, y: Math.round(spotsFor(lake)[0].y / 20) * 20 };
    const local = t.deck.map((d) => bitesPerDayAt(lake, t.conditions, 570, d, at));
    const top = local.reduce((bi, x, i) => (x > local[bi] ? i : bi), 0);
    const plan = dayPlan(lake, t.conditions, t.deck);
    for (let k = 0; k < t.deck.length; k++) {
      const pinned = plan.map((p) => ({ ...p, best: k }));
      expect(proPickNow(lake, t.conditions, t.deck, 570, at, pinned)).toBe(local[top] > local[k] * 1.3 ? top : k);
    }
  });
  it('asks for heavy line in standing timber and flags rod/lure mismatches', () => {
    expect(suggestedLine(LAKES.lakefork, 'footballJig').testLb).toBeGreaterThanOrEqual(15);
    const issues = rigIssues(LAKES.lakefork, { id: 'x', rodId: 'rod-xh', line: { type: 'fluoro', testLb: 8 }, lureId: 'ned', colorId: 'greenPumpkin' });
    expect(issues.map((i) => i.text).join(' ')).toMatch(/outside the rod/);
    expect(issues.map((i) => i.text).join(' ')).toMatch(/standing timber/);
  });
});

// ---------- Audit fixes (docs/model-reports/BASELINE.md) ----------
describe('keyboard mapping', () => {
  const setup = () => {
    const l: Record<string, (e: unknown) => void> = {};
    const detach = inputHub.attachKeyboard({ addEventListener: (t: string, fn: (e: unknown) => void) => (l[t] = fn), removeEventListener: () => {} } as unknown as Window);
    inputHub.reset();
    const key = (k: string, down: boolean) => l[down ? 'keydown' : 'keyup']({ key: k, repeat: false, preventDefault() {} });
    return { key, detach };
  };
  it('steering keys never twitch or bow', () => {
    const { key, detach } = setup();
    for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 's']) {
      key(k, true);
      const f = inputHub.frame('Present');
      key(k, false);
      expect(f.twitch || f.bowFlick).toBe(false);
    }
    key('t', true);
    expect(inputHub.frame('Present').twitch).toBe(true);
    key('t', false);
    key('v', true);
    expect(inputHub.frame('Fight').bowFlick).toBe(true);
    key('v', false);
    detach();
  });
  it('drives on the trolling motor by default and the outboard with Shift', () => {
    const { key, detach } = setup();
    key('w', true);
    key('d', true);
    const quiet = inputHub.frame('Navigate');
    expect(Math.hypot(quiet.stick.x, quiet.stick.y)).toBeLessThanOrEqual(TUNING.boat.trollingStickMax);
    key('Shift', true);
    expect(Math.hypot(inputHub.frame('Navigate').stick.x, inputHub.frame('Navigate').stick.y)).toBeCloseTo(1, 5);
    key('Shift', false);
    // Aiming isn't throttled.
    expect(Math.abs(inputHub.frame('Cast').stick.x)).toBeGreaterThan(0.6);
    key('w', false);
    key('d', false);
    detach();
  });
});

describe('lake geometry fixes', () => {
  it('finds cover a few metres away (sub-cell distance)', () => {
    const lake = LAKES.champlain;
    const g = getLakeGrid(lake);
    let tested = 0;
    for (let i = 0; i < g.water.length && tested < 50; i++) {
      if (!g.water[i] || !g.cover[i]) continue;
      const c = i % g.cols;
      const r = Math.floor(i / g.cols);
      const j = i + 1; // the open cell east of a cover cell
      if (c + 1 >= g.cols || !g.water[j] || g.cover[j]) continue;
      const x = (c + 1) * g.cellM + 3; // 3 m into the open cell
      const y = (r + 0.5) * g.cellM;
      expect(nearCover(g, x, y, 8)).not.toBe('none');
      expect(nearCover(g, x, y, 1)).toBe('none');
      tested++;
    }
    expect(tested).toBeGreaterThan(5);
  });
  it('has shallow water along the banks for shallow baits', () => {
    for (const lake of Object.values(LAKES)) {
      const g = getLakeGrid(lake);
      let min = Infinity;
      for (let i = 0; i < g.water.length; i++) if (g.water[i]) min = Math.min(min, g.depthFt[i]);
      expect(min).toBeLessThanOrEqual(2);
    }
  });
});

describe('retrieve fixes', () => {
  const castAt = (lureId: string) => {
    const s = newT(12);
    s.deck = [{ id: 'x', rodId: 'rod-m', line: { type: 'fluoro', testLb: 12 }, lureId, colorId: LURES[lureId].colors[0] }];
    s.activeRod = 0;
    const lake = LAKES.champlain;
    const g = getLakeGrid(lake);
    // Deep open water 20 m from the boat.
    let at = { x: 900, y: 1700 };
    for (let k = 0; k < 400 && depthAt(g, at.x, at.y) < 15; k++) at = { x: 700 + (k % 20) * 30, y: 1500 + Math.floor(k / 20) * 30 };
    s.boat.pos = { x: at.x - 30, y: at.y };
    s.boat.heading = 0;
    s.phase = 'Present';
    s.present = newPresentState(at, false);
    return s;
  };
  it('a slipped thumb on REEL does not restart a steady retrieve', () => {
    const s = castAt('squarebill');
    const reel = (on: boolean, n: number) => {
      for (let i = 0; i < n && s.present; i++) stepTournament(s, { ...emptyInput(), reel: on }, DT);
    };
    reel(true, 90);
    const before = s.present!.movingFor;
    reel(false, 6); // 0.1 s slip
    reel(true, 1);
    expect(s.present!.movingFor).toBeGreaterThan(before * 0.9);
  });
  it('a bladed jig counts down on slack line and holds depth on the retrieve', () => {
    const s = castAt('chatterbait');
    for (let i = 0; i < 60; i++) stepTournament(s, emptyInput(), DT);
    const counted = s.present!.lureDepthFt;
    expect(counted).toBeGreaterThan(3);
    for (let i = 0; i < 60 && s.present; i++) stepTournament(s, { ...emptyInput(), reel: true }, DT);
    expect(s.present!.lureDepthFt).toBeGreaterThan(counted * 0.6);
  });
});

describe('leaky interest model', () => {
  const A = TUNING.attraction;
  const settle = (fit: number) => (A.gainPerSec * fit) / A.leakPerSec;
  it('good fits strike, middling fits follow without committing, poor fits are ignored', () => {
    expect(settle(0.7)).toBeGreaterThan(A.strikeAt);
    expect(settle(0.4)).toBeGreaterThan(A.followAt);
    expect(settle(0.4)).toBeLessThan(A.strikeAt);
    expect(settle(0.2)).toBeLessThan(A.followAt);
  });
});

describe('coach debrief', () => {
  const base = { casts: 30, arrivals: 6, spookedArrivals: 0, crashes: 0, fishlessCasts: 0, followNoStrike: 0, strikes: 5, match: {} };
  it('leads with the costliest mistake', () => {
    const notes = debrief({ ...base, spookedArrivals: 5, crashes: 2 }, 70);
    expect(notes[0]).toMatch(/5 of 6 stops/);
    expect(notes[1]).toMatch(/crashed/);
  });
  it('calls out a broken retrieve with the technique tip', () => {
    const notes = debrief({ ...base, match: { squarebill: { n: 10, sum: 3 } } }, 70);
    expect(notes[0]).toMatch(/Squarebill Crankbait retrieve rated 30%/);
  });
  it('says so when the day was clean', () => {
    expect(debrief(base, 70)[0]).toMatch(/Clean day/);
  });
});
