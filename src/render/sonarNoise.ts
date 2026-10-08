// Sonar realism for the forward-facing cone and the side-scan inset. Render-only: the sim and the
// harness read fish directly; this only changes what the screen shows. A return's size is the fish's
// size plus a fixed per-fish error (target strength depends on aspect, swim bladder and depth, not
// species), so a big drum and a big bass look alike; inside cover the wood, grass and dock pilings
// return echoes too, so a fish there fades into clutter. Everything is deterministic per fish (and per
// cell for the clutter), so a mark doesn't shimmer frame to frame.
import type { CoverType } from '../sim/types';

/** Deterministic 0..1 hash of two integers. */
export function hash2(a: number, b: number): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/**
 * Size error for one fish's return: x0.55-1.8 (log-uniform), fixed for that fish in this tournament.
 * Enough that you can't weigh a fish off the screen, though bigger fish still read bigger on average.
 */
export function markSizeNoise(fishId: number, seed: number): number {
  return Math.pow(2, (hash2(fishId, seed) * 2 - 1) * 0.85);
}

/** How much each cover type clutters the return (0 = clean water, 1 = the fish is mostly lost in it). */
export const COVER_CLUTTER: Record<CoverType, number> = { none: 0, rock: 0.15, grass: 0.55, reeds: 0.6, dock: 0.5, timber: 0.65, standing: 0.7 };

/**
 * Alpha multiplier for a fish return in this cover. In heavy cover the mark also drops out on some
 * pings (`ping` = which sweep this is), so it flickers in and out of the clutter.
 */
export function coverFade(cover: CoverType, fishId: number, ping: number): number {
  const c = COVER_CLUTTER[cover];
  if (!c) return 1;
  const dropped = hash2(fishId * 31 + ping, 977) < c * 0.6;
  return dropped ? 0.12 : 1 - c * 0.6;
}

/** Clutter speckles for a cover cell: up to `max` points as offsets in 0..1 of the cell, deterministic. */
export function clutterPoints(cellIndex: number, cover: CoverType, max = 4): { u: number; v: number; s: number }[] {
  const n = Math.round(COVER_CLUTTER[cover] * max);
  const out: { u: number; v: number; s: number }[] = [];
  for (let k = 0; k < n; k++) out.push({ u: hash2(cellIndex, k * 3 + 1), v: hash2(cellIndex, k * 3 + 2), s: 0.5 + hash2(cellIndex, k * 3 + 3) });
  return out;
}
