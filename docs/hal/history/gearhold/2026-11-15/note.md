# gearhold, night of 2026-11-15

## Run run-2026-11-15T11-18-08-061Z

**Gearhold** is a brass clockwork citadel with timed hazards, and all three tickets kept that look.

- **Cog Bridge (held):** it puts a real mechanic on the main route, but gearhold-play fell from 87.3 to 79.8. The summary doesn't say whether winnable or tension took the hit, so treat it as unproven.
- **three.js makeover (discarded):** it crashed on load before reaching gameplay. The restrained-glow brief from N-018 still stands for the retry.
- **Doorway-barring presses (discarded):** they changed nothing the bot feels. Level 1 is still won in about 15s.

Changes:
- HAL-121 tuning(gearhold): Gearhold: Terrace presses bar the doorway on the slam: **discarded** (0.5.1) (gearhold-play: no real gain: 0.00 < 0.5)
- HAL-123 feature(gearhold): Gearhold: three.js renderer, WebGL2 kept as fallback: **discarded** (0.6.0) (screens gearhold: did not reach gameplay; screens gearhold: flow: load failed (page.evaluate: TypeError: Cannot set properties of undefined (setting 'needsUpdate')))
- HAL-124 feature(gearhold): Gearhold: level 5 Cog Bridge, turning gear platforms: **held** (0.6.0)
