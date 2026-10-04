// Core simulation types. The sim is pure TypeScript: no DOM, React, or Pixi.
// World units: metres on the horizontal plane, feet for water depth (anglers think in feet).

export type SpeciesId = 'largemouth' | 'smallmouth' | 'spotted' | 'pike' | 'pickerel' | 'bowfin' | 'drum';
/** 'timber' = laydowns/stumps (hard: lures crash); 'standing' = flooded standing timber you can fish through. */
export type CoverType = 'none' | 'rock' | 'grass' | 'dock' | 'timber' | 'reeds' | 'standing';
export type Season = 'Prespawn' | 'Spawn' | 'Postspawn' | 'Summer' | 'Fall' | 'Turnover' | 'Winter';
export type Weather = 'Bluebird' | 'Overcast' | 'Windy' | 'Rain';
export type PressureTrend = 'falling' | 'steady' | 'rising';
export type Tier = 'Amateur' | 'SemiPro' | 'Pro' | 'Elite';
export type Rank = 'CoAngler' | 'SemiPro' | 'Pro' | 'Elite';
export type RodPower = 'ML' | 'M' | 'MH' | 'H' | 'XH';
export type LineType = 'fluoro' | 'mono' | 'braid';
export type ColorFamily = 'natural' | 'bright' | 'dark' | 'red';

export type GamePhase = 'Navigate' | 'Cast' | 'Present' | 'Fight' | 'Landed' | 'WeighIn';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Conditions {
  /** ISO date (yyyy-mm-dd) of tournament day 1. */
  date: string;
  month: number; // 1-12
  season: Season;
  waterTempF: number;
  /** Degrees F per day; positive = warming (bass respond to the trend). */
  tempTrendFPerDay: number;
  weather: Weather;
  windMph: number;
  /** Direction the wind blows TOWARD, radians (0 = +x / east). */
  windDir: number;
  pressureTrend: PressureTrend;
  postFront: boolean;
}

export interface Line {
  type: LineType;
  testLb: number;
}

export interface RodSetup {
  id: string;
  rodId: string;
  line: Line;
  lureId: string;
  colorId: string;
}

export interface FishEntity {
  id: number;
  species: SpeciesId;
  lengthIn: number;
  weightLb: number;
  home: Vec2;
  homeRangeM: number;
  pos: Vec2;
  depthFt: number;
  /** Persistent trait: some fish are far easier to catch than others (Philipp et al.). 0.2-2. */
  vulnerability: number;
  /** 0..1, rises each time the fish is caught/hooked; lowers strike odds on later days. */
  hookShy: number;
  /** Game minute until which the fish is spooked and ignores lures. */
  spookUntil: number;
  /** 0..10 attraction meter toward the current lure (the HBMAX successor). */
  interest: number;
  /** True once removed from the lake (in livewell or kept). */
  caught: boolean;
}

export interface CaughtFish {
  fishId: number;
  species: SpeciesId;
  weightLb: number;
  lengthIn: number;
  caughtAtMin: number;
  lureId: string;
  /** Protected-slot fish under catch-weigh-release: weighed by the marshal, counted, released. */
  cwr?: boolean;
}

export interface Rival {
  id: number;
  name: string;
  hometown: string;
  skill: number;
  /** Pre-sampled catches for the current day: game minute + weight (+ species for the broadcast feed). */
  catches: { atMin: number; weightLb: number; species?: SpeciesId }[];
  /** Feed cursor: index of the next catch not yet seen by the broadcast feed. */
  feedCursor?: number;
  dayWeights: number[];
  cut: boolean;
}

export type LureState = 'air' | 'water';

export interface CastState {
  aimAngle: number; // radians relative to boat heading
  powerCharging: boolean;
  power: number; // 0..1 oscillating
  powerDir: 1 | -1;
  flying: boolean;
  flightT: number;
  flightDuration: number;
  origin: Vec2;
  target: Vec2;
  /** Where the lure actually is during/after flight. */
  lurePos: Vec2;
  lureHeight: number; // metres above water during flight (for render)
  braked: boolean;
  result?: 'water' | 'crash' | 'shore' | 'edge';
}

