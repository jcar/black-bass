import { describe, expect, it } from 'vitest';
import { LAKES } from '../src/data/lakes';
import { TUNING } from '../src/data/tuning';
import { RODS } from '../src/data/rods';
import { rodForKey } from '../src/game/input';
import { APPROACH_TIP, techniqueTip } from '../src/sim/advisor';
import { debrief, missTip } from '../src/sim/coach';
import { hoursMinText, lbOzText, plural, scaleLb } from '../src/sim/format';
import { bagWeight } from '../src/sim/livewell';
import { getLakeGrid, isWater } from '../src/sim/lake';
import { bearingTo, castRangeM, checkInNeedsConfirm, compassPoint, distanceM, idleInDistM, lateMinutes, lineClear, markVisited, navCue, nearestInRange, nextStop, OFF_PLANE_M, relativeBearing, scaleBarM, steerPoint, waterPath, wrapAngle, type NavStop } from '../src/sim/nav';
import { createTournament, drainEvents, stepTournament } from '../src/sim/tournament';
import { emptyInput, type RodSetup, type TournamentState } from '../src/sim/types';
import { botDeck } from '../tools/simulate';

const DT = 1 / 60;
const stop = (id: string, x: number, y: number, pro?: number): NavStop => ({ id, name: id, x, y, pro });

