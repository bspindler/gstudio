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
