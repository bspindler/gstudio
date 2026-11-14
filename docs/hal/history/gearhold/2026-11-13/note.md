# gearhold, night of 2026-11-13

## Run run-2026-11-13T12-19-59-373Z

**Gearhold: the clockwork citadel, where the machinery is the danger.** The brass hit tick (0.3.3) keeps the brass HUD language you liked, and it is clarity, not drift. Press Gallery (level 4) is still the right idea for real tension. Tonight's retry died on a screenshot-tool crash on the old build, not on the level. The build's gearhold-play score was 81.03 and was not rescored after the crawler fix. Next run: fix the tool, retry, rescore.

Changes:
- HAL-037 polish(gearhold): Gearhold: brass hit-direction tick on the HUD when damaged: **merged** (0.3.3)
- HAL-038 feature(gearhold): Retry Press Gallery level 4 with wider press windows: **discarded** (0.4.0) (before shot failed: exit 1: flow: level 4 from above failed (page.evaluate: TypeError: Cannot read properties of undefined (reading 'map')))

## Run run-2026-11-13T13-03-20-409Z

**Gearhold: clockwork citadel crawler.** The Press Gallery retry (HAL-045) was discarded because the screenshot tool crashed on the pre-level-4 build. The build itself showed that a crystal before the last presses makes level 4 survivable (98% wins). It also cut tension to 10.2, and pace stays at 50 because the level is only 12s long. Next run I fix the tool, then make level 4 longer instead of easier. The press hazard is on identity and worth keeping.

Changes:
- HAL-045 feature(gearhold): Gearhold L4 Press Gallery: crystal before the last presses: **discarded** (0.4.0) (before shot failed: exit 1: flow: level 4 from above failed (page.evaluate: TypeError: Cannot read properties of undefined (reading 'map')))

## Run run-2026-11-13T13-34-06-006Z

**Identity:** clockwork citadel of rooms and corridors in brass, with ticks and chimes.

The gear-key pickup now has a brass glow and a ratchet chime, in the same family as the compass and hit ticks you voted up. The Terrace of Dials route change made the level longer (19.5s median) but left pace at 66.7, so it was discarded. gearhold-play holds at 83.05. The screenshot-tool fix and the level 4 retry are still queued.

Changes:
- HAL-048 tuning(gearhold): Gearhold: seal Terrace of Dials' mid-wall gap for a longer route: **discarded** (0.3.3) (gearhold-play: no real gain: 0.00 < 0.5)
- HAL-050 polish(gearhold): Gearhold: brass gear-key pickup flash and a clockwork chime: **merged** (0.3.3)

## Run run-2026-11-13T19-39-37-293Z

### Gearhold
Clockwork-citadel exploration, with gear keys and timed presses.

- **HAL-051 discarded.** The longer Terrace of Dials loop made the route 50% longer but added only 1.3s to the median win, and pace held at 66.7.
- No new enemies were added, and the exploration feel would have been kept. The lever is simply wrong.
- **Next:** check which level and which pace band is failing before reshaping anything else.
- Level 4 (Press Gallery) is blocked until the protected screenshot tool is fixed.

Changes:
- HAL-051 tuning(gearhold): Gearhold: longer Terrace of Dials loop via a side gallery: **discarded** (0.3.3) (gearhold-play: no real gain: 0.00 < 0.5)

## Run run-2026-11-13T20-13-53-894Z

**Gearhold**: a brass clockwork citadel.
- **Tonight (HAL-060):** the steam-and-cog puff when a foe is wrecked adds to the brass feedback you've liked, without touching layout or balance.
- **Scores:** gearhold is 100 and gearhold-play is 83.1.
- **Level 4:** still waiting on the protected screenshot tool.

Changes:
- HAL-060 polish(gearhold): Gearhold: brass steam puff when a clockwork foe is wrecked: **merged** (0.3.3)

## Run run-2026-11-13T20-47-47-798Z

### Gearhold
Gearhold is a clockwork citadel where the threat comes from machinery and timing, not from crowds of enemies. Tonight's brass arch glow keeps that identity. It echoes the key flash and the brass-and-cog look, and it makes the exit easier to spot in the busy rooms on levels 2 and 3. Gearhold is at 100 and gearhold-play is at 83.07, both unchanged.

Level 4 is stuck behind the screenshot-tool fix, which sits on protected paths. When it's unblocked, the ticket has to build the timed presses from scratch, because no press code was ever merged.

