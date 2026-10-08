import type { ColorFamily, RodPower } from '../sim/types';
import { TUNING } from './tuning';

/** How the lure behaves in the water column. */
/** 'swimming': sinks on a slack line and holds depth while reeled (bladed and swim jigs). */
export type LureMotion = 'surface' | 'diving' | 'suspending' | 'sinking' | 'swimming';
/** Which cadence the attraction model rewards. */
export type LureStyle = 'walk' | 'steady' | 'twitchPause' | 'bottom' | 'shake';

export interface LureDef {
  id: string;
  name: string;
  short: string;
  description: string;
  motion: LureMotion;
  style: LureStyle;
  weightOz: number;
  /** Max running depth (diving/suspending) in ft. */
  runDepthFt: number;
  /**
   * Sink rate (sinking lures) in ft/s. 1/16 oz Ned ~0.9 (the buoyant stick slows it), 1/8 oz Ned ~1.3
   * (sink speed scales ~ sqrt of weight), 1/2 oz football jig ~4.
   */
  fallRateFtPerSec: number;
  /** Reel-in speed while REEL is held (m/s). 1 mph ~ 0.45 m/s. */
  retrieveSpeed: number;
  /** Speed band (m/s) the fish respond to best for steady-style lures. */
  speedBand: [number, number];
  /** 0..1 vibration/displacement; drives detection in dirty water. */
  vibration: number;
  treble: boolean;
  /** Water temperature range (F) where the lure shines, with soft falloff outside. */
  tempRangeF: [number, number];
  /** Walking rhythm (twitches per second) for 'walk' style. */
  rhythmHz?: number;
  /**
   * Hook guarded or buried in the plastic. 'full': pitch it into docks, wood and grass without a crash
   * (it lands in the cover, beside the fish). 'partial': comes through grass, and slides off docks and
   * wood more often than not (TUNING.cast.partialWeedlessCrash).
   */
  weedless?: 'full' | 'partial';
  /** The bait rides this far (ft) above the weight on the bottom (drop shot, Carolina rig). */
  leaderFt?: number;
  /** Big-fish bait: fit x (length / lake median)^(3 x lean). Bigger fish eat it; small ones less. */
  bigFishLean?: number;
  /** Lightest rod power that drives its hook (heavy weedless baits); lighter rods hook fewer fish. */
  rodPower?: RodPower;
  /** Hook-up odds relative to an ordinary bait (hollow frogs are notorious for misses). */
  hookRate?: number;
  /** Lipless crankbaits: ripping one free of the grass is the strike trigger. */
  ripsGrass?: boolean;
  price: number;
  colors: string[];
}

export interface ColorDef {
  id: string;
  name: string;
  family: ColorFamily;
  hex: string;
}

export const COLORS: Record<string, ColorDef> = {
  greenPumpkin: { id: 'greenPumpkin', name: 'Green Pumpkin', family: 'natural', hex: '#5b5a2e' },
  ghostMinnow: { id: 'ghostMinnow', name: 'Ghost Minnow', family: 'natural', hex: '#c9d6d2' },
  smoke: { id: 'smoke', name: 'Smoke Pepper', family: 'natural', hex: '#8a8a80' },
  sexyShad: { id: 'sexyShad', name: 'Sexy Shad', family: 'natural', hex: '#b9c3c9' },
  bone: { id: 'bone', name: 'Bone', family: 'natural', hex: '#e8e0c8' },
  chartreuse: { id: 'chartreuse', name: 'Chartreuse', family: 'bright', hex: '#c6e63a' },
  white: { id: 'white', name: 'White', family: 'bright', hex: '#f4f4f0' },
  blackBlue: { id: 'blackBlue', name: 'Black & Blue', family: 'dark', hex: '#1d2350' },
  redCraw: { id: 'redCraw', name: 'Red Craw', family: 'red', hex: '#b5372a' },
};

