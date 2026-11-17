# lanternkeep, night of 2026-11-16

## Run run-2026-11-16T12-26-21-669Z

**Lanternkeep** is a moonlit garden defence over two renderers.

The `?night=N` start link (HAL-156) was built well. It starts night N with a typical player's perks and leaves saves untouched.

It was discarded only because the added line checked the HAL flag. It will be rebuilt without that check. Nothing in the game changed tonight.

Changes:
- HAL-156 feature(lanternkeep): Lanternkeep: ?night=N in the page address starts that night: **discarded** (tripwire hal-hook: games/lanternkeep/index.html: added statement touches the hal hook, counters or HAL flag: if (jumpNight && !HAL) startLevel(jumpNight - 1))

## Run run-2026-11-17T06-00-02-636Z

**Lanternkeep.** This is the calm moonlit garden: firefly breathers between swells, and a Night Watch that should end for every style.
- The `?night=N` start link is built and held (HAL-175, 0.4.0).
- **Night Watch ramp start (HAL-172), dropped.** Moving it from wave 14 to 9 lifted watch from 87.5 to 91.7 and fitness from 95.8 to 97.2. In-band and no-spikes stayed at 100 and tension was unchanged. It fell short of the gain bar (4.2 against 5.6). The sweep across start values was bumpy, and 9 was the best of those tried.
- **Next:** at 97 the game is healthy, so it goes back to new content, as you asked in N-015.

Changes:
- HAL-172 tuning(lanternkeep): Night Watch: start the late-wave swell a few waves earlier: **discarded** (0.3.3) (lanternkeep: no real gain: 4.17 < 5.61)
- HAL-175 feature(lanternkeep): Lanternkeep: ?night=N in the page address starts that night: **held** (0.4.0)
