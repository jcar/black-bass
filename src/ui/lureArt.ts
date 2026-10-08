// Procedural lure art: a side-view silhouette per lure type, tinted with the colour's hex, for any lure
// and colour the asset pipeline hasn't rendered yet. Drawn as an SVG data URL so it drops in wherever a
// generated icon would (rod bar, locker, shop shelf and the shop's large picture). The body gets a dark
// halo and a light outline so it reads on the teal backdrop in any colour, black & blue included.

const BG = '#0d2a31';
const HALO = '#04131a';
const EDGE = '#eef6f4';
const METAL = '#cfd8dc';
const LEAD = '#3d4448';

/** A filled shape: dark halo, colour with a light edge, then a top-lit sheen. */
const body = (d: string, fill: string) =>
  `<path d="${d}" fill="none" stroke="${HALO}" stroke-width="6" stroke-linejoin="round"/>` +
  `<path d="${d}" fill="${fill}" stroke="${EDGE}" stroke-opacity=".85" stroke-width="2" stroke-linejoin="round"/>` +
  `<path d="${d}" fill="url(#sh)"/>`;

/** A thick stroked shape (worm bodies, skirt strands) with the same halo and edge. */
const strand = (d: string, fill: string, w: number) =>
  `<path d="${d}" fill="none" stroke="${HALO}" stroke-width="${w + 4}" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<path d="${d}" fill="none" stroke="${EDGE}" stroke-opacity=".85" stroke-width="${w + 2}" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<path d="${d}" fill="none" stroke="${fill}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

const wire = (d: string, w = 1.8) => `<path d="${d}" fill="none" stroke="${HALO}" stroke-width="${w + 2}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${METAL}" stroke-width="${w}" stroke-linecap="round"/>`;

const eye = (x: number, y: number, r = 3.2) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#f4f1e0" stroke="${HALO}" stroke-width="1"/><circle cx="${x + 0.6}" cy="${y}" r="${r * 0.5}" fill="#111"/>`;

/** A treble hook hanging from (x, y). */
const treble = (x: number, y: number) => wire(`M${x} ${y} v7 M${x - 4} ${y + 5} q0 5 4 5 q4 0 4 -5 M${x} ${y + 10} q-1 3 2 4`, 1.4);

/** Skirt strands fanning back from (x, y) over `len`, `n` of them. */
function skirt(x: number, y: number, len: number, spread: number, n: number, fill: string): string {
  let d = '';
  for (let i = 0; i < n; i++) {
    const k = n === 1 ? 0 : i / (n - 1) - 0.5;
    d += `M${x} ${y + k * 4} q${len * 0.5} ${k * spread * 0.4} ${len} ${k * spread} `;
  }
  return strand(d.trim(), fill, 1.6);
}

