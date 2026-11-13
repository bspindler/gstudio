# tidepool-pals, night of 2026-11-12

## Run run-2026-11-12T12-44-45-040Z

### Tidepool Pals
Its identity is a gentle, cozy tide-pool puzzler with hand-authored level personalities. Tonight's changes only touched move budgets and goal counts; boards, pals, tides and reef progression are unchanged.
- **Results:** fitness rose from 78.8 to 83.9. `inBand` went from 76.7 to 86.7 and `noWalls` from 75.9 to 79.3.
- **Honest limits:** L15 and L19 didn't improve even at 45 moves, because the rescue is the wall, not the budget. L15 now asks for only one of its two pals. L19, L26 and L28 need board or tide work. L5 is at 80% and still under the 90% early bar.
- **Cozy watch:** these were budget and goal tweaks only. The next step is layout changes, and I'll keep those small so the levels keep their personalities.

Changes:
- HAL-007 tuning(tidepool-pals): Add moves to the Tidepool Pals levels that wall players: **merged** (0.4.2)
- HAL-008 tuning(tidepool-pals): Retune goal counts on the off-band Tidepool Pals levels: **merged** (0.4.2)

## Run run-2026-11-12T14-07-27-199Z

**Identity:** gentle reef restoration, forgiving puzzles.

Level 21 lost two litter pieces, with the same moves and goals. Its win rate rose from 40% to 50%, which clears the 20→21 wall. Fitness went from 83.9 to 85.1. This follows your upvote on board-level easing rather than stacking more moves.

Level 24 is still a wall. Easing it enough would make level 25 the wall instead, so it needs a two-level reshape rather than a single tweak.

**Next:** treat 24 and 25 together.

Changes:
- HAL-014 tuning(tidepool-pals): Ease the Tidepool Pals levels that still wall players beyond levels 11–28: **merged** (0.4.2)

## Run run-2026-11-12T15-54-46-170Z

**Tidepool Pals:** cozy reef restoration with a gentle, kind curve.

**Merged (0.5.0):**
- Returning players get *Continue · Level N* on the map and in the pool card. Nothing new is stored.
- Board eases on level 14 (lighter litter) and level 28 (the pal starts closer to open water). Win rates are now 65% and 50%. Fitness went from 85.1 to 88.8.

**Left alone:** levels 11 and 19, the side-exit rescues, didn't respond to in-scope changes. Easing level 24 would only turn 25 into a wall. Those may need a mechanic look rather than more tuning.

**Next:** the top-bar dead space you flagged.

Changes:
- HAL-017 feature(tidepool-pals): Tidepool Pals opens on the reef map with Continue at your next level: **merged** (0.5.0)
- HAL-019 tuning(tidepool-pals): Ease the Tidepool Pals levels the scorer still finds walling: **merged** (0.5.0)

## Run run-2026-11-12T19-02-22-946Z

**Identity:** calm reef, hand-made boards, finishes that land close.

- **Merged, HAL-020:** layout-only fix. The board and its level label are now centred as a group under the HUD. Tile art, HUD and logic are untouched. **The visual result is unconfirmed, so please look on a tall phone.**
- **Dropped, HAL-024:** easing goals on L13, L21 and L29 gave +0.45 fitness but cost 2.55 tension, and easing L11 made it worse. Easing has reached its useful limit.
- **Next:** look at layout on the levels that are still unfinished, rather than lowering their goals.

Changes:
- HAL-020 polish(tidepool-pals): Close the empty band between the goal bar and the board on tall phones: **merged** (0.5.0)
- HAL-024 tuning(tidepool-pals): Ease goal counts on the Tidepool levels where the scorer falls short of goals: **discarded** (0.5.0) (tidepool-pals: no real gain: 0.45 < 0.5; tidepool-pals: tension regressed 2.55 (> 1))

## Run run-2026-11-12T20-22-43-996Z

**Tidepool Pals** is the calm, cozy reef match game. Tonight's work kept that identity.
- **HAL-026 (merged):** the board fills the tall-phone dead space, and the tiles, art and underwater look are unchanged. It has not been verified on a real device.
- **HAL-029 (merged):** levels 3, 4, 6, 7, 10 and 17 each lose 2 moves. This was a gentle tightening that left the walled levels alone. Tension went from 39.2 to 40.4, but the overall score did not move from 88.85.
- **Next:** move trims are a small lever. Tension needs a different idea, not more trimming, and it must not make the game feel stressful.

Changes:
- HAL-026 fix(tidepool-pals): Scale the Tidepool board to fill the empty height between goal bar and tab bar: **merged** (0.5.0)
- HAL-029 tuning(tidepool-pals): Trim 1-2 moves on the Tidepool levels the scorer wins with the most moves left: **merged** (0.5.0)

## Run run-2026-11-13T06-00-05-835Z

**Tidepool Pals:** a cosy, kind, no-timer reef puzzler. Tonight kept that intact.

- **Merged 0.5.3 (HAL-032):** the board is pinned under the goal bar, with the level label beneath it. Leftover water forms one band above the tabs, where the bubbles drift. Tiles, rules and board size are untouched. Fitness is unchanged at 88.85.
- **Honest caveat:** this moves the empty space; it doesn't fill it. The board is width-bound, so filling the space would mean taller boards (a level change) or putting something useful in the band.
- **Discarded (HAL-035):** a hand-made bay level combining litter clearing with a pal rescue. It scored in band (inBand 90.3, noWalls 90.0, goalReach 86.4, 45% win rate) but was blocked by a protected test pinning 20 levels. On retry it should be appended, not swapped in for generated level 21.

Changes:
- HAL-032 fix(tidepool-pals): Anchor the Tidepool board right under the goal bar, not centred in the water: **merged** (0.5.3)
- HAL-035 feature(tidepool-pals): Add a new hand-made Tidepool Pals level after the last existing one: **discarded** (0.6.0) (implementer blocked: scripts/hal/git.unit.test.ts:34 hard-codes 20 Tidepool levels, so adding the requested 21st level fails it. The file is protected under scripts/hal/**, so I can't edit it; Hal needs to update the expected count to 21.)
