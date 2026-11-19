# hyperline, night of 2026-11-18

## Run run-2026-11-19T04-32-26-271Z

**Identity:** a neon rhythm-runner built on reads. Falling Pillars adds a timing read, of when each pillar drops, and stays fair.

- The intro kills the casual bot 13% of the time, with a p10 tap window of 125 ms.
- Fitness went from 99.4 to 99.45.
- A first try with a 92 ms window killed 33% of the time and was widened.
- HYPERCORE is now sector 17.

Changes:
- HAL-230 feature(hyperline): New sector FALLING PILLARS: pillars drop onto the track ahead; hop each: **held** (0.10.0)

## Run run-2026-11-19T05-55-40-173Z

**Hyperline 0.9.1**: a near miss now throws a brief cyan spark off the runner's edge, matching the landing ripple (HAL-234).

- It is visual only: the sim, camera and the held FALLING PILLARS sector are untouched.
- The score is unchanged at 99.4.

Changes:
- HAL-234 polish(hyperline): Near miss gives a brief cyan spark off the runner's edge: **merged** (0.9.1)

## Run run-2026-11-19T08-03-16-458Z

**Hyperline:** neon one-tap timing.
- **Held:** FALLING PILLARS rebuilt (HAL-246). The read is when the pillar lands, not a narrower window, so it stays on identity.
  - The take-off window keeps the 112-125 ms sizing from L-133.
  - Intro kill rate is 7%, down from 13% in the first build. Sector 15 death rate is 0.31, the p10 window is 125 ms, and fitness went from 99.4 to 99.45.
  - HYPERCORE becomes sector 16. The builder updated the pinned indexes in the tests directly.

Changes:
- HAL-246 feature(hyperline): Rebuild sector FALLING PILLARS (hop each dropping pillar) on current main: **held** (0.10.0)
