// Offline asset build: expands manifest.config.json against the game data, calls Gemini once per
// asset, post-processes to WebP/MP3 and writes everything into public/assets with an index the
// game loads at runtime. The game itself never calls any API.
//
//   npm run assets -- --dry-run                 print every job and prompt, no API calls
//   npm run assets -- --only "plate_champlain_*" generate a subset (glob on asset id)
//   npm run assets -- --force                   regenerate even if unchanged
//   npm run assets -- --concurrency 2 --limit 5
//   npm run assets -- --no-anchor               skip the first-image style anchor (avoids layout copying)
//
// Needs GEMINI_API_KEY in .env.local (never commit it). Audio post-processing needs ffmpeg on PATH.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { LAKES } from '../../src/data/lakes';
import { COLORS, LURES } from '../../src/data/lures';
import { RODS } from '../../src/data/rods';
import { SPECIES } from '../../src/data/species';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PUBLIC = join(ROOT, 'public');
const OUT = join(PUBLIC, 'assets');
const CACHE = join(HERE, '.cache');
const HASHES = join(CACHE, 'hashes.json');
const STYLE_REFS = join(HERE, 'styleRefs');

type Kind = 'plate' | 'portrait' | 'icon' | 'ui' | 'music' | 'sfx';
interface Job {
  id: string;
  kind: Kind;
  prompt: string;
  out: string; // path relative to public/
  aspect?: string;
  size?: string;
  outWidth?: number;
  model?: string; // audio only: overrides cfg.models.music
  maxSec?: number; // sfx only: keep this much audio after the first sound
}
const isAudio = (k: Kind) => k === 'music' || k === 'sfx';

const cfg = JSON.parse(readFileSync(join(HERE, 'manifest.config.json'), 'utf8'));

// ---------- CLI ----------
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, def?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const DRY = flag('dry-run');
const FORCE = flag('force');
const NO_ANCHOR = flag('no-anchor');
const ONLY = opt('only');
const CONCURRENCY = Number(opt('concurrency', '2'));
const LIMIT = Number(opt('limit', 'Infinity'));

const globToRe = (g: string) => new RegExp('^' + g.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');

// ---------- Expand jobs from game data ----------
function fill(t: string, vars: Record<string, string>) {
  return t.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

function buildJobs(): Job[] {
  const jobs: Job[] = [];
  const P = cfg.plates;
  for (const lakeId of Object.keys(LAKES)) {
    const lakeDesc = P.lakes[lakeId];
    if (!lakeDesc) continue;
    const covers = new Set(['open', ...LAKES[lakeId].cover.map((c) => c.type)]);
    for (const [wKey, wDesc] of Object.entries<string>(P.weathers)) {
      for (const cover of covers) {
        const id = `plate_${lakeId}_${wKey}_${cover}`;
        jobs.push({
          id,
          kind: 'plate',
          prompt: `${cfg.style} ${fill(P.template, { lake: lakeDesc, cover: P.covers[cover], weather: wDesc })}`,
          out: `assets/plates/${id}.webp`,
          aspect: P.aspect,
          size: P.size,
          outWidth: P.outWidth,
        });
      }
    }
  }
  const R = cfg.portraits;
  for (const sp of Object.keys(SPECIES)) {
    if (!R.species[sp]) continue;
    for (const [cls, clsDesc] of Object.entries<string>(R.classes)) {
      const id = `portrait_${sp}_${cls}`;
      jobs.push({
        id,
        kind: 'portrait',
        prompt: `${cfg.style} ${fill(R.template, { sizeClass: clsDesc, species: SPECIES[sp as keyof typeof SPECIES].name, features: `It is a ${R.species[sp]}.` })}`,
        out: `assets/portraits/${id}.webp`,
        aspect: R.aspect,
        size: R.size,
        outWidth: R.outWidth,
      });
    }
  }
  const I = cfg.icons;
  for (const lure of Object.values(LURES)) {
    for (const colorId of lure.colors) {
      const id = `icon_lure_${lure.id}_${colorId}`;
      jobs.push({
        id,
        kind: 'icon',
        prompt: `${cfg.style} ${fill(I.template, { lure: I.lures[lure.id] ?? lure.name, color: COLORS[colorId].name, hex: COLORS[colorId].hex, bg: I.background })}`,
        out: `assets/icons/${id}.webp`,
        aspect: I.aspect,
        size: I.size,
        outWidth: I.outWidth,
      });
    }
  }
  const S = cfg.scenes;
  for (const [name, desc] of Object.entries<string>(S.items)) {
    const id = `ui_${name}`;
    jobs.push({ id, kind: 'ui', prompt: `${cfg.style} ${desc}`, out: `assets/ui/${id}.webp`, aspect: S.aspect, size: S.size, outWidth: S.outWidth });
  }
  const RD = cfg.rods;
  for (const rod of Object.values(RODS)) {
    const len = rod.name.split(' ')[0];
    const desc = fill(RD.reels[rod.reel], { len, power: RD.powers[rod.power] ?? rod.power });
    const id = `icon_rod_${rod.id}`;
    jobs.push({ id, kind: 'icon', prompt: `${cfg.style} ${fill(RD.template, { desc })}`, out: `assets/icons/${id}.webp`, aspect: RD.aspect, size: RD.size, outWidth: RD.outWidth });
  }
  for (const [name, prompt] of Object.entries<string>(cfg.music.tracks)) {
    jobs.push({ id: `music_${name}`, kind: 'music', prompt, out: `assets/music/music_${name}.mp3` });
  }
  const cue = (prefix: string, items: Record<string, { prompt: string; maxSec: number }>) => {
    for (const [name, { prompt, maxSec }] of Object.entries(items)) {
      const id = `${prefix}_${name}`;
      jobs.push({ id, kind: 'sfx', prompt, out: `assets/sfx/${id}.mp3`, model: cfg.models.clip, maxSec });
    }
  };
  cue('sting', cfg.stings.items);
  cue('sfx_ui', cfg.sfx.items);
  return jobs;
}

// ---------- Cache (prompt hash per asset) ----------
const hashes: Record<string, string> = existsSync(HASHES) ? JSON.parse(readFileSync(HASHES, 'utf8')) : {};
const jobHash = (j: Job) => {
  const key: unknown[] = [j.prompt, j.aspect, j.size, j.outWidth, isAudio(j.kind) ? (j.model ?? cfg.models.music) : cfg.models.image];
  if (j.maxSec !== undefined) key.push(j.maxSec); // appended only when set so older hashes stay valid
  return createHash('sha256').update(JSON.stringify(key)).digest('hex');
};

// ---------- Style references for consistency ----------
interface Ref {
  type: 'image';
  mime_type: string;
  data: string;
}
const anchors = new Map<Kind, Ref>();
function userRefs(kind: Kind): Ref[] {
  const dir = join(STYLE_REFS, kind);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .slice(0, 3)
    .map((f) => ({
      type: 'image' as const,
      mime_type: extname(f).toLowerCase() === '.png' ? 'image/png' : extname(f).toLowerCase() === '.webp' ? 'image/webp' : 'image/jpeg',
      data: readFileSync(join(dir, f)).toString('base64'),
    }));
}

// ---------- Gemini calls ----------
type GenAI = import('@google/genai').GoogleGenAI;
let client: GenAI | null = null;
async function ai(): Promise<GenAI> {
  if (client) return client;
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set. Copy .env.example to .env.local and insert your key.');
  const { GoogleGenAI } = await import('@google/genai');
  client = new GoogleGenAI({ apiKey: key });
  return client;
}

async function withRetry<T>(label: string, fn: () => Promise<T>, tries = 4): Promise<T> {
  let delay = 4000;
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const retryable = /429|500|502|503|504|RESOURCE_EXHAUSTED|UNAVAILABLE|deadline|timeout/i.test(msg);
      if (!retryable || i >= tries) throw e;
      console.warn(`  ${label}: ${msg.slice(0, 120)}. Retrying in ${delay / 1000}s (${i}/${tries - 1})`);
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    }
  }
}

