import { describe, expect, it } from 'vitest';
import { LAKES } from '../src/data/lakes';
import { LURES } from '../src/data/lures';
import { weightFromLength } from '../src/data/species';
import { seasonFor } from '../src/sim/conditions';
import { breakingStrengthLb, newFightState } from '../src/sim/fight';
import { makeCtx } from '../src/sim/context';
import { migrate, newSave } from '../src/state/save';
import { jerkPauseWindow, presentationMatch } from '../src/sim/fish/attraction';
import { tempFactor } from '../src/sim/fish/activity';
import { coverAt, getLakeGrid, inLane, isWater, stumpHazardAt } from '../src/sim/lake';
import { continueAfterLanded, inSlot, isKeeper, resolveCull, suggestedCull } from '../src/sim/livewell';
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
  it('treats 16-24" largemouth as catch-weigh-release slot fish that still count', () => {
    expect(inSlot(fish(18), lake)).toBe(true);
    expect(isKeeper(fish(18), lake)).toBe(true);
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
