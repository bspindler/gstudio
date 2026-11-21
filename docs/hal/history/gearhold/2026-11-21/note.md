# gearhold, night of 2026-11-21

## Run run-2026-11-21T14-05-02-181Z

**Gearhold:** a brass-clockwork top-down shooter, now with levels that each have their own enemy or goal.

- **Dropped:** a late wisp drone on Terrace of Dials barely moved tension (37.8 to 38.3) and failed the tuning bar (HAL-273).
- **Held:** Press Gallery's drones now split into two fast biting minis when scrapped (HAL-276, 0.11.0). gearhold-play rose from 96.32 to 98.09 and level 4 wins are 0.83. Level 4's feel fell to 85.1, against 98 to 100 on the other levels, and its own tension row is missing.
- **Live:** Turret Gallery is now level 9 (HAL-270).
- **Still waiting:** the Boiler Stair cinder mites (HAL-265).

Changes:
- HAL-273 tuning(gearhold): Tighten the final stretch of the loosest-won level for closer finishes: **discarded** (0.10.1) (gearhold-play: no real gain: 0.50 < 8.80)
- HAL-276 feature(gearhold): Press Gallery (level 4): fission drones split in two when shot: **held** (0.11.0)

## Run run-2026-11-21T15-53-40-903Z

**Gearhold** is brass, steam and clockwork rooms, and since N-034 each level should have its own enemy or goal.
- **Bellworks (HAL-283, held as 0.11.0):** a stationary bell-golem boss with glowing, chiming shockwave telegraphs. It wins 73% of the time, with pace, feel and fair damage at 100.
- It arrives with a judge patch that adds `n: 5` to the scorer's threat table, with the pin test updated in the same patch.
- **Terrace of Dials (HAL-279, dropped):**
  - Swapping two drones for rams dropped its threat per step so far that The Orrery counted as a wall.
  - One swap passes, but showed no gain, and the level's row never got measured.
  - It is still a 99%-win level and still needs a real layout change.

Changes:
- HAL-279 tuning(gearhold): Terrace of Dials: swap its drones for brass rams so it plays unlike the others: **discarded** (0.10.1) (gearhold-play: no real gain: 0.00 < 6.99)
- HAL-283 feature(gearhold): New level 10 'Bellworks': a bell-golem guards the exit with slow shockwaves: **held** (0.11.0)

## Run run-2026-11-21T17-52-16-045Z

**Gearhold**: brass, readable fights, one level at a time.

The Terrace of Dials retune (HAL-285) put a kilnwarden on the final crossing, with a repair crystal beyond the door. The level's own wins fell from about 99% to 47% (winnable 58.33, pace and feel 100), using existing enemy kinds and the terrace's dial look. It was discarded because the overall play score barely moved (96.32 to 96.46), and the final one-crystal map was never re-scored after a revert. The fix is right in spirit, so I'd resend it as a re-scored fix. Bellworks, Press Gallery's fission drones and the cinder-mite Boiler Stair are still held.

Changes:
- HAL-285 tuning(gearhold): Terrace of Dials: route its last stretch through one guarded crossing: **discarded** (0.10.1) (gearhold-play: no real gain: 1.06 < 8.98)

## Run run-2026-11-21T18-50-33-301Z

**Gearhold:** dim brass halls and clockwork foes. Machines now show a brief brass glint in the last 0.28s before they bite or fire (HAL-293, 0.10.1, merged). It is rendering only; rams and turrets are excluded, and glow stays where it belongs. Gearhold-play held at 96.3. The Terrace of Dials kilnwarden fix (HAL-289) timed out before building and goes again next run, smaller. Bellworks, Press Gallery and Boiler Stair (HAL-283, HAL-276, HAL-265) are still held.

Changes:
- HAL-289 fix(gearhold): Terrace of Dials: guard its final crossing with one kilnwarden, re-scored as a…: **discarded** (implementer timed out)
- HAL-293 polish(gearhold): Enemies flash a brief brass glint just before they attack: **merged** (0.10.1)
