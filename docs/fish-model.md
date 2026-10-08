# Fish model

How a bass decides to bite in Black Bass Pro Tour. All constants live in `src/data/tuning.ts`; the
code is in `src/sim/` (paths below). Validated with the human-proxy harness (`tools/harness`, reports
in `docs/model-reports/`).

## 1. Where fish are (`fish/population.ts`)

- Each lake places `species.count` fish. A random water point is accepted with probability
  `depthSuitability(species, season, depth) x coverWeight`, where `coverWeight = (cover pref / 1.8)^2`
  for fish on structure and `0.35` for the 30% placed off structure (`population.offStructureFrac`).
  Structure therefore concentrates fish roughly 4x over open water.
- Species come from the lake's mix, overridden inside species zones (e.g. Champlain's largemouth bays).
- Fish wander a home range (largemouth ~35 m, smallmouth ~60 m) and hold at
  `holdingDepth = bottom x (1 - rise)`, rising toward the surface in low light when active.
- `vulnerability` ~ lognormal(1, 0.45) clipped to 0.2-2.5: some fish are far easier to catch
  (Philipp et al.). Each hook-up adds hook-shyness for later days.

## 2. How active they are (`fish/activity.ts`)

`activity = tempFactor x timeOfDay x pressureTrend x postFront x tempTrend x sky x season`, ~0.15-1.6.
Temperature is an asymmetric Gaussian around each species' optimum; dawn is the peak window; a falling
barometer is 1.3x, rising 0.75x; post-front lockjaw hits big fish hardest.

## 3. Spooking

- Outboard within 28 m: 0.75/s chance to spook each fish for 15-40 game minutes. Trolling motor:
  5 m, 0.3/s, 5 minutes. **Idle in; don't run over the spot.**
- A lure landing on hard cover (docks, laydowns) spooks fish within 12 m for 20 minutes. Edge casts
  (within ~8 m of cover) are rewarded instead.

## 4. The interest meter (`fish/attraction.ts`, `presentation.ts`)

Every fish within 45 m of the lure keeps an interest score 0-10, a successor to the NES game's hidden
lure-action number (the "MIRUN" name-entry cheat displays it; players aim to keep it at or above 6.0).

```
fit = activity x match x depthMatch x proximity x cover x vulnerability x (1 - 0.7 hookShy)
      x lureTempFit x lightWindFit x colorFit x lineVisibility x speciesAffinity x (1 - 0.4 pressure)
dI/dt = gainPerSec x fit - leakPerSec x I          (fish time = real time x gameSpeedScale)
```

- Interest settles toward `gainPerSec x fit / leakPerSec` (11 / 1.2 ~ 9 x fit). **Strike at 6**
  (fit ~0.65), **follow at 3** (fit ~0.33): a middling presentation draws followers that don't commit
  (the shadows behind your lure), a poor one is ignored.
- What you see is the meter: the underwater view draws each fish by its interest (curious 2-3, following
  3+, hot 5+, a dart just before the strike, a turn-away when a follower gives up), and the Angler's Eye
  setting shows the top fish's number (`src/render/scenes/WaterScene.ts`, `Hud.tsx`).
- `proximity = 1 - distance / detectRange`. Detection range is sight (scales with water clarity and
  light, 1.5-9 m) or vibration (lure vibration x 4.5 m, +3 m in muddy water), whichever is larger.
- `depthMatch` is Gaussian in the gap between lure depth and fish depth (sigma 3 + 8 x activity ft):
  active fish move further for a bait.
- `match` scores the cadence the lure is designed for (`presentationMatch`):
  steady baits want an unbroken retrieve in their speed band (a slip under 0.3 s is forgiven);
  jerkbaits want 1-3 twitches then a pause whose ideal length depends on water temperature;
  walking baits want an even rhythm; bottom baits want to be on the bottom, moved slowly with hops;
  drop shots want shaking in place.
- Colour is deliberately small (about +/-10%): research finds little catch-rate difference at constant
  clarity (Moraga et al. 2015). Natural colours in clear water, bright/dark in stained.
- Reaction strikes: a crankbait deflecting off rock/wood/docks, a pause after a steady retrieve, a
  tube landing on rock, or a treble bait ripped free of the grass add an interest spike to nearby fish.
- Big-fish baits (swimbait, frog, flipping jig) multiply fit by `(length / lake median)^(3 x lean)`,
  clamped 0.5-1.8: roughly weight^lean, so bigger fish eat them and small ones less, with the mean
  barely changed. The swimbait's low bite rate comes from its species affinity (0.65-0.7).
