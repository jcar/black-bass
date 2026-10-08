import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/data/tuning';
import { inputHub } from '../src/game/input';
import { createTournament, stepTournament } from '../src/sim/tournament';
import { emptyInput, type InputFrame } from '../src/sim/types';
import { botDeck } from '../tools/simulate';

const DT = 1 / 60;
const boatAt = () => {
  const t = createTournament({ lakeId: 'champlain', tier: 'Amateur', seed: 5, deck: botDeck() });
  t.phase = 'Navigate';
  return t;
};
const drive = (turn: number, throttle: number): InputFrame => ({ ...emptyInput(), drive: { turn, throttle } });
const keys = () => {
  const l: Record<string, (e: unknown) => void> = {};
  const detach = inputHub.attachKeyboard({ addEventListener: (t: string, fn: (e: unknown) => void) => (l[t] = fn), removeEventListener: () => {} } as unknown as Window);
  inputHub.reset();
  const key = (k: string, down: boolean) => l[down ? 'keydown' : 'keyup']({ key: k, repeat: false, preventDefault() {} });
  return { key, detach };
};

describe("Rock n' Roll Racing steering", () => {
  it('right turns the bow clockwise, even with the boat stopped', () => {
    const t = boatAt();
    const h0 = t.boat.heading;
    for (let i = 0; i < 30; i++) stepTournament(t, drive(1, 0), DT);
    expect(t.boat.speed).toBe(0);
    expect(t.boat.heading - h0).toBeCloseTo(TUNING.boat.turnRate * 0.5, 5);
  });

  it('up goes forward along the bow on the trolling motor; full throttle runs the outboard', () => {
    const t = boatAt();
    const h = t.boat.heading;
    for (let i = 0; i < 240; i++) stepTournament(t, drive(0, TUNING.boat.trollingStickMax * 0.9), DT);
    expect(t.boat.heading).toBe(h);
    expect(t.boat.motor).toBe('trolling');
    expect(t.boat.speed).toBeGreaterThan(0);
    const u = boatAt();
    for (let i = 0; i < 240; i++) stepTournament(u, drive(0, 1), DT);
    expect(u.boat.motor).toBe('outboard');
  });

  it('down brakes harder than coasting', () => {
    const run = (throttle: number) => {
      const t = boatAt();
      for (let i = 0; i < 120; i++) stepTournament(t, drive(0, 1), DT);
      for (let i = 0; i < 30; i++) stepTournament(t, drive(0, throttle), DT);
      return t.boat.speed;
    };
    expect(run(-1)).toBeLessThan(run(0));
  });

  it('keyboard: arrows drive tank-style in Navigate, Shift opens the outboard; point-to-go is a setting', () => {
    const { key, detach } = keys();
    inputHub.steering = 'tank';
    key('ArrowRight', true);
    key('ArrowUp', true);
    let f = inputHub.frame('Navigate');
    expect(f.drive).toEqual({ turn: 1, throttle: TUNING.boat.trollingStickMax * 0.9 });
    expect(f.stick).toEqual({ x: 0, y: 0 });
    key('Shift', true);
    expect(inputHub.frame('Navigate').drive?.throttle).toBe(1);
    key('Shift', false);
    key('ArrowUp', false);
    key('ArrowRight', false);
    key('ArrowDown', true);
    expect(inputHub.frame('Navigate').drive).toEqual({ turn: 0, throttle: -1 });
    key('ArrowDown', false);
    // Other phases keep the stick (aiming a cast, steering the lure).
    key('d', true);
    f = inputHub.frame('Cast');
    expect(f.drive).toBeUndefined();
    expect(f.stick.x).toBe(1);
    key('d', false);
    inputHub.steering = 'direct';
    key('ArrowUp', true);
    f = inputHub.frame('Navigate');
    expect(f.drive).toBeUndefined();
    expect(f.stick.y).toBeGreaterThan(0);
    key('ArrowUp', false);
    inputHub.steering = 'tank';
    detach();
  });
});
