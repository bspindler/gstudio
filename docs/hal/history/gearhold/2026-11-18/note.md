# gearhold, night of 2026-11-18

## Run run-2026-11-18T12-28-25-567Z

**Gearhold:** a clockwork-citadel shooter. Tonight was all about your N-034 ask for levels that feel different. Boiler Stair shipped on your 👍. All four new ideas fit the brass-and-steam identity:
- **Steam regulators (HAL-220):** a hunt-the-targets goal. Feel 46 against a bar of 98, because the bot can't treat the regulators as targets.
- **Brass ram (HAL-221):** a sidestep-and-punish enemy. 79% wins with every measure at 100, but discarded on the missing-patch mismatch.
- **Lift Siege (HAL-222):** a hold-the-platform level. Feel 77.
- **Lens Gallery (HAL-223):** sneak between sweeping sentry cones. Feel 60, because the bot is blind to the cones.

None shipped. The ram is first in line to rebuild.

Changes:
- HAL-220 feature(gearhold): New level 7 'Regulator Hall': exit stays sealed until you wreck 3 steam…: **discarded** (0.8.0) (gearhold-play: new levels[6] feel 45.98 is out of its band (needs >= 98.22))
- HAL-221 feature(gearhold): New enemy brass ram: charges in a straight line, stuns itself on walls; level 8: **discarded** (0.8.0) (asks refused: the reply asks for a protected change but there is no hal-asks.patch)
- HAL-222 feature(gearhold): New level 9 'Lift Siege': hold the rising cargo lift while waves climb aboard: **discarded** (0.8.0) (gearhold-play: new levels[6] feel 77.10 is out of its band (needs >= 97.58))
- HAL-223 feature(gearhold): New enemy sentry lens: fixed turret sweeping a visible beam; level 10: **discarded** (0.8.0) (gearhold-play: new levels[6] feel 60.43 is out of its band (needs >= 97.40))

## Run run-2026-11-19T04-32-26-271Z

**Identity:** brass clockwork. Ram Foundry adds a new verb: dodge, let the ram crash, then scrap it. That is the first real break from 'same level, more baddies'.

- Built cleanly in slot 7, with no judge change and no mention of protected files.
- 82% wins, pace 100, feel 100, and gearhold-play went from 91.7 to 92.9.
- Its tension wasn't reported.
- The regulator, lift and lens ideas still need the bot taught first.

Changes:
- HAL-228 feature(gearhold): New level 7 'Ram Foundry': brass rams charge in lines and stun on walls: **held** (0.8.0)

## Run run-2026-11-19T05-55-40-173Z

**Gearhold**: two merges, both labelled 0.7.1 (a version clash).

**Boiler Stair furnace look (HAL-232)**
- Dim red-orange boiler lamps and slow steam wisps, on the existing three.js renderer.
- Glow is restrained and only on real lamps, as you asked in N-018.
- Layout and enemies are unchanged, and the score held at 91.73.

**The Orrery press crossings (HAL-233)**
- Three timed press rows on the key route.
- Whole-game winnable went from 81.1 to 84.4 and fitness from 91.7 to 92.3.
- The Orrery itself is still too easy at 0.95 wins, and tension dipped from 35.0 to 30.4.
- Presses have now failed twice on this level, so the next attempt will change the layout or put a threat on the main route.

The levels are starting to feel like different places, which is the identity you asked for. Ram Foundry (level 7) is still held.

Changes:
- HAL-232 polish(gearhold): Give Boiler Stair its own furnace look: low red-orange boiler lamps, rising…: **merged** (0.7.1)
- HAL-233 fix(gearhold): The Orrery: three full-width timed press crossings on the key route: **merged** (0.7.1)

## Run run-2026-11-19T06-46-57-019Z

**Gearhold.** Brass-and-steam corridors, a gear key to fetch, kilnwardens in the dark.

- **Regulator Hall (HAL-240), held.** Wreck three regulator drums to unseal the exit; the compass points at the nearest one. It is the first level with a different goal, and it keeps the boiler-room look. Results: 61% wins, median win 45.7 s, winnable 100, pace 100, feel 100. Tension is low: 27.1, with one close win. It took three tries to land in band: 0.98 wins with no kilnwarden, 0.38 with extra drones.
- **Bot change.** The level plays today without the bot change. The attached change only gives the bot the regulator's real aim point.
- **Slot clash.** It sits in the same level-7 slot as Ram Foundry (HAL-228).
- **The Orrery kilnwarden (HAL-237), dropped on the tuning bar.** It brought wins into band (0.95 to 0.60), so I'd resend it as a fix.

Changes:
- HAL-237 tuning(gearhold): The Orrery: a kilnwarden wakes in the exit hall once the gear key is taken: **discarded** (0.7.1) (gearhold-play: no real gain: 2.47 < 9.02)
- HAL-240 feature(gearhold): New level 'Regulator Hall': wreck 3 steam regulators to unseal the exit: **held** (0.8.0)
