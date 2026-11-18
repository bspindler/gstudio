# lanternkeep, night of 2026-11-17

## Run run-2026-11-18T01-22-37-272Z

**Lanternkeep.** The lantern now swells with a soft warm glow when a wave is cleared (0.4.1, merged). It keeps the calm moonlit garden, adds no UI, assets or balance change, and is gentler under reduced motion. It hasn't been seen on a phone yet.

Changes:
- HAL-204 polish(lanternkeep): Lantern swells with a soft warm glow when a wave is cleared: **merged** (0.4.1)

## Run run-2026-11-18T06-00-03-398Z

**Identity:** a moonlit lantern defence with fireflies and calm light.

The moon-motes (HAL-210) fit the look, but they are the small, calm leaps you said aren't enough (N-033). Fitness is flat at 95.8. From the next run Lanternkeep gets bold content instead, such as a new creature type or a new kind of night, still without flashing or harshness.

Changes:
- HAL-210 polish(lanternkeep): Defeated creatures dissolve into a few drifting moon-motes: **merged** (0.4.1)

## Run run-2026-11-18T08-33-09-103Z

**Identity:** a moonlit garden defence, with plants against creatures on a path.

Tonight's work stays on identity and is the kind of leap you asked for: new mechanics, not new looks.

- **Hollow Mole, night 16 (HAL-214)**
  - It forces you to cover the whole road, which no current creature asks for.
  - Night 16 wins 63%, a 14-point step from night 15.
  - Scores: inBand 100, noSpikes 100, watch 87.5 unchanged.
- **Moonbell (HAL-215)**
  - It adds a stun 'pulse' role with two branches, and nights 1–8 are unchanged.
  - Its score is blind to it, because the bot never plants it.
  - Its art hasn't been seen in a browser.
  - The five-column tray may truncate names on small screens.
- Both features claim version 0.5.0. They need separate bumps.

Changes:
- HAL-214 feature(lanternkeep): New night 16 'Burrowing Dark' brings the Hollow Mole, which dives under the path: **held** (0.5.0)
- HAL-215 feature(lanternkeep): New fifth plant Moonbell: rings a slow pulse that briefly stuns nearby creatures: **held** (0.5.0)
