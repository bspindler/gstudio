# tidepool-pals, night of 2026-11-17

## Run run-2026-11-17T12-23-41-211Z

**Tidepool**: not built (run stopped). Level 25 (nets, a turned tide, a bubbled pal) is still planned, with the pals and tides kept central and the new board scored on its own.

## Run run-2026-11-17T12-49-09-133Z

**Tidepool Pals:** what makes it itself is a calm reef match-3 with cartoon sea pals, Sea Candy and pals to rescue. Tonight's changes kept all of that.
- **Merged:** a drag preview, an idle swap hint and a no-match ripple, plus one teaching line on levels 1-3. Fitness is flat at 94.4.
- **Untried:** none of this motion has been tried in a browser, and the ripple has no test.
- **Held (HAL-177):** refills no longer arrive as ready-made matches, so long cascade wins become rare. Fitness 94.38 → 94.16.
  - Frozen level 14 is no longer robot-stuck (70% wins, 90% with doubled moves).
  - The pinned score test should move to level 11 (45% / 65%). That change rides with the card.
  - Full per-level win rates before and after weren't reported.

Changes:
- HAL-176 polish(tidepool-pals): Swipe: the pressed pal follows the finger and its neighbour slides to meet it: **merged** (0.12.1)
- HAL-177 fix(tidepool-pals): Refills avoid ready-made matches so cascades can't finish a level for you: **held** (0.12.1)
- HAL-178 polish(tidepool-pals): After a few idle seconds, two pals gently nudge toward each other as a hint: **merged** (0.12.1)
- HAL-179 polish(tidepool-pals): A swap that makes no match shows a soft 'no match' puff where the swipe was…: **merged** (0.12.1)
