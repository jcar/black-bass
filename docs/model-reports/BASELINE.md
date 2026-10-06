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
