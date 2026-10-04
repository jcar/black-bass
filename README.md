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
npm run assets -- --dry-run     # list all 73 jobs and their prompts; no API calls
npm run assets -- --only "plate_champlain_bluebird_*"
npm run assets                  # everything that's missing or whose prompt changed
```

- Prompts live in `tools/asset-pipeline/manifest.config.json` and are expanded against the game data
  (lakes × weather × cover plates, species × size portraits, lure × colour icons, music loops).
- Output goes to `public/assets/**` with an index (`public/assets/assets.generated.json`) the game reads.
- Style consistency: drop up to 3 reference images per kind into `tools/asset-pipeline/styleRefs/<plate|portrait|icon>/`.
  Without references, the first generated image of each kind anchors the rest.
- Re-runs are incremental (prompt hashes in `tools/asset-pipeline/.cache`). Use `--force` to regenerate.
- Sound effects are synthesised at runtime: Google's generation APIs currently have no SFX model.
  Any `sfx_<event>` file added to the index takes priority.
- Until assets exist, the game draws everything procedurally, so it's always playable.

## Architecture

| Path | What |
|---|---|
| `src/sim/` | Pure, deterministic TypeScript simulation (no DOM/React/Pixi): conditions, fish population and AI, attraction meter, cast, lure physics, fight, livewell, AI field, tournament state machine |
| `src/data/` | Lakes (JSON), species, lures, rods, and `tuning.ts` (**every** gameplay constant) |
| `src/state/` | Zustand store, save/load (versioned localStorage), career logic |
| `src/render/` | PixiJS v8 scenes: map + forward-facing sonar, cast view, top-down lure/fight view with depth inset |
| `src/game/` | Fixed-timestep runner, input hub (touch + keyboard), runtime asset index |
| `src/ui/` | React screens, HUD and touch controls |
| `tools/` | Asset pipeline, balance simulator, icon rasteriser, build guard |

Fish behaviour is modelled on published bass research (temperature curves, dawn activity peak,
barometric trend, boat-noise spooking, standard-weight curves, lure fall rates, line stretch). See the
comments in `src/data/tuning.ts` and `src/sim/fish/` for sources.
