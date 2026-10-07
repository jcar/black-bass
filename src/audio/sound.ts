// Audio: generated music (from the offline pipeline, via Howler) plus small procedural
// WebAudio effects. Google's generation APIs have no sound-effects model, so in-game SFX are
// synthesised at runtime; UI cues and stings are short musical hits generated with Lyria.
// Any generated file listed in the asset index takes priority over the synth fallback.
import { Howl, Howler } from 'howler';
import { assetUrl, musicId } from '../game/assets';
import type { TournamentEvent } from '../sim/types';

let ctx: AudioContext | null = null;
let enabled = true;
let music: Howl | null = null;
const sfxFiles = new Map<string, Howl>();

export function setSoundEnabled(on: boolean) {
  const was = enabled;
  enabled = on;
  Howler.mute(!on);
  // Music is skipped entirely while muted, so start the current track when sound comes back.
  if (on && !was && !music && musicName) {
    const name = musicName;
    musicName = '';
    playMusic(name);
  }
}

/** iOS only allows audio after a user gesture: call this from the first tap. */
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AC) ctx = new AC();
  }
  void ctx?.resume();
}

// iOS suspends ("interrupts") the context when the app is backgrounded; resume on return and on
// the next touch, not just the first one.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void ctx?.resume());
  document.addEventListener('pointerdown', () => ctx && ctx.state !== 'running' && void ctx.resume(), { passive: true });
}

function noiseBurst(dur: number, freq: number, q: number, gain: number, sweepTo?: number) {
  if (!ctx || !enabled) return;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + dur);
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(ctx.destination);
  src.start();
}

function tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', slideTo?: number) {
  if (!ctx || !enabled) return;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + dur);
}

const SYNTH: Partial<Record<TournamentEvent['type'], () => void>> = {
  splash: () => noiseBurst(0.35, 900, 0.8, 0.5, 300),
  edge: () => {
    noiseBurst(0.35, 900, 0.8, 0.5, 300);
    tone(880, 0.15, 0.08, 'triangle');
  },
  crash: () => {
    noiseBurst(0.2, 400, 2, 0.6);
    tone(140, 0.25, 0.2, 'square', 70);
  },
  strike: () => {
    noiseBurst(0.5, 600, 0.6, 0.8, 200);
    tone(90, 0.3, 0.35, 'sine', 50);
  },
  hooked: () => tone(520, 0.12, 0.1, 'triangle', 780),
  jump: () => noiseBurst(0.7, 1200, 0.5, 0.7, 250),
  snap: () => {
    tone(1800, 0.08, 0.2, 'square', 400);
    noiseBurst(0.15, 3000, 3, 0.3);
  },
  thrown: () => tone(400, 0.3, 0.12, 'sawtooth', 120),
  landed: () => {
    tone(660, 0.12, 0.1, 'triangle');
    setTimeout(() => tone(990, 0.2, 0.1, 'triangle'), 110);
  },
  cullNeeded: () => tone(500, 0.2, 0.1, 'triangle', 700),
  timeWarning: () => {
    tone(740, 0.2, 0.12, 'square');
    setTimeout(() => tone(740, 0.2, 0.12, 'square'), 260);
  },
  dayOver: () => tone(392, 0.6, 0.12, 'triangle', 523),
  shore: () => noiseBurst(0.25, 300, 1, 0.4),
  // Hull on the bank: a low thump plus a gravelly scrape.
  bank: () => {
    tone(85, 0.3, 0.35, 'sine', 45);
    noiseBurst(0.3, 220, 0.9, 0.55, 120);
  },
  popped: () => noiseBurst(0.3, 800, 1, 0.4, 1600),
};

export function playEvent(type: TournamentEvent['type']) {
  if (!enabled) return;
  const file = assetUrl(`sfx_${type}`);
  if (file) {
    let h = sfxFiles.get(type);
    if (!h) {
      h = new Howl({ src: [file], volume: 0.8 });
      sfxFiles.set(type, h);
    }
    h.play();
    return;
  }
  SYNTH[type]?.();
}

