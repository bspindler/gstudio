# gearhold, night of 2026-11-11

## Run run-2026-11-12T10-40-26-967Z

### Gearhold

**What makes it itself:** a scrappy last-repair-unit crawl through citadel layouts, ending at the kilnwarden finale. Healing is scarce but fair, and difficulty climbs steadily.

**Tonight:** Terrace of Dials (level 1) now has a repair crystal within reach of the main path. The ratio went from 0 to 0.25, the band is 0.1–1.0, and the level still has two crystals. This **keeps** the scarcity and only makes the opening level fair, so it doesn't drift toward a health-pack buffet. safeStarts, rising and challenge all stay at 100, and a new `gearhold-supply.test.ts` guards them. The change was checked through the scoring function directly, because the score CLI wouldn't start in the sandbox.

**Fitness:** maps 91.67 → 100. Play is unchanged at 74.69: 2 of 3 levels have a bot win rate outside their band, and win times haven't been checked yet.

**Next:** fix the off-band win rate (one enemy placement change on the worst level), then bring the slow or unwon level's win time into 30–180 s. Both are waiting on a working play scorer, or on per-level numbers from you.

Changes:
- HAL-001 tuning(gearhold): Retune the bot win rate on the off-band Gearhold level: **discarded** (implementer blocked: Can't get per-level bot win rates: npm run hal -- score fails with tsx EPERM in the sandbox, and gearhold-play needs a browser runner that isn't available. Rerun with a working score command or with the last gearhold-play per-level win rates in the ticket.)
- HAL-002 tuning(gearhold): Rebalance repair crystals on the one under-supplied Gearhold level: **merged** (0.2.1)
