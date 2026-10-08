// How much the pro advice tells you, by tier. The NES game's Class A lakes made you find the hot
// spots yourself; here the help fades as you climb: the co-angler series gets the whole milk run, the
// Elite series gets a scouting report and nothing else. The live coach and the weigh-in notes stay at
// every tier: they explain mistakes, not where the fish are.
import type { Tier } from './types';

export interface AdviceAccess {
  /** PRO stops marked on the map, and the destination chip's default route (0 = find your own water). */
  proStops: number;
  /** The "Pro" badge on the rod bar (the advisor's rig for right now). */
  proChip: boolean;
  /**
   * The briefing / pause-menu plan: 'full' = rig, window, where and how; 'lures' = which rig in each
   * window and how to work it, no spots; 'scouting' = only the lake's scouting report.
   */
  plan: 'full' | 'lures' | 'scouting';
  /** The scouting report names spots ("Where: ..."). */
  scoutSpots: boolean;
  /** "Data for this point": game minutes it costs to check (0 = free, shown on each stop), or null = not available. */
  pointDataMin: number | null;
  /** One line for the briefing: what this tier shows. */
  label: string;
}

const ACCESS: Record<Tier, AdviceAccess> = {
  Amateur: { proStops: 6, proChip: true, plan: 'full', scoutSpots: true, pointDataMin: 0, label: 'Full pro help: 6 PRO stops, the Pro rod, the day plan and Data for this point.' },
  SemiPro: { proStops: 3, proChip: true, plan: 'full', scoutSpots: true, pointDataMin: 0, label: 'Pro help: 3 PRO stops, the Pro rod, the day plan and Data for this point.' },
  Pro: { proStops: 0, proChip: true, plan: 'lures', scoutSpots: false, pointDataMin: 2, label: 'Pros find their own water: no PRO stops, a lure plan only, and checking a point costs 2 minutes.' },
  Elite: { proStops: 0, proChip: false, plan: 'scouting', scoutSpots: false, pointDataMin: null, label: 'Elite: pros find their own water. A scouting report is all you get.' },
};

/** What the advice shows at a tier. Every place advice appears asks this one function. */
export function adviceFor(tier: Tier): AdviceAccess {
  return ACCESS[tier] ?? ACCESS.Amateur;
}
