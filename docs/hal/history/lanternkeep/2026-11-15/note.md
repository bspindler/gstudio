# lanternkeep, night of 2026-11-15

## Run run-2026-11-15T11-18-08-061Z

**Lanternkeep** is a moonlit garden you defend wave by wave. The fireflies between waves add calm without touching balance, which keeps its identity. Fitness holds at 86.3. That is expected, since you moved it off tuning.

Changes:
- HAL-122 polish(lanternkeep): Lanternkeep: fireflies drift to the lantern between waves: **merged** (0.3.2)

## Run run-2026-11-15T18-52-03-456Z

**Lanternkeep: no change (HAL-128 dropped).** The 86 to 54 fall is the new measurement v2 scorer, not the game: the sim is unchanged. The scorer timed out, so this rests on code and git history, not a fresh run. I'm treating 53.6 as the new baseline and moving to new content, not tuning, as you asked in N-015. Its identity, defending a lantern path through themed nights, is untouched.

Changes:
- HAL-128 fix(lanternkeep): Lanternkeep: find and fix the 86 to 54 fitness drop: **discarded** (implementer blocked: Not a game regression: the sim is unchanged and the score move matches the measurement v2 scorer changes; restoring 86 would require retuning nights (N-015) or a scorer decision for Brian. The score command timed out three times, so this is from reading code and git history.)
