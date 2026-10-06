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

Every fish within 45 m of the lure keeps an interest score 0-10 (the NES "HBMAX" successor).

```
fit = activity x match x depthMatch x proximity x cover x vulnerability x (1 - 0.7 hookShy)
      x lureTempFit x lightWindFit x colorFit x lineVisibility x speciesAffinity x (1 - 0.4 pressure)
dI/dt = gainPerSec x fit - leakPerSec x I          (fish time = real time x gameSpeedScale)
```

- Interest settles toward `gainPerSec x fit / leakPerSec` (11 / 1.2 ~ 9 x fit). **Strike at 6**
  (fit ~0.65), **follow at 3** (fit ~0.33): a middling presentation draws followers that don't commit
  (the shadows behind your lure), a poor one is ignored.
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
- Reaction strikes: a crankbait deflecting off rock/wood/docks, a pause after a steady retrieve, or a
  tube landing on rock add an interest spike to nearby fish.
- Time compression: lure motion runs `gameSpeedScale` (3) x real time so a retrieve takes seconds, and
  fish react in the same game time, so fast baits get the same exposure per metre they would in life.

## 5. Why the leaky meter (audit, Oct 2026)

The first model used `dI/dt = gain x fit - 0.4`. Any fish with fit above ~0.04 eventually crossed the
strike line, so bites measured water covered, not fit: lure choice and technique barely mattered and
the pro advice could not be meaningfully right or wrong. With the leak, fit sets *how interested* a
fish can get, so the right lure, depth, cadence and spot matter, and skill separates players.
See `docs/model-reports/` for before/after harness numbers.

## 6. Known simplifications

- Fish don't school or relate to each other; bait (shad) isn't modelled.
- Wind direction doesn't move fish to banks yet (wind only affects lure fit and casting).
- Fight outcome doesn't depend on cover except standing timber (line wraps).
