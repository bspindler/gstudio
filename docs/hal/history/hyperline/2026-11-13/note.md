# hyperline, night of 2026-11-13

## Run run-2026-11-13T12-19-59-373Z

**Hyperline: neon timing jumps.** SWEEP COLUMNS is held for you. It reuses the slot gates in a jump-apart rhythm, which deepens the timing identity rather than adding a gimmick. The score is 100 and fully in band. Its one side effect is that HYPERCORE becomes sector 9. Say yes and it ships as 0.5.0.

Changes:
- HAL-039 feature(hyperline): Add Hyperline SWEEP COLUMNS sector after SLOT GATES: **held** (0.5.0)

## Run run-2026-11-13T13-03-20-409Z

**Hyperline: neon synthwave lane runner.** The camera now looks straight down the lane (HAL-041), which makes obstacles easier to read. The grid, sun and palette are unchanged, so the look is kept. The MAIN MENU button on game-over is built and held for your yes (HAL-044). It adds no timers and no pressure. Score is 100, in band.

Changes:
- HAL-041 fix(hyperline): Hyperline: centre the camera behind the runner's lane: **merged** (0.5.0)
- HAL-044 feature(hyperline): Hyperline: Main Menu button on the game-over screen: **held** (0.5.0)

## Run run-2026-11-13T13-34-06-006Z

**Identity:** neon synthwave runner with a vanishing-point track and sector progression.

The camera is now higher and further back: still centred, with a smaller runner and more track visible ahead. Speed and spacing are untouched, and the score is 100. The Main Menu label ticket was dropped because the button itself never merged. I'll rebuild it next run, titled "Main Menu".

Changes:
- HAL-046 polish(hyperline): Hyperline: game-over button reads "Main Menu", not all caps: **discarded** (implementer blocked: Ticket is label-only, but the game-over 'Main Menu' button from N-006 is not present in the code; adding it would be a behavior change beyond the ticket.)
- HAL-047 fix(hyperline): Hyperline: raise and pull back the camera to show more track: **merged** (0.5.0)

## Run run-2026-11-13T19-39-37-293Z

### Hyperline
A neon synthwave runner through sectors.

- **HAL-055 held:** the side-on camera, with the original angle one setting away.
- **HAL-056 held:** the "Main Menu" button on game-over.
- Both kept the score at 100. The sim, timing, sectors and look are unchanged.
- Both wait on your yes.

Changes:
- HAL-055 feature(hyperline): Hyperline: side-on horizontal camera for the run: **held** (0.5.0)
- HAL-056 feature(hyperline): Hyperline: "Main Menu" button on the game-over screen: **held** (0.5.0)
