# block-barn, night of 2026-11-22

## Run run-2026-11-22T12-39-23-095Z

**Block Barn 0.10.0: loft visit, held for you.** Drop a dragged animal on the open door and it goes in, waves from the loft window, and comes back out to its block.

It falls back to the ordinary trot when:
- the door is closed,
- reduced motion is on, or
- the animal is already inside.

A door tap or reset mid-visit cleans up safely. It adds no sounds, text, flashing or assets, and it is calm and wordless, true to the game.

The tests only check the code statically. It has not been played in a browser and there is no phone screenshot, so please try the gesture yourself.

Changes:
- HAL-315 feature(block-barn): Drag an animal into the open barn door: it waves from the loft window, then…: **held** (0.10.0)
