# Pro advisor acceptance gate

`tools/advisor-check.ts` against human-proxy play (`tools/harness`, expert profile, every lure fished
alone on the same 30 seeded days), once on a player's default itinerary (`gate-<lake>-itinerary.*`)
and once on the advisor's route for that lure and day (`gate-<lake>-advisor.*`). Bass strikes per
tournament day, 95% bootstrap CIs over days. Lake Fork as shipped (8,500 bass; see Balance). Full output: `gate-<lake>.txt`.

| Check | Champlain (Amateur) | Lake Fork (Semi-Pro, CWIR) |
|---|---|---|
| WHERE: advisor route vs default itinerary | 18.10 vs 8.93, diff CI [7.30, 11.03] **PASS** | 8.27 vs 4.70, diff CI [2.00, 5.20] **PASS** |
| WHAT: advisor's top lure vs median lure (on route) | 18.10 vs 13.72, diff CI [3.53, 5.22] **PASS** | 8.27 vs 6.92, diff CI [0.47, 2.32] **PASS** |
| RANK: per-day Spearman, advisor score vs bites | 0.68 [0.62, 0.74]; pooled 0.90 **PASS** | 0.52 [0.42, 0.61]; pooled 0.84 **PASS** |
| CALIB: per lure-day, predicted vs harness | Spearman 0.90; harness/predicted 0.76 | Spearman 0.89; harness/predicted 0.68 |

16 lures (batch D1 tackle), hookset, check-in, Lake Fork catch-weigh-immediate-release (batch D2 + fix).
Earlier 8-lure results (pre-batches): Champlain WHERE 13.03 vs 6.57, WHAT +2.4, RANK 0.62; Fork WHERE
5.93 vs 3.90, WHAT +1.3, RANK 0.56.

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

### After batches A-D (Oct 2026)

Drag, faster landing of beaten fish, the new tackle and CWIR scoring raised advised bags (Champlain
expert on the advisor's pick: median place 4 of 30, top 3 on 47% of days; Fork: 5th of 40, 37%).
Field medians were raised to restore the target, found by re-placing the gate's harness days against
scaled fields: Champlain x1.08 (Amateur 11.5 -> 12.5 lb ... Elite 19), Lake Fork x1.12 (Semi-Pro
12.5 -> 14 lb ... Elite 21). Advised expert now: Champlain median 6th of 30 (top 3 on 43% of days),
Fork 9th of 40 (30%); a player fishing the default itinerary finishes around 18th and 31st.
