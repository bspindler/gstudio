# tidepool-pals, night of 2026-11-14

## Run run-2026-11-14T21-45-31-818Z

**What makes it Tidepool:** sea-animal pals, the trapped pal you rescue, the tides and Sea Candy on the reef. Nothing merged tonight, so nothing was sanded off.

- **Level 9 rescue (HAL-106), dropped.** The tripwire caught the +5 offer line, so this needs your answer. The rescue safety net itself puts a bubbled pal back when a rescue goal runs short, and it can ship separately. I could not reproduce your bug on main: was it an older build or a particular device?
- **Swipe-to-swap (HAL-109), dropped.** It was built to your contract and kept the pals, the bubble and the tides. One protected test still expects taps.
- **Swipe numbers vs. baseline:** inBand rose from 90.3 to 96.8, but tension collapsed from 37 to 8.7 and goalReach fell from 87.5 to 83.8. Swaps with cascades are easier, so the retry must retune move budgets too.
- **Stray request found:** it came from the SDK's default endpoint. The page now sends nothing unless a host sets one.

Changes:
- HAL-106 fix(tidepool-pals): Tidepool: level 9 rescue pal always spawns and can be freed: **discarded** (tripwire payment: games/tidepool-pals/index.html: payment-shaped line: ${reachable && offered(CATALOG.moves) ? `<button class="btn buy" data-act="buy-moves">${CATALOG.moves.title} · ${price(C)
- HAL-109 feature(tidepool-pals): Tidepool: swipe to swap neighbours, match 3+ to clear: **discarded** (0.8.0) (implementer blocked: Protected test packages/core/test/hal-tidepool-swap.test.ts:63 expects moveKind(board) to be 'tap', but the ticket requires MOVE='swap'. It fails for that reason and I can't edit hal-*.test.ts; Brian needs to update that assertion to 'swap'.)
