import type { LureDef } from '../data/lures';
import { TUNING } from '../data/tuning';
import { emptyInput, type GamePhase, type InputFrame } from '../sim/types';

/** Stick magnitude for keyboard steering without Shift: inside the trolling-motor range. */
const KEY_TROLL = TUNING.boat.trollingStickMax * 0.9;

/** Desktop key map, shown in the HUD and README. */
export const KEY_HINTS =
  '←/→ (A/D) turn the boat · ↑ (W) go on the trolling motor, Shift+↑ runs the outboard · ↓ (S) brake (Settings: point-to-go steering) · 1-5 pick a rod (between casts) · M lake map (while driving; 1-9 there pick a PRO stop) · F fish · C cast · Space reel · T twitch/hop/shake · H set the hook · B thumb · V bow · M move/burn in (once fishing) · I data for this point · P pop · K check in (at the launch; twice early in the day) · Esc pause';

/**
 * The rod a digit key picks (0-based), or null: 1 is the first rod on the bar, up to the deck size.
 * The lake map has its own digits (PRO stops) while it's open.
 */
export function rodForKey(key: string, deckSize: number): number | null {
  if (!/^[1-9]$/.test(key)) return null;
  const i = Number(key) - 1;
  return i < deckSize ? i : null;
}

/**
 * How to work the lure on the line, by the cadence the attraction model rewards (presentationMatch).
 * Holding REEL steady is right for moving baits and wrong for everything else.
 */
export function retrieveHint(lure: Pick<LureDef, 'motion' | 'style'>, keyboard: boolean): string {
  const k = keyboard;
  const reel = k ? 'Space' : 'REEL';
  const burn = k ? ' · M burn in' : '';
  if (lure.motion === 'swimming') return `Count it down, then hold ${reel} steady${burn}`;
  switch (lure.style) {
    case 'steady':
      return `Hold ${reel} steady, no pumping · ${k ? 'A/D' : 'drag sideways to'} steer${burn}`;
    case 'bottom':
      return `Let it sink to the bottom · short ${reel} pulses to drag · ${k ? 'T' : 'tap to'} hop${burn}`;
    case 'shake':
      return `Drop it on a fish · ${k ? 'B' : 'THUMB'} on the fall stops it at a suspended fish · ${k ? 'T' : 'tap to'} shake it in place${burn}`;
    case 'twitchPause':
      return `${k ? 'T' : 'Tap to'} twitch 1-3 times, then pause: strikes come on the pause${burn}`;
    case 'walk':
      return `${k ? 'T' : 'Tap'} in an even rhythm to walk it${burn}`;
  }
}

/**
 * Shared mutable input state written by touch controls and the keyboard, read once per
 * fixed sim step. Held buttons are levels; taps/flicks are counters consumed as edges.
 */
class InputHub {
  stick = { x: 0, y: 0 };
  /**
   * Keyboard boat steering: 'tank' (Rock n' Roll Racing: left/right turn the bow, up is the gas,
   * down brakes) or 'direct' (the arrows point where you want to go). Touch always uses the stick.
   */
  steering: 'tank' | 'direct' = 'tank';
  private keyStick = { x: 0, y: 0 };
  reel = false;
  brake = false;
  private keysDown = new Set<string>();
  /**
   * Asked before K checks in: false holds the press (the game asks for a second one when there's
   * plenty of day left). Unset (the harness), K checks in straight away.
   */
  confirmCheckIn: (() => boolean) | null = null;
  private pending = { castTap: 0, popTap: 0, bowFlick: 0, twitch: 0, fishHere: 0, moveOn: 0, hookSet: 0, checkIn: 0 };

  tap(kind: keyof InputHub['pending']) {
    this.pending[kind]++;
  }

  /** Consume one frame: edges fire for exactly one sim step. */
  frame(phase?: GamePhase): InputFrame {
    const f = emptyInput();
    // Keyboard driving is the quiet trolling motor; holding Shift opens up the outboard. Other phases
    // (aiming, steering the lure, the fight) get full deflection.
    const km = Math.hypot(this.keyStick.x, this.keyStick.y) || 1;
    const kbMag = phase === 'Navigate' && !this.keysDown.has('shift') ? KEY_TROLL : 1;
    const sx = this.stick.x || (this.keyStick.x / km) * kbMag;
    const sy = this.stick.y || (this.keyStick.y / km) * kbMag;
    const m = Math.hypot(sx, sy);
    f.stick = m > 1 ? { x: sx / m, y: sy / m } : { x: sx, y: sy };
    if (phase === 'Navigate' && this.steering === 'tank' && !this.stick.x && !this.stick.y && (this.keyStick.x || this.keyStick.y)) {
      const up = this.keyStick.y;
      f.drive = { turn: this.keyStick.x, throttle: up > 0 ? (this.keysDown.has('shift') ? 1 : KEY_TROLL) : up < 0 ? -1 : 0 };
      f.stick = { x: 0, y: 0 };
    }
    f.reel = this.reel || this.keysDown.has(' ');
    f.brake = this.brake || this.keysDown.has('b');
    for (const k of Object.keys(this.pending) as (keyof InputHub['pending'])[]) {
      if (this.pending[k] > 0) {
        f[k] = true;
        this.pending[k]--;
      }
    }
    return f;
  }

  reset() {
    this.stick = { x: 0, y: 0 };
    this.keyStick = { x: 0, y: 0 };
    this.reel = false;
    this.brake = false;
    this.keysDown.clear();
    for (const k of Object.keys(this.pending) as (keyof InputHub['pending'])[]) this.pending[k] = 0;
  }

  private updateKeyStick() {
    const k = this.keysDown;
    this.keyStick = {
      x: (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0),
      y: (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0),
    };
  }

  /** Desktop/dev keyboard fallback. Returns a detach function. */
  attachKeyboard(target: Window): () => void {
    const down = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (e.repeat) return;
      this.keysDown.add(key);
      switch (key) {
        case 'enter':
        case 'c':
          this.tap('castTap');
          break;
        // Arrows/WASD only ever steer: twitching or bowing on a steering key wrecked steady retrieves.
        case 't':
          this.tap('twitch');
          break;
        case 'v':
          this.tap('bowFlick');
          break;
        case 'f':
          this.tap('fishHere');
          break;
        case 'm':
          this.tap('moveOn');
          break;
        case 'p':
          this.tap('popTap');
          break;
        // A dedicated hookset key: Space is held to reel, so a press on it can't tell a set from a retrieve.
        case 'h':
          this.tap('hookSet');
          break;
        // Check in at the launch: ends the day (only works there, once check-in opens).
        case 'k':
          if (!this.confirmCheckIn || this.confirmCheckIn()) this.tap('checkIn');
          break;
      }
      this.updateKeyStick();
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      this.keysDown.delete(e.key.toLowerCase());
      this.updateKeyStick();
    };
    const blur = () => this.reset();
    target.addEventListener('keydown', down);
    target.addEventListener('keyup', up);
    target.addEventListener('blur', blur);
    return () => {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
      target.removeEventListener('blur', blur);
    };
  }
}

export const inputHub = new InputHub();
