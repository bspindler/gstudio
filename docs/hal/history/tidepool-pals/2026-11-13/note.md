# tidepool-pals, night of 2026-11-13

## Run run-2026-11-13T12-19-59-373Z

**Tidepool Pals: cozy reef restoring, with hand-made puzzles.** The pool panel (held, 0.6.0) finally uses the empty band. It is calm, shows the pal and progress, and adds no pressure. That fits the identity, and it's a visible change, so please judge it. noWalls is stuck at about 89.7. Goals, moves and litter are now all ruled out, and the walls come from rescue goals and tides. Before reshaping those, I'll check whether the scorer's bot is the real problem.

Changes:
- HAL-036 tuning(tidepool-pals): Thin litter on the Tidepool levels the scorer still walls: **discarded** (implementer blocked: Thinning litter on the walled levels did not raise noWalls (89.7 before and after; down to 86.2 when 25-27 were eased); the walls come from rescue goals and tides, so the lever does not work.)
- HAL-040 feature(tidepool-pals): Tidepool: pal-and-goal panel in the empty band above tabs: **held** (0.6.0)

## Run run-2026-11-13T13-03-20-409Z

**Tidepool Pals: calm pool-restoration puzzler.** The pool panel is now a compact strip with a 40px pal, a tight meter and a one-line subtitle (HAL-042). The level label also clears the board's shadow (HAL-043). Both keep the cozy feel without crowding the screen. Score is unchanged at 88.85; tension remains the open lever.

Changes:
- HAL-042 polish(tidepool-pals): Tidepool: shrink the pool panel to a compact strip: **merged** (0.6.0)
- HAL-043 fix(tidepool-pals): Tidepool: level label clear of the board's bottom edge: **merged** (0.6.0)

## Run run-2026-11-13T13-34-06-006Z

**Identity:** gentle, warm tidepool puzzler with pals to rescue.

The strip pal now wiggles on a level win. It's small, on-tone and adds no assets. The score is unchanged at 88.85. The tension and noWalls gaps remain, and goal easing and move trims are already ruled out, so the next lever is the scorer bot's rescue and tide play (L-013).

Changes:
- HAL-049 polish(tidepool-pals): Tidepool: pal in the pool strip does a happy wiggle on level win: **merged** (0.6.0)

## Run run-2026-11-13T19-39-37-293Z

### Tidepool Pals
Gentle reef restoration with pals.

- **HAL-054 merged (0.6.0).** The strip's pal bobs up on goal progress, alongside the win wiggle.
- It's feel work only. The score stays at 88.85, because goal, move and litter tuning is exhausted (L-003, L-006, L-013).
- The strip size is unchanged.

Changes:
- HAL-054 polish(tidepool-pals): Tidepool: pal in the pool strip peeks up on goal progress: **merged** (0.6.0)

## Run run-2026-11-13T20-13-53-894Z

**Tidepool Pals**: a gentle reef match-and-rescue game with a pal at its heart.
- **Tonight (HAL-061):** the strip pal now turns its head (up to 14°) toward where you cleared a group.
- **Identity:** this is pure feel work. The strip size is unchanged, and the glance is skipped under reduced motion.
- **Score:** unchanged at 88.9, as expected for feel work. The tuning levers are spent (L-003, L-006, L-010).

Changes:
- HAL-061 polish(tidepool-pals): Tidepool: pal in strip glances at the tile group you clear: **merged** (0.6.0)

## Run run-2026-11-13T21-58-15-764Z

**Tidepool Pals 0.6.0 (held):** hand-made level 21 is a litter-and-gem clear on an open board while the tide turns. It sits in the close-finish band and keeps the gentle reef-restoration identity. Your player-feedback note on the art style is answered in the reply to N-011.

Changes:
- HAL-070 feature(tidepool-pals): Tidepool: new hand-made level after the last one: **held** (0.6.0)

## Run run-2026-11-13T22-42-46-992Z

**Tidepool Pals:** the kind reef puzzle.

Three visual passes from N-011 merged:
- The pals are now a crab, starfish, fish, octopus and turtle, with faces.
- Gems became sea-glass "Sea Candy" with a sparkle when collected.
- Coral and anemone flowers sit behind the pool strip and bloom as each pool is restored.

The flowers take no room in the strip, and reduced motion is honoured. Fitness stayed flat at 89.27, as expected for art-only work.

The candy stays reef-original: frosted pebbles, not wrapped sweets.

Risk: three art changes in one night. Please check that the matches still read at a glance.

Next: another hand-made level along the lines of L-028, to work on tension, walls and goal reach.

Changes:
- HAL-071 polish(tidepool-pals): Tidepool: rounder, cuter cartoon pals with faces: **merged** (0.6.0)
- HAL-072 polish(tidepool-pals): Tidepool: Gems redrawn as glossy sea-glass candy: **merged** (0.6.0)
- HAL-073 polish(tidepool-pals): Tidepool: coral and anemone flowers framing the board: **merged** (0.6.0)

## Run run-2026-11-13T23-51-30-095Z

**Tidepool Pals: kind, no-timer reef rescue.** Level 9 now has the pal you are rescuing trapped in a bubble on the board. Two nearby clears free it, and freeing it counts toward the goal. This answers the player who couldn't see how the pal connected to the board. I trimmed the droplet goal from 20 to 14 to keep the workload level, and level 9 wins 95%. I didn't take a baseline score first, so I can't say whether goalReach moved. It is held as 0.7.0. This is one level. Your note that the game feels generic and repetitive still needs the wider overhaul.

Changes:
- HAL-080 feature(tidepool-pals): Tidepool: level's pal trapped on board, freed by nearby clears: **held** (0.7.0)
