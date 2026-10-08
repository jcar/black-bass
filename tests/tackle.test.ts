// Batch D1: new tackle (weedless, leader rigs, big-fish baits), the hookset, and the drop shot's
// suspend and dwell mechanics.
import { afterEach, describe, expect, it } from 'vitest';
import { LAKES } from '../src/data/lakes';
import { LURES } from '../src/data/lures';
import { RODS, rodCasts, rodPowerOk } from '../src/data/rods';
import { TUNING } from '../src/data/tuning';
import { inputHub } from '../src/game/input';
import { bitesPerDayAt, rigIssues, suggestedLine, suggestedRod, techniqueTip } from '../src/sim/advisor';
import { newCastState } from '../src/sim/cast';
import { missTip } from '../src/sim/coach';
import { detectRange } from '../src/sim/fish/attraction';
import { lightLevel } from '../src/sim/conditions';
import { COVER_CODES, depthAt, getLakeGrid, nearCover, secchiAt } from '../src/sim/lake';
import { biteAtSec, hookUpChance, hookWindowSec, newPresentState } from '../src/sim/presentation';
import { createTournament, drainEvents, stepTournament } from '../src/sim/tournament';
import { emptyInput, type CoverType, type InputFrame, type Line, type TournamentEvent, type TournamentState, type Vec2 } from '../src/sim/types';

const DT = 1 / 60;
const lake = LAKES.champlain;
const grid = getLakeGrid(lake);

function rigged(lureId: string, line: Line = { type: 'fluoro', testLb: 12 }, rodId = 'rod-h', seed = 42): TournamentState {
  const s = createTournament({ lakeId: 'champlain', tier: 'Amateur', seed, deck: [{ id: 'x', rodId, line, lureId, colorId: LURES[lureId].colors[0] }] });
  s.activeRod = 0;
  return s;
}

/** First water cell of a cover type (optionally at least this deep), cell centre. */
function cellOf(cover: CoverType, minDepth = 0): Vec2 {
  for (let i = 0; i < grid.water.length; i++)
    if (grid.water[i] && COVER_CODES[grid.cover[i]] === cover && grid.depthFt[i] >= minDepth) return { x: ((i % grid.cols) + 0.5) * grid.cellM, y: (Math.floor(i / grid.cols) + 0.5) * grid.cellM };
  throw new Error(`no ${cover} cell`);
}

/** Deep open water, with the boat 25 m away and every fish moved out of the way. */
function openWater(s: TournamentState): Vec2 {
  let at = { x: 900, y: 1700 };
  const ok = (p: Vec2) => depthAt(grid, p.x, p.y) >= 25 && depthAt(grid, p.x, p.y) <= 40 && nearCover(grid, p.x, p.y, 10) === 'none';
  for (let k = 0; k < 2000 && !ok(at); k++) at = { x: 300 + (k % 40) * 30, y: 900 + Math.floor(k / 40) * 30 };
  if (!ok(at)) throw new Error('no open water 25-40 ft');
  s.boat.pos = { x: at.x - 25, y: at.y };
  s.boat.heading = 0;
  for (const f of s.fish) f.pos = { x: -5000, y: -5000 };
  return at;
}

/** Lure in the water and a fish (id 0) already charging it. */
function striking(lureId: string, line?: Line, seed = 42) {
  const s = rigged(lureId, line, 'rod-h', seed);
  const at = openWater(s);
  s.phase = 'Present';
  s.present = newPresentState(at, false);
  const f = s.fish[0];
  f.pos = { x: at.x + 1, y: at.y };
  f.depthFt = 5;
  s.present.strikingFishId = 0;
  return { s, f };
}

const step = (s: TournamentState, input: Partial<InputFrame> = {}, n = 1): TournamentEvent[] => {
  const out: TournamentEvent[] = [];
  for (let i = 0; i < n; i++) {
    stepTournament(s, { ...emptyInput(), ...input }, DT);
    out.push(...drainEvents(s));
  }
  return out;
};
const stepUntil = (s: TournamentState, strikeT: number) => {
  const out: TournamentEvent[] = [];
  while (s.present && s.present.strikingFishId !== null && s.present.strikeT + DT < strikeT) out.push(...step(s));
  return out;
};

