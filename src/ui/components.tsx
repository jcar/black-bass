import { useState } from 'react';
import { assetUrl, lureIconId, portraitId } from '../game/assets';
import { COLORS, LURES } from '../data/lures';
import type { SpeciesId } from '../sim/types';

export function lbOz(lb: number): string {
  const whole = Math.floor(lb);
  const oz = Math.round((lb - whole) * 16);
  return oz === 16 ? `${whole + 1}-00` : `${whole}-${String(oz).padStart(2, '0')}`;
}

export const money = (n: number) => `$${n.toLocaleString('en-US')}`;

const FISH_TINT: Record<SpeciesId, string> = {
  largemouth: '#5f7d35',
  smallmouth: '#8a6a3a',
  spotted: '#6f7f3a',
  pike: '#5e7a52',
  pickerel: '#7b8a4a',
  bowfin: '#4f5a3a',
  drum: '#9aa0a3',
};

/** Procedural fallback portrait until the pipeline has generated one. */
export function FishArt({ species, weightLb }: { species: SpeciesId; weightLb: number }) {
  const url = assetUrl(portraitId(species, weightLb));
  const [failed, setFailed] = useState(false);
  if (url && !failed) return <img src={url} alt="" onError={() => setFailed(true)} />;
  const long = species === 'pike' || species === 'pickerel' || species === 'bowfin';
  const c = FISH_TINT[species];
  return (
    <svg viewBox="0 0 200 120" width="90%" aria-hidden="true">
      <ellipse cx="100" cy="64" rx={long ? 78 : 66} ry={long ? 20 : 30} fill={c} />
      <path d={long ? 'M22 64 L2 44 L6 64 L2 84 Z' : 'M36 64 L10 38 L16 64 L10 90 Z'} fill={c} />
      <path d="M90 36 Q110 18 130 36 Z" fill={c} opacity="0.85" />
      <ellipse cx="100" cy="74" rx={long ? 66 : 54} ry={long ? 8 : 12} fill="#e9e3c8" opacity="0.35" />
      <circle cx={long ? 158 : 148} cy="58" r="5" fill="#111" />
      <circle cx={long ? 159 : 149} cy="57" r="1.6" fill="#fff" />
      {species === 'largemouth' && <path d="M40 66 Q100 58 160 66" stroke="#2c3a18" strokeWidth="6" fill="none" opacity="0.55" />}
      {species === 'smallmouth' && [60, 80, 100, 120].map((x) => <rect key={x} x={x} y="42" width="6" height="40" rx="3" fill="#4a3518" opacity="0.4" />)}
    </svg>
  );
}

export function LureIcon({ lureId, colorId, size = 28 }: { lureId: string; colorId: string; size?: number }) {
  const url = assetUrl(lureIconId(lureId, colorId));
  if (url) return <img src={url} width={size} height={size} alt="" style={{ borderRadius: 6 }} />;
  const lure = LURES[lureId];
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        display: 'inline-grid',
        placeItems: 'center',
        background: COLORS[colorId]?.hex ?? '#888',
        color: '#111',
        fontSize: size * 0.32,
        fontWeight: 900,
        border: '1.5px solid rgba(255,255,255,0.6)',
      }}
    >
      {lure?.short.slice(0, 2)}
    </span>
  );
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="col" style={{ gap: 2 }}>
      <span className="small muted">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
