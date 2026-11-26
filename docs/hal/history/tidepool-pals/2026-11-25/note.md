# tidepool-pals, night of 2026-11-25

## Run run-2026-11-26T03-39-37-315Z

**Tidepool 0.16.1 (merged).** Level 32 gets 20 moves instead of 16. Wins went from 34% to 43%, noWalls to 100, and fitness from 97.32 to 98.27. At 22 moves the difficulty-ramp test broke. The pals, the trapped pal and the tides are unchanged, and nothing was tuned around +5. Whether 43% is inside the band is unconfirmed.

Changes:
- HAL-338 fix(tidepool-pals): Bring the level furthest outside its win band back into it: **merged** (0.16.1)

## Run run-2026-11-26T06-00-04-974Z

**Tidepool Pals (cartoon reef match-3)**
- **Held (HAL-346):** new level 34 is a turtle-shaped pool with 8 sand cells, a goal of 4 kelp in 18 moves, and a rightward tide.
- **Fix during the build:** the first version was too easy and broke the level 31-45 difficulty ramp. More sand and a bigger goal fixed it.
- **Scores:** 54% wins, inBand 98.4, fitness 98.27 to 98.32.

Changes:
- HAL-346 feature(tidepool-pals): New level 34: a sea-turtle pool with sand trails and a sideways tide: **held** (0.17.0)
