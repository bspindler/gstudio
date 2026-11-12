# gearhold, night of 2026-11-12

## Run run-2026-11-12T12-44-45-040Z

### Gearhold
Its identity is tense, close-quarters scrapping in a clockwork citadel. Both merges kept that.
- **Spawn facing:** levels now open looking down the longest open hall, so screenshots finally show the citadel. Maps, look and gameplay are unchanged.
- **Kiln Heart:** I removed one crawler by the gear key. The bot's win rate went from 0.34 to 0.82. The kilnwarden fight still bites, and crystals are untouched.
- **Dropped:** the overhead `?hal` camera, because the implementer's output broke the contract. It's still needed for checking placement tickets like HAL-002.
- **Remaining:** `winnable` is 66.7, so one level is still too crowded. That's the next target.

Changes:
- HAL-003 fix(gearhold): Start each Gearhold level facing down the open hall, not into a corner: **merged** (0.2.2)
- HAL-004 polish(gearhold): Add an inert ?hal-only overhead camera that frames the whole level: **discarded** (implementer output does not match the contract)
- HAL-006 tuning(gearhold): Thin the enemy count on the Gearhold level the play-bot can't clear: **merged** (0.2.2)

## Run run-2026-11-12T14-07-27-199Z

**Identity:** clockwork citadel with methodical repair-unit combat. Dials, kilns and caretaker machines gone rogue.

Nothing merged tonight:
- The **overhead camera** was stopped by the hal-hook tripwire. It needs your OK, see the note.
- **Bellows Gallery**, with its rhythmic kiln vents, was built and stayed in band. It's blocked only by the protected scorer test pinned to 3 levels. It fits the citadel well and is ready once you allow the scorer to follow the real level count.
- **Both tuning tickets** targeted the wrong levels. The real problems are The Orrery being too easy (0.94) and Terrace of Dials being too fast (15.4 s).

gearhold-play stays at 83.0.

**Next:** put a crawler guarding the exit pocket on The Orrery, and lengthen the route on Terrace of Dials.

Changes:
- HAL-010 feature(gearhold): Add an inert ?hal-only overhead camera that frames the whole level: **discarded** (tripwire hal-hook: games/gearhold/index.html: added statement touches the hal hook, counters or HAL flag: let halOverhead = HAL && new URLSearchParams(location.search).has('overhead'); tripwire hal-hook: games/gearhold/index.html: added statement touches the hal hook, counters or HAL flag: if (HAL) )
- HAL-011 feature(gearhold): Add a new Gearhold level built around one new clockwork hazard: **discarded** (0.3.0) (implementer blocked: Any new Gearhold level makes the play scorer's limit message read 'at most 4', but the protected test packages/core/test/hal-scorers.test.ts:47 expects 'at most 3', and the scorer default (levels: 3, pinned at line 43) would never play the new level. Hal's scorer and its test mu)
- HAL-012 tuning(gearhold): Retune the Gearhold level the play-bot still can't win: **discarded** (implementer blocked: The ticket blames Kiln Heart, but the out-of-band level is The Orrery, which is too easy (0.94). No measured layout change brought it to 0.9 or below within the 12-score limit (best was 0.92). Suggested follow-up: start from the corner-key layout and try a crawler guarding the e)
- HAL-013 tuning(gearhold): Shorten the slowest Gearhold level's route to the exit arch: **discarded** (implementer blocked: The ticket's premise is wrong: the level outside the pace band is the fastest one (Terrace of Dials, 15.4s, below the 30s minimum), not the slowest. Shortening The Orrery cannot raise pace; it needs a new ticket to lengthen Terrace of Dials.)

## Run run-2026-11-12T15-54-46-170Z

**Gearhold:** a tense brass-citadel crawl with code-drawn clockwork.

**Merged (0.3.0):** a gear-key checkpoint, saved locally. The WRECKED screen offers *Reboot at gear key*, and the title offers *Continue*. The crawl is kept, and only the replay of the whole level is gone. Scores held at gearhold 100 and gearhold-play 83.

**Discarded:** level 4, Piston Gallery. It has visible, audible piston rhythms, landed in band, and stayed on-identity. It was blocked only by the protected test that pins 3 levels.

Changes:
- HAL-015 feature(gearhold): Gearhold mid-level checkpoint: respawn at the gear key, not the level start: **merged** (0.3.0)
- HAL-018 feature(gearhold): Add Gearhold level 4 built around one new clockwork hazard: **discarded** (0.3.0) (implementer blocked: Protected test scripts/hal/cli.unit.test.ts:30 assumes exactly 3 Gearhold levels, so any fourth level fails it, and scripts/hal/** may not be edited. The ticket says the level-count contract is resolved, but this test still pins 3. It needs updating in Hal's own code (count take)

## Run run-2026-11-12T19-02-22-946Z

**Identity:** a citadel of attrition, with keys, doors and threats.

- **Dropped, HAL-021 (crystal):** contract mismatch, so it was never measured.
- **Dropped, HAL-022 (exit guard):** stayed in band, but tension stayed at 0. The bot still wins with more than 35 health.
- **Dropped, HAL-023 (backtracking):** stopped because it targeted the wrong level. Level 1, Terrace of Dials, is too fast at 15.4s.
- **Next:** lengthen Terrace of Dials with a guarded detour, which should help pace and tension together. Then retry the Kiln Heart crystal with a tighter contract.
- **Level 4:** still waits on the pinned 3-level test (N-001).

Changes:
- HAL-021 tuning(gearhold): Put a repair crystal on the final approach of the level the play-bot can't win: **discarded** (implementer output does not match the contract)
- HAL-022 tuning(gearhold): Station one existing enemy by the exit arch on the easiest Gearhold level: **discarded** (0.3.0) (gearhold-play: no real gain: 0.00 < 0.5)
- HAL-023 tuning(gearhold): Trim backtracking on the Gearhold level that misses its pace band: **discarded** (implementer blocked: The ticket targets the wrong level and direction: level 1 (Terrace of Dials) is too fast at 15.4s, not a slow level 3. A new ticket should lengthen level 1.)
