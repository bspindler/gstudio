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