const SHAPES: Record<string, (c: string) => string> = {
  texasRig: (c) =>
    body('M12 50 L27 44.5 Q29 50 27 55.5 Z', LEAD) +
    strand('M29 50 C40 43, 50 58, 62 50 S80 41, 90 49', c, 8) +
    wire('M31 46 q-3 8 5 10 q6 1 7 -5', 1.6) +
    `<path d="M40 47 l1 6 M50 51 l-1 6 M70 46 l1 6" stroke="${HALO}" stroke-opacity=".35" stroke-width="1"/>`,
  flipJig: (c) =>
    skirt(32, 50, 34, 30, 9, c) +
    strand('M60 48 C70 40, 80 36, 90 38 M60 52 C70 60, 80 64, 90 62', c, 5) +
    body('M18 50 a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0 Z', c) +
    wire('M30 43 l8 -12 M32 44 l9 -11 M34 45 l9 -10', 1) +
    wire('M27 58 q2 9 12 6', 1.8) +
    eye(23, 48, 2.6),
  spinnerbait: (c) =>
    wire('M60 18 L20 46 L48 62', 1.8) +
    body('M56 15 C66 8, 80 9, 86 14 C78 21, 64 22, 56 15 Z', METAL) +
    body('M38 26 C42 21, 50 21, 52 25 C48 30, 41 30, 38 26 Z', '#e0c25a') +
    skirt(54, 63, 32, 24, 8, c) +
    body('M44 63 a7 6 0 1 0 14 0 a7 6 0 1 0 -14 0 Z', c) +
    eye(54, 61.5, 2.2),
  frog: (c) =>
    skirt(60, 50, 30, 26, 7, c) +
    body('M16 52 C16 38, 40 32, 56 40 C66 45, 66 56, 56 61 C40 68, 16 64, 16 52 Z', c) +
    `<path d="M22 58 C34 63, 48 62, 58 57" fill="none" stroke="#f4f1e0" stroke-opacity=".35" stroke-width="3" stroke-linecap="round"/>` +
    eye(27, 42, 3.6) +
    eye(37, 40, 3.2) +
    wire('M58 42 q9 -6 4 -15 M56 44 q12 -3 12 -14', 1.6),
  lipless: (c) =>
    treble(36, 64) +
    treble(68, 62) +
    body('M18 54 C19 38, 42 28, 64 32 C78 35, 86 44, 86 52 C82 62, 62 68, 42 66 C28 65, 18 62, 18 54 Z', c) +
    `<path d="M28 58 C44 62, 64 61, 80 54" fill="none" stroke="#f4f1e0" stroke-opacity=".3" stroke-width="4" stroke-linecap="round"/>` +
    eye(28, 46, 3.4) +
    wire('M24 37 l-3 -4', 1.6),
  deepCrank: (c) =>
    treble(46, 62) +
    treble(74, 60) +
    `<path d="M33 52 L10 66 L16 73 L37 58 Z" fill="#cfe9ef" fill-opacity=".45" stroke="${EDGE}" stroke-opacity=".9" stroke-width="1.8" stroke-linejoin="round"/>` +
    body('M30 50 C30 38, 48 33, 64 35 C80 37, 88 45, 88 51 C88 58, 78 64, 62 65 C46 66, 30 62, 30 50 Z', c) +
    eye(40, 46, 3.6) +
    wire('M14 69 l-4 2', 1.6),
  swimbait: (c) =>
    body('M76 50 L86 38 C90 42, 90 58, 86 62 Z', c) +
    body('M12 51 C16 40, 34 36, 52 40 C64 43, 72 47, 78 50 C72 53, 64 57, 52 60 C34 64, 16 61, 12 51 Z', c) +
    `<path d="M18 56 C32 61, 52 60, 72 52" fill="none" stroke="#f4f1e0" stroke-opacity=".35" stroke-width="4" stroke-linecap="round"/>` +
    `<path d="M40 41 q3 9 0 18 M52 42 q3 8 0 16 M63 45 q2 5 0 10" fill="none" stroke="${HALO}" stroke-opacity=".35" stroke-width="1.2"/>` +
    eye(21, 48, 3) +
    `<path d="M30 42 q4 8 0 16" fill="none" stroke="${HALO}" stroke-opacity=".5" stroke-width="1.4"/>`,
  carolinaRig: (c) =>
    wire('M4 40 L19 44 M44 48 L60 51', 1) +
    body('M18 44 a8 5.5 0 1 0 16 0 a8 5.5 0 1 0 -16 0 Z', LEAD) +
    `<circle cx="37" cy="46" r="2.8" fill="#c0392b" stroke="${EDGE}" stroke-width="1"/>` +
    `<circle cx="41" cy="47" r="1.8" fill="none" stroke="${METAL}" stroke-width="1.3"/><circle cx="44.5" cy="48" r="1.8" fill="none" stroke="${METAL}" stroke-width="1.3"/>` +
    strand('M60 51 C68 47, 74 56, 82 53 S90 46, 94 52', c, 6) +
    strand('M68 51 l-4 6 M76 54 l2 6', c, 2) +
    wire('M62 48 q-1 8 6 8 q4 0 5 -4', 1.4),
};

/** Any other lure without art yet: a plain minnow. */
const GENERIC = (c: string) =>
  treble(44, 60) +
  body('M14 50 C18 40, 40 36, 60 40 C74 43, 82 47, 86 50 C82 53, 74 57, 60 60 C40 64, 18 60, 14 50 Z', c) +
  eye(24, 48, 3);

const cache = new Map<string, string>();

/** SVG data URL of the procedural art for a lure in a colour (hex). */
export function lureArtUrl(lureId: string, hex: string): string {
  const key = `${lureId}|${hex}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const draw = SHAPES[lureId] ?? GENERIC;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="256" height="256">` +
    `<defs><radialGradient id="bg" cx=".45" cy=".4" r=".75"><stop offset="0" stop-color="#174652"/><stop offset="1" stop-color="${BG}"/></radialGradient>` +
    `<linearGradient id="sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient></defs>` +
    `<rect width="100" height="100" fill="url(#bg)"/>` +
    `<g transform="translate(50 50) scale(.9) rotate(-28) translate(-48 -48)">${draw(hex)}</g></svg>`;
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  cache.set(key, url);
  return url;
}
