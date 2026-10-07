// Navigation helpers for the destination chip, the full lake map and the FISH "in range" cue.
// Pure and DOM-free: the runner feeds them the boat and the advisor's route; the sim never needs them.
import { LURES } from '../data/lures';
import { RODS } from '../data/rods';
import { TUNING } from '../data/tuning';
import { maxCastDistance } from './cast';
import { isWater, stumpHazardAt, type LakeGrid } from './lake';
import type { Conditions, RodSetup, Vec2 } from './types';

/** Where the advisor says to come off plane (APPROACH_TIP): three outboard spook radii out. */
export const OFF_PLANE_M = Math.round(TUNING.boat.outboardSpookRadius * 3);

/** A place you can drive to: an advisor stop (`pro` = 1-based route order) or a charted waypoint. */
export interface NavStop {
  id: string;
  name: string;
  x: number;
  y: number;
  pro?: number;
}

/** How far the rig in hand casts with no wind help (m): the "in range" ring around a stop. */
export function castRangeM(rig: RodSetup, c: Conditions): number {
  return maxCastDistance(LURES[rig.lureId], RODS[rig.rodId], rig.line, c, c.windDir + Math.PI / 2);
}

export const distanceM = (a: Vec2, b: Vec2) => Math.hypot(b.x - a.x, b.y - a.y);

/** World bearing from a to b (rad): 0 = east, +PI/2 = south, the same frame as boat.heading. */
export const bearingTo = (a: Vec2, b: Vec2) => Math.atan2(b.y - a.y, b.x - a.x);

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  const w = Math.atan2(Math.sin(a), Math.cos(a));
  return w === -Math.PI ? Math.PI : w;
}

/** Bearing to `to` relative to the boat's heading: 0 dead ahead, positive to starboard (clockwise on the chart). */
export const relativeBearing = (heading: number, from: Vec2, to: Vec2) => wrapAngle(bearingTo(from, to) - heading);

const POINTS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
/** Eight-point compass name for a world bearing (north is up the chart, -y). */
export function compassPoint(rad: number): string {
  const i = Math.round(wrapAngle(rad) / (Math.PI / 4));
  return POINTS[(i + 8) % 8];
}

/**
 * Stops the boat is fishing now: a cast made within `rangeM` of a stop counts it as visited. Adds them
 * to `visited` and returns the ids that are new.
 */
export function markVisited(visited: Set<string>, stops: readonly NavStop[], boat: Vec2, rangeM: number): string[] {
  const fresh: string[] = [];
  for (const s of stops) {
    if (visited.has(s.id) || distanceM(boat, s) > rangeM) continue;
    visited.add(s.id);
    fresh.push(s.id);
  }
  return fresh;
}

/** The default destination: the first stop in route order you haven't fished yet. */
export const nextStop = (route: readonly NavStop[], visited: ReadonlySet<string>): NavStop | null => route.find((s) => !visited.has(s.id)) ?? null;

/** The closest stop within `rangeM` of the boat, if any. */
export function nearestInRange(stops: readonly NavStop[], boat: Vec2, rangeM: number): NavStop | null {
  let best: NavStop | null = null;
  for (const s of stops) if (distanceM(boat, s) <= rangeM && (!best || distanceM(boat, s) < distanceM(boat, best))) best = s;
  return best;
}

/**
 * What the destination chip should warn about: in casting range of it, or still on the outboard
 * inside the off-plane ring (spooking what you came for).
 */
export function navCue(distM: number, motor: 'outboard' | 'trolling', castRangeM: number): 'inRange' | 'idleIn' | null {
  if (distM <= castRangeM) return 'inRange';
  if (motor === 'outboard' && distM <= OFF_PLANE_M) return 'idleIn';
  return null;
}

/** A round scale-bar length (m) that draws about `targetPx` long at `pxPerM`. */
export function scaleBarM(pxPerM: number, targetPx = 90): number {
  const raw = targetPx / pxPerM;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const k of [5, 2, 1]) if (k * mag <= raw) return k * mag;
  return mag;
}

// ---------- Water routing ----------
// The chip's arrow follows the water: when an island or a point is in the way, it points along the
// shortest water route (A* over the lake grid, hugging no shoreline), not straight through the land.

