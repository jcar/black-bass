// Audio: generated music (from the offline pipeline, via Howler) plus small procedural
// WebAudio effects. Google's current generation APIs have no sound-effects model, so SFX are
// synthesised at runtime; any generated SFX file listed in the asset index takes priority.
import { Howl, Howler } from 'howler';
import { assetUrl, musicId } from '../game/assets';
import type { TournamentEvent } from '../sim/types';

let ctx: AudioContext | null = null;
let enabled = true;
let music: Howl | null = null;
const sfxFiles = new Map<string, Howl>();

export function setSoundEnabled(on: boolean) {
  enabled = on;
  Howler.mute(!on);
}

/** iOS only allows audio after a user gesture: call this from the first tap. */
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AC) ctx = new AC();
  }
  void ctx?.resume();
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
  music.fade(0, 0.35, 1200);
}
