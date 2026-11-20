# gearhold, night of 2026-11-19

## Run run-2026-11-19T13-06-12-091Z

**Gearhold**: the brass-and-steam dungeon, where each level should have its own goal and foe (N-034).
- The Orrery fix merged as 0.8.1. The kilnwarden moved beside the exit arch, with 230 health instead of 260. Wins went from 0.43 to 0.71, tension is 48.6, and the other levels are unchanged. The key-triggered fight is kept, just fairer.
- Regulator Hall as level 8, the first level without a key, was dropped. Its feel was 95.24 against a 96.90 bar, and wins were 87%, high next to the earlier 61%. Ram Foundry is already on main as level 7.
- Next: retry Regulator Hall with a tighter layout, aiming for mid-band wins and the feel bar.

Changes:
- HAL-248 fix(gearhold): The Orrery: bring wins back into band after the kilnwarden (0.43 to ~0.6): **merged** (0.8.1)
- HAL-250 feature(gearhold): Rebuild 'Regulator Hall' (wreck 3 steam regulators, no key) as level 8: **discarded** (0.9.0) (gearhold-play: new levels[7] feel 95.24 is out of its band (needs >= 96.90))

## Run run-2026-11-20T02-14-12-960Z

**Gearhold 0.9.0, Regulator Hall (held).** You wreck three steam regulators to unseal the exit, with no key. The route is longer and winds past one guarded kilnwarden crossing. The first version won only 45%; after two drones were removed it wins 69% (n=150), with pace 100, feel 100 and winnable 100, and gearhold-play rose from 95.35 to 95.94. The level's own tension row doesn't exist in the score output. It's a genuinely different goal, in keeping with the brass-and-steam identity.

Changes:
- HAL-255 feature(gearhold): Retry 'Regulator Hall' (wreck 3 steam regulators, no key) as level 8, mid-band: **held** (0.9.0)

## Run run-2026-11-20T06-00-04-377Z

**Gearhold:** brass-and-steam dungeon fights.

- Built and held HAL-261, your N-034 ask for a level 6 that feels different: two lone crawlers in Boiler Stair become swarms of three fast, one-hit cinder mites.
- Level 6 sits at 53% wins (52% before), with winnable, pace and feel at 100. The bot handled the mites without any change, as L-140 predicted.
- It edits an existing level, so it doesn't collide with Regulator Hall (HAL-255), which is still held as level 8.

Changes:
- HAL-261 feature(gearhold): Boiler Stair: cinder mites, fast swarms of three that pop in one hit, replace…: **held** (0.9.0)
