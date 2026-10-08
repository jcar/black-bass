// Batch C ("NES soul"): tier-gated advice, Data for this point, the logbook, and lane routing.
import { describe, expect, it } from 'vitest';
import { LAKES } from '../src/data/lakes';
import { lakePointScale, pointData, pointVerdict, spotsFor } from '../src/sim/advisor';
import { generateConditions } from '../src/sim/conditions';
import { getLakeGrid, stumpHazardAt } from '../src/sim/lake';
import { bearingTo, distanceM, lineClear, navCue, OFF_PLANE_M, steerPoint, stumpsOnRoute, waterPath } from '../src/sim/nav';
import { Rng } from '../src/sim/rng';
import { adviceFor } from '../src/sim/tierAdvice';
import { createTournament, drainEvents, spendMinutes, stepTournament } from '../src/sim/tournament';
import { emptyInput, type CaughtFish, type Tier } from '../src/sim/types';
import { appendLog, capLog, groupLog, heaviest, LOG_CAP, logEntry, rankLogLures, type LogEntry } from '../src/state/logbook';
import { migrate, newSave, SAVE_VERSION } from '../src/state/save';
import { botDeck } from '../tools/simulate';

describe('advice by tier', () => {
  it('fades as you climb: Amateur everything, Semi-Pro 3 stops, Pro lures only and paid data, Elite scouting only', () => {
    const a = adviceFor('Amateur');
    expect([a.proStops, a.proChip, a.plan, a.scoutSpots, a.pointDataMin]).toEqual([6, true, 'full', true, 0]);
    const s = adviceFor('SemiPro');
    expect([s.proStops, s.proChip, s.plan, s.scoutSpots, s.pointDataMin]).toEqual([3, true, 'full', true, 0]);
    const p = adviceFor('Pro');
    expect([p.proStops, p.proChip, p.plan, p.scoutSpots, p.pointDataMin]).toEqual([0, true, 'lures', false, 2]);
    const e = adviceFor('Elite');
    expect([e.proStops, e.proChip, e.plan, e.scoutSpots, e.pointDataMin]).toEqual([0, false, 'scouting', false, null]);
    expect(p.label).toMatch(/find their own water/);
  });

  it('never gives a higher tier more than a lower one', () => {
    const order: Tier[] = ['Amateur', 'SemiPro', 'Pro', 'Elite'];
    const planRank = { full: 2, lures: 1, scouting: 0 };
    for (let i = 1; i < order.length; i++) {
      const lo = adviceFor(order[i - 1]);
      const hi = adviceFor(order[i]);
      expect(hi.proStops).toBeLessThanOrEqual(lo.proStops);
      expect(planRank[hi.plan]).toBeLessThanOrEqual(planRank[lo.plan]);
      expect(Number(hi.proChip)).toBeLessThanOrEqual(Number(lo.proChip));
      expect(hi.pointDataMin ?? Infinity).toBeGreaterThanOrEqual(lo.pointDataMin ?? Infinity);
    }
  });

  it('charges game minutes for checking a point only between casts', () => {
    const t = createTournament({ lakeId: 'champlain', tier: 'Pro', seed: 4, deck: botDeck() });
    t.phase = 'Cast';
    const at = t.clockMin;
    expect(spendMinutes(t, 2)).toBe(true);
    expect(t.clockMin).toBe(at + 2);
    t.phase = 'Fight';
    expect(spendMinutes(t, 2)).toBe(false);
    expect(t.clockMin).toBe(at + 2);
  });
});

