# gearhold, night of 2026-11-16

## Run run-2026-11-16T12-26-21-669Z

**Gearhold** is brass clockwork you walk through, with learnable press rhythms and a restrained glow.

- **Shipped:** Cog Bridge is live as level 5 on main.
- **Discarded:** two tuning passes on its too-easy levels.
  - The Orrery's extra crawler moved wins from 1.00 to 0.98.
  - Press Gallery's faster final presses moved wins from 0.95 to 0.93.
  - Both kept the levels' personality, and both were too weak to matter.
- **Re-planned:** the `?level=N` start link (HAL-155) was built correctly, but its added line read the HAL flag. It will be rebuilt without that.
- **Next:** stronger single levers on the main route, such as health supply or a second enemy, rather than more press timing.

Changes:
- HAL-151 tuning(gearhold): Gearhold: The Orrery, one more main-route enemy near the exit: **discarded** (0.6.0) (gearhold-play: no real gain: -2.66 < 13.47)
- HAL-152 tuning(gearhold): Gearhold: Press Gallery presses slam a beat faster on the last stretch: **discarded** (0.6.0) (gearhold-play: no real gain: 2.67 < 13.92)
- HAL-155 feature(gearhold): Gearhold: ?level=N in the page address starts at that level: **discarded** (tripwire hal-hook: games/gearhold/index.html: added statement touches the hal hook, counters or HAL flag: const linked = HAL || !R3 ? null : levelFromSearch(location.search, LEVELS.length))

## Run run-2026-11-17T06-00-02-636Z

**Gearhold.** This is the brass keep: learnable press waves and crawler corridors you get through by timing.
- The `?level=N` start link is built and held (HAL-174, 0.6.0). It has no HAL guard, it clamps to the real level count, and level stats are unchanged.
- **Press Gallery crystal (HAL-170), dropped.** It went into band: wins 0.95 to 0.63, winnable 77.3 to 86.7, fitness 90.1 to 92.5. It was still dropped for falling short of the gain bar (9.3 against 12.3). The press wave was kept.
- **The Orrery's crystals (HAL-171), dropped.** Moving them to far corners did nothing (wins 0.98 to 0.97). Its supply rule won't let them go further, so health supply is the wrong lever there.
- **Next:** one combined ticket, the Press Gallery change plus a main-route threat for The Orrery.

Changes:
- HAL-170 tuning(gearhold): Press Gallery: remove the mid-gallery repair crystal so wins drop into band: **discarded** (0.6.0) (gearhold-play: no real gain: 9.34 < 12.30)
- HAL-171 tuning(gearhold): The Orrery: cut its health supply so the level stops being a sure win: **discarded** (0.6.0) (gearhold-play: no real gain: -1.33 < 13.48)
- HAL-174 feature(gearhold): Gearhold: ?level=N in the page address starts at that level: **held** (0.6.0)
