# Tidepool Pals changelog

Newest first. Each version matches `version` in `game.yaml` and the `createStudio({ version })` call in `index.html`; a test keeps the three in sync. Fixes, tuning and polish bump the patch number, and new features bump the minor number. Hal adds an entry with every change it merges.

## 0.8.0 (2026-11-15)
- Every level opens straight onto its board, with a mission card on top: the goal in big words ("Collect 12 Coral"), the pals to get, the moves you have, and on the first levels a little picture of how to play. Tap "Let's go!" and you're in.
- The goal chips on the board now say what they want ("Coral to collect", "to rescue"), not just a number.
- On the first three levels a "Tap!" bubble points at a group of the pal you need, until your first move.
- Boosters moved from the pre-level screen onto the board. From level 3, "Need a hand?" under the board offers +3 moves, an urchin or a wave whenever you want one. Tap once to pick, tap again to use. They still cost pearls, and a boosted level still doesn't wash up a shell.

## 0.7.1 (2026-11-14)
- Sea Candy now pops with a soft pastel sugar-sparkle burst.
- Level 9 now always has a trapped pal in a bubble to rescue, so the level can always be won.

## 0.7.0 (2026-11-13)
- Level 9 now has a pal trapped in a bubble on the board. Clear matches next to it twice to crack it open and free it, and freeing it counts toward the goal.
- Each reef pool now has its own board look: a tint from the pool's colours, a little floor pattern (ripples, kelp, pebbles or sparkle) and a driftwood or coral frame.
- Tidepool Pals: level 3 now has a pal trapped in a bubble, freed by clearing next to it twice, so you learn the rescue early.
- The pool strip under the board now shows the full favourite-pal line on its own line, so you can see which pal the pool is for.
- New level 23: a five-point starfish pool with a pal trapped in a bubble right in the middle.

## 0.6.1 (2026-11-13)
- On shorter phone screens the pool strip no longer overlaps the Play, Pool, Album and Shop tabs; the board shrinks a little to make room.

## 0.6.0 (2026-11-13)
- A calm pool panel under the board shows the pool you're restoring, its favourite pal and how much of the pool is cleaned up.
- The pool panel under the board is now a slim strip with a smaller pal icon and a tighter meter, so it no longer crowds the screen.
- The level label under the board now has a little breathing room and no longer tucks under the board's shadow.
- The pal in the pool strip now does a happy wiggle when you win a level.
- The pal in the pool strip now bobs up with a little cheer whenever a move gets you closer to the level goal.
- Tidepool Pals: the pal in the pool strip now glances toward the side of the board where you clear a group.
- Tidepool Pals has a new hand-made level 21: clear the litter along the reef floor and collect Gems while the tide turns.
- Tidepool Pals are now rounder, cuter sea animals: a crab, starfish, fish, octopus and turtle, each with big shiny eyes, rosy cheeks and a smile.
- Gems are now glossy sea-glass 'Sea Candy' pebbles with a twist of light and a little sparkle when collected.
- Coral fans and swaying anemone flowers now decorate the pool strip, blooming brighter as you restore each pool.

## 0.5.3 (2026-11-12)
- The board now sits right under the goal bar instead of floating in the middle, so the spare water collects in one calm band above the tabs.

## 0.5.2 (2026-11-12)
- Sound now plays on iPhone even when the ring/silent switch is set to silent. Use the in-game sound setting to turn it off.

## 0.5.1 (2026-11-12)
- Undone: Trim 1-2 moves on the Tidepool levels the scorer wins with the most moves left (HAL-029): whatevver you are doing is not making any difference

## 0.5.0 (2026-11-12)
- Gave a few of the trickiest tide pools a little more room: levels 11, 14, 15, 19, 25, 26 and 28 now have extra moves.
- Rebalanced goals on a few tricky early levels: level 5 asks for a few more Sunstars, level 14 needs 3 of its 4 nets untangled, and level 15 needs either one of its two stranded pals rescued.
- Level 21's reef floor has a little less litter to clear, so it's gentler after level 20.
- Returning players open on the reef map with a Continue button at their furthest unlocked level, right in the pool they're restoring.
- Level 14 has less litter to clear and level 28's stranded pal starts closer to open water, so neither feels like a sudden wall any more.
- On tall phones the board now sits right under the goal and moves bar, with the level label just below it, instead of floating in a band of empty water.
- Tidepool Pals: the puzzle board now grows to fill the empty space on tall phones, with the level label tucked right under it.
- A few early reef levels (3, 4, 6, 7, 10, 17) give you 2 fewer moves, so wins come down to closer finishes.

## 0.4.1 (2026-11-11)
- **Fonts ship with the game.** Bagel Fat One and Nunito now load from the game's own `fonts/` folder (SIL OFL), so players' phones no longer contact Google Fonts. The look is unchanged.
- Fix: the reef's litter art was renamed so the merged page script loads.

## 0.4.0 (2026-11-07)
- **Reef restoration:** a reef map, stage-up celebrations, a reef Home Pool, a photo card and field notes.
- **Tides:** tide gravity in four directions, a tide meter and a tide-turn sweep, plus rock pools, rescues, litter and helper abilities.
- Pal favourite pools spread three per pool across the first four pools. Pal sources are saved, and a bought-only helper marks the level as assisted.
- Side exit markers keep their arrow direction and fit the phone gutter.

## 0.3.0 (2026-11-07)
- Banked shells, a level map, boosters, a home pool and general polish.
- Hand-authored levels 1–20 and a generator that ramps features in gradually.
- Pure board rules: masks, sand, ice, specials, combos and goals.
- Runs on the studio SDK's no-ingest mode for local play.

## 0.2.0 (2026-10-26)
- First studio version: ported onto the studio SDK. Earlier versions predate this repo.
- Assisted wins pay pearls, not a shell, so there's no paid path to random rewards.
- Fix: the empty modal no longer covers the board.
