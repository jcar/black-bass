import type { Line, LineType, RodPower } from '../sim/types';

export interface RodDef {
  id: string;
  name: string;
  power: RodPower;
  /** Lure weight range (oz) the rod casts well. Power letters vary by brand, so this is what matters. */
  lureOz: [number, number];
  reel: 'spinning' | 'casting';
  price: number;
}

export const RODS: Record<string, RodDef> = {
  'rod-ml': { id: 'rod-ml', name: "7'0\" ML Spinning", power: 'ML', lureOz: [0.06, 0.5], reel: 'spinning', price: 150 },
  'rod-m': { id: 'rod-m', name: "7'0\" M Casting", power: 'M', lureOz: [0.25, 0.75], reel: 'casting', price: 180 },
  'rod-mh': { id: 'rod-mh', name: "7'3\" MH Casting", power: 'MH', lureOz: [0.375, 1.25], reel: 'casting', price: 220 },
  'rod-h': { id: 'rod-h', name: "7'6\" H Casting", power: 'H', lureOz: [0.5, 2], reel: 'casting', price: 260 },
  'rod-xh': { id: 'rod-xh', name: "7'11\" XH Flipping", power: 'XH', lureOz: [1, 3], reel: 'casting', price: 320 },
};

/** Line is cheap: any listed spool can be put on any rod for free. */
export const LINE_OPTIONS: Record<LineType, number[]> = {
  fluoro: [6, 8, 10, 12, 15, 17, 20],
  mono: [10, 12, 14, 17],
  braid: [15, 20, 30, 50, 65],
};

export const STARTER_RODS = ['rod-ml', 'rod-m', 'rod-mh'];

export const lineLabel = (l: Line) => `${l.testLb} lb ${l.type === 'fluoro' ? 'Fluoro' : l.type === 'mono' ? 'Mono' : 'Braid'}`;