- **Dwell** (shake-in-place baits): a fish within detection range of a drop shot shaken in place
  (on the bottom or held mid-water, under 0.1 m/s, shaken in the last 3 s) drifts in to look. Its
  effective proximity climbs from `p` toward the lure by up to `dwellCap` (0.6) of the gap after
  `dwellFullSec` (15 s fish time, 5 s real): `p' = p + (1 - p) x min(cap, cap x dwell / full)`. This is
  how vertical drop-shotting works: hold the bait on a fish and it comes to it.
- Time compression: lure motion runs `gameSpeedScale` (3) x real time so a retrieve takes seconds, and
  fish react in the same game time, so fast baits get the same exposure per metre they would in life.

## 5. Tackle mechanics (`cast.ts`, `presentation.ts`, `fight.ts`)

- **Weedless** (`LureDef.weedless`): `'full'` baits (Texas rig, flipping jig, frog) landing on docks or
  laydowns go into the cover instead of crashing: no spook, an edge cast (cover bonus) beside the fish
  that live there. `'partial'` (spinnerbait) still crashes 40% of the time. The advisor doesn't
  discount weedless baits at hard cover.
- **Grass**: a treble bait without a weed guard running within 3 ft of the bottom of a grass or reeds
  cell fouls: its cadence match drops to 35% until a twitch rips it free, which pops it up 2 ft and
  fires a reaction spike (strongest for the lipless crank, built for it).
- **Leader rigs** (`leaderFt`): the drop shot's bait rides 1.5 ft above the weight, the Carolina rig's
  about 1 ft, so "on the bottom" for them is the leader's height off it.
- **Suspended drop shot**: BRAKE (thumb the spool) on the fall stops the drop shot at that depth
  (`present.held`); shaking works there as on the bottom, so you can hold it at a suspended fish's
  depth read off the sonar inset. Another press lets it fall again.
- **Hookset**: a strike is the fish charging the lure (0.55 s). Subsurface, it has the bait on reaching
  it; on topwater the blow-up comes first and it has the bait 0.3 s later. The player must set
  (`InputFrame.hookSet`: keyboard H, touch HOOK, which replaces REEL during a strike and glows once the
  fish has it) within 0.9 s of the bite (soft plastics: 1.4 s). Too early (before it has the bait, which
  is the topwater trap) or too late misses; a set on time hooks with probability
  `0.95 x hookRate x (single hook: 1 - 0.6 x stretch x min(1, lineOut / 25 m)) x (trebles on braid: 0.96)
  x (rod lighter than the lure's power: 0.85)`. A missed fish is spooked 10 game minutes and gains 0.2
  hook-shyness; the cast goes on. Trebles on braid also throw the hook 1.35x as often on a jump.
  **Auto hookset** (Settings, off by default; `TournamentState.autoHookset`) sets 0.15 s after the bite.
  H is a dedicated key because Space is held to reel, so a press on it can't tell a set from a retrieve.

## 6. Why the leaky meter (audit, Oct 2026)

The first model used `dI/dt = gain x fit - 0.4`. Any fish with fit above ~0.04 eventually crossed the
strike line, so bites measured water covered, not fit: lure choice and technique barely mattered and
the pro advice could not be meaningfully right or wrong. With the leak, fit sets *how interested* a
fish can get, so the right lure, depth, cadence and spot matter, and skill separates players.
See `docs/model-reports/` for before/after harness numbers.

## 7. The pro advisor (`advisor.ts`)

The advice is the strike model run forward analytically, not a separate heuristic:

- **Fish at a stop:** expected bass per cell from the placement odds above (depth suitability x cover
  preference, species zones), over the water within 40 m of the stop.
- **Will a given fish strike?** Interest settles at `gain x fit / leak`, so a fish strikes when
  `vulnerability x proximity x F0 >= strikeAt x leak / gain`, where F0 is the rest of the fit product
  for that cell, hour, rig and an expert's measured cadence match. Within a visit the same fish see the
  lure repeatedly and interest is deterministic, so a fish strikes on its closest pass or not at all:
  with `K ~ Poisson(lambda)` passes, `P = E_vuln[1 - exp(-lambda (1 - x))]`. A fish past the follow line
  swims at the lure and takes its depth; if the bait is slow enough to catch (follow speed vs lure
  speed), it strikes at full proximity and depth match. This is why slow baits convert followers.
