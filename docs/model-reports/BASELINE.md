# Fish model baseline (before the audit fixes)

Human-proxy harness (`tools/harness`), current model at commit `12ddae4`. Each lure fished alone on
the same paired days and spot itineraries; bass strikes per tournament day with bootstrap 95% CIs.
Raw rows in the `baseline-*.json` files next to this one.

## Lake Champlain (Amateur, 30 days)

| Lure | Expert | Average | Naive keyboard |
|---|---|---|---|
| Tube | 5.47 [4.20, 6.67] | 4.93 [3.83, 6.07] | 4.73 [3.90, 5.60] |
| Football jig | 5.13 [4.00, 6.37] | 5.07 [4.13, 6.07] | 4.37 [3.57, 5.17] |
| Ned rig | 5.03 [4.00, 6.13] | 4.17 [3.33, 5.03] | 3.80 [2.90, 4.80] |
| Bladed jig | 4.47 [3.20, 5.73] | 3.70 [2.67, 4.80] | 2.63 [2.03, 3.40] |
| Squarebill | 4.03 [2.87, 5.40] | 3.93 [2.77, 5.20] | 2.33 [1.83, 2.87] |
| Drop shot | 3.53 [2.40, 4.77] | 4.00 [2.87, 5.20] | 5.23 [4.53, 5.97] |
| Walking topwater | 2.67 [1.73, 3.63] | 2.47 [1.63, 3.37] | 1.37 [0.93, 1.83] |
| Jerkbait | 2.63 [1.77, 3.53] | 2.70 [1.77, 3.80] | 0.93 [0.50, 1.40] |

Fish spooked within 30 m on arrival: expert 3-5%, average 44-49%, naive keyboard 54-58%.
Hard-cover crashes: 2-16 per day for every profile (docks/laydowns; near-cover detection broken).

## Lake Fork (Semi-Pro; expert 20 days, others 12)

| Lure | Expert | Average | Naive keyboard |
|---|---|---|---|
| Football jig | 4.20 [2.65, 5.85] | 3.92 [2.00, 6.08] | 1.67 [0.75, 2.75] |
| Tube | 3.50 [2.25, 4.90] | 3.25 [1.50, 5.33] | 1.83 [0.92, 2.83] |
| Ned rig | 3.20 [2.10, 4.35] | 2.83 [1.50, 4.33] | 1.08 [0.17, 2.42] |
| Bladed jig | 2.35 [1.20, 3.65] | 2.08 [0.75, 3.83] | 1.08 [0.42, 1.83] |
| Squarebill | 1.90 [1.00, 3.00] | 1.92 [0.83, 3.08] | 1.17 [0.33, 2.17] |
| Drop shot | 1.60 [0.95, 2.35] | 2.08 [0.83, 3.50] | 2.83 [1.50, 4.42] |
| Jerkbait | 1.20 [0.65, 1.70] | 0.92 [0.50, 1.42] | 0.08 [0.00, 0.25] |
| Walking topwater | 1.00 [0.45, 1.65] | 0.83 [0.33, 1.42] | 0.17 [0.00, 0.50] |

## What it shows

- **Lure choice barely matters:** most lures' CIs overlap; the saturating strike model rewards water
  covered, not fit. The pro advice's top Champlain picks (bladed jig, squarebill) are mid-pack here.
- **Skill barely matters:** expert vs average differ by less than the noise on most lures.
- **The naive keyboard player loses most on the steady baits** (↑ also twitches; full-throttle
  arrivals spook ~55% of nearby fish), matching the player report on squarebill and bladed jig.
- **Few casts:** 10-50 casts/day; travel and idling eat the clock, so location choice dominates.

## Correction (harness navigation)

The tables above were produced before the harness got route planning: its greedy steering pinned the
boat against a peninsula for much of some days, understating casts (especially for the expert).
`baseline2-champlain.*` is the same original model (commit `12ddae4`) re-measured with the fixed
harness, 20 paired days:

| Lure | Expert | Average | Naive keyboard |
|---|---|---|---|
| Ned rig | 6.65 [5.40, 7.85] | 5.60 [4.50, 6.75] | 3.80 [3.00, 4.65] |
| Drop shot | 6.45 [4.40, 8.45] | 5.85 [4.35, 7.35] | 4.85 [3.95, 5.70] |
| Football jig | 6.35 [5.00, 7.75] | 6.35 [5.20, 7.55] | 3.95 [3.10, 4.95] |
| Tube | 6.20 [4.55, 7.80] | 5.70 [4.80, 6.65] | 4.45 [3.40, 5.65] |
| Squarebill | 5.40 [4.15, 6.65] | 4.60 [3.40, 5.95] | 2.45 [1.75, 3.15] |
| Bladed jig | 5.25 [4.10, 6.40] | 4.55 [3.40, 5.80] | 2.05 [1.45, 2.65] |
| Jerkbait | 4.35 [3.25, 5.60] | 4.40 [3.55, 5.30] | 1.15 [0.55, 1.80] |
| Walking topwater | 4.15 [3.05, 5.30] | 2.95 [2.00, 4.00] | 1.30 [0.80, 1.85] |

Then, same harness: `fixes2-champlain.*` = bug fixes only (constant decay saturates even harder once
fish react in game time: expert 7-11 bites/day, all lures overlapping), and `leaky-champlain.*` =
fixes + leaky interest (leak 1.2): expert 4.4-7.1, average 3.9-6.7, naive keyboard 0.7-4.4.
