import { describe, expect, it } from 'vitest';
import { LAKES } from '../src/data/lakes';
import { LURES } from '../src/data/lures';
import { weightFromLength } from '../src/data/species';
import { seasonFor } from '../src/sim/conditions';
import { breakingStrengthLb } from '../src/sim/fight';
import { jerkPauseWindow, presentationMatch } from '../src/sim/fish/attraction';
import { tempFactor } from '../src/sim/fish/activity';
import { getLakeGrid, isWater } from '../src/sim/lake';
import { continueAfterLanded, resolveCull, suggestedCull } from '../src/sim/livewell';
import { IllegalTransitionError, transition } from '../src/sim/machine';
import { newPresentState } from '../src/sim/presentation';
import { createTournament, drainEvents, endDay, standings, stepTournament } from '../src/sim/tournament';
import { emptyInput, type CaughtFish, type InputFrame, type TournamentState } from '../src/sim/types';
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