describe('tackle box', () => {
  it('every lure has a rod that casts it with the power it needs, and the advisor finds it', () => {
    const all = Object.keys(RODS);
    for (const lure of Object.values(LURES)) {
      expect(Object.values(RODS).some((r) => rodCasts(r, lure) && rodPowerOk(r, lure)), lure.id).toBe(true);
      expect(suggestedRod(lure.id, all), lure.id).not.toBeNull();
      expect(lure.colors.length).toBeGreaterThan(0);
      expect(techniqueTip(lure.id, 60).length).toBeGreaterThan(20);
    }
    expect(suggestedRod('flipJig', all)).toBe('rod-xh');
    expect(RODS[suggestedRod('frog', all)!].power).toMatch(/^(H|XH)$/);
    expect(suggestedRod('swimbait', all)).toBe('rod-h');
    // Without a heavy enough rod there's no suggestion, not a wrong one.
    expect(suggestedRod('flipJig', ['rod-ml', 'rod-m', 'rod-mh'])).toBeNull();
  });

  it('rigs frogs on braid and flipping baits on heavy line, and flags light rods', () => {
    expect(suggestedLine(lake, 'frog').type).toBe('braid');
    expect(suggestedLine(lake, 'flipJig').testLb).toBeGreaterThanOrEqual(17);
    const issues = rigIssues(lake, { id: 'x', rodId: 'rod-m', line: { type: 'mono', testLb: 14 }, lureId: 'frog', colorId: 'blackBlue' })
      .map((i) => i.text)
      .join(' ');
    expect(issues).toMatch(/H rod/);
    expect(issues).toMatch(/braid/);
  });

  it('a weedless bait pitched into a dock lands in the cover; a tube crashes and spooks the fish', () => {
    const dock = cellOf('dock');
    const land = (lureId: string) => {
      const s = rigged(lureId);
      s.boat.pos = { x: dock.x - 15, y: dock.y };
      // Away from the population slice the first step updates (its wander would move the fish).
      const f = s.fish[700];
      f.pos = { x: dock.x + 1, y: dock.y };
      s.phase = 'Cast';
      s.cast = { ...newCastState(s), flying: true, flightDuration: 0.01, origin: { ...s.boat.pos }, target: { ...dock }, lurePos: { ...dock } };
      const ev = step(s);
      return { s, f, ev };
    };
    const weedless = land('texasRig');
    expect(weedless.ev.some((e) => e.type === 'crash')).toBe(false);
    expect(weedless.s.phase).toBe('Present');
    expect(weedless.s.present!.edgeCast).toBe(true);
    expect(weedless.f.spookUntil).toBeLessThanOrEqual(weedless.s.clockMin);
    const tube = land('tube');
    expect(tube.ev.some((e) => e.type === 'crash')).toBe(true);
    expect(tube.f.spookUntil).toBeGreaterThan(tube.s.clockMin);
  });

  it('the advisor does not discount weedless baits for cover crashes', () => {
    const dock = cellOf('dock');
    const c = rigged('texasRig').conditions;
    const rig = { lureId: 'texasRig', colorId: 'greenPumpkin', line: { type: 'fluoro' as const, testLb: 15 } };
    const weedless = bitesPerDayAt(lake, c, 570, rig, dock);
    const saved = LURES.texasRig.weedless;
    try {
      delete LURES.texasRig.weedless;
      expect(weedless).toBeGreaterThan(bitesPerDayAt(lake, c, 570, rig, dock));
    } finally {
      LURES.texasRig.weedless = saved;
    }
  });
});

