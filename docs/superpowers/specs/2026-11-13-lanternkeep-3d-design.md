# Lanternkeep 0.2: 3D, polish, and a stronger first ten minutes

Operator request (2026-11-13): "make it 3d instead of 2d, polish all art, screens etc and add a lot more engaging content esp early on to get my attention." Operator delegated all calls.

## Intent

Lanternkeep 0.1 works but is quiet: the first minute is reading a bar, finding a tile, and waiting for moths. 0.2 has to grab a first-time player within seconds and keep pulling them forward: something new on every early level, an active ability so there's always something to do, and a reason to come back (meta-progression, endless mode). The 3D look carries the identity: a dark garden lit only by your plants and your lantern.

**Anti-goals:** dark patterns (fake timers, energy, pressure after declining), anything purchasable, random rewards, a big download, losing players on devices without WebGL2.

## Approaches (3D)

| Option | Trade-off | Pick |
|---|---|---|
| Hand-written WebGL2, adapted from Gearhold's renderer | ~1000 lines, no dependency, tiny download, full control over the point-light look; precedent already in the repo | **Chosen** |
| Vendored three.js | Faster to rich features, but ~600 KB for a small game, and a second 3D stack in the repo | No |
| 2.5D (canvas with fake depth) | Cheap, but isn't what was asked for | No |

The 0.1 canvas renderer stays as the fallback when WebGL2 isn't available. Both renderers implement the same interface (`resize`, `cellAt`, `draw`, `addEvents`, `tickFx`, `clearFx`).

## The look

- Fixed, tilted perspective camera over the 9x13 board (portrait), with a short swoop-in at level start that a tap skips.
- Moonlight: a dim blue directional light with a shadow map. Every plant is a coloured point light, and the lantern is the big warm one; its radius and brightness follow lives.
- Low-poly flat-shaded models: raised moss tiles with height jitter, sunken flagstone path, trees, rocks, fences and hills past the board edge, a starry sky with a moon.
- Three regions with their own palette and props: Moon Garden (1-5), Frostmere (6-10, snow, icy ground), Ember Marsh (11-15, warm reeds, glowing water).
- Creatures are animated through part transforms (wings flap, legs step, toads hop). Additive billboards cover glows, bolts, bursts, sparks and drifting motes.
- Juice: camera shake on boss hits and leaks (off with reduced motion), death puffs, coins that fly to the HUD, a "Swarm cleared" callout.

## Content

**Early hook (first 60 seconds):** Play drops straight into level 1 with a camera swoop. The best tile and the Glowcap card pulse. The first wave starts automatically three seconds after the first plant (or on Start). Moths arrive within about 10 seconds of Play. Level 1 is three short waves. In wave 2 the lantern charges and a prompt says to tap it.

**Lantern Flare (new active ability):** tapping the lantern, or the Flare button, releases a burst of light that damages every creature within 2.6 tiles and stuns them for 1.2 seconds. It recharges over 30 seconds. Charging is visible on the lantern and on the button.

**Plant specialisations:** the third growth level is a choice between two branches:
- Glowcap: *Spore Storm* (hits up to three targets) or *Deepcap* (one heavy hit, and every fourth shot stuns).
- Frost Fern: *Hoarfrost* (stronger, wider slow) or *Icicle* (moderate slow plus real damage).
- Ember Thistle: *Wildfire* (bigger burst) or *Cinder* (burst that leaves a burning patch dealing damage over time).
- Sunspire: *Solar Lance* (pierces through every creature in a line) or *Daybreak* (faster beam that ramps damage on the same target).

**New creatures:** *Mossback* heals nearby creatures; *Mothmother* is a boss that bursts into moths when she dies. Each creature's first appearance shows a reveal card (name, a one-line tip, a turntable model), and so does each newly unlocked plant.

**Fifteen levels in three regions.** Each early level introduces exactly one thing. Levels 1-4 are short (2-3 minutes).

**Sparks (meta-progression, earned only):** each star earned is one spark. Sparks go into eight lantern perks: more lives, more starting gold, cheaper Glowcaps, faster Flare recharge, stronger Flare, longer frost, a higher sell refund, and early-call gold. Perks can be reset for free at any time. Nothing is purchasable.

**Night Watch (endless):** unlocked by beating level 5. Waves are generated deterministically and escalate. The game keeps your local best wave and shows it honestly, with no leaderboard.

## Screens

Title (the live 3D garden behind the logo), a garden map (a winding route of level nodes grouped by region, scrolling vertically), the Lantern perk screen, reveal cards, the specialisation choice, pause (sound, haptics, reduced effects), and an end screen (star pop, sparks earned, tip on a loss).

## Engineering

- The sim stays pure and deterministic (no Math.random), tested with vitest, test-first for new mechanics.
- Perks are applied at `createGame(level, mods)`; the sim never reads the save.
- Save v2 migrates v1 stars.
- Balance: the bot learns the Flare and the branches. The same balance tests run over all 15 levels plus endless waves 1-10.
- Version 0.2.0. Compliance: no purchase words, the SDK only, `level_start`/`level_end` events, plus `custom` for flare use and branch picks (the ingest accepts `custom`).

## Left to the builder

Exact numbers, model shapes, and copy, within the above.
