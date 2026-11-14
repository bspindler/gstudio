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

## Run run-2026-11-14T00-28-38-604Z

**Identity:** a cartoon reef with pals to rescue, Sea Candy, tides and pools that bloom back to life.

**Tonight:**
- **Merged:** each pool now has its own board look (0.7.0), which makes moving to a new pool feel like going somewhere new.
- **Held:** the level-start goal card that ties the pal to what you clear.
- **Dropped:** swipe-to-swap. Hal's controls check still expects taps, the scorer robot can't play swaps, and a blocked request to the local ingest needs tracing.

**Next:** once you decide who updates the controls check and scorer, retry swipe with a baseline score first, keeping the pals and the trapped pal central.

Changes:
- HAL-082 polish(tidepool-pals): Tidepool: each pool gets its own board look and reef frame: **merged** (0.7.0)
- HAL-086 feature(tidepool-pals): Tidepool: swipe to swap neighbours, match 3+ to clear: **discarded** (0.7.0) (controls tidepool-pals touch tap on a tile group makes a move: moves 18 -> 18 (settled 18) after tapping tile #39 of 56; controls tidepool-pals no outbound requests: blocked (1): http://127.0.0.1:8787/v1/events)
- HAL-087 feature(tidepool-pals): Tidepool: level-start card shows the pal and what to clear: **held** (0.7.0)

## Run run-2026-11-14T06-00-05-178Z

**Identity:** a cartoon reef rescue with Sea Candy and blooming coral. Taps are still the control.

- **HAL-091 (held).** Level 3 now has a bubbled pal, freed by two nearby clears, so the rescue is taught early. Level 3 still wins 100% of plays.
- **HAL-092 (held).** Level 22 is a heart-shaped pool with the pal bubbled in the centre and ringed by litter. It wins 95% of plays with 22% of moves left, a close finish, and fitness went from 89.3 to 89.6.

Both tickets push away from the generic grid. Both are bundled into 0.7.0 with the level 9 bubble and the goal card, waiting on your yes.

Changes:
- HAL-091 feature(tidepool-pals): Tidepool: bubble-trapped pal on level 3 to teach the rescue: **held** (0.7.0)
- HAL-092 feature(tidepool-pals): Tidepool: level 22, a pal ringed by litter in a heart board: **held** (0.7.0)

## Run run-2026-11-14T06-52-45-522Z

**Identity:** a calm reef rescue. You free sea-animal pals and restore pools, with cartoon Sea Candy and blooming coral. Tonight kept that identity.

- **Pool strip (HAL-094, merged).** The favourite-pal line now fits on its own line, which strengthens the pal-to-board link you said was unclear. It was not checked visually in a browser, so please glance at it on your iPhone.
- **Level 23 (HAL-098, held).** A starfish board with a bubbled pal in the centre. It lands at 85% win with 22% moves left, a close finish, though easier to lose than the heart level's 95%. This is the kind of shape variety that answers 'generic and repetitive'.
- **Heart-shaped level 22 (HAL-092).** Dropped on a merge conflict and queued for a rebuild.
- **Fitness:** flat at 89.3.
- **Version mistake:** both tickets reused 0.7.0. They will be re-versioned before release.

Changes:
- HAL-094 polish(tidepool-pals): Tidepool: pool strip shows the full favourite-pal line: **merged** (0.7.0)
- HAL-098 feature(tidepool-pals): Tidepool: level 23, star-shaped board, pal in a bubble: **held** (0.7.0)

## Run run-2026-11-14T10-59-15-303Z

**Tidepool Pals 0.7.1**, a cute reef rescue with sea-glass Sea Candy.
- **Merged:** Sea Candy now pops with a pastel sugar-sparkle. It is on-identity, uses no assets, and is skipped under reduced motion.
- **Dropped:** the bubbled-pal wave and crack (HAL-100), for "no gain", even though the equally neutral sparkle merged. I'm looking into it.
- **Urgent:** Brian can't win level 9 because its rescue pal never appears (N-016). Fixing that comes first.
- Fitness is 89.3, unchanged.

Changes:
- HAL-100 polish(tidepool-pals): Tidepool: bubbled pal waves and bubble cracks on first hit: **discarded** (0.7.1) (tidepool-pals: no real gain: 0.00 < 0.5)
- HAL-104 polish(tidepool-pals): Tidepool: Sea Candy pops with a soft sugar-sparkle burst: **merged** (0.7.1)
