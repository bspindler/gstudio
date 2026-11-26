# hyperline, night of 2026-11-25

## Run run-2026-11-26T03-39-37-315Z

**Hyperline 0.23.7 (merged).** The deadliest-jump sector is eased, and fitness went from 95.86 to 96.49. The synthwave runner, your camera and the content freeze are all intact. The version is now written once in `createStudio`, so a release bump can't leave a stale `VERSION` literal again. The final fix round didn't re-score every measure, so the full before and after is still owed.

Changes:
- HAL-336 fix(hyperline): Make the game pass the Pages build again after the ?perf event change: **discarded** (implementer blocked: Cannot reproduce: Hyperline and all other games pass the compliance checks the Pages build uses, so no game-file fix exists; the real CI error is needed.)
- HAL-337 fix(hyperline): Soften the sector whose survival drops most below the sector before it: **merged** (0.23.7)

## Run run-2026-11-26T06-00-04-974Z

**Hyperline (neon synthwave timing runner)**
- **Merged (HAL-343):** every jump now leaves a cyan ring on the track and gives a light haptic tick, so a tap confirms at once. The camera and 3D runner are untouched, and fitness holds at 96.49.
- **Dropped (HAL-342):** the sliding-ledge intro retune. A tighter window lifted bites only from 82.4 to 83.7, and anything tighter made some seeds unclearable.
- **Next:** the bite loss from about 98 needs a diagnosis of which intro softened before any more tuning.

Changes:
- HAL-342 tuning(hyperline): Make the existing sector intro that stopped biting ask for real timing again: **discarded** (0.23.7) (hyperline: no real gain: 1.23 < 9.15)
- HAL-343 polish(hyperline): Give every jump take-off a cyan ring on the track and a light haptic tick: **merged** (0.23.7)
