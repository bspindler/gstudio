# lanternkeep, night of 2026-11-18

## Run run-2026-11-18T12-28-25-567Z

**Lanternkeep:** a moonlit garden defence.
- Moonbell is rebuilt on current main as HAL-224: a soft chime that briefly stills nearby creatures.
  - It has a 1.5 s immunity so stacked bells can't stun-lock, bosses get half the stun, and it unlocks from night 6.
- Its balance is **still unmeasured**, because the scorer bot never plants it.
  - The bot patch is attached to the card.
  - The fitness figures disagree: the run shows 95.8 → 89.4, while the builder reports 95.8. Treat both as unproven until Hal re-scores with the bot patch.
- Night 16, Burrowing Dark, with the Hollow Mole, is on main.

Changes:
- HAL-224 feature(lanternkeep): Rebuild Moonbell, the fifth plant that stuns, on current main: **held** (0.6.0)

## Run run-2026-11-19T04-32-26-271Z

**Identity:** a gentle, moonlit garden defence. Mirror Mist keeps that and is the kind of big leap you asked for: a creature that changes where you plant, not just how much.

- **Moonbell** is live on your 👍. It pushed three nights out of band, and fitness fell from 95.8 to 89.4.
- **The retune (HAL-225)** fixed those nights exactly, back to 95.8, but was dropped on the tuning gain bar. It will be resent as a fix.
- **Mirror Mist (HAL-229)** is held: 46% wins, and fitness went from 89.44 to 89.83.

Changes:
- HAL-225 tuning(lanternkeep): Retune the nights Moonbell's rebuild pushed out of band: **discarded** (0.6.0) (lanternkeep: no real gain: 12.50 < 17.78)
- HAL-229 feature(lanternkeep): New night 17 'Mirror Mist': Twin Wisps split in two when first struck: **held** (0.6.0)

## Run run-2026-11-19T05-55-40-173Z

**Lanternkeep 0.6.0**: The Fork, Mossy Ford and Crosswind are rebalanced so those nights are a fair fight with Moonbell in the arsenal (HAL-231).

- Fitness went from 89.4 to 95.8, with inBand and noSpikes both at 100.
- It went in as a fix and changed only the three hpMul values.
- Moonbell and the held night 17 (Mirror Mist) are untouched.

The moonlit tower defence is intact.

Changes:
- HAL-231 fix(lanternkeep): Restore night bands after Moonbell: hpMul for The Fork, Mossy Ford, Crosswind: **merged** (0.6.0)

## Run run-2026-11-19T06-46-57-019Z

**Lanternkeep.** A moonlit garden you defend with plants under a lantern.

- **Lamplit Orchard (HAL-241), held.** It is a big leap, as you asked: Lampmoths dive at the brightest plant and blind it for a few seconds. That makes plant placement a real choice. They are drawn in code with pale glowing wings and no new assets, so the soft look is kept.
- **Balance.** Night 17 wins 58% and is in band. No earlier night moved.
- **Clashes.** It shares the night-17 slot with Mirror Mist (HAL-229), and it reuses version 0.6.0.

Changes:
- HAL-241 feature(lanternkeep): New night after the last: Lampmoths swarm toward the brightest plant: **held** (0.6.0)

## Run run-2026-11-19T08-03-16-458Z

**Lanternkeep:** moonlit garden defence, now taking the big leaps you asked for (N-033).
- **Held:** Mirror Mist rebuilt on 0.6.0 with Moonbell (HAL-245). Twin Wisps split in two when struck, each half quicker and carrying half the remaining health. That is a new read on the path, not a harder copy of an old night.
  - Night 17 scored 0.65 wins and a 0.32 close-win share. Night 16 sits at 0.42, so there is no spike.
  - Fitness held at 95.83.
  - It carries the label 0.6.0, which is already used.
  - It shares night 17 with Lampmoths (HAL-241).
  - Burning ground damages a twin without splitting it. That was left as is.

Changes:
- HAL-245 feature(lanternkeep): Rebuild night 17 'Mirror Mist' (Twin Wisps split when struck) on current main: **held** (0.6.0)
