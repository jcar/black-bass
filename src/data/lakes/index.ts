import type { Tier } from '../../sim/types';
import champlain from './champlain.json';
import type { LakeDef } from './types';

export const LAKES: Record<string, LakeDef> = {
  champlain: champlain as unknown as LakeDef,
};

/** Career ladder. Lakes without data yet are listed so the progression UI is complete. */
export const LAKE_LADDER: { id: string; name: string; region: string; tier: Tier; available: boolean }[] = [
  { id: 'champlain', name: 'Lake Champlain', region: 'NY / VT', tier: 'Amateur', available: true },
  { id: 'guntersville', name: 'Lake Guntersville', region: 'Alabama', tier: 'SemiPro', available: false },
  { id: 'toledobend', name: 'Toledo Bend Reservoir', region: 'TX / LA', tier: 'Pro', available: false },
  { id: 'okeechobee', name: 'Lake Okeechobee', region: 'Florida', tier: 'Elite', available: false },
];

export const TIER_FORMAT: Record<Tier, { days: number; cutAfterDay: number | null; fieldSize: number; cutTo: number }> = {
  Amateur: { days: 1, cutAfterDay: null, fieldSize: 30, cutTo: 30 },
  SemiPro: { days: 1, cutAfterDay: null, fieldSize: 40, cutTo: 40 },
  Pro: { days: 2, cutAfterDay: null, fieldSize: 50, cutTo: 50 },
  Elite: { days: 3, cutAfterDay: 2, fieldSize: 60, cutTo: 30 },
};

/** Payout by finishing place (index 0 = 1st) and rank points. */
export const PURSE: Record<Tier, { entry: number; payouts: number[]; points: number[] }> = {
  Amateur: { entry: 100, payouts: [2000, 1200, 800, 500, 400, 300, 250, 200, 150, 150], points: [100, 80, 70, 60, 55, 50, 45, 40, 35, 30] },
  SemiPro: { entry: 300, payouts: [6000, 3500, 2500, 1500, 1200, 1000, 800, 700, 600, 500], points: [100, 80, 70, 60, 55, 50, 45, 40, 35, 30] },
  Pro: { entry: 1000, payouts: [20000, 12000, 8000, 6000, 5000, 4000, 3500, 3000, 2500, 2000], points: [100, 80, 70, 60, 55, 50, 45, 40, 35, 30] },
  Elite: { entry: 2500, payouts: [100000, 30000, 20000, 15000, 12000, 11000, 10500, 10000, 10000, 10000], points: [100, 80, 70, 60, 55, 50, 45, 40, 35, 30] },
};
