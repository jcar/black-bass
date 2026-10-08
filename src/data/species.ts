import type { CoverType, Season, SpeciesId } from '../sim/types';

export interface SpeciesDef {
  id: SpeciesId;
  name: string;
  isBass: boolean;
  /** Standard-weight curve: log10 W(lb) = a + b*log10 L(in). */
  ws: { a: number; b: number };
  /** Preferred water temperature (F) for activity. LMB ~82, SMB 69-79 (In-Fisherman / Bassmaster). */
  tempOptF: number;
  /** Seasonal holding depth ranges (ft). */
  depthBySeason: Record<Season, [number, number]>;
  cover: Partial<Record<CoverType, number>>;
  /** Jump rate per second during a fight (SMB jump repeatedly, LMB rarely). (game) */
  jumpRate: number;
  /** Fight strength multiplier relative to body weight. */
  power: number;
  /** Lure preferences beyond the general model (e.g. pike love jerkbaits). */
  lureAffinity?: Partial<Record<string, number>>;
}

const bassDepths = (shallow: number): Record<Season, [number, number]> => ({
  Prespawn: [4 + shallow, 12 + shallow],
  Spawn: [1 + shallow / 2, 6 + shallow],
  Postspawn: [5 + shallow, 15 + shallow],
  Summer: [8 + shallow, 20 + shallow],
  Fall: [3 + shallow, 12 + shallow],
  Turnover: [5 + shallow, 15 + shallow],
  Winter: [15 + shallow, 30 + shallow],
});

const flat = (r: [number, number]): Record<Season, [number, number]> => ({
  Prespawn: r,
  Spawn: r,
  Postspawn: r,
  Summer: r,
  Fall: r,
  Turnover: r,
  Winter: [r[0] + 4, r[1] + 8],
});

export const SPECIES: Record<SpeciesId, SpeciesDef> = {
  largemouth: {
    id: 'largemouth',
    name: 'Largemouth Bass',
    isBass: true,
    ws: { a: -3.587, b: 3.273 }, // Henson 1991
    tempOptF: 81,
    depthBySeason: bassDepths(0),
    cover: { standing: 1.7, grass: 1.6, dock: 1.5, timber: 1.5, reeds: 1.4, rock: 0.8, none: 0.5 },
    jumpRate: 0.05,
    power: 1.0,
    // Largemouth: the cover and grass fish. Weedless plastics, jigs, frogs and spinnerbaits are their baits.
    lureAffinity: { squarebill: 1.15, chatterbait: 1.2, walker: 1.1, dropShot: 0.85, texasRig: 1.15, flipJig: 1.15, spinnerbait: 1.15, frog: 1.15, swimbait: 0.7 },
  },
  smallmouth: {
    id: 'smallmouth',
    name: 'Smallmouth Bass',
    isBass: true,
    ws: { a: -3.49, b: 3.2 }, // Kolander et al. 1993
    tempOptF: 72,
    depthBySeason: bassDepths(6),
    cover: { rock: 1.8, dock: 0.7, grass: 0.5, timber: 0.6, standing: 0.6, reeds: 0.2, none: 0.7 },
    jumpRate: 0.13,
    power: 1.2,
    // Smallmouth: rock and open-water fish; finesse and deep cranks, rarely in the slop.
    lureAffinity: { tube: 1.2, ned: 1.15, dropShot: 1.2, jerkbait: 1.15, chatterbait: 0.85, deepCrank: 1.1, carolinaRig: 1.05, flipJig: 0.85, frog: 0.6, spinnerbait: 0.9, swimbait: 0.65 },
  },
  spotted: {
    id: 'spotted',
    name: 'Spotted Bass',
    isBass: true,
    ws: { a: -3.53, b: 3.22 }, // between LMB and SMB (game approximation)
    tempOptF: 76,
    depthBySeason: bassDepths(8),
    cover: { rock: 1.6, timber: 1.0, standing: 1.0, dock: 0.8, grass: 0.6, none: 0.8 },
    jumpRate: 0.05,
    power: 1.15,
    lureAffinity: { deepCrank: 1.05, carolinaRig: 1.05, frog: 0.7 },
  },
  pike: {
    id: 'pike',
    name: 'Northern Pike',
    isBass: false,
    ws: { a: -3.98, b: 3.13 },
    tempOptF: 62,
    depthBySeason: flat([5, 15]),
    cover: { grass: 1.8, reeds: 1.0, none: 0.4 },
    jumpRate: 0.02,
    power: 1.1,
    lureAffinity: { jerkbait: 1.4, chatterbait: 1.3, squarebill: 1.1, spinnerbait: 1.4, swimbait: 1.3, lipless: 1.2, frog: 1.1 },
  },
  pickerel: {
    id: 'pickerel',
    name: 'Chain Pickerel',
    isBass: false,
    ws: { a: -3.9, b: 3.1 },
    tempOptF: 68,
    depthBySeason: flat([2, 8]),
    cover: { grass: 1.6, reeds: 1.6, none: 0.3 },
    jumpRate: 0.03,
    power: 0.8,
    lureAffinity: { jerkbait: 1.3, walker: 1.2, chatterbait: 1.2, spinnerbait: 1.3, frog: 1.2, lipless: 1.1 },
  },
  bowfin: {
    id: 'bowfin',
    name: 'Bowfin',
    isBass: false,
    ws: { a: -3.55, b: 3.15 },
    tempOptF: 80,
    depthBySeason: flat([2, 7]),
    cover: { grass: 1.5, reeds: 1.7, standing: 1.0, none: 0.2 },
    jumpRate: 0,
    power: 1.4,
    lureAffinity: { ned: 0.8, tube: 1.0, footballJig: 1.2, texasRig: 1.1, flipJig: 1.1, frog: 1.2 },
  },
  drum: {
    id: 'drum',
    name: 'Freshwater Drum',
    isBass: false,
    ws: { a: -3.6, b: 3.15 },
    tempOptF: 72,
    depthBySeason: flat([12, 30]),
    cover: { rock: 1.2, standing: 0.8, none: 1.0 },
    jumpRate: 0,
    power: 1.0,
    lureAffinity: { ned: 1.3, dropShot: 1.3, tube: 1.2, footballJig: 1.2, carolinaRig: 1.3 },
  },
};

export function weightFromLength(species: SpeciesId, lengthIn: number, condition = 1): number {
  const { a, b } = SPECIES[species].ws;
  return Math.pow(10, a + b * Math.log10(lengthIn)) * condition;
}