async function generateImage(j: Job): Promise<Buffer> {
  const refs = [...userRefs(j.kind)];
  const anchor = anchors.get(j.kind);
  if (!refs.length && anchor && !NO_ANCHOR) refs.push(anchor);
  const input = refs.length
    ? [{ type: 'text' as const, text: `${j.prompt} Match the art style, palette and rendering of the reference image(s) exactly; do not copy their content.` }, ...refs]
    : j.prompt;
  const c = await ai();
  const res = await withRetry(j.id, () =>
    c.interactions.create({
      model: cfg.models.image,
      input,
      response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: j.aspect, image_size: j.size },
    } as Parameters<GenAI['interactions']['create']>[0]),
  );
  const data = (res as { output_image?: { data?: string } }).output_image?.data;
  if (!data) throw new Error('No image in response');
  return Buffer.from(data, 'base64');
}

async function generateMusic(j: Job): Promise<Buffer> {
  const c = await ai();
  const res = await withRetry(j.id, () => c.interactions.create({ model: j.model ?? cfg.models.music, input: j.prompt } as Parameters<GenAI['interactions']['create']>[0]));
  const data = (res as { output_audio?: { data?: string } }).output_audio?.data;
  if (!data) throw new Error('No audio in response');
  return Buffer.from(data, 'base64');
}

async function runJob(j: Job): Promise<void> {
  const dest = join(PUBLIC, j.out);
  mkdirSync(dirname(dest), { recursive: true });
  if (isAudio(j.kind)) {
    const raw = join(tmpdir(), `bb-${j.id}-${process.pid}.mp3`);
    writeFileSync(raw, await generateMusic(j));
    // Write next to the destination and rename on success, so a failed step never clobbers a good file.
    const tmp = `${dest}.tmp.mp3`;
    try {
      if (j.kind === 'music') loopify(raw, tmp);
      else trimCue(raw, tmp, j.maxSec ?? 1);
      renameSync(tmp, dest);
    } finally {
      rmSync(raw, { force: true });
      rmSync(tmp, { force: true });
    }
  } else {
    const img = await generateImage(j);
    await sharp(img).resize({ width: j.outWidth, withoutEnlargement: true }).webp({ quality: j.kind === 'icon' ? 90 : 80 }).toFile(dest);
    // The first image of each kind anchors the style of the rest (unless user refs exist).
    if (!anchors.has(j.kind)) anchors.set(j.kind, { type: 'image', mime_type: 'image/jpeg', data: img.toString('base64') });
  }
  hashes[j.id] = jobHash(j);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(HASHES, JSON.stringify(hashes, null, 2));
}

