# tidepool-pals, night of 2026-11-21

## Run run-2026-11-21T14-05-02-181Z

**Tidepool Pals:** a cartoon reef where you rescue sea pals by swiping.

Tonight a little crab scuttles along the rim after a chain of 3 or more and follows the tide direction (HAL-274, 0.14.3, merged). It adds reef life and teaches the tide again without words. It does not change moves, refills or the robot. It skips under reduced motion, and fitness stays at 97.35. It has not been seen on a phone yet.

The octopus level 31 rebuild still waits on your card (HAL-267).

Changes:
- HAL-274 polish(tidepool-pals): A little crab scuttles along the pool's rim after a chain of 3 or more: **merged** (0.14.3)

## Run run-2026-11-21T15-53-40-903Z

**Tidepool** is the reef, its pals and the tides.
- **HAL-280 (dropped):** level 25's moves went from 22 to 18.
  - Win rate went from 70% to 65%, which is fine.
  - Tension barely moved.
  - At 17 moves it broke the level 21-30 ramp test.
- No game change tonight. Tension, at 82.8, stays its weakest measure, and the next attempt should change how a level ends, not its budget.

Changes:
- HAL-280 tuning(tidepool-pals): Tighten the last stretch of the loosest-won level past 15 for closer finishes: **discarded** (0.14.3) (tidepool-pals: no real gain: 0.54 < 6.66)

## Run run-2026-11-21T17-52-16-045Z

**Tidepool Pals**: cartoon reef pals, sea candy and tides.

0.14.3 adds an occasional slow blink to one resting pal every few seconds. It is cosmetic only and skipped during drags, clears, hints and reduced motion. Fitness held at 97.35. It adds charm without blurring the matching, in line with your N-011 ask. Level 31's rebuild is still held.

Changes:
- HAL-286 polish(tidepool-pals): Board pals give an occasional slow, soft blink so the pool feels alive: **merged** (0.14.3)