/** Continuous drag/reel sound driven by fight tension (called every frame during fights). */
let dragNext = 0;
export function dragTick(tension: number, reeling: boolean, now: number) {
  if (!ctx || !enabled || now < dragNext) return;
  if (reeling) {
    tone(2200 + tension * 1200, 0.025, 0.03, 'square');
    dragNext = now + 0.07;
  } else if (tension > 0.25) {
    noiseBurst(0.04, 3500, 4, 0.08 + tension * 0.1);
    dragNext = now + 0.05;
  }
}

// ---------- UI cues and stings ----------
export type UiCue = 'tap' | 'back' | 'confirm' | 'buy' | 'open' | 'tick' | 'hotseat' | 'hold' | 'promote' | 'record' | 'build';
const STINGS = new Set<UiCue>(['hotseat', 'hold', 'promote', 'record', 'build']);

const UI_SYNTH: Record<UiCue, () => void> = {
  tap: () => tone(1320, 0.05, 0.05, 'triangle'),
  back: () => tone(520, 0.08, 0.06, 'triangle', 390),
  confirm: () => {
    tone(784, 0.08, 0.06, 'triangle');
    setTimeout(() => tone(1175, 0.12, 0.06, 'triangle'), 70);
  },
  buy: () => {
    tone(988, 0.1, 0.06, 'triangle');
    setTimeout(() => tone(1319, 0.18, 0.06, 'triangle'), 80);
  },
  open: () => tone(660, 0.09, 0.04, 'sine', 990),
  tick: () => noiseBurst(0.03, 4000, 6, 0.12),
  hotseat: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.4, 0.08, 'triangle'), i * 90)),
  hold: () => tone(330, 0.6, 0.08, 'triangle', 311),
  promote: () => [392, 523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.5, 0.08, 'triangle'), i * 110)),
  record: () => [1047, 1319, 1568].forEach((f, i) => setTimeout(() => tone(f, 0.35, 0.05, 'sine'), i * 70)),
  build: () => tone(220, 1.6, 0.06, 'sawtooth', 440),
};

const uiFiles = new Map<UiCue, Howl | null>();
function uiHowl(cue: UiCue): Howl | null {
  if (uiFiles.has(cue)) return uiFiles.get(cue)!;
  const url = assetUrl(STINGS.has(cue) ? `sting_${cue}` : `sfx_ui_${cue}`);
  const h = url ? new Howl({ src: [url], volume: STINGS.has(cue) ? 0.75 : 0.45 }) : null;
  uiFiles.set(cue, h);
  return h;
}

/** Menu/UI feedback. Stings briefly duck the music so they read like a broadcast cue. */
export function playUi(cue: UiCue) {
  if (!enabled) return;
  if (STINGS.has(cue)) duckMusic(cue === 'build' ? 2600 : 2200);
  const h = uiHowl(cue);
  if (h) {
    if (cue === 'build') h.stop();
    h.play();
    return;
  }
  UI_SYNTH[cue]();
}

/** Preload UI cues so the first tap isn't silent while the file decodes. */
export function preloadUi() {
  (Object.keys(UI_SYNTH) as UiCue[]).forEach(uiHowl);
}

export function stopUi(cue: UiCue) {
  uiFiles.get(cue)?.stop();
}

const MUSIC_VOL = 0.35;
let duckTimer: ReturnType<typeof setTimeout> | undefined;
function duckMusic(ms: number) {
  if (!music) return;
  music.fade(music.volume(), MUSIC_VOL * 0.3, 150);
  clearTimeout(duckTimer);
  duckTimer = setTimeout(() => music?.fade(music.volume(), MUSIC_VOL, 600), ms);
}

let musicName = '';
export function playMusic(name: string) {
  if (name === musicName) return;
  musicName = name;
  const url = assetUrl(musicId(name));
  if (music) {
    music.fade(music.volume(), 0, 600);
    const old = music;
    setTimeout(() => old.unload(), 700);
    music = null;
  }
  if (!url || !enabled) return;
  music = new Howl({ src: [url], loop: true, volume: 0, html5: false });
  music.play();
  music.fade(0, MUSIC_VOL, 1200);
}