// ---------- Audio post-processing (ffmpeg) ----------
const ffmpeg = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const duration = (file: string) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());

/** Seamless loop: crossfade the last X seconds into the first X, then drop the tail. */
function loopify(src: string, dest: string, x = 3) {
  const d = duration(src);
  // Three seeked inputs (head, tail, middle): splitting one stream with asplit stalls ffmpeg.
  const f = `[0]afade=t=in:d=${x}[h];[1]afade=t=out:d=${x}[t];[h][t]amix=inputs=2:normalize=0:duration=longest[x];[x][2]concat=n=2:v=0:a=1[out]`;
  ffmpeg(['-t', `${x}`, '-i', src, '-ss', `${d - x}`, '-i', src, '-ss', `${x}`, '-t', `${d - 2 * x}`, '-i', src, '-filter_complex', f, '-map', '[out]', '-c:a', 'libmp3lame', '-b:a', '160k', dest]);
}

/** UI cue / sting: start at the first sound, keep maxSec, fade the tail, normalise peak. */
function trimCue(src: string, dest: string, maxSec: number) {
  const fade = Math.min(0.4, maxSec * 0.35);
  const f = [
    'silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.005',
    `atrim=0:${maxSec}`,
    `afade=t=out:st=${Math.max(0, maxSec - fade)}:d=${fade}`,
    'areverse,silenceremove=start_periods=1:start_threshold=-55dB,areverse',
    'loudnorm=I=-16:TP=-1.5:LRA=11',
  ].join(',');
  ffmpeg(['-i', src, '-af', f, '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k', dest]);
}

// ---------- Runtime index ----------
function writeIndex(jobs: Job[]) {
  const assets = jobs
    .filter((j) => existsSync(join(PUBLIC, j.out)) && statSync(join(PUBLIC, j.out)).size > 0)
    .map((j) => ({ id: j.id, kind: j.kind, path: relative(PUBLIC, join(PUBLIC, j.out)).split('\\').join('/') }));
  writeFileSync(join(OUT, 'assets.generated.json'), JSON.stringify({ generatedAt: new Date().toISOString(), assets }, null, 2));
  console.log(`Index: ${assets.length} assets listed in public/assets/assets.generated.json`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const all = buildJobs();
  let jobs = ONLY ? all.filter((j) => globToRe(ONLY).test(j.id)) : all;
  const pending = jobs.filter((j) => FORCE || !existsSync(join(PUBLIC, j.out)) || hashes[j.id] !== jobHash(j));
  jobs = pending.slice(0, LIMIT);
  console.log(`${all.length} assets in manifest · ${pending.length} need generating · running ${jobs.length}${DRY ? ' (dry run)' : ''}`);

  if (!DRY && jobs.length && !process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is not set. Copy .env.example to .env.local and insert your own key (or use --dry-run).');
    process.exitCode = 1;
    return;
  }

  if (DRY) {
    for (const j of jobs) console.log(`\n[${j.id}] -> public/${j.out}\n  ${j.prompt}`);
    writeIndex(all);
    return;
  }

  // Style anchors: reuse an already-generated image of each kind (consistency across runs);
  // otherwise generate the first image of each kind before the rest and anchor on it.
  if (!NO_ANCHOR) {
    for (const kind of ['plate', 'portrait', 'icon', 'ui'] as Kind[]) {
      if (userRefs(kind).length) continue;
      const existing = all.find((j) => j.kind === kind && existsSync(join(PUBLIC, j.out)));
      if (existing) {
        const png = await sharp(join(PUBLIC, existing.out)).png().toBuffer();
        anchors.set(kind, { type: 'image', mime_type: 'image/png', data: png.toString('base64') });
      }
    }
  }
  let done = 0;
  let failed = 0;
  const attempt = async (j: Job, note = '') => {
    const t0 = Date.now();
    try {
      await runJob(j);
      done++;
      console.log(`✓ ${j.id}${note} (${((Date.now() - t0) / 1000).toFixed(1)}s) [${done + failed}/${jobs.length}]`);
    } catch (e) {
      failed++;
      console.error(`✗ ${j.id}: ${e instanceof Error ? e.message : e}`);
    }
  };
  const firsts: Job[] = [];
  for (const j of jobs) if (!isAudio(j.kind) && !anchors.has(j.kind) && !firsts.some((f) => f.kind === j.kind)) firsts.push(j);
  for (const j of firsts) await attempt(j, ' (style anchor)');
  const queue = jobs.filter((j) => !firsts.includes(j));
  const worker = async () => {
    for (let j = queue.shift(); j; j = queue.shift()) await attempt(j);
  };
  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));
  writeIndex(all);
  console.log(`Done: ${done} generated, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}

void main();