export const LURES: Record<string, LureDef> = {
  ned: {
    id: 'ned',
    name: 'Ned Rig',
    short: 'NED',
    description: 'Finesse stick on a mushroom head. Drag it slowly along the bottom with an occasional hop.',
    motion: 'sinking',
    style: 'bottom',
    weightOz: 0.125,
    runDepthFt: 0,
    fallRateFtPerSec: 1.3,
    retrieveSpeed: 0.28,
    speedBand: [0.05, 0.35],
    vibration: 0.05,
    treble: false,
    tempRangeF: [38, 90],
    price: 6,
    colors: ['greenPumpkin', 'smoke', 'blackBlue'],
  },
  dropShot: {
    id: 'dropShot',
    name: 'Drop Shot',
    short: 'DROP',
    description: 'A bait tied above a weight. Drop it on fish you see on sonar and shake it in place; thumb the spool on the fall to stop it at a suspended fish.',
    motion: 'sinking',
    style: 'shake',
    weightOz: 0.25,
    runDepthFt: 0,
    fallRateFtPerSec: 3,
    retrieveSpeed: 0.2,
    speedBand: [0, 0.15],
    vibration: 0.05,
    treble: false,
    tempRangeF: [38, 90],
    leaderFt: TUNING.lure.dropShotLeaderFt,
    price: 7,
    colors: ['smoke', 'ghostMinnow', 'greenPumpkin'],
  },
  tube: {
    id: 'tube',
    name: 'Tube',
    short: 'TUBE',
    description: 'A smallmouth classic. Hop and drag it across rock; it spirals on the fall.',
    motion: 'sinking',
    style: 'bottom',
    weightOz: 0.375,
    runDepthFt: 0,
    fallRateFtPerSec: 2.6,
    retrieveSpeed: 0.32,
    speedBand: [0.05, 0.4],
    vibration: 0.1,
    treble: false,
    tempRangeF: [42, 85],
    price: 7,
    colors: ['greenPumpkin', 'smoke', 'redCraw'],
  },
  jerkbait: {
    id: 'jerkbait',
    name: 'Suspending Jerkbait',
    short: 'JERK',
    description: 'Twitch-twitch-pause. It hangs at depth on the pause, so lengthen the pause in cold water.',
    motion: 'suspending',
    style: 'twitchPause',
    weightOz: 0.4,
    runDepthFt: 6,
    fallRateFtPerSec: 0,
    retrieveSpeed: 0.8,
    speedBand: [0.3, 1.0],
    vibration: 0.35,
    treble: true,
    tempRangeF: [38, 70],
    price: 18,
    colors: ['ghostMinnow', 'sexyShad', 'chartreuse'],
  },
  squarebill: {
    id: 'squarebill',
    name: 'Squarebill Crankbait',
    short: 'SQBL',
    description: 'Dives 1-4 ft. Grind it steadily and bounce it off rock or wood to trigger reaction strikes.',
    motion: 'diving',
    style: 'steady',
    weightOz: 0.375,
    runDepthFt: 3.5,
    fallRateFtPerSec: 0,
    retrieveSpeed: 1.0,
    speedBand: [0.6, 1.3],
    vibration: 0.8,
    treble: true,
    tempRangeF: [50, 88],
    price: 12,
    colors: ['sexyShad', 'chartreuse', 'redCraw'],
  },
  walker: {
    id: 'walker',
    name: 'Walking Topwater',
    short: 'WALK',
    description: 'Walk-the-dog with a steady rhythm of twitches. Deadly at dawn, dusk and on cloudy days.',
    motion: 'surface',
    style: 'walk',
    weightOz: 0.75,
    runDepthFt: 0,
    fallRateFtPerSec: 0,
    retrieveSpeed: 0.55,
    speedBand: [0.25, 0.8],
    vibration: 0.6,
    treble: true,
    tempRangeF: [60, 92],
    rhythmHz: 2,
    price: 16,
    colors: ['bone', 'sexyShad', 'blackBlue'],
  },
  chatterbait: {
    id: 'chatterbait',
    name: 'Bladed Jig',
    short: 'CHAT',
    description: 'A bladed jig: count it down on a slack line, then reel steadily. The blade thumps; bump it through grass and wood.',
    motion: 'swimming',
    style: 'steady',
    weightOz: 0.375,
    runDepthFt: 6,
    fallRateFtPerSec: 1.6,
    retrieveSpeed: 1.1,
    speedBand: [0.7, 1.6],
    vibration: 1,
    treble: false,
    tempRangeF: [45, 90],
    price: 15,
    colors: ['white', 'chartreuse', 'blackBlue', 'greenPumpkin'],
  },
  footballJig: {
    id: 'footballJig',
    name: 'Tungsten Football Jig',
    short: 'JIG',
    description: 'Heavy and compact. Drag it across deep rock in summer and on bright days.',
    motion: 'sinking',
    style: 'bottom',
    weightOz: 0.5,
    runDepthFt: 0,
    fallRateFtPerSec: 4,
    retrieveSpeed: 0.35,
    speedBand: [0.05, 0.4],
    vibration: 0.2,
    treble: false,
    tempRangeF: [45, 90],
    price: 14,
    colors: ['greenPumpkin', 'blackBlue', 'redCraw'],
  },
  texasRig: {
    id: 'texasRig',
    name: 'Texas Rig',
    short: 'TEX',
    description: 'A soft-plastic worm on a pegged bullet weight with the hook point buried: weedless. Pitch it into docks, wood and grass, let it fall, then crawl and hop it out.',
    motion: 'sinking',
    style: 'bottom',
    weightOz: 0.375,
    runDepthFt: 0,
    fallRateFtPerSec: 3.2,
    retrieveSpeed: 0.3,
    speedBand: [0.05, 0.4],
    vibration: 0.15,
    treble: false,
    tempRangeF: [50, 92],
    weedless: 'full',
    rodPower: 'MH',
    price: 6,
    colors: ['greenPumpkin', 'blackBlue', 'redCraw'],
  },
  flipJig: {
    id: 'flipJig',
    name: 'Flipping Jig',
    short: 'FLIP',
    description: 'A heavy weedless jig with a craw trailer for flipping docks, laydowns and matted grass. Drop it in the cover, hop it once or twice, and set hard: a big-fish bait. Wants an XH flipping stick and heavy line.',
    motion: 'sinking',
    style: 'bottom',
    weightOz: 0.75,
    runDepthFt: 0,
    fallRateFtPerSec: 4.5,
    retrieveSpeed: 0.3,
    speedBand: [0.05, 0.35],
    vibration: 0.25,
    treble: false,
    tempRangeF: [48, 90],
    weedless: 'full',
    bigFishLean: 0.25,
    rodPower: 'XH',
    price: 9,
    colors: ['blackBlue', 'greenPumpkin', 'redCraw'],
  },
  spinnerbait: {
    id: 'spinnerbait',
    name: 'Spinnerbait',
    short: 'SPIN',
    description: 'Blades that flash and thump on a safety-pin wire that shields the hook: it comes through grass and bumps off wood. Count it down, then reel steadily. Best in wind and stained water.',
    motion: 'swimming',
    style: 'steady',
    weightOz: 0.5,
    runDepthFt: 6,
    fallRateFtPerSec: 1.4,
    retrieveSpeed: 1.0,
    speedBand: [0.5, 1.4],
    vibration: 0.8,
    treble: false,
    tempRangeF: [45, 85],
    weedless: 'partial',
    price: 9,
    colors: ['white', 'chartreuse', 'sexyShad'],
  },
  frog: {
    id: 'frog',
    name: 'Hollow Frog',
    short: 'FROG',
    description: 'A hollow-bodied frog with the hooks tucked against it: walk it over grass, pads and wood without hanging up. Big fish blow up on it. Wait to feel the weight before you set, on braid and a heavy rod.',
    motion: 'surface',
    style: 'walk',
    weightOz: 0.625,
    runDepthFt: 0,
    fallRateFtPerSec: 0,
    retrieveSpeed: 0.5,
    speedBand: [0.2, 0.7],
    vibration: 0.45,
    treble: false,
    tempRangeF: [62, 92],
    rhythmHz: 2,
    weedless: 'full',
    bigFishLean: 0.3,
    rodPower: 'H',
    hookRate: 0.85,
    price: 12,
    colors: ['blackBlue', 'white', 'greenPumpkin'],
  },
  lipless: {
    id: 'lipless',
    name: 'Lipless Crankbait',
    short: 'LIP',
    description: 'A rattling lipless crank that sinks: count it to the grass tops and reel steadily. When it ticks into the grass, rip it free: that is when they hit. A cold-water and fall favourite.',
    motion: 'swimming',
    style: 'steady',
    weightOz: 0.5,
    runDepthFt: 8,
    fallRateFtPerSec: 2.5,
    retrieveSpeed: 1.1,
    speedBand: [0.6, 1.5],
    vibration: 0.9,
    treble: true,
    tempRangeF: [42, 80],
    ripsGrass: true,
    price: 10,
    colors: ['redCraw', 'chartreuse', 'sexyShad'],
  },
  deepCrank: {
    id: 'deepCrank',
    name: 'Deep Crankbait',
    short: 'DEEP',
    description: 'A big-billed crankbait that dives to about 14 ft. Long casts and a steady retrieve; dig it into deep rock and ledges in summer. Lighter line runs it deeper.',
    motion: 'diving',
    style: 'steady',
    weightOz: 0.625,
    runDepthFt: 14,
    fallRateFtPerSec: 0,
    retrieveSpeed: 1.0,
    speedBand: [0.5, 1.2],
    vibration: 0.75,
    treble: true,
    tempRangeF: [55, 88],
    price: 14,
    colors: ['sexyShad', 'chartreuse', 'redCraw'],
  },
  swimbait: {
    id: 'swimbait',
    name: 'Swimbait',
    short: 'SWIM',
    description: 'A big paddle-tail swimbait on a weighted hook. Count it down and swim it slowly: fewer bites, bigger fish. Throw it on an H rod.',
    motion: 'swimming',
    style: 'steady',
    weightOz: 1.5,
    runDepthFt: 8,
    fallRateFtPerSec: 1.8,
    retrieveSpeed: 0.8,
    speedBand: [0.4, 1.0],
    vibration: 0.5,
    treble: false,
    tempRangeF: [50, 85],
    bigFishLean: 0.5,
    rodPower: 'H',
    price: 15,
    colors: ['ghostMinnow', 'sexyShad', 'white'],
  },
  carolinaRig: {
    id: 'carolinaRig',
    name: 'Carolina Rig',
    short: 'CRIG',
    description: 'A heavy egg sinker and glass bead ahead of a leader and floating soft plastic. Drag it slowly across offshore flats, points and humps to cover water along the bottom.',
    motion: 'sinking',
    style: 'bottom',
    weightOz: 0.75,
    runDepthFt: 0,
    fallRateFtPerSec: 4.5,
    retrieveSpeed: 0.4,
    speedBand: [0.1, 0.5],
    vibration: 0.2,
    treble: false,
    tempRangeF: [45, 92],
    leaderFt: TUNING.lure.carolinaLeaderFt,
    rodPower: 'MH',
    price: 8,
    colors: ['greenPumpkin', 'smoke', 'redCraw'],
  },
};

export const STARTER_LURES: { lureId: string; colorId: string }[] = [
  { lureId: 'ned', colorId: 'greenPumpkin' },
  { lureId: 'tube', colorId: 'greenPumpkin' },
  { lureId: 'squarebill', colorId: 'sexyShad' },
  { lureId: 'walker', colorId: 'bone' },
];

export const lureKey = (lureId: string, colorId: string) => `${lureId}:${colorId}`;
