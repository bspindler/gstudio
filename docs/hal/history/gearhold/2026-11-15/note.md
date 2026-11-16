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

## Run run-2026-11-15T18-52-03-456Z

**Gearhold 0.5.2: three.js makeover merged (HAL-127).** It keeps the brass clockwork look: same lighting, fog, shadows and sky, rebuilt on the shared three.js copy. Bloom is limited to light sources, which honours your N-018 complaint about too much glow. If three.js fails at startup or while running, the game falls back to the old renderer. The play score moved from 87.5 to 87.7. The risk is that scoring timed out four times, so the renderer has not been seen loading in a browser, and the last version crashed on load. Cog Bridge (HAL-124) is still waiting on you.

Changes:
- HAL-127 fix(gearhold): Gearhold: fix three.js renderer crash on load: **merged** (0.5.2)

## Run run-2026-11-15T21-24-29-875Z

**Gearhold**

Identity: a brass clockwork platformer with presses, gears and kiln heat.

- **HAL-135, Cog Bridge (dropped):** level 5, with turning gear platforms on the main route that spin faster and glow before they bite.
  - In band on win rate (0.83) and pace (47 s median).
  - It lifted gearhold-play 87.7 → 89.2.
  - The gate rejected it because the level's feel was 81.6, below the roughly 94.8 bar the existing levels set.
  - The ticket quoted the wrong band, so the next try should aim at the gate's real number.
- The 0.5.2 three.js renderer still hasn't been seen loading in a browser.

Changes:
- HAL-135 feature(gearhold): Gearhold: level 5 Cog Bridge, turning gear platforms: **discarded** (0.6.0) (gearhold-play: new levels[4] feel 81.64 is out of its band (needs >= 94.84))

## Run run-2026-11-15T23-32-53-315Z

**Gearhold**: brass clockwork exploration. The Cog Bridge retry timed out before building, so nothing changed tonight. Still outstanding: confirming in a real browser that the 0.5.2 three.js renderer loads rather than silently falling back.

Changes:
- HAL-140 feature(gearhold): Gearhold: level 5 Cog Bridge with clear sightlines: **discarded** (implementer timed out)

## Run run-2026-11-16T06-00-02-465Z

**Gearhold:** both tickets were dropped, but both moved closer. The easing pass (HAL-145) lifted winnable from 71.7 to 78.3 and put Kiln Heart in band, while Press Gallery overshot to 0.92 wins. Cog Bridge (HAL-147) now passes feel (100) with a kilnwarden and foes on the main route, and misses only the per-level pace bar (94.9 against 97.1). The beat-timed brass identity is intact in both.

Changes:
- HAL-145 tuning(gearhold): Gearhold: ease Kiln Heart and Press Gallery together toward the win band: **discarded** (0.5.4) (gearhold-play: no real gain: 6.67 < 17.31)
- HAL-147 feature(gearhold): Gearhold: level 5 Cog Bridge with turning gear platforms, feel at the bar: **discarded** (0.6.0) (gearhold-play: new levels[4] pace 94.94 is out of its band (needs >= 97.12))
