import type { LakeDef } from '../../data/lakes/types';
import { SPECIES, weightFromLength } from '../../data/species';
import { TUNING } from '../../data/tuning';
import { lightLevel } from '../conditions';
import { COVER_CODES, coverAt, depthAt, isWater, type LakeGrid } from '../lake';
import type { Rng } from '../rng';
import type { Conditions, FishEntity, Season, SpeciesId } from '../types';

const SEASON_CONDITION: Record<Season, number> = {
  Prespawn: 1.08,
  Spawn: 1.04,
  Postspawn: 0.92,
  Summer: 0.97,
  Fall: 1.02,
  Turnover: 1.0,
  Winter: 1.0,
};

/** Bass home ranges are small (often ~500 m of shoreline); compressed for the game world. */
const HOME_RANGE_M: Record<SpeciesId, number> = {
  largemouth: 35,
  smallmouth: 60,
  spotted: 50,
  pike: 50,
  pickerel: 30,
  bowfin: 30,
  drum: 70,
};

export function speciesWeightsAt(lake: LakeDef, x: number, y: number): Partial<Record<SpeciesId, number>> {
  for (const z of lake.species.zones) if (Math.hypot(z.x - x, z.y - y) < z.r) return z.weights;
  return lake.species.default;
}

function depthSuitability(species: SpeciesId, season: Season, depthFt: number): number {
  const [lo, hi] = SPECIES[species].depthBySeason[season];
  if (depthFt >= lo && depthFt <= hi) return 1;
  const off = depthFt < lo ? lo - depthFt : depthFt - hi;
  return Math.exp(-off / 6);
}

export function sampleLength(rng: Rng, lake: LakeDef, species: SpeciesId, onStructure: boolean): number {
  const prof = lake.species.sizes[species] ?? { medianIn: 14, sigma: 0.18, maxIn: 22 };
  let len = rng.logNormal(prof.medianIn, prof.sigma);
  // Structure holds the better fish: a small chance to re-roll and keep the bigger one.
  if (onStructure && SPECIES[species].isBass && rng.chance(TUNING.population.trophyStructureBias)) {
    len = Math.max(len, rng.logNormal(prof.medianIn * 1.1, prof.sigma));
  }
  return Math.min(prof.maxIn, Math.max(8, Math.round(len * 4) / 4));
}

export function generatePopulation(lake: LakeDef, grid: LakeGrid, c: Conditions, rng: Rng): FishEntity[] {
  const fish: FishEntity[] = [];
  const target = lake.species.count;
  let guard = 0;
  while (fish.length < target && guard++ < target * 400) {
    const x = rng.next() * lake.sizeM.w;
    const y = rng.next() * lake.sizeM.h;
    if (!isWater(grid, x, y)) continue;
    const weights = speciesWeightsAt(lake, x, y);
    const ids = Object.keys(weights) as SpeciesId[];
    const species = rng.weighted(ids, (s) => weights[s] ?? 0);
    const sp = SPECIES[species];
    const depth = depthAt(grid, x, y);
    const cover = coverAt(grid, x, y);
    const offStructure = rng.chance(TUNING.population.offStructureFrac);
    // Squared so structure clearly concentrates fish relative to open water.
    const coverW = offStructure ? 0.35 : Math.pow((sp.cover[cover] ?? sp.cover.none ?? 0.5) / 1.8, 2);
    const suit = depthSuitability(species, c.season, depth) * coverW;
    if (!rng.chance(suit)) continue;

    const lengthIn = sampleLength(rng, lake, species, cover !== 'none');
    const weightLb =
      Math.round(weightFromLength(species, lengthIn, lake.species.condition * SEASON_CONDITION[c.season] * rng.normal(1, 0.05)) * 100) / 100;
    fish.push({
      id: fish.length,
      species,
      lengthIn,
      weightLb,
      home: { x, y },
      homeRangeM: HOME_RANGE_M[species],
      pos: { x, y },
      depthFt: depth,
      vulnerability: Math.min(2.5, Math.max(0.2, rng.logNormal(1, 0.45))),
      hookShy: 0,
      spookUntil: 0,
      interest: 0,
      caught: false,
    });
  }
  return fish;
}

/**
 * Where in the water column a fish holds. Bass relate to the bottom by default; in low light
 * and when active they rise to feed (which is what makes topwater work at dawn and on cloudy days).
 */
export function holdingDepth(bottomFt: number, light: number, activity: number): number {
  const rise = Math.max(0, Math.min(0.8, 0.1 + 0.6 * (1 - light) * Math.min(1.2, activity) - (bottomFt > 25 ? 0.15 : 0)));
  return bottomFt * (1 - rise);
}

/** Deterministic home-range wander: no RNG consumed, so it never disturbs replay determinism. */
export function wanderTarget(f: FishEntity, clockMin: number): { x: number; y: number } {
  const ang = f.id * 2.399 + clockMin * 0.045;
  const rad = f.homeRangeM * (0.25 + 0.25 * Math.sin(f.id * 0.7 + clockMin * 0.03));
  return { x: f.home.x + Math.cos(ang) * rad, y: f.home.y + Math.sin(ang) * rad };
}

/** Round-robin update of a slice of the population each tick (positions + holding depth). */
export function updatePopulationSlice(
  fish: FishEntity[],
  grid: LakeGrid,
  c: Conditions,
  clockMin: number,
  start: number,
  count: number,
  activityOf: (f: FishEntity) => number,
): number {
  const light = lightLevel(clockMin, c.weather);
  const n = fish.length;
  for (let k = 0; k < count && n > 0; k++) {
    const f = fish[(start + k) % n];
    if (f.caught) continue;
    if (f.interest < TUNING.attraction.followAt) {
      const t = wanderTarget(f, clockMin);
      if (isWater(grid, t.x, t.y)) f.pos = t;
    }
    f.depthFt = holdingDepth(depthAt(grid, f.pos.x, f.pos.y), light, activityOf(f));
  }
  return (start + count) % Math.max(1, n);
}

export const coverName = (code: number) => COVER_CODES[code];