describe('data for this point', () => {
  it('maps a score onto the lake quantiles', () => {
    expect(pointVerdict(10, [2, 6])).toBe('nice');
    expect(pointVerdict(6, [2, 6])).toBe('nice');
    expect(pointVerdict(3, [2, 6])).toBe('some');
    expect(pointVerdict(1, [2, 6])).toBe('little');
  });

  for (const lakeId of ['champlain', 'lakefork']) {
    it(`is informative on ${lakeId}: each verdict occurs, better water reads better, and dawn beats midday`, () => {
      const lake = LAKES[lakeId];
      const c = generateConditions(lake, new Rng(11));
      const { quantiles, refActivity } = lakePointScale(lake, c.season);
      expect(quantiles[0]).toBeGreaterThan(0);
      expect(quantiles[1]).toBeGreaterThan(quantiles[0]);
      expect(refActivity).toBeGreaterThan(0);
      const g = getLakeGrid(lake);
      const seen = new Set<string>();
      const rng = new Rng(3);
      for (let k = 0; k < 400; k++) {
        const i = rng.int(0, g.water.length - 1);
        if (g.water[i]) seen.add(pointData(lake, c, 420, { x: ((i % g.cols) + 0.5) * g.cellM, y: (Math.floor(i / g.cols) + 0.5) * g.cellM }).verdict);
      }
      for (const s of spotsFor(lake)) seen.add(pointData(lake, c, 420, s).verdict);
      expect([...seen].sort()).toEqual(['little', 'nice', 'some']);
      // Same point: the score is monotone in active bass, and activity changes it through the day.
      const spot = spotsFor(lake)[0];
      const dawn = pointData(lake, c, 390, spot);
      const noon = pointData(lake, c, 750, spot);
      expect(dawn.bass).toBeCloseTo(noon.bass);
      expect(dawn.score).toBeGreaterThan(noon.score);
    });
  }
});

describe('logbook', () => {
  const fish = (over: Partial<CaughtFish> = {}): CaughtFish => ({ fishId: 1, species: 'largemouth', weightLb: 2.5, lengthIn: 16, caughtAtMin: 400, lureId: 'squarebill', colorId: 'sexyShad', line: { type: 'fluoro', testLb: 12 }, depthFt: 4, bottomFt: 7, cover: 'rock', ...over });

  it('logs bass with tackle, conditions and where it bit; skips other species', () => {
    const t = createTournament({ lakeId: 'champlain', tier: 'Amateur', seed: 21, deck: botDeck() });
    const e = logEntry(t, fish(), true)!;
    expect(e).toMatchObject({ lakeId: 'champlain', species: 'largemouth', lureId: 'squarebill', colorId: 'sexyShad', clockMin: 400, depthFt: 4, cover: 'rock', keeper: true, day: 1 });
    expect(e.weather).toBe(t.conditions.weather);
    expect(e.date).toBe(t.conditions.date);
    expect(logEntry(t, fish({ species: 'pike' }), false)).toBeNull();
  });

  it('keeps the most recent 500 and never logs a fish twice', () => {
    const mk = (i: number) => ({ id: `e${i}`, weightLb: i / 100 }) as LogEntry;
    let log: LogEntry[] = [];
    for (let i = 0; i < LOG_CAP + 25; i++) log = appendLog(log, mk(i));
    expect(log.length).toBe(LOG_CAP);
    expect(log[0].id).toBe('e25');
    expect(log[log.length - 1].id).toBe(`e${LOG_CAP + 24}`);
    expect(appendLog(log, mk(LOG_CAP + 24))).toBe(log);
    expect(capLog(Array.from({ length: 600 }, (_, i) => mk(i))).length).toBe(LOG_CAP);
  });

  it('ranks lures by count and by weight and finds the record fish', () => {
    const e = (lureId: string, weightLb: number, season = 'Summer') => ({ id: `${lureId}${weightLb}`, lureId, weightLb, season }) as LogEntry;
    const log = [e('ned', 1), e('ned', 1.2), e('ned', 0.9), e('jig', 5.5), e('jig', 3, 'Fall')];
    expect(rankLogLures(log, 'count')[0].lureId).toBe('ned');
    expect(rankLogLures(log, 'weight')[0].lureId).toBe('jig');
    expect(heaviest(log)?.weightLb).toBe(5.5);
    expect(groupLog(log, (x) => x.season, ['Summer', 'Fall']).map((g) => [g.key, g.entries.length])).toEqual([
      ['Summer', 4],
      ['Fall', 1],
    ]);
  });

  it('migrates a v1 save: empty logbook, Angler’s Eye off, everything else kept', () => {
    const v1 = { ...newSave(), version: 1, player: { name: 'Old Timer', rank: 'SemiPro', cash: 1234, rankPoints: 50 } } as Record<string, unknown>;
    delete v1.logbook;
    v1.settings = { leftHanded: true, sound: false, debugMeter: false, seenWeighIn: true, coach: true };
    const s = migrate(JSON.parse(JSON.stringify(v1)));
    expect(s.version).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBe(2);
    expect(s.logbook).toEqual([]);
    expect(s.settings.anglersEye).toBe(false);
    expect(s.settings.leftHanded).toBe(true);
    expect(s.player.name).toBe('Old Timer');
    // An over-long log (hand-edited or from a future build) is capped on load.
    const big = { ...newSave(), logbook: Array.from({ length: 700 }, (_, i) => ({ id: `x${i}` })) };
    expect(migrate(JSON.parse(JSON.stringify(big))).logbook.length).toBe(LOG_CAP);
  });
});

