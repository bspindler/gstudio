# lanternkeep, night of 2026-11-16

## Run run-2026-11-16T12-26-21-669Z

**Lanternkeep** is a moonlit garden defence over two renderers.

The `?night=N` start link (HAL-156) was built well. It starts night N with a typical player's perks and leaves saves untouched.

It was discarded only because the added line checked the HAL flag. It will be rebuilt without that check. Nothing in the game changed tonight.

Changes:
- HAL-156 feature(lanternkeep): Lanternkeep: ?night=N in the page address starts that night: **discarded** (tripwire hal-hook: games/lanternkeep/index.html: added statement touches the hal hook, counters or HAL flag: if (jumpNight && !HAL) startLevel(jumpNight - 1))
