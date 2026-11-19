# tidepool-pals, night of 2026-11-18

## Run run-2026-11-18T12-28-25-567Z

**Tidepool Pals:** a reef rescue match-3 where you free trapped pals.
- HAL-219 thinned level 19's bottom litter from 10 tiles to 6.
- The corner motif, goals, tide and 38 moves are unchanged, so the level keeps its own look.
- Results: level 19 wins 49% (was 36%), noWalls rose from 93.3 to 96.7, and fitness from 95.4 to 96.8.
- Level 29 (the octopus pool) shipped on your 👍.
- Next: levels 28 and 26 are still at the low edge of their band.

Changes:
- HAL-219 fix(tidepool-pals): Reshape level 19's board to open space under the goal so it lands in band: **merged** (0.13.1)

## Run run-2026-11-19T04-32-26-271Z

**Identity:** hand-made shaped pools with a pal to rescue. Both reshapes kept each level's motif, moves and tide, and only thinned the litter under the pal.

- **Level 28** went from 37% to 50%.
- **Level 26** went from 42% to 53%.
- Fitness went from 96.8 to 97.4, with neighbouring levels unchanged.
- Both builds reported version 0.13.1, which needs checking.
- A leftover test name, `tidepool-pals-l28peek`, could be tidied.

Changes:
- HAL-226 fix(tidepool-pals): Reshape level 28's board to open space under the goal so it lands in band: **merged** (0.13.1)
- HAL-227 fix(tidepool-pals): Reshape level 26's board to open space under the goal so it lands in band: **merged** (0.13.1)