export interface PresentState {
  lurePos: Vec2;
  lureDepthFt: number;
  lureVel: Vec2;
  /** Seconds since lure hit water. */
  t: number;
  /** Recent action history used to score cadence. Times are presentation seconds. */
  twitchTimes: number[];
  lastMoveT: number;
  pauseStartT: number | null;
  /** Rolling average horizontal speed (m/s). */
  avgSpeed: number;
  /** Seconds the lure has been moving continuously. */
  movingFor: number;
  /** 0..1 rolling presentation-match score (exposed for the debug overlay). */
  match: number;
  /** Decaying reaction-strike trigger from deflection / speed change / pause. */
  trigger: number;
  hopT: number; // >0 while a bottom bait is mid-hop
  onBottom: boolean;
  /** Active twitch impulse (seconds remaining + velocity). */
  twitchT: number;
  twitchVel: Vec2;
  walkSide: 1 | -1;
  /** True for the first seconds after a cast that landed tight to cover. */
  edgeCast: boolean;
  lastDeflectT: number;
  stillFor: number;
  /** Fish currently charging the lure (strike animation). */
  strikingFishId: number | null;
  strikeT: number;
  lastCover: CoverType;
}

export interface FightState {
  fishId: number;
  species: SpeciesId;
  weightLb: number;
  /** Fish position in world metres. */
  pos: Vec2;
  heading: number;
  speed: number;
  /** Line out between rod tip and fish (m). */
  lineOut: number;
  stamina: number; // 0..1
  tensionLb: number;
  /** Normalised 0..1+ against breaking strength (HUD). */
  tension: number;
  burstT: number; // seconds of current burst remaining
  nextBurstIn: number;
  jumpT: number; // >0 while airborne / spike window
  jumpBowed: boolean;
  jumps: number;
  revealed: boolean;
  t: number;
  rodSide: number; // -1..1 from stick
}

export interface TournamentEvent {
  type:
    | 'splash'
    | 'crash'
    | 'shore'
    | 'edge'
    | 'strike'
    | 'hooked'
    | 'snap'
    | 'thrown'
    | 'jump'
    | 'landed'
    | 'popped'
    | 'popFailed'
    | 'cullNeeded'
    | 'retrieved'
    | 'spooked'
    | 'timeWarning'
    | 'dayOver'
    | 'stump'
    | 'rivalCatch'
    | 'leaderChange'
    | 'playerPlace'
    | 'message';
  text?: string;
  at?: Vec2;
  /** Structured payload for the broadcast feed (rival name, weight, place...). */
  data?: { name?: string; weightLb?: number; species?: SpeciesId; place?: number; big?: boolean };
}

/** Running state of the live broadcast feed (leader, player place, rate limiting). */
export interface BroadcastState {
  /** Rival fish at or above this weight are worth reporting (top ~8% of today's field catches). */
  notableLb: number;
  lastReportMin: number;
  leaderId: number | null;
  lastPlace: number;
}

export interface BoatState {
  pos: Vec2;
  heading: number;
  speed: number; // m/s (world)
  motor: 'outboard' | 'trolling';
}

export interface TournamentState {
  version: 1;
  seed: number;
  rngState: number;
  lakeId: string;
  tier: Tier;
  day: number;
  totalDays: number;
  cutAfterDay: number | null;
  /** Minutes since midnight. 360 = 6:00 AM, 900 = 3:00 PM weigh-in. */
  clockMin: number;
  conditions: Conditions;
  phase: GamePhase;
  boat: BoatState;
  deck: RodSetup[];
  activeRod: number;
  livewell: CaughtFish[];
  /** Fish waiting for a cull decision (6th bass). */
  pendingCull: CaughtFish | null;
  /** Last landed fish (for the Landed card). */
  lastLanded: CaughtFish | null;
  dayWeights: number[];
  fish: FishEntity[];
  rivals: Rival[];
  /** 0..1 lake-wide pressure, rises over multi-day events. */
  pressure: number;
  cast: CastState | null;
  present: PresentState | null;
  fight: FightState | null;
  events: TournamentEvent[];
  stats: { casts: number; bites: number; lost: number; bycatch: number; bigFishLb: number };
  timeWarned: boolean;
  lastAimAngle: number;
  /** Round-robin cursor for population updates. */
  popCursor: number;
  /** Optional so tournaments saved before the feed existed still load. */
  broadcast?: BroadcastState;
}

/** One frame of player input, produced by touch controls or keyboard. */
export interface InputFrame {
  stick: Vec2; // -1..1, y up = +1
  reel: boolean;
  brake: boolean;
  /** Edge-triggered actions (true for exactly one tick). */
  castTap: boolean;
  popTap: boolean;
  bowFlick: boolean;
  twitch: boolean;
  fishHere: boolean;
  moveOn: boolean;
}

export const emptyInput = (): InputFrame => ({
  stick: { x: 0, y: 0 },
  reel: false,
  brake: false,
  castTap: false,
  popTap: false,
  bowFlick: false,
  twitch: false,
  fishHere: false,
  moveOn: false,
});
