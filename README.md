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
node --import tsx tools/advisor-check.ts champlain  # pro-advice gate (see Pro advice)
npm run build        # typecheck + production build + zero-runtime-API guard
```

On iOS: open the LAN URL in Safari, accept the certificate, then **Share → Add to Home Screen** for
full-screen landscape play that works offline.

Desktop keyboard: WASD/arrows steer on the quiet trolling motor (hold Shift to run the outboard), M = lake
map while driving (1-9 picks a PRO stop, 0 follows the route; M/Esc closes), F = fish here, Enter/C = cast, Space = reel (hold it steady for moving baits, short pulses for bottom baits),
T = twitch/hop/shake, H = set the hook, B = thumb brake (also stops a drop shot on the fall), V = bow on a jump,
M = move/burn in once fishing, I = data for this point (between casts), P = pop hook, Esc = pause (or close the
open panel). Steering keys never twitch the lure; the on-screen hint follows the lure.

Setting the hook: a strike is a fish charging the lure; once it has the bait (a thump and a buzz, "HOOK HIM!", and
on touch the HOOK button that replaces REEL glows) you have about a second to set (H or HOOK) before it spits a hard
bait, a little longer with soft plastics. Set while it's still coming and you pull the bait away; on topwater the
blow-up comes first, so wait to feel the weight. Hook-ups also depend on the tackle: a single hook on a long cast
with stretchy mono or fluoro, trebles on braid, a rod too light for a heavy weedless bait and hollow frogs all miss a
few more. Settings has **Auto hookset** (off by default) to set it for you. Space isn't the hookset key because it's
held to reel. Weedless baits (Texas rig, flipping jig, frog; a spinnerbait mostly) can be pitched into docks and
wood without crashing; treble baits ticking into grass foul until you rip them free (T), which is also a strike
trigger for a lipless crank.

Getting around: the chip beside the minimap points at the next PRO stop you haven't fished (name, metres,
an arrow relative to the bow; a stop counts once you cast within casting range of it). Around it the chart
draws the advisor's come-off-plane ring (dashed amber) and your rig's casting range (green); the chip warns
"Idle in now" if you're still on the outboard inside the ring and says "In range" (FISH glows) once you can
reach it. Tap the minimap, the map button or the chip (or press M) for the full lake map: tap a stop to
make it the destination. The clock stops while the map is open, as it does in the pause menu. Hitting the
bank bumps (sound, shake, callout); the boat scrapes along it, and steering away always backs it off. On the
outboard the route keeps to the buoyed boat lanes through stump fields; the chip says "Stay in the lane" when
you run an off-lane stump field and "Off plane: stumps ahead" before the route leaves the lane.

Reading the water (the NES game's soul): fish shadows are drawn from each fish's real interest in the lure.
Curious fish (2-3) hang back faint and half-looking; followers (3+, the follow line) trail the lure at its
depth with a light edge; hot fish (5+) crowd it, tail beating fast, fins flared and glowing; a quick dart
means a strike is coming. A follower that loses interest (or is left at the boat) turns and fades away, and a
soft cue plays (and a tick on touch devices) when one starts following. **Angler's Eye** (Settings, off by
default) shows the lure-action number the NES "MIRUN" cheat revealed: the most interested fish's meter, 0-10,
with the follow (3) and strike (6) lines marked. **Data for this point** (on FISH, the DATA button or I) gives
the NES verdict for the water around the boat ("NICE BASS POINT" / "SOME BASS HERE" / "LITTLE BASS HERE") with
the clock, sky and water temperature. It comes from the advisor's model (expected bass within reach and how
active they are now, against the lake's own range), never from the live fish.

Advice fades as you climb (`src/sim/tierAdvice.ts`, like the NES Class A lakes that hid the hot spots):
Co-Angler gets 6 PRO stops, the Pro rod badge, the full day plan and free point data; Semi-Pro 3 stops; Pro no
stops, a lure/window plan only, and point data costs 2 game minutes; Elite a scouting report and nothing
else. The live coach and the weigh-in notes stay at every tier. The trophy room's **Logbook** keeps every bass
you land (the latest 500): lure and colour, line, clock, weather, water temperature, depth and cover, with the
best lures by lake and season and the record fish.

## Deploying

Every push to `main` builds and publishes to GitHub Pages via `.github/workflows/deploy.yml`
(site lives at `https://<user>.github.io/<repo>/`; the workflow sets `BASE_PATH` to match).
Generated assets are committed, so CI never needs the Gemini key.

## Generating art and music (offline, build time)

```bash
cp .env.example .env.local      # then insert your own GEMINI_API_KEY
npm run assets -- --dry-run     # list every job and its prompt; no API calls
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

## Pro advice

`src/sim/advisor.ts` predicts bites from the game's own strike model (`docs/fish-model.md`): for the
water around each candidate stop it takes how many bass the placement model puts there, their depth
and activity at that hour, and the leaky interest meter's strike line, and works out which of them a
rig converts over a stop's worth of casts (fish only strike on their closest pass; slow baits let
followers close in). Cast pace and the cadence match an expert achieves are measured with the
human-proxy harness. It tells you **what** to tie on, **where** to fish (a milk run of stops),
**how** to work it and approach the spot, **when** each rig is best, and what to expect.

`tools/advisor-check.ts` is the acceptance gate: the harness expert fishes every lure on the same
seeded days, once on a player's default itinerary and once on the advisor's route, and the advice
must beat the alternatives with 95% CIs that exclude zero. Rerun it whenever lure, species, lake or
attraction tuning changes:

```bash
for plan in itinerary advisor; do node --import tsx tools/harness/run.ts --lake champlain --profile expert \
  --rigs lures --days 30 --jobs 8 --plan $plan --out docs/model-reports/gate-champlain-$plan.json; done
node --import tsx tools/advisor-check.ts champlain
```

The harness (`tools/harness/`) plays through the real inputs (keyboard or stick) with expert, average
and naive-keyboard profiles, each setting the hook with its own timing (the expert on the thump, the
average player sometimes late, the naive one often early or late) and drop-shotting the marks it saw
on the sonar as it stopped; see `docs/model-reports/` for its reports. Bass/day counts strikes, as the
advisor predicts; hooked and missed show the hookset. It caps itself at 8 worker
processes and its workers refuse to spawn more.

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
