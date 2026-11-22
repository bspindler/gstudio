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

## Run run-2026-11-21T18-50-33-301Z

**Tidepool Pals:** a calm reef swap-match with the pals at the centre. The goal counter now bounces with a glow in the matching pal's colour each time a clear counts toward it (HAL-290, merged). It ties the board to the mission without new text and leaves tile colours and level data alone. Fitness held at 97.3. No before-change baseline was taken, and it hasn't been seen on a phone. It shipped as 0.14.3, a version already used twice, so the numbering is wrong. Level 31 (HAL-267) is still held.

Changes:
- HAL-290 polish(tidepool-pals): Goal counter gives a small bounce each time a clear counts toward it: **merged** (0.14.3)

## Run run-2026-11-21T19-57-50-284Z

**Tidepool Pals:** cartoon reef pals, Sea Candy, and rescuing a trapped pal on the board. Tonight a freed pal swims along an arc into the goal counter, and the counter bounces only when the pal lands. The counter's bounce now ties the rescue on the board to the goal. With reduced motion on, the pal falls back to the old swim-off. Fitness held at 97.35. It has not been seen on a phone yet, and the version was wrongly left at 0.14.3.

Changes:
- HAL-295 polish(tidepool-pals): Freed pal swims up into the goal counter instead of off the board: **merged** (0.14.3)

## Run run-2026-11-21T21-59-13-038Z

**Tidepool Pals:** reef rescue, pals and tides.

- **Dropped (HAL-299):** moving level 25's stranded pal up into the seahorse's mane raised tension from 82.8 to 84.5, and the level's win rate went from 70% to 66%. Fitness stayed at 97.35, so it missed the gain bar.
- **Unchanged:** level 31 (held under HAL-267) was not touched.
- **Next:** single-level layout nudges won't move tension enough. Any further work should reshape several late levels together, or move on.

Changes:
- HAL-299 tuning(tidepool-pals): Move a 16+ level's last goal later on the board for closer finishes: **discarded** (0.14.3) (tidepool-pals: no real gain: 1.67 < 6.58)

## Run run-2026-11-22T06-00-05-822Z

**Tidepool Pals**: a hand-made cartoon reef where you rescue the pal. Level 32 is a jellyfish pool with a bubbled pal and sand trails, and no rock pools (L-150). Its win rate is unmeasured because the scorer only covers levels 1-31, so its moves may still need trimming.

Changes:
- HAL-310 feature(tidepool-pals): New level 32: a jellyfish-shaped pool with sand trails and a bubbled pal: **held** (0.15.0)
