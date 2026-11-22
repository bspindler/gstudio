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

## Run run-2026-11-21T19-57-50-284Z

**Gearhold:** brass-and-steam halls, machine foes and a key-or-goal route through each level. Tonight a kilnwarden was added to the final crossing of Terrace of Dials (level 1), so the level no longer wins itself. Wins went from 99% to 82%, tension from 39.4 to 45.6, and fitness from 96.3 to 97.6. The layout and the look are unchanged. Bellworks, Press Gallery's fission drones and Boiler Stair's cinder mites are still held.

Changes:
- HAL-294 fix(gearhold): Terrace of Dials: one kilnwarden guards the final crossing, re-scored: **merged** (0.10.1)

## Run run-2026-11-21T21-59-13-038Z

**Gearhold:** brass-machine halls with deliberate aim-and-fire.

- **Merged (HAL-298):** one Turret Gallery turret moved from (21,2) to (19,4), in the doorway row, with the door left clear. Turret Gallery feel is now 100.
- **Score dip:** overall gearhold-play fell from 97.63 to 96.95 and is unexplained, so it needs a look.
- **Version:** labelled 0.10.1 again, so the version bump was missed.
- **Dropped (HAL-297):** the only out-of-band level is Press Gallery (winnable 53.33, hit ratio 0.24), which is held under HAL-276, so nothing could be retuned.
- **Identity:** kept. No layout changes.

Changes:
- HAL-297 fix(gearhold): Retune one foe's health on the level furthest outside its winnable band: **discarded** (implementer blocked: The only level outside its winnable band is Press Gallery (level 3, winnable 53.33, winRate 0.95), which the ticket forbids touching (HAL-276). All other levels score winnable 100, so no permitted level can be retuned.)
- HAL-298 fix(gearhold): Lift feel on the merged level with the lowest hit ratio: **merged** (0.10.1)

## Run run-2026-11-22T00-23-21-048Z

**Gearhold.** Its identity is brass machines, timed presses and furnace heat, and tonight's work stayed on it. Boiler Stair's cinder mites (HAL-303) are on main at 51% wins with pace and feel at 100, and the furnace character of level 6 holds. Bellworks (HAL-304) is a brass bell-golem boss as level 10. It is held only because its new tile needs a scorer threat weight through the asks path; the score is 96.96, or 97.27 with Bellworks. The Press Gallery rebuild (HAL-302) timed out. A builder reading showed level 4's feel at 67, which I can't yet explain and want re-scored before the next attempt.

Changes:
- HAL-302 feature(gearhold): Rebuild Press Gallery's fission drones that split when shot, on current main: **discarded** (implementer timed out)
- HAL-303 feature(gearhold): Rebuild Boiler Stair's cinder-mite swarms on current main: **merged** (0.11.0)
- HAL-304 feature(gearhold): Rebuild level 10 Bellworks: bell-golem boss with slow shockwaves: **held** (0.11.0)

## Run run-2026-11-22T06-00-05-822Z

**Gearhold**: brass machine halls, with a press-timing level and enemies of its own. The Press Gallery fission drones are live in their gentler form: 2 big, slow minis, feel 100 and 83% wins. They kept the level's own enemy instead of sanding it off, and gearhold-play went from 96.96 to 99.16. The other levels' rows were not re-read on the final run. Bellworks (HAL-304) still needs the scorer's threat weight change.

Changes:
- HAL-308 feature(gearhold): Rebuild Press Gallery's fission drones with fewer, slower, larger minis: **merged** (0.11.0)
