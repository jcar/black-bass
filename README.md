# Black Bass Pro Tour

A touch-first tournament bass fishing game for iPhone and iPad, inspired by the 1989 NES classic
*The Black Bass*. Built as an installable, offline PWA. The runtime is 100% static and makes no API calls.

## Quick start

```bash
npm install
npm run dev          # https://localhost:5173 (self-signed cert)
npm run dev:lan      # same, exposed on your LAN so you can open it on an iPhone/iPad
npm test             # simulation unit tests
npm run simulate     # headless bot plays tournament days; prints balance stats
                     # e.g. npm run simulate -- 30 lakefork SemiPro
npm run build        # typecheck + production build + zero-runtime-API guard
```

On iOS: open the LAN URL in Safari, accept the certificate, then **Share → Add to Home Screen** for
full-screen landscape play that works offline.

Desktop keyboard fallback: WASD/arrows = stick, Space = reel, Shift/B = thumb brake, Enter/C = cast,
T/↑ = twitch, ↓ = bow, F = fish here, M = move/burn in, P = pop hook.

## Deploying

Every push to `main` builds and publishes to GitHub Pages via `.github/workflows/deploy.yml`
(site lives at `https://<user>.github.io/<repo>/`; the workflow sets `BASE_PATH` to match).
Generated assets are committed, so CI never needs the Gemini key.

## Generating art and music (offline, build time)

```bash
cp .env.example .env.local      # then insert your own GEMINI_API_KEY
npm run assets -- --dry-run     # list all 94 jobs and their prompts; no API calls
npm run assets -- --only "plate_champlain_bluebird_*"
npm run assets                  # everything that's missing or whose prompt changed
```

- Prompts live in `tools/asset-pipeline/manifest.config.json` and are expanded against the game data
  (lakes × weather × cover plates, species × size portraits, lure × colour icons, music loops).
- Output goes to `public/assets/**` with an index (`public/assets/assets.generated.json`) the game reads.
- Style consistency: drop up to 3 reference images per kind into `tools/asset-pipeline/styleRefs/<plate|portrait|icon>/`.
  Without references, the first generated image of each kind anchors the rest.
- Re-runs are incremental (prompt hashes in `tools/asset-pipeline/.cache`). Use `--force` to regenerate.
- Menu art (`ui_*`: marina, weigh-in stage, tackle shop, rod locker, trophy room) and rod renders
  come from the same pipeline. Hub hotspots are positioned against `ui_marina` in `MarinaScreen.tsx`.
- Music uses Lyria 3.5 (~2 min tracks), made loop-seamless with an ffmpeg crossfade. Google has no
  sound-effects model, so UI cues (`sfx_ui_*`) and broadcast stings (`sting_*`) are short Lyria clips
  trimmed with ffmpeg (needs `ffmpeg`/`ffprobe` on PATH). In-game SFX are still synthesised at
  runtime; any `sfx_<event>` file added to the index takes priority.
- Until assets exist, the game draws everything procedurally, so it's always playable.

## Adding a lake

Lakes are data (`src/data/lakes/<id>.json`, typed by `src/data/lakes/types.ts`). Reservoirs with many
creek arms are easiest to author as a sketch: basins (polygons) plus arms (centre-lines with
tapering widths), with optional shoreline wobble and generated coves.

```bash
npx tsx tools/lake-shape.ts lakefork           # tools/lakes/lakefork.sketch.json -> src/data/lakes/lakefork.json
npx tsx tools/lake-preview.ts lakefork out.png  # depth, cover, lanes, stumps, waypoints; flags anything on land
npm run simulate -- 30 lakefork SemiPro         # calibrate field.medianBagLb against the bot
```

Then register it in `src/data/lakes/index.ts` (`LAKES` and `LAKE_LADDER`), add a plate description
in the asset manifest (`plates.lakes`, optional `plates.lakeCovers`), and run
`npm run assets -- --only "plate_<id>_*" --no-anchor`. Per-lake options: `regs` (minimum length and
protected slot with catch-weigh-release), `lanes`/`stumpZones` (boat lanes and the stump hazard), and
`standing` timber cover (fishable; can wrap light line in a fight).

## Architecture

| Path | What |
|---|---|
| `src/sim/` | Pure, deterministic TypeScript simulation (no DOM/React/Pixi): conditions, fish population and AI, attraction meter, cast, lure physics, fight, livewell, AI field, tournament state machine |
| `src/data/` | Lakes (JSON), species, lures, rods, and `tuning.ts` (**every** gameplay constant) |
| `src/state/` | Zustand store, save/load (versioned localStorage), career logic |
| `src/render/` | PixiJS v8 scenes: map + forward-facing sonar, cast view, top-down lure/fight view with depth inset |
| `src/game/` | Fixed-timestep runner, input hub (touch + keyboard), runtime asset index |
| `src/ui/` | React screens, HUD and touch controls. `src/ui/kit/` is the game UI kit (Motion-based buttons, broadcast slugs/lower-thirds, scorebug, sheets, count-ups, scenes); screens compose it |
| `tools/` | Asset pipeline, lake authoring (`lake-shape.ts`, `lake-preview.ts`, `lakes/*.sketch.json`), balance simulator, icon rasteriser, build guard |

Fish behaviour is modelled on published bass research (temperature curves, dawn activity peak,
barometric trend, boat-noise spooking, standard-weight curves, lure fall rates, line stretch). See the
comments in `src/data/tuning.ts` and `src/sim/fish/` for sources.
