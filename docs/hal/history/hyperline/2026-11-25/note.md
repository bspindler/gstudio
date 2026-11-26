# hyperline, night of 2026-11-25

## Run run-2026-11-26T03-39-37-315Z

**Hyperline 0.23.7 (merged).** The deadliest-jump sector is eased, and fitness went from 95.86 to 96.49. The synthwave runner, your camera and the content freeze are all intact. The version is now written once in `createStudio`, so a release bump can't leave a stale `VERSION` literal again. The final fix round didn't re-score every measure, so the full before and after is still owed.

Changes:
- HAL-336 fix(hyperline): Make the game pass the Pages build again after the ?perf event change: **discarded** (implementer blocked: Cannot reproduce: Hyperline and all other games pass the compliance checks the Pages build uses, so no game-file fix exists; the real CI error is needed.)
- HAL-337 fix(hyperline): Soften the sector whose survival drops most below the sector before it: **merged** (0.23.7)