describe('nav helpers', () => {
  it('measures distance and bearing in the boat heading frame (0 = east, +y = south)', () => {
    expect(distanceM({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(bearingTo({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(0);
    expect(bearingTo({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(Math.PI / 2);
    expect(compassPoint(bearingTo({ x: 0, y: 0 }, { x: 0, y: -10 }))).toBe('N');
    expect(compassPoint(bearingTo({ x: 0, y: 0 }, { x: 10, y: -10 }))).toBe('NE');
    expect(compassPoint(bearingTo({ x: 0, y: 0 }, { x: -10, y: 10 }))).toBe('SW');
    expect(compassPoint(Math.PI)).toBe('W');
  });

  it('gives the bearing relative to the bow: 0 ahead, positive to starboard, wrapped to (-PI, PI]', () => {
    const boat = { x: 100, y: 100 };
    expect(relativeBearing(0, boat, { x: 200, y: 100 })).toBeCloseTo(0);
    // Heading north (-PI/2), target east: a quarter turn to starboard.
    expect(relativeBearing(-Math.PI / 2, boat, { x: 200, y: 100 })).toBeCloseTo(Math.PI / 2);
    expect(relativeBearing(-Math.PI / 2, boat, { x: 0, y: 100 })).toBeCloseTo(-Math.PI / 2);
    expect(Math.abs(relativeBearing(0, boat, { x: 0, y: 100 }))).toBeCloseTo(Math.PI);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI)).toBe(Math.PI);
  });

  it('counts a stop visited only when you cast within range of it, and moves on to the next unvisited', () => {
    const route = [stop('a', 0, 0, 1), stop('b', 500, 0, 2), stop('c', 1000, 0, 3)];
    const visited = new Set<string>();
    expect(nextStop(route, visited)?.id).toBe('a');
    // A cast 60 m short of stop a does not count.
    expect(markVisited(visited, route, { x: 60, y: 0 }, 25)).toEqual([]);
    expect(nextStop(route, visited)?.id).toBe('a');
    expect(markVisited(visited, route, { x: 20, y: 0 }, 25)).toEqual(['a']);
    expect(markVisited(visited, route, { x: 20, y: 0 }, 25)).toEqual([]);
    expect(nextStop(route, visited)?.id).toBe('b');
    // Fishing c out of order skips it later, but b is still next.
    markVisited(visited, route, { x: 1000, y: 10 }, 25);
    expect(nextStop(route, visited)?.id).toBe('b');
    markVisited(visited, route, { x: 500, y: 0 }, 25);
    expect(nextStop(route, visited)).toBeNull();
  });

  it('finds the nearest stop in range', () => {
    const stops = [stop('a', 0, 0), stop('b', 30, 0)];
    expect(nearestInRange(stops, { x: 20, y: 0 }, 25)?.id).toBe('b');
    expect(nearestInRange(stops, { x: 200, y: 0 }, 25)).toBeNull();
  });

  it('cues "in range" and "idle in" at the advisor distances', () => {
    expect(OFF_PLANE_M).toBe(Math.round(TUNING.boat.outboardSpookRadius * 3));
    expect(APPROACH_TIP).toContain(`${OFF_PLANE_M} m out`);
    expect(navCue(20, 'trolling', 25)).toBe('inRange');
    expect(navCue(20, 'outboard', 25)).toBe('inRange');
    expect(navCue(OFF_PLANE_M - 1, 'outboard', 25)).toBe('idleIn');
    expect(navCue(OFF_PLANE_M - 1, 'trolling', 25)).toBeNull();
    expect(navCue(OFF_PLANE_M + 50, 'outboard', 25)).toBeNull();
  });

  it('picks round scale-bar lengths', () => {
    expect(scaleBarM(0.09, 90)).toBe(1000);
    expect(scaleBarM(0.2, 90)).toBe(200);
    expect(scaleBarM(1, 90)).toBe(50);
  });

  it('casting range comes from the rig in hand', () => {
    const t = createTournament({ lakeId: 'champlain', tier: 'Amateur', seed: 3, deck: botDeck() });
    for (const rig of t.deck) {
      const r = castRangeM(rig, t.conditions);
      expect(r).toBeGreaterThan(12);
      expect(r).toBeLessThan(40);
    }
  });
});

describe('shore contact', () => {
  const drive = (t: TournamentState, sx: number, sy: number, sec: number) => {
    const input = { ...emptyInput(), stick: { x: sx, y: sy } };
    for (let i = 0; i < sec * 60; i++) stepTournament(t, input, DT);
  };

  it('bumps on the bank, scrapes along it, and backs off when you steer away', () => {
    const t = createTournament({ lakeId: 'champlain', tier: 'Amateur', seed: 5, deck: botDeck() });
    const g = getLakeGrid(LAKES.champlain);
    // East shore of the main lake near the north end: open water to the west, land from ~2140 m east.
    t.boat = { pos: { x: 2000, y: 295 }, heading: 0, speed: 0, motor: 'trolling' };
    expect(isWater(g, 2000, 295) && !isWater(g, 2200, 295)).toBe(true);
    drainEvents(t);
    drive(t, 1, 0, 4);
    // The hit on plane, then (maybe) a second as it creeps the last metres in: the runner debounces the feedback.
    const bumps = drainEvents(t).filter((e) => e.type === 'bank');
    expect(bumps.length).toBeGreaterThanOrEqual(1);
    expect(bumps.length).toBeLessThanOrEqual(2);
    expect(bumps[0].at).toBeDefined();
    expect(t.boat.onBank).toBe(true);
    // Holding the stick into the bank scrapes along it at trolling speed: no re-bump every frame, no beaching.
    drive(t, 1, 0, 2);
    expect(drainEvents(t).filter((e) => e.type === 'bank')).toHaveLength(0);
    expect(t.boat.speed).toBeLessThanOrEqual(TUNING.boat.trollingMaxSpeed);
    expect(isWater(g, t.boat.pos.x, t.boat.pos.y)).toBe(true);
    const at = { ...t.boat.pos };
    drive(t, -0.4, 0, 3);
    expect(distanceM(at, t.boat.pos)).toBeGreaterThan(5);
    expect(t.boat.pos.x).toBeLessThan(at.x);
    expect(t.boat.onBank).toBe(false);
  });

  it('glances round a point instead of wedging on it (the stick held at a target past the corner)', () => {
    const t = createTournament({ lakeId: 'champlain', tier: 'Amateur', seed: 5, deck: botDeck() });
    // West face of a block of land near (1400, 1740); open water wraps round its south-west corner.
    t.boat = { pos: { x: 1395, y: 1734 }, heading: 0.43, speed: 0, motor: 'trolling' };
    const target = { x: 1430, y: 1750 };
    for (let i = 0; i < 15 * 60 && distanceM(t.boat.pos, target) > 8; i++) {
      const a = bearingTo(t.boat.pos, target);
      stepTournament(t, { ...emptyInput(), stick: { x: Math.cos(a) * 0.36, y: -Math.sin(a) * 0.36 } }, DT);
    }
    expect(distanceM(t.boat.pos, target)).toBeLessThanOrEqual(8);
  });

  it('never pins the boat: from any bank contact, steering back the way you came gets you off', () => {
    for (const lakeId of ['champlain', 'lakefork']) {
      const g = getLakeGrid(LAKES[lakeId]);
      const t = createTournament({ lakeId, tier: 'Amateur', seed: 9, deck: botDeck(lakeId) });
      let contacts = 0;
      for (let i = 0; i < g.water.length && contacts < 12; i += 61) {
        if (!g.water[i] || g.shoreDistM[i] < 15 || g.shoreDistM[i] > 80) continue;
        const start = { x: ((i % g.cols) + 0.5) * g.cellM, y: (Math.floor(i / g.cols) + 0.5) * g.cellM };
        for (let a = 0; a < 8; a += 2) {
          const ang = (a / 8) * Math.PI * 2;
          t.phase = 'Navigate';
          t.clockMin = 420;
          t.boat = { pos: { ...start }, heading: ang, speed: 0, motor: 'trolling' };
          const toward = { ...emptyInput(), stick: { x: Math.cos(ang), y: -Math.sin(ang) } };
          let hit = false;
          for (let k = 0; k < 180 && !hit; k++) {
            stepTournament(t, toward, DT);
            hit = k > 10 && t.boat.speed === 0;
          }
          if (!hit) continue;
          contacts++;
          const at = { ...t.boat.pos };
          drive(t, -Math.cos(ang) * 0.4, Math.sin(ang) * 0.4, 4);
          expect(distanceM(at, t.boat.pos), `${lakeId} ${at.x.toFixed(0)},${at.y.toFixed(0)} heading ${a}`).toBeGreaterThan(5);
        }
      }
      expect(contacts).toBeGreaterThan(5);
    }
  }, 60_000); // sweeps ~1,100 bank contacts on both lakes; slow on CI runners
});

describe('water routing', () => {
  const g = getLakeGrid(LAKES.champlain);
  // West of Valcour Island, with "Valcour Island Rocks" off its east side: straight through is land.
  const from = { x: 560, y: 2080 };
  const rocks = LAKES.champlain.waypoints.find((w) => w.id === 'valcour')!;

  it('routes round the island over water and ends at the stop', () => {
    expect(lineClear(g, from, rocks)).toBe(false);
    const path = waterPath(g, from, rocks);
    expect(path.length).toBeGreaterThan(2);
    expect(path[path.length - 1]).toEqual({ x: rocks.x, y: rocks.y });
    for (const p of path) expect(isWater(g, p.x, p.y)).toBe(true);
    let prev = from;
    let len = 0;
    for (const p of path) {
      len += distanceM(prev, p);
      prev = p;
    }
    expect(len).toBeGreaterThan(distanceM(from, rocks));
  });

  it('steers at a visible point on the route, or straight at the stop when the way is clear', () => {
    const path = waterPath(g, from, rocks);
    const steer = steerPoint(g, from, path);
    expect(lineClear(g, from, steer)).toBe(true);
    expect(steer).not.toEqual(path[path.length - 1]);
    const open = { x: 1000, y: 2000 };
    const near = { x: 1100, y: 2050 };
    expect(lineClear(g, open, near)).toBe(true);
    expect(steerPoint(g, open, waterPath(g, open, near))).toEqual(near);
  });

  it('following the steer point gets the boat to the stop (no wedging on the island)', () => {
    const t = createTournament({ lakeId: 'champlain', tier: 'Amateur', seed: 5, deck: botDeck() });
    t.boat = { pos: { ...from }, heading: 0, speed: 0, motor: 'trolling' };
    let path = waterPath(g, t.boat.pos, rocks);
    for (let i = 0; i < 90 * 60 && distanceM(t.boat.pos, rocks) > 20; i++) {
      if (i % 60 === 0) path = waterPath(g, t.boat.pos, rocks);
      const a = bearingTo(t.boat.pos, steerPoint(g, t.boat.pos, path));
      const mag = distanceM(t.boat.pos, rocks) > OFF_PLANE_M ? 0.7 : 0.36;
      t.clockMin = 420;
      stepTournament(t, { ...emptyInput(), stick: { x: Math.cos(a) * mag, y: -Math.sin(a) * mag } }, DT);
    }
    expect(distanceM(t.boat.pos, rocks)).toBeLessThanOrEqual(20);
  });
});

describe('playtest fixes: chip cues, check-in, rods, scale weights', () => {
  it('"Idle in now" wins over the lane warnings inside the off-plane ring (Lake Fork stops sit in stumps)', () => {
    expect(navCue(OFF_PLANE_M - 1, 'outboard', 25, 'in')).toBe('idleInStumps');
    expect(navCue(OFF_PLANE_M - 1, 'outboard', 25, 'ahead')).toBe('idleInStumps');
    expect(navCue(OFF_PLANE_M - 1, 'outboard', 25, null)).toBe('idleIn');
    // Outside the ring (and the coast-down) the lane warnings still apply.
    expect(navCue(OFF_PLANE_M + 200, 'outboard', 25, 'in', 75)).toBe('lane');
    expect(navCue(OFF_PLANE_M + 200, 'outboard', 25, 'ahead', 75)).toBe('stumpsAhead');
    expect(navCue(OFF_PLANE_M - 1, 'trolling', 25, 'in')).toBeNull();
  });

  it('calls "Idle in now" a stopping distance early at speed', () => {
    const v = TUNING.boat.outboardMaxSpeed;
    const stopM = (v * v) / (2 * TUNING.boat.decel);
    expect(idleInDistM(0)).toBe(OFF_PLANE_M);
    expect(idleInDistM(v)).toBeCloseTo(OFF_PLANE_M + stopM);
    expect(navCue(OFF_PLANE_M + stopM - 1, 'outboard', 25, null, v)).toBe('idleIn');
    expect(navCue(OFF_PLANE_M + stopM - 1, 'outboard', 25, null, 0)).toBeNull();
    expect(navCue(OFF_PLANE_M + stopM + 1, 'outboard', 25, null, v)).toBeNull();
  });

  it('asks before an early check-in, not in the last half hour', () => {
    const end = TUNING.clock.dayEndMin;
    expect(checkInNeedsConfirm(7 * 60 + 8)).toBe(true);
    expect(checkInNeedsConfirm(end - TUNING.checkIn.confirmEarlyMin - 1)).toBe(true);
    expect(checkInNeedsConfirm(end - TUNING.checkIn.confirmEarlyMin)).toBe(false);
    expect(checkInNeedsConfirm(end - 5)).toBe(false);
  });

  it('counts minutes late off the clock: 0 at 3:00, 1 from 3:01', () => {
    const end = TUNING.clock.dayEndMin;
    expect(lateMinutes(end - 1)).toBe(0);
    expect(lateMinutes(end)).toBe(0);
    expect(lateMinutes(end + 0.99)).toBe(0);
    expect(lateMinutes(end + 1)).toBe(1);
    expect(lateMinutes(end + 2.5)).toBe(2);
  });

  it('maps digit keys to rods on the bar, up to the deck size', () => {
    expect(rodForKey('1', 5)).toBe(0);
    expect(rodForKey('5', 5)).toBe(4);
    expect(rodForKey('4', 3)).toBeNull();
    expect(rodForKey('0', 5)).toBeNull();
    expect(rodForKey('k', 5)).toBeNull();
  });

  it('weighs each fish to the ounce, so the fish shown add up to the bag', () => {
    const fish = [3.39, 3.24, 2.76, 2.62, 2.38].map((w) => ({ weightLb: w }));
    const bag = bagWeight(fish);
    const shown = fish.map((f) => lbOzText(f.weightLb));
    expect(shown).toEqual(['3-06', '3-04', '2-12', '2-10', '2-06']);
    // 3-06 + 3-04 + 2-12 + 2-10 + 2-06 = 14-06
    expect(lbOzText(bag)).toBe('14-06');
    expect(bag).toBe(fish.reduce((a, f) => a + scaleLb(f.weightLb), 0));
    expect(scaleLb(3.39)).toBe(3.375);
  });

  it('words tips for the day and the lure in hand', () => {
    expect(hoursMinText(472)).toBe('7 h 52 m');
    expect(hoursMinText(25)).toBe('25 m');
    expect(plural(1, 'bite')).toBe('1 bite');
    expect(plural(3, 'bite')).toBe('3 bites');
    expect(techniqueTip('texasRig', 70, 'rock')).not.toMatch(/docks/);
    expect(techniqueTip('texasRig', 70)).not.toMatch(/docks/);
    expect(techniqueTip('texasRig', 70, 'dock')).toMatch(/into the docks/);
    const rig = { rodId: Object.keys(RODS)[0], lureId: 'texasRig', colorId: 'greenPumpkin', line: { type: 'fluoro', testLb: 12 } } as RodSetup;
    expect(missTip('late', false, rig).text).toMatch(/soft plastic like the Texas rig/i);
    expect(missTip('late', false, { ...rig, lureId: 'squarebill' }).text).toMatch(/hard bait/);
    const early = debrief({ casts: 0, arrivals: 0, spookedArrivals: 0, crashes: 0, fishlessCasts: 0, followNoStrike: 0, strikes: 0, match: {} }, 70, {
      atMin: 7 * 60 + 8,
      grossLb: 0,
      lateMin: 0,
      latePenaltyLb: 0,
      deadFish: 0,
      deadPenaltyLb: 0,
      zeroed: false,
      netLb: 0,
    });
    expect(early[0]).toMatch(/^Checked in at 7:08 AM with 7 h 52 m left/);
  });
});
