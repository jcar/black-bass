import type { CoverType, Weather } from '../sim/types';

export const PAL = {
  land: '#3d5a3a',
  landDark: '#2c4429',
  sand: '#b9a77a',
  shallow: [120, 196, 196] as const,
  deep: [10, 40, 74] as const,
  contour: 'rgba(255,255,255,0.13)',
  rock: '#8d8a83',
  rockDark: '#5f5c56',
  grass: '#4f8a3a',
  grassLight: '#7fb55a',
  dock: '#8a6a45',
  dockDark: '#5e4428',
  timber: '#4c3b2a',
  standing: '#6b5a48',
  standingTop: '#a39785',
  reeds: '#a9b863',
  lane: 'rgba(255,255,255,0.6)',
  buoy: '#f4f1ea',
  buoyStripe: '#e8672c',
  boat: 0xf2f2ee,
  boatAccent: 0xd23b2b,
  sonar: 0x63e6ff,
  line: 0xe9f2f5,
  ui: 0x0b1d26,
};

/** Water colour by depth (ft), tinted by clarity: murky water reads greener/browner. */
export function depthRGB(depthFt: number, secchiFt: number): [number, number, number] {
  const t = Math.min(1, Math.pow(depthFt / 60, 0.55));
  const [r0, g0, b0] = PAL.shallow;
  const [r1, g1, b1] = PAL.deep;
  let r = r0 + (r1 - r0) * t;
  let g = g0 + (g1 - g0) * t;
  let b = b0 + (b1 - b0) * t;
  const murk = Math.max(0, Math.min(1, (8 - secchiFt) / 6));
  r += (110 - r) * murk * 0.45;
  g += (120 - g) * murk * 0.35;
  b += (70 - b) * murk * 0.5;
  return [r | 0, g | 0, b | 0];
}

export function depthColor(depthFt: number, secchiFt: number): string {
  const [r, g, b] = depthRGB(depthFt, secchiFt);
  return `rgb(${r},${g},${b})`;
}

export const COVER_LABEL: Record<CoverType, string> = {
  none: 'Open water',
  rock: 'Rock',
  grass: 'Grass',
  dock: 'Docks',
  timber: 'Timber',
  reeds: 'Reeds',
  standing: 'Standing timber',
};

export const SKY: Record<Weather, { top: number; bottom: number }> = {
  Bluebird: { top: 0x3f8fd8, bottom: 0xbfe3f5 },
  Overcast: { top: 0x7d8a93, bottom: 0xc9cfd2 },
  Windy: { top: 0x5d8fb8, bottom: 0xcfe0e8 },
  Rain: { top: 0x55606a, bottom: 0x9aa4ab },
};

export function hexNum(css: string): number {
  return parseInt(css.replace('#', ''), 16);
}
