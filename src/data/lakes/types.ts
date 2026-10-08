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
  /** Lake regulations (largemouth). Defaults: 12" minimum, no slot, fish kept in the livewell for a ramp weigh-in. */
  regs?: {
    /** Tournament minimum length (in). */
    minIn: number;
    /**
     * Weigh-in format. `cwir` = TPWD catch-weigh-immediate-release (Lake Fork since the 2007 Toyota Texas
     * Bass Classic): a judge in each boat weighs and records every legal bass and it goes straight back;
     * the best five count, slot fish included. Default: kept in the livewell, weighed at the ramp.
     */
    format?: 'cwir';
    /**
     * Protected slot (TPWD Lake Fork: 16-24"): no bass in it may be kept. Under `cwir` it is weighed in
     * the boat, released and counts; at a ramp weigh-in it goes straight back and doesn't count.
     */
    slot?: { minIn: number; maxIn: number };
    /**
     * Only `perDay` bass of `minIn` or longer may be kept each day (TPWD Lake Fork: one 24" or longer).
     * Under `cwir` that is the one fish you may bring to the weigh-in stage (it counts either way).
     */
    bigFish?: { minIn: number; perDay: number };
  };
  /** Buoyed boat lanes (polylines). Running the outboard outside them in a stump zone is risky. */
  lanes?: Pt[][];
  laneWidthM?: number;
  /** Fields of submerged stumps just under the surface. */
  stumpZones?: { x: number; y: number; r: number }[];
}
