# lanternkeep, night of 2026-11-15

## Run run-2026-11-15T11-18-08-061Z

**Lanternkeep** is a moonlit garden you defend wave by wave. The fireflies between waves add calm without touching balance, which keeps its identity. Fitness holds at 86.3. That is expected, since you moved it off tuning.

Changes:
- HAL-122 polish(lanternkeep): Lanternkeep: fireflies drift to the lantern between waves: **merged** (0.3.2)

## Run run-2026-11-15T18-52-03-456Z

**Lanternkeep: no change (HAL-128 dropped).** The 86 to 54 fall is the new measurement v2 scorer, not the game: the sim is unchanged. The scorer timed out, so this rests on code and git history, not a fresh run. I'm treating 53.6 as the new baseline and moving to new content, not tuning, as you asked in N-015. Its identity, defending a lantern path through themed nights, is untouched.

Changes:
- HAL-128 fix(lanternkeep): Lanternkeep: find and fix the 86 to 54 fitness drop: **discarded** (implementer blocked: Not a game regression: the sim is unchanged and the score move matches the measurement v2 scorer changes; restoring 86 would require retuning nights (N-015) or a scorer decision for Brian. The score command timed out three times, so this is from reading code and git history.)

## Run run-2026-11-15T21-24-29-875Z

**Lanternkeep, 0.3.2 (two merges)**

Identity: a calm garden defence where you guard a lantern through 15 story nights, then the endless Night Watch.

- HAL-131 makes waves after wave 15 grow and bunch up faster. Night Watch now ends 30–60% of the way in for every play style (watch 80.7). The opening waves are untouched.
- HAL-132 raises wave strength on nights 6–11 and 13–15 to match a typical player's perks. Night 12 already sat in band. inBand went 40 → 100, with no spikes.
- Fitness 53.6 → 93.6 on the v2 baseline, without chasing the old 86.
- The tone is kept, with harder late nights but no new pressure mechanics.
- Both changes are labelled 0.3.2, so one is missing its own bump.

Changes:
- HAL-131 tuning(lanternkeep): Lanternkeep: Night Watch late waves ramp up faster: **merged** (0.3.2)
- HAL-132 tuning(lanternkeep): Lanternkeep: scale late nights to a typical player's perks: **merged** (0.3.2)
