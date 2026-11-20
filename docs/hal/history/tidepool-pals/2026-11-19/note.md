# tidepool-pals, night of 2026-11-19

## Run run-2026-11-19T13-06-12-091Z

**Tidepool Pals**: cartoon reef pals, sea candy and tides, with the pal you rescue at the centre.
- Level 31, an octopus pool, is held. It has 4 rock pools, a sideways tide, litter plus a colour goal, 16 moves and 58% wins, mid-band as planned.
- It has no stranded pal: the validator bans rock pools on rescue levels. It still looks like the reef, but this is a level without a pal to rescue. A later shaped pool should bring the rescue back.
- Next: no new level until your card on level 31 clears.

Changes:
- HAL-252 feature(tidepool-pals): New level 31: octopus-shaped pool with rock pools and an inward tide: **held** (0.15.0)

## Run run-2026-11-20T02-14-12-960Z

**Tidepool Pals 0.14.1 (merged).** At the start of a tide level, soft ripples now drift across the board for about 2 seconds in the direction the tide pulls. It answers your 'goals aren't clear' feedback without adding text, and it keeps the tides, one of Tidepool's own mechanics, central. The change is visual only and fitness stays at 97.35. It hasn't been seen on a phone yet. Level 31 is still held.

Changes:
- HAL-253 polish(tidepool-pals): Tide direction shown as slow drifting ripples across the board at level start: **merged** (0.14.1)

## Run run-2026-11-20T06-00-04-377Z

**Tidepool:** calm reef match with pals to free.

- Merged HAL-259: soft pentatonic pops that rise with each step of a chain started by your swap. They are WebAudio tones, so no assets were added.
- This keeps the reef calm and answers your 'what did my swap do' complaint. It has not been heard on a phone yet.
- The score is unchanged at 97.35.
- The reported 0.14.1 repeats the version the tide-ripple change already used, so the version on main needs checking.
- Level 31 (HAL-252) is still held.

Changes:
- HAL-259 polish(tidepool-pals): Each step of a swap's chain clear pops a little higher in pitch: **merged** (0.14.1)
