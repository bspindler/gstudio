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
