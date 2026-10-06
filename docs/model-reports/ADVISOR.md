# Pro advisor acceptance gate

`tools/advisor-check.ts` against human-proxy play (`tools/harness`, expert profile, every lure fished
alone on the same 30 seeded days), once on a player's default itinerary (`gate-<lake>-itinerary.*`)
and once on the advisor's route for that lure and day (`gate-<lake>-advisor.*`). Bass strikes per
tournament day, 95% bootstrap CIs over days. Lake Fork as shipped (8,500 bass; see Balance). Full output: `gate-<lake>.txt`.

| Check | Champlain (Amateur) | Lake Fork (Semi-Pro) |
|---|---|---|
| WHERE: advisor route vs default itinerary | 13.03 vs 6.57, diff CI [5.17, 7.80] **PASS** | 5.93 vs 3.90, diff CI [1.00, 3.20] **PASS** |
| WHAT: advisor's top lure vs median lure (on route) | 13.03 vs 10.62, diff CI [1.48, 3.33] **PASS** | 5.93 vs 4.65, diff CI [0.70, 1.95] **PASS** |
| RANK: per-day Spearman, advisor score vs bites | 0.62 [0.52, 0.71]; pooled 0.85 **PASS** | 0.56 [0.45, 0.67]; pooled 0.90 **PASS** |
| CALIB: per lure-day, predicted vs harness | Spearman 0.82; harness/predicted 0.75 | Spearman 0.87; harness/predicted 0.63 |

Every lure gains on the advisor's route (Champlain +2.7 to +5.7 bites/day, Fork +0.4 to +2.7), and
hard-cover crashes drop from 1-9 a day to 0-2.

## How it got there

The first rebuild treated every cast as meeting fresh fish and predicted 70 bites/hour. Two mechanics
of the engine were missing: within a stop the same fish see the lure again and again, and interest is
deterministic, so a fish strikes on its closest pass or never (depletion); and a fish past the follow
line swims at the lure and takes its depth, so slow baits convert followers that fast ones outrun
(follow-in). With both, per-visit predictions matched the harness within a constant factor (0.57-0.83
for every lure). The remaining error was time per cast: bottom baits are worked at about 1.4x reel speed
with hops (16 s a cast, not 55 s), measured from the harness and now used by the advisor. The expert
profile was taught to count a bladed jig down, as the advice says (match 0.72 when counted down).

## Balance (where an expert following the advice finishes)

`tools/harness/placement.ts` places each harness day against that seed's AI field.
Champlain Amateur: median place 6-7 of 30, top 3 on ~30% of days (one rig, no switching).
Lake Fork Semi-Pro was out of reach (expert on the advisor's route: median place 29-39 of 40, a 10-12 lb
bag against a 13 lb field median; the medians had been fitted to the old teleporting bot). Two changes,
measured in `fork8500-advisor.txt`: the bass population went from 6,500 to 8,500 (a skilled angler can
now fill a limit and cull: 5.4-6.6 bites/day, 12-13 lb), and every Fork tier's field median was scaled
by 0.8 (Semi-Pro 16 -> 12.5 lb). Advisor's top Fork pick (chatterbait) now finishes a median 7th of
40, top 10 on 60% of days, top 3 on 17%: a step up from Champlain, not a wall.
