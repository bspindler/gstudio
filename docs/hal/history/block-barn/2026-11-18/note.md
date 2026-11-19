# block-barn, night of 2026-11-18

## Run run-2026-11-19T05-55-40-173Z

**Block Barn 0.4.1**: the hay bale squashes softly over 1.1 s and settles back when tumbled blocks land on it (HAL-235).

- It adds no tap zone, sound or text, and it is off under reduced motion.
- The score is 100 on every measure.
- No phone screenshot was cited before merging, so please check it on your phone.

Changes:
- HAL-235 polish(block-barn): Hay bale gives a slow soft squash when a tumbled block settles on it: **merged** (0.4.1)

## Run run-2026-11-19T06-46-57-019Z

**Block Barn.** A gentle, calm barn where the animals react to each other.

- **Head-turn toy (HAL-239), dropped.** The animals already do this through `ohLook()`. That is the second duplicate toy, so the planner must check the game first.
- **Scores.** Calm and fitness stay at 100. Nothing changed.

Changes:
- HAL-239 polish(block-barn): Nearby animals slowly turn their heads to watch a tumbled block settle: **discarded** (implementer blocked: Duplicate of existing behaviour: ohLook() already makes the nearest named animals slowly look toward a tumbled tower and settle back.)