/** Cells this close to shore cost extra, so routes run down the channel rather than along the bank. */
const SHORE_COST = 3;
/** Stump fields off the boat lanes cost extra, so routes run the lanes (running them on plane is a gamble). */
const STUMP_COST = 4;
/** Stumps this close (m) to either end of a straight run don't count against it (you idle in and out). */
const STUMP_ENDS_M = 40;

/** Water route from `from` to `to`: cell centres after the start, ending exactly at `to`. [to] if none. */
export function waterPath(g: LakeGrid, from: Vec2, to: Vec2): Vec2[] {
  const cell = (p: Vec2) => {
    const c = Math.min(g.cols - 1, Math.max(0, Math.floor(p.x / g.cellM)));
    const r = Math.min(g.rows - 1, Math.max(0, Math.floor(p.y / g.cellM)));
    return r * g.cols + c;
  };
  const start = cell(from);
  const goal = cell(to);
  if (start === goal || !g.water[start]) return [to];
  const n = g.cols * g.rows;
  const cost = new Float32Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const gc = goal % g.cols;
  const gr = Math.floor(goal / g.cols);
  const h = (i: number) => {
    const dx = Math.abs((i % g.cols) - gc);
    const dy = Math.abs(Math.floor(i / g.cols) - gr);
    return (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * g.cellM;
  };
  // Binary heap of [f, cell].
  const heap: [number, number][] = [];
  const push = (f: number, i: number) => {
    heap.push([f, i]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  cost[start] = 0;
  push(h(start), start);
  let found = false;
  while (heap.length) {
    const [f, i] = pop();
    if (i === goal) {
      found = true;
      break;
    }
    if (f - h(i) > cost[i] + 1e-6) continue;
    const c = i % g.cols;
    const r = Math.floor(i / g.cols);
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const cc = c + dc;
        const rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= g.cols || rr >= g.rows) continue;
        const j = rr * g.cols + cc;
        if (!g.water[j]) continue;
        // No cutting a corner between two land cells.
        if (dr && dc && (!g.water[r * g.cols + cc] || !g.water[rr * g.cols + c])) continue;
        const near = j !== goal && g.shoreDistM[j] <= g.cellM ? SHORE_COST : 1;
        const stumps = j !== goal && g.stump[j] && !g.lane[j] ? STUMP_COST : 1;
        const step = (dr && dc ? Math.SQRT2 : 1) * g.cellM * near * stumps;
        if (cost[i] + step < cost[j]) {
          cost[j] = cost[i] + step;
          prev[j] = i;
          push(cost[j] + h(j), j);
        }
      }
  }
  if (!found) return [to];
  const out: Vec2[] = [];
  for (let i = prev[goal]; i !== -1 && i !== start; i = prev[i]) out.push({ x: ((i % g.cols) + 0.5) * g.cellM, y: (Math.floor(i / g.cols) + 0.5) * g.cellM });
  out.reverse();
  out.push({ x: to.x, y: to.y });
  return out;
}

/**
 * A boat-width-clear straight run over water from a to b (sampled every 5 m, 6 m either side). With
 * `avoidStumps`, a run through an off-lane stump field (away from its ends) doesn't count as clear.
 */
export function lineClear(g: LakeGrid, a: Vec2, b: Vec2, avoidStumps = false): boolean {
  const d = distanceM(a, b);
  if (d < 1e-6) return true;
  const ux = (b.x - a.x) / d;
  const uy = (b.y - a.y) / d;
  for (let s = 0; s <= d; s += 5) {
    const x = a.x + ux * s;
    const y = a.y + uy * s;
    if (!isWater(g, x, y)) return false;
    if (avoidStumps && s > STUMP_ENDS_M && s < d - STUMP_ENDS_M && stumpHazardAt(g, x, y)) return false;
    // Either side too, away from the ends (the boat or the stop may sit close to a bank).
    if (s > 8 && s < d - 8 && (!isWater(g, x - uy * 6, y + ux * 6) || !isWater(g, x + uy * 6, y - ux * 6))) return false;
  }
  return true;
}

/**
 * Where to steer now along a water route: the farthest point of `path` you can run to in a straight
 * line. The destination itself when nothing is in the way.
 */
export function steerPoint(g: LakeGrid, from: Vec2, path: readonly Vec2[]): Vec2 {
  const end = path[path.length - 1];
  if (lineClear(g, from, end, true)) return end;
  let best = path[0];
  for (const p of path) {
    if (!lineClear(g, from, p, true)) break;
    best = p;
  }
  return best;
}