Changes:
- HAL-063 fix(gearhold): Overhead shot tool: skip levels the build lacks: **discarded** (implementer blocked: The fix belongs in scripts/hal/screens.ts and focus.ts (guard h.start(n) when n is at or above the build's level count and record 'level not present'). Both are protected paths, and the Gearhold hook block is also protected.)
- HAL-064 polish(gearhold): Gearhold: exit arch glows brass once you hold the gear key: **merged** (0.3.3)
- HAL-065 feature(gearhold): Gearhold L4 Press Gallery: longer gallery, wider press windows: **discarded** (implementer blocked: T1 (timed presses) is not merged: games/gearhold has no press mechanic, so level 4 Press Gallery cannot be implemented.)

## Run run-2026-11-13T21-58-15-764Z

**Gearhold 0.4.0 (held):** Press Gallery adds brass presses that glow, then thump, in a steady, learnable wave. That fits its clockwork-citadel identity, with no random timing. gearhold-play went from 83.1 to 87.3, with real tension at last (35) and winnable at 75. A kilnwarden in the exit room dropped wins to 14%, so a drone guards it instead. The layout scorer still needs a rerun on the longer map.

Changes:
- HAL-069 feature(gearhold): Gearhold L4 Press Gallery with its timed gear presses: **held** (0.4.0)

## Run run-2026-11-13T22-42-46-992Z

**Gearhold:** the heavy clockwork citadel.

The press slam dust and distance-faded clank (HAL-074) was discarded on a gearhold-play tension drop of 8.74. Fitness was flat, and a cosmetic change shouldn't move tension, so I suspect scorer noise or a side effect from the new `slamVolume` helper.

Next: score the unchanged build twice to measure the noise, then retry.

Press Gallery 0.4.0 is still waiting on your release yes (N-010).

Changes:
- HAL-074 polish(gearhold): Gearhold: press slams kick up brass dust and a low thud: **discarded** (0.4.0) (gearhold-play: tension regressed 8.74 (> 1))

## Run run-2026-11-13T23-51-30-095Z

**Gearhold: steady, learnable machine-hall danger.** One repair crystal two-thirds of the way down Press Gallery overshot. Wins rose to 94-96%, tension fell to 10-13.6 (band is 15-50), and winnable dropped to 50. I discarded it. Press Gallery's identity is its press rhythm, so the next lever is press timing (slightly wider safe windows), not more healing.

Changes:
- HAL-077 tuning(gearhold): Gearhold L4: one repair crystal midway down Press Gallery: **discarded** (implementer blocked: A repair crystal midway down Press Gallery raised the L4 win rate to 94-96% and dropped tension to 10-13.6, below the 15-50 band, and winnable scored 50.0. The fix needs a different lever, such as press timing or crystal removal.)

## Run run-2026-11-14T00-28-38-604Z

**Identity:** tense, learnable rhythm among brass machinery.

**Tonight:**
- **Dropped:** the longer press rest (4.4s). Level 4 wins rose from 80% to 90%, but `winnable` stayed at 75 and tension slipped from 35 to 32.

**Next:** Press Gallery's 4s rhythm stays. I'll find which level actually holds `winnable` at 75 before tuning further.

Changes:
- HAL-083 tuning(gearhold): Gearhold L4: press cycle 4.0s to 4.4s, same glow and slam: **discarded** (0.4.0) (gearhold-play: no real gain: 0.00 < 0.5; gearhold-play: tension regressed 2.78 (> 1))

## Run run-2026-11-14T06-00-05-178Z

**Identity:** a tense, compact clockwork citadel. Nothing shipped tonight, so that identity is intact.

- **HAL-088 (dropped).** Easing Kiln Heart lifted level 3 wins from 82% to 90%, but winnable stayed at 75 because Press Gallery (80%) is now the floor. Both levels need easing together.
- **HAL-089 (dropped).** Closing shortcuts on Terrace of Dials fixed pace (75 to 100, fitness 87.3 to 92.7), but feel fell 3.4 points, over the gate's limit of 1.

Gearhold is **stagnated**. I'm waiting on your direction before trying more.

Changes:
- HAL-088 tuning(gearhold): Gearhold: find the level holding winnable at 75, ease it: **discarded** (0.4.0) (gearhold-play: no real gain: 0.00 < 0.5)
- HAL-089 tuning(gearhold): Gearhold: find the level that fails pace, retune its route: **discarded** (0.4.0) (gearhold-play: feel regressed 3.40 (> 1))

## Run run-2026-11-14T06-52-45-522Z

**Identity:** a clockwork shooter with brass, gears and press halls.

- **Hit-tick (HAL-096, merged).** Per your direction, I moved off winnable and pace tuning. Landing a shot now gives the crosshair a brass ring-and-tick and a soft click, with red kept for kills. This strengthens the existing marker and makes the game more itself.
- **Scores:** flat at 100, and gearhold-play at 87.3.
- **Version mistake:** it reused 0.4.0. It will get its own bump.
- **Still unconfirmed:** whether Press Gallery 0.4.0 is live.

Changes:
- HAL-096 polish(gearhold): Gearhold: brass hit-tick on the crosshair when a shot lands: **merged** (0.4.0)

## Run run-2026-11-14T10-59-15-303Z

**Gearhold**, clockwork brass.
- **Dropped:** the press steam vent and hiss (HAL-101), for a gearhold-play tension -4.17 with fitness flat. This is the second time a visual- or audio-only change has tripped tension, which points to scorer noise.
- **Next:** measure variance on an unchanged build before more polish. Gearhold stays off winnable and pace tuning, per N-015.
- Press Gallery 0.4.0 still needs Brian to confirm it is live.

Changes:
- HAL-101 polish(gearhold): Gearhold: presses vent a brass steam puff after slamming: **discarded** (0.4.1) (gearhold-play: tension regressed 4.17 (> 1))
