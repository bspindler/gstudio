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

## Run run-2026-11-13T20-13-53-894Z

**Hyperline**: a neon lane-runner you read at speed.
- **Tonight:** the camera restore (HAL-057) was blocked. The builder needed the pre-HAL-041 camera values and couldn't find them. Nothing shipped, so the game is unchanged at 100.
- **Main Menu:** the Main Menu button you approved is on main.
- **Next run:** restore the 0.4.1 chase camera exactly, using values taken from git history.
- **three.js:** I'm waiting on this until you've confirmed the camera.

Changes:
- HAL-057 fix(hyperline): Hyperline: restore the original angled chase camera: **discarded** (implementer blocked: Need the pre-HAL-041 cameraFor values (eye, target, fov) from git history; they are not in the working tree or docs.)

## Run run-2026-11-13T21-58-15-764Z

**Hyperline:** nothing changed tonight. What makes it itself is the neon chase down the track, seen from the original angled camera. Restoring that camera was blocked because the builder can't read git history. Main Menu (👍) is untouched. three.js waits for the camera restore and for your approval of the dependency.

Changes:
- HAL-066 fix(hyperline): Hyperline: restore the exact 0.4.1 angled chase camera: **discarded** (implementer blocked: Need the exact 0.4.1 cameraFor values (eye, target, fov, any CAMERA_VIEW default) from git history; they are not in the working tree, docs or changelog, and this build has no git access. Paste them into the ticket and re-run.)

## Run run-2026-11-13T22-42-46-992Z

**Hyperline:** the neon runner.

The three.js bloom renderer (HAL-076) was blocked before any code was written, because the builder can't vendor the library.

Once `three.module.js` and its LICENSE are in `games/hyperline/vendor/`, I'll build it:
- keeping the 0.4.1 camera you restored, exactly as it is
- leaving the course untouched
- falling back to the current renderer if WebGL fails

Changes:
- HAL-076 feature(hyperline): Hyperline: three.js renderer with real neon bloom: **discarded** (implementer blocked: Cannot bundle three.js into games/hyperline/ with the allowed tools (no copy or network). A human needs to copy the vendored three.module.js and its LICENSE into games/hyperline/vendor/ first.)

## Run run-2026-11-13T23-51-30-095Z

**Hyperline: neon speed on your restored chase camera.** Bloom now makes the rails, edges and sun really glow. It uses only the shared three.js copy, nothing is bundled into the game folder, and the game falls back to the plain renderer if WebGL fails or is lost. Gameplay and camera are unchanged, and the score is 100. It is held as 0.6.0 for your yes.

Changes:
- HAL-081 feature(hyperline): Hyperline: three.js neon bloom renderer, shared copy: **held** (0.6.0)

## Run run-2026-11-14T06-00-05-178Z

**Identity:** a one-button neon runner. You jump to a rhythm, and the 0.4.1 chase camera is restored.

- **HAL-093 (held).** PULSE RAILS adds a rail across the track that blinks red and lit to a beat. Land in the dark half, then hop again. The ticket asked for lane switches, but Hyperline has a single lane, so the builder correctly turned it into a jump-timing sector. It is in band at 100, the camera is untouched, and it makes HYPERCORE sector 10.

Changes:
- HAL-093 feature(hyperline): Hyperline: new sector PULSE RAILS, side rails that blink: **held** (0.6.0)

## Run run-2026-11-14T06-52-45-522Z

**Identity:** a single-lane, jump-only neon runner, now with bloom on your restored 0.4.1 camera.

- **PULSE RAILS** shipped on your 👍.
- **CRUMBLE TRACK (HAL-099, held).** Panels glow and then fall away, which is a jump-timing mechanic in line with L-041. HYPERCORE becomes sector 11.
- **Wall spacing.** The build also made padWall's wall spacing scale with speed so walls stay clearable at top speed. That slightly touches existing sectors, so watch for it.
- **Fitness:** 99.88.
- **Version mistake:** it reused 0.6.0. It needs a new minor version before release.

Changes:
- HAL-099 feature(hyperline): Hyperline: new sector CRUMBLE TRACK, panels fall away: **held** (0.6.0)
