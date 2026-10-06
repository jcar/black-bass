import { TUNING } from '../data/tuning';
import { emptyInput, type GamePhase, type InputFrame } from '../sim/types';

/** Stick magnitude for keyboard steering without Shift: inside the trolling-motor range. */
const KEY_TROLL = TUNING.boat.trollingStickMax * 0.9;

/** Desktop key map, shown in the HUD and README. */
export const KEY_HINTS = 'WASD/arrows steer (trolling) · Shift+steer run · F fish · C cast · Space reel · T twitch · B thumb · V bow · M move/burn in · P pop';

/**
 * Shared mutable input state written by touch controls and the keyboard, read once per
 * fixed sim step. Held buttons are levels; taps/flicks are counters consumed as edges.
 */
class InputHub {
  stick = { x: 0, y: 0 };
  private keyStick = { x: 0, y: 0 };
  reel = false;
  brake = false;
  private keysDown = new Set<string>();
  private pending = { castTap: 0, popTap: 0, bowFlick: 0, twitch: 0, fishHere: 0, moveOn: 0 };

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
