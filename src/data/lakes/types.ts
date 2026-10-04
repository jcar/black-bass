import type { CoverType, SpeciesId, Tier, Weather } from '../../sim/types';

export type Pt = [number, number];

export interface CoverPatch {
  type: Exclude<CoverType, 'none'>;
  x: number;
  y: number;
  r: number;
  label?: string;
}

export interface Waypoint {
  id: string;
  name: string;
  x: number;
  y: number;
  tip: string;
  /** Hidden waypoints exist in the data (for later tiers) but are not drawn. */
  visible: boolean;
}

export interface SizeProfile {
  medianIn: number;
  /** Lognormal sigma on length. */
  sigma: number;
  maxIn: number;
}

export interface LakeDef {
  id: string;
  name: string;
  region: string;
  tier: Tier;
  blurb: string;
  sizeM: { w: number; h: number };
  cellM: number;
  launch: { x: number; y: number; heading: number; name: string };
  shoreline: Pt[];
  islands: Pt[][];
  /** Control points [x, y, depthFt] interpolated by inverse-distance weighting. */
  depthPoints: [number, number, number][];
  /** Depth can never exceed shore distance (m) times this slope. */
  shoreSlopeFtPerM: number;
  clarity: { defaultSecchiFt: number; zones: { x: number; y: number; r: number; secchiFt: number }[] };
  cover: CoverPatch[];
  waypoints: Waypoint[];
  regions: { name: string; x: number; y: number }[];
  species: {
    /** Fraction of the population per species (bass + bycatch). */
    default: Partial<Record<SpeciesId, number>>;
    zones: { x: number; y: number; r: number; weights: Partial<Record<SpeciesId, number>> }[];
    sizes: Partial<Record<SpeciesId, SizeProfile>>;
    /** Total fish in the lake (sim entities). */
    count: number;
    condition: number;
  };
  climate: {
    waterTempFByMonth: number[]; // Jan..Dec
    tournamentMonths: number[];
    weatherOdds: Record<Weather, number>;
  };
  field: {
    /** Median 5-fish daily bag for the field, per tier (lb). */
    medianBagLb: Record<Tier, number>;
    sigma: number;
  };
}