describe('lane routing on Lake Fork', () => {
  const lake = LAKES.lakefork;
  const g = getLakeGrid(lake);

  it('keeps a running route in the boat lanes: straight runs it steers along never cross off-lane stumps', () => {
    for (const w of lake.waypoints.filter((x) => x.visible)) {
      const path = waterPath(g, lake.launch, w, true);
      let from: { x: number; y: number } = { x: lake.launch.x, y: lake.launch.y };
      // Walk the route the way the chip does: steer at the farthest clear point, then from there.
      for (let k = 0; k < 400 && distanceM(from, w) > 1; k++) {
        if (stumpHazardAt(g, from.x, from.y)) break; // the stop's own stump field: idled, the chip says so
        const rest = path.slice(path.findIndex((p) => distanceM(p, from) < 1) + 1);
        const ahead = rest.length ? rest : path;
        const steer = steerPoint(g, from, ahead, true);
        if (!lineClear(g, from, steer, true, true)) {
          // No clear run left: the route leaves the lane for a stop in the stumps, and the chip says so.
          expect(stumpsOnRoute(g, from, ahead), `${w.id} from ${from.x.toFixed(0)},${from.y.toFixed(0)}`).not.toBeNull();
          break;
        }
        if (steer === from) break;
        from = steer;
      }
    }
  });

  it('tells you to stay in the lane when you run off it, and to come off plane before stumps', () => {
    expect(navCue(500, 'outboard', 20, 'in')).toBe('lane');
    expect(navCue(500, 'outboard', 20, 'ahead')).toBe('stumpsAhead');
    expect(navCue(500, 'trolling', 20, 'in')).toBeNull();
    expect(navCue(10, 'outboard', 20, 'in')).toBe('inRange');
    const z = lake.stumpZones![0];
    const inStumps = { x: z.x, y: z.y };
    if (stumpHazardAt(g, inStumps.x, inStumps.y)) expect(stumpsOnRoute(g, inStumps, [lake.launch])).toBe('in');
  });

  it('following the chip on the outboard (off plane when it says so) hits no stumps', () => {
    let hits = 0;
    for (const w of lake.waypoints.filter((x) => x.visible).slice(0, 5)) {
      const t = createTournament({ lakeId: 'lakefork', tier: 'Amateur', seed: 3, deck: botDeck('lakefork') });
      t.boat = { pos: { ...lake.launch }, heading: 0, speed: 0, motor: 'trolling' };
      let path = waterPath(g, t.boat.pos, w, true);
      for (let i = 0; i < 300 * 60 && distanceM(t.boat.pos, w) > OFF_PLANE_M; i++) {
        const running = t.boat.motor === 'outboard';
        if (i % 90 === 0) path = waterPath(g, t.boat.pos, w, running);
        const a = bearingTo(t.boat.pos, steerPoint(g, t.boat.pos, path, running));
        const stumps = stumpsOnRoute(g, t.boat.pos, path, t.boat.heading);
        const cue = navCue(distanceM(t.boat.pos, w), t.boat.motor, 20, stumps);
        // A player who heeds "Stay in the lane" / "Off plane: stumps ahead" idles through, then runs again.
        const mag = cue === 'lane' || cue === 'stumpsAhead' || cue === 'idleInStumps' || (!running && stumps) ? 0.36 : 1;
        t.clockMin = 420;
        t.phase = 'Navigate';
        stepTournament(t, { ...emptyInput(), stick: { x: Math.cos(a) * mag, y: -Math.sin(a) * mag } }, 1 / 60);
        for (const e of drainEvents(t)) if (e.type === 'stump') hits++;
      }
      expect(distanceM(t.boat.pos, w), w.id).toBeLessThanOrEqual(OFF_PLANE_M + 1);
    }
    expect(hits).toBe(0);
  }, 60_000);
});
