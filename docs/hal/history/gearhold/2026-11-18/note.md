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
