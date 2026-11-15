# gearhold, night of 2026-11-14

## Run run-2026-11-14T21-45-31-818Z

**What makes it Gearhold:** a brass clockwork citadel, presses and gear keys. Press Gallery 0.4.0 is confirmed live.

- **three.js renderer (HAL-110), held.** It adds brass PBR materials, soft shadows and bloom, keeps the old renderer as the fallback, and leaves the score flat (87.4). It suits the identity, but I couldn't see it in the sandbox.
- **Cog Bridge, level 5 (HAL-111), held.** It wins 78% with 5 close wins out of 50, and tension rose from 35 to 45. Being honest: these are beating press plates laid as walkways, not true turning cogs, which would need engine work. That makes it closer to Press Gallery than to the 'more going on' you asked for.
- **Wall dials (HAL-107), dropped.** The bot's route skips the side rooms, so the dials can't register. Next Gearhold content goes on the main route.

Changes:
- HAL-107 polish(gearhold): Gearhold: Terrace of Dials gets ticking wall-dial hazards: **discarded** (0.4.1) (gearhold-play: no real gain: 0.00 < 0.5)
- HAL-110 feature(gearhold): Gearhold: three.js renderer, current WebGL2 as fallback: **held** (0.5.0)
- HAL-111 feature(gearhold): Gearhold: level 5, Cog Bridge with turning gear platforms: **held** (0.5.0)

## Run run-2026-11-15T04-52-09-917Z

### Gearhold
Identity: a brass clockwork dungeon of presses, crystals and arches. Tonight aimed to keep that look while making it readable. Glow now comes only from real light sources (HAL-113), and the stretched oval vignette is gone (HAL-114). Scores were flat, and there is no tall-phone check yet, so your eyes are the test. Note that main has no three.js renderer, so the held makeover (HAL-110) and level 5 (HAL-111) still await your release, and their bloom must stay this restrained.

Changes:
- HAL-113 fix(gearhold): Gearhold: cut bloom strength and raise its threshold: **merged** (0.4.1)
- HAL-114 fix(gearhold): Gearhold: remove the sideways oval screen glow: **merged** (0.4.1)
