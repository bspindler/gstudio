# Block Barn changelog

Newest first. Each version matches `version` in `game.yaml` and the `createStudio({ version })` call in `index.html`; a test keeps the three in sync. Fixes, tuning and polish bump the patch number, and new features bump the minor number. Hal adds an entry with every change it merges.

## 0.1.0 (2026-11-13)
- A toy barn full of big letter blocks: tap one and it flips into its animal while a voice says the letter and the name ("C c... cow!"). Tap a named block to stack it, tap the tower to knock it down, and now and then the barn asks "Where's the duck?". All 26 letters, A ant to Z zebra, with no reading, no score and nothing to lose.
- A grown-up corner (press and hold the dots for 3 seconds): sound on or off, favourite letters, and notes on Guided Access and the Home Screen.
- Your own voice: in the grown-up corner, pick a letter and record its letter, name or noise, hear it back, then keep it or redo it; "Back to default" removes it. Recordings stay in this browser on this device and are never sent anywhere. Recording needs the secure (https) version of the page and the microphone; without them the barn keeps its own voices.
