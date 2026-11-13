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