describe('hookset', () => {
  afterEach(() => inputHub.reset());

  it('setting before the fish has it misses (too early), and the cast goes on', () => {
    const { s, f } = striking('tube');
    step(s, {}, 10); // the fish is still closing on the bait
    const ev = step(s, { hookSet: true });
    const miss = ev.find((e) => e.type === 'missed');
    expect(miss?.data?.miss).toBe('early');
    expect(s.phase).toBe('Present');
    expect(s.present!.strikingFishId).toBeNull();
    expect(f.spookUntil).toBeGreaterThan(s.clockMin);
    expect(s.stats.missed).toBe(1);
  });

  it('on topwater the blow-up comes before the fish has it: setting on the blow-up is too early', () => {
    const { s } = striking('walker', { type: 'mono', testLb: 14 });
    const reach = TUNING.attraction.strikeChargeSec;
    expect(biteAtSec(LURES.walker)).toBeGreaterThan(reach);
    stepUntil(s, reach + 0.05); // the blow-up
    const ev = step(s, { hookSet: true });
    const miss = ev.find((e) => e.type === 'missed');
    expect(miss?.data).toMatchObject({ miss: 'early', topwater: true });
    expect(missTip('early', true, s.deck[0]).title).toMatch(/weight on topwater/);
  });

  it('waiting past the window lets the fish spit the bait (too late)', () => {
    const { s } = striking('squarebill');
    const ev = step(s, {}, Math.ceil((biteAtSec(LURES.squarebill) + hookWindowSec(LURES.squarebill) + 0.1) / DT));
    expect(ev.some((e) => e.type === 'bite')).toBe(true);
    expect(ev.find((e) => e.type === 'missed')?.data?.miss).toBe('late');
    expect(s.phase).toBe('Present');
    // Soft plastics are held longer than hard baits.
    expect(hookWindowSec(LURES.tube)).toBeGreaterThan(hookWindowSec(LURES.squarebill));
  });

  it('a set on the thump hooks the fish (most of the time) and starts the fight', () => {
    let hooked = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { s } = striking('squarebill', { type: 'fluoro', testLb: 12 }, seed);
      stepUntil(s, biteAtSec(LURES.squarebill) + 0.25);
      const ev = step(s, { hookSet: true });
      const miss = ev.find((e) => e.type === 'missed');
      if (miss) expect(miss.data?.miss).toBe('noHook');
      else {
        expect(s.phase).toBe('Fight');
        hooked++;
      }
    }
    expect(hooked).toBeGreaterThanOrEqual(16);
  });

  it('auto hookset (Settings) sets it for you once the fish has it', () => {
    let hooked = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { s } = striking('tube', { type: 'fluoro', testLb: 10 }, seed);
      s.autoHookset = true;
      const ev = step(s, {}, 120);
      expect(ev.some((e) => e.type === 'missed' && e.data?.miss !== 'noHook')).toBe(false);
      if (s.phase === 'Fight') hooked++;
    }
    expect(hooked).toBeGreaterThanOrEqual(8);
  });

  it('hook-up odds: stretchy line on a long cast, braid with trebles, and light rods all cost a little', () => {
    const { tube, squarebill, flipJig } = LURES;
    const h = RODS['rod-h'];
    const braid: Line = { type: 'braid', testLb: 30 };
    const mono: Line = { type: 'mono', testLb: 14 };
    expect(hookUpChance(tube, h, mono, 25)).toBeLessThan(hookUpChance(tube, h, mono, 5));
    expect(hookUpChance(tube, h, mono, 25)).toBeLessThan(hookUpChance(tube, h, braid, 25));
    expect(hookUpChance(tube, h, mono, 25)).toBeGreaterThan(0.75); // modest
    expect(hookUpChance(squarebill, h, braid, 25)).toBeLessThan(hookUpChance(squarebill, h, mono, 25));
    expect(hookUpChance(flipJig, RODS['rod-m'], braid, 10)).toBeLessThan(hookUpChance(flipJig, RODS['rod-xh'], braid, 10));
  });

  it('H sets the hook from the keyboard', () => {
    const listeners: Record<string, (e: unknown) => void> = {};
    const detach = inputHub.attachKeyboard({ addEventListener: (t: string, fn: (e: unknown) => void) => (listeners[t] = fn), removeEventListener: () => {} } as unknown as Window);
    listeners.keydown({ key: 'h', repeat: false, preventDefault() {} });
    expect(inputHub.frame('Present').hookSet).toBe(true);
    expect(inputHub.frame('Present').hookSet).toBe(false);
    detach();
  });
});

