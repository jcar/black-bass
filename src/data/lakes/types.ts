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
    /** Median 5-fish daily bag for the field, per tier (lb). With a big-fish rule (`regs.bigFish`), the limit without the kicker, which rivals weigh at its own weight. */
    medianBagLb: Record<Tier, number>;
    sigma: number;
    /** With a big-fish rule: a rival's chance of weighing a kicker over the line today (x skill). */
    bigFishOdds?: number;
  };
  /** Lake regulations (largemouth). Defaults: 12" minimum, no slot. */
  regs?: {
    /** Tournament minimum length (in). */
    minIn: number;
    /**
     * Protected slot (TPWD Lake Fork: 16-24"): `release` = back in the lake immediately; it can't go in
     * the livewell or be weighed. (Only a catch-weigh-release event with an on-boat judge, like the 2024
     * Elite at Lake Fork, can weigh slot fish; this game's events weigh in at the ramp.)
     */
    slot?: { minIn: number; maxIn: number; mode: 'release' };
    /** Only `perDay` bass of `minIn` or longer may be kept each day (TPWD Lake Fork: one 24" or longer). */
    bigFish?: { minIn: number; perDay: number };
  };
  /** Buoyed boat lanes (polylines). Running the outboard outside them in a stump zone is risky. */
  lanes?: Pt[][];
  laneWidthM?: number;
  /** Fields of submerged stumps just under the surface. */
  stumpZones?: { x: number; y: number; r: number }[];
}
