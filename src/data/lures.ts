import type { ColorFamily } from '../sim/types';

/** How the lure behaves in the water column. */
export type LureMotion = 'surface' | 'diving' | 'suspending' | 'sinking';
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
  /** Sink rate (sinking lures) in ft/s. 1/16 oz Ned ~0.9, 1/2 oz football jig ~4. */
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
    fallRateFtPerSec: 2.2,
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
    description: 'Bait suspended above a weight. Shake it in place over fish you see on sonar.',
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
    description: 'A vibrating blade on a jig. Rip it through grass in wind and stained water.',
    motion: 'diving',
    style: 'steady',
    weightOz: 0.375,
    runDepthFt: 6,
    fallRateFtPerSec: 0,
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
};

export const STARTER_LURES: { lureId: string; colorId: string }[] = [
  { lureId: 'ned', colorId: 'greenPumpkin' },
  { lureId: 'tube', colorId: 'greenPumpkin' },
  { lureId: 'squarebill', colorId: 'sexyShad' },
  { lureId: 'walker', colorId: 'bone' },
];

export const lureKey = (lureId: string, colorId: string) => `${lureId}:${colorId}`;