describe('drop shot', () => {
  const dropShot = () => {
    const s = rigged('dropShot', { type: 'fluoro', testLb: 8 }, 'rod-ml');
    const at = openWater(s);
    s.phase = 'Present';
    s.present = newPresentState(at, false);
    return { s, at };
  };

  it('rides its leader above the bottom', () => {
    const { s, at } = dropShot();
    step(s, {}, 300);
    expect(s.present!.onBottom).toBe(true);
    expect(s.present!.lureDepthFt).toBeCloseTo(depthAt(grid, at.x, at.y) - TUNING.lure.dropShotLeaderFt, 1);
  });

  it('thumbing the spool on the fall holds it at a suspended depth, where shaking still works', () => {
    const { s, at } = dropShot();
    step(s, {}, 30);
    const p = s.present!;
    expect(p.onBottom).toBe(false);
    step(s, { brake: true });
    step(s); // released: the hold latches
    const held = p.lureDepthFt;
    expect(p.held).toBe(true);
    expect(held).toBeLessThan(depthAt(grid, at.x, at.y) - 5);
    for (let i = 0; i < 6; i++) {
      step(s, { twitch: true });
      step(s, {}, 50);
    }
    expect(Math.abs(p.lureDepthFt - held)).toBeLessThan(0.01);
    expect(p.match).toBeGreaterThan(0.9);
  });

  it('dwell: a fish near a bait shaken in place gets interested where a passing look would not', () => {
    const run = (cap: number) => {
      const A = TUNING.attraction as { dwellCap: number };
      const saved = A.dwellCap;
      A.dwellCap = cap;
      try {
        const { s, at } = dropShot();
        step(s, {}, 300); // settle on the bottom
        const p = s.present!;
        const range = detectRange(LURES.dropShot, secchiAt(grid, at.x, at.y), lightLevel(s.clockMin, s.conditions.weather));
        const f = s.fish[0];
        f.spookUntil = 0;
        f.vulnerability = 1;
        // Hold its station (ignore its home-range wander) a little off the bait, at its depth.
        const pin = () => {
          f.pos = { x: at.x, y: at.y + range * 0.75 };
          f.depthFt = p.lureDepthFt;
        };
        let peak = 0;
        for (let i = 0; i < 12 && s.present; i++) {
          pin();
          step(s, { twitch: true });
          for (let j = 0; j < 50; j++) {
            pin();
            step(s);
          }
          peak = Math.max(peak, f.interest);
        }
        return { peak, dwell: p.dwell?.[0] ?? 0 };
      } finally {
        A.dwellCap = saved;
      }
    };
    const with_ = run(TUNING.attraction.dwellCap);
    const without = run(0);
    expect(with_.dwell).toBeGreaterThan(1);
    expect(with_.peak).toBeGreaterThan(without.peak * 1.5);
    expect(with_.peak).toBeGreaterThanOrEqual(TUNING.attraction.followAt);
  });
});

describe('grass', () => {
  it('a lipless crank fouls in the grass canopy and a rip frees it with a reaction spike', () => {
    const g = cellOf('grass', 6);
    const s = rigged('lipless');
    s.boat.pos = { x: g.x - 15, y: g.y };
    s.phase = 'Present';
    s.present = newPresentState(g, false);
    const p = s.present;
    p.lureDepthFt = depthAt(grid, g.x, g.y) - 1;
    const ev = step(s, { reel: true }, 30);
    expect(ev.some((e) => e.type === 'fouled')).toBe(true);
    expect(p.fouled).toBe(true);
    const f = s.fish.find((x) => !x.caught)!;
    f.pos = { ...p.lurePos };
    f.spookUntil = 0;
    f.interest = 0;
    step(s, { reel: true, twitch: true });
    expect(p.fouled).toBe(false);
    expect(f.interest).toBeGreaterThan(0.5);
  });

  it('weedless and single-hook baits come through the grass clean', () => {
    const g = cellOf('grass', 6);
    for (const id of ['spinnerbait', 'chatterbait']) {
      const s = rigged(id);
      s.boat.pos = { x: g.x - 15, y: g.y };
      s.phase = 'Present';
      s.present = newPresentState(g, false);
      s.present.lureDepthFt = depthAt(grid, g.x, g.y) - 1;
      expect(step(s, { reel: true }, 30).some((e) => e.type === 'fouled')).toBe(false);
    }
  });
});
