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
