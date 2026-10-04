// Runtime side of the offline art pipeline. The game only ever reads static files that the
// GeminiAssetBuilder wrote into public/assets; it never calls any API. Missing assets fall back
// to procedural drawing, so the game is fully playable before any art has been generated.
import { Assets, Texture } from 'pixi.js';
import type { CoverType, SpeciesId, Weather } from '../sim/types';

export interface AssetEntry {
  id: string;
  kind: 'plate' | 'portrait' | 'icon' | 'ui' | 'music' | 'sfx';
  path: string;
}

let index: Record<string, AssetEntry> = {};
const textures = new Map<string, Texture | null>();

export async function loadAssetIndex(): Promise<void> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}assets/assets.generated.json`, { cache: 'no-cache' });
    if (!res.ok) return;
    const data = (await res.json()) as { assets: AssetEntry[] };
    index = Object.fromEntries(data.assets.map((a) => [a.id, a]));
  } catch {
    index = {};
  }
}

export const assetUrl = (id: string): string | null => (index[id] ? `${import.meta.env.BASE_URL}${index[id].path}` : null);

/** Returns the texture if loaded, kicks off a background load otherwise (null until ready). */
export function texture(id: string): Texture | null {
  if (textures.has(id)) return textures.get(id) ?? null;
  const url = assetUrl(id);
  textures.set(id, null);
  if (url) {
    Assets.load<Texture>(url)
      .then((t) => textures.set(id, t))
      .catch(() => textures.set(id, null));
  }
  return null;
}

// Naming scheme shared with tools/asset-pipeline/manifest.json.
export const plateId = (lakeId: string, weather: Weather, cover: CoverType) =>
  `plate_${lakeId}_${weather.toLowerCase()}_${cover === 'none' ? 'open' : cover}`;
export const portraitId = (species: SpeciesId, weightLb: number) =>
  `portrait_${species}_${weightLb >= 5 ? 'trophy' : weightLb >= 2.5 ? 'quality' : 'small'}`;
export const lureIconId = (lureId: string, colorId: string) => `icon_lure_${lureId}_${colorId}`;
export const rodIconId = (rodId: string) => `icon_rod_${rodId}`;
export const musicId = (name: string) => `music_${name}`;
