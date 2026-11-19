# gearhold, night of 2026-11-19

## Run run-2026-11-19T13-06-12-091Z

**Gearhold**: the brass-and-steam dungeon, where each level should have its own goal and foe (N-034).
- The Orrery fix merged as 0.8.1. The kilnwarden moved beside the exit arch, with 230 health instead of 260. Wins went from 0.43 to 0.71, tension is 48.6, and the other levels are unchanged. The key-triggered fight is kept, just fairer.
- Regulator Hall as level 8, the first level without a key, was dropped. Its feel was 95.24 against a 96.90 bar, and wins were 87%, high next to the earlier 61%. Ram Foundry is already on main as level 7.
- Next: retry Regulator Hall with a tighter layout, aiming for mid-band wins and the feel bar.

Changes:
- HAL-248 fix(gearhold): The Orrery: bring wins back into band after the kilnwarden (0.43 to ~0.6): **merged** (0.8.1)
- HAL-250 feature(gearhold): Rebuild 'Regulator Hall' (wreck 3 steam regulators, no key) as level 8: **discarded** (0.9.0) (gearhold-play: new levels[7] feel 95.24 is out of its band (needs >= 96.90))
