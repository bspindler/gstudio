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

## Run run-2026-11-17T13-41-27-044Z

**Tidepool Pals:** a cartoon reef where you swap sea-animal pals and Sea Candy to free a trapped pal.

- **Merged:** HAL-183 adds a 260 ms glow on exactly the matched pals before swap and cascade clears. It is skipped under reduced motion, has no timer and adds no pressure. It keeps the reef look and makes cause and effect clearer. Fitness is flat at 94.38.
- **Dropped:** HAL-182 (calm refills, the rebuild of HAL-177). Goal reach got worse by 6.71 against a 4.37 limit, and fitness fell from 94.38 to 92.66. The "cascades finish the level for me" problem is still open.
- **Next:** pair calm refills with a per-level move-budget retune in one ticket, and report per-level win rates.

Changes:
- HAL-182 fix(tidepool-pals): Refills avoid ready-made matches so cascades can't finish a level for you: **discarded** (0.12.1) (tidepool-pals: goalReach regressed 6.71 (> 4.37))
- HAL-183 polish(tidepool-pals): Matched pals glow together for a beat before clearing, so swaps read as cause: **merged** (0.12.1)

## Run run-2026-11-17T21-53-26-952Z

**Tidepool Pals**

**Merged**
- **HAL-188:** the shell on the win card is now the tap target, so the prize takes one tap instead of three.
- **HAL-189:** a CSS-3D hinge and pearly glow before the pal appears.

**Held**
- **HAL-191:** a 3D three.js pal reveal with an SVG fallback. Not seen on a device.
- **HAL-190:** calm refills plus a move retune on levels 8, 12, 16, 25 and 27.
  - Fitness is 94.38 → 93.81, against 92.66 for calm refills alone.
  - Per-level win rates are not yet re-scored.
  - It includes a test patch that moves the robot-stuck check from level 14 to level 11.

**Unchanged**
- Earned-only shells, odds at the point of opening, no reward for assisted wins, level 19 untouched.

**Watch**
- All three report 0.12.1, so the versions need checking.

Changes:
- HAL-188 polish(tidepool-pals): Win card opens the shell in place with one tap, no extra shell screen: **merged** (0.12.1)
- HAL-189 polish(tidepool-pals): The shell opens with a 3D hinge and a pearly glow before the pal pops out: **merged** (0.12.1)
- HAL-190 fix(tidepool-pals): Calm refills plus per-level move retune so cascades can't win a level for you: **held** (0.12.1)
- HAL-191 feature(tidepool-pals): Revealed pal appears as a soft 3D figure that turns in the light: **held** (0.13.0)