- **Time:** cast cycle from the lure's reel speed and the pace an expert works it (measured), fall time,
  ~60 s per move and ~15 s per fish. Expected bites per stop visit become bites per day, over the
  fishing day: blast-off to check-in less the run back to the launch (one move) and the "head in"
  margin (`DAY_FISHING_SEC`, ~823 of 900 real seconds). The retrieve path scales with cast distance
  (heavy baits cast further and sweep more water).
- **Drop shot:** the expert casts to fish it saw on the forward sonar when it stopped, thumbs the bait at
  a suspended fish's depth, and shakes ~15 s before reeling up. The advisor applies the dwell to the
  proximity a fish needs, a depth match of 0.8 for suspended fish, and a sonar-targeting factor (1.75 x
  the encounter rate) fitted so the drop shot's harness/predicted ratio matches the other lures'.
- Hook-ups are not in the prediction: the advisor and the gate count strikes; missed sets show in bags.
- **Outputs:** lure ranking, a milk run of distinct stops (marked PRO 1-6 on the map), best windows,
  technique and approach tips, and the day's outlook (scaled by the measured play calibration, 0.75).
- **Gate:** `tools/advisor-check.ts` (README, "Pro advice"). The live coach (`coach.ts`) explains
  misses with the same rules: spooked arrivals, crashes, broken retrieves, followers that won't commit,
  fishless water.

## 8. Tournament rules (`livewell.ts`, `tournament.ts`, `nav.ts`)

- **Lake Fork regulations** (TPWD, `lakefork.json` `regs`): 16-24" largemouth are a protected slot and go
  back immediately: never in the livewell, never weighed (the catch card says so). Only one bass 24" or
  longer may be kept a day; a second is released, or swapped for the smaller one (not a dead one). The
  tournament minimum is 14". (The 2024 Elite at Lake Fork ran catch-weigh-release with on-boat judges,
  so slot fish counted there; this game's events weigh in at the ramp, which the slot rule forbids.)
  Rivals keep only legal fish; their kicker (24"+) comes from `field.bigFishOdds` and keeps its own
  weight, so the field swings on big fish. Champlain: 12" minimum, no slot.
- **Check-in** (B.A.S.S. "Rules are rules: the late penalty"): be back at the launch (within 60 m) by
  3:00 PM. CHECK IN (K) there ends the day early, from an hour after blast-off. Sitting at the launch at
  check-in time checks you in. Out on the water the day runs on: 1 lb per minute late (any part of a
  minute counts), and more than 15 minutes late the day's catch counts zero. The "Head in" warning fires
  when the clock plus the run back plus 10 minutes reaches check-in: the run is a Dijkstra over the grid
  from the launch on the outboard's route (lanes through stump fields, which count at just under stump
  speed), at 80% of top speed. After it, the destination chip points home with the run time. About 2.5%
  of rivals check in late (15% of those too late to count).
- **Livewell survival:** each kept fish has health 1 (lively) to 0 (dead), "sluggish" below 0.5. It comes
  aboard at `1 - 0.0025 x fight seconds x sqrt(heat) x size / hardiness` and loses
  `0.02/h x heat x size / hardiness` in the livewell, where `heat = 1 + ((T - 72F)/7)^2` above 72F,
  `size = (lb / 3)^0.35` and hardiness ~ lognormal(1, 0.35) from the sim rng when it's landed
  (deterministic). With no culling, ~0.1% of fish kept from capture to check-in die at 76F, ~1.6% at
  80F, ~13% at 84F, ~36% at 88F. Champlain's summer water (median 69F) never kills; Lake Fork's
  tournament months (Feb-May, Oct-Nov, median 65F) only rarely reach 80F, so a dead fish there is a
  warm-day event. Dead fish can't be culled and cost 4 oz each
  at the scales (B.A.S.S. "the dead fish penalty"). The coach warns when a fish goes sluggish ("Hot water:
  cull and weigh early, fish shorter fights") and the debrief counts dead fish and lateness.
- **Sonar** (render only): every return is the same colour (no spooked or species tell), carries a fixed
  per-fish size error (x0.55-1.8), and fades into clutter returned by wood, grass and docks
  (`src/render/sonarNoise.ts`). The harness reads the sim directly and is unaffected.

## 9. Known simplifications

- Fish don't school or relate to each other; bait (shad) isn't modelled.
- Wind direction doesn't move fish to banks yet (wind only affects lure fit and casting).
- Fight outcome doesn't depend on cover except standing timber (line wraps).
- Only exposed trebles foul in grass; single-hook baits (Ned, tube, bladed jig) come through it clean.
- The advisor treats big-fish baits' size lean as extra spread in vulnerability, not by fish size.
