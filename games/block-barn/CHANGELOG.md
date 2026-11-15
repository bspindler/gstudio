# Block Barn changelog

Newest first. Each version matches `version` in `game.yaml` and the `createStudio({ version })` call in `index.html`; a test keeps the three in sync. Fixes, tuning and polish bump the patch number, and new features bump the minor number. Hal adds an entry with every change it merges.

## 0.2.3 (2026-11-15)
- Internal only, nothing changes for players: the list of tappable places now lives next to the code that answers taps, so the test robot reads it from the game.

## 0.2.2 (2026-11-15)
- A palm or two fingers that touch the grown-up corner along with the barn now count as one tap: the barn answers once, and the corner no longer puffs or starts its ring at the same time.

## 0.2.1 (2026-11-15)
- The barn doors and the window are now big enough for small fingers on every phone: the wall along the top is never shorter than 88 px. The hay tower's blocks stay big on short phones too.

## 0.2.0 (2026-11-14)
- Block Barn: neighbouring animals now and then turn to each other with a slow, gentle peek.
- Tap the big barn doors and they swing open: your animals trot inside one by one and peek out of the window; tap again and they trot back out.
- Tap the sky in the barn window and it fades slowly to a soft dusk with a moon, and the animals curl up for a nap. Tap again for morning.

## 0.1.1 (2026-11-13)
- Block Barn: when you name a block, the animals nearby slowly turn to look at it (and stay still if reduced motion is on).
- Block Barn: the grown-up corner is easier to find and press, with a bigger touch area and a clearer ring that fills during the 3-second hold and empties gently if you let go early.
- Block Barn: when the tower tumbles, each block now gives one small, gentle bounce as it settles (skipped with reduced motion).
- Block Barn: the animal on top of your tower gives a soft happy hop after you stack a block (skipped with reduced motion).
- After the neighbours turn to look at a newly named animal, the one or two nearest ones lean in for a slow, soft nuzzle and settle back.
- Named animals now give a slow, gentle blink every few seconds (and stay still with reduced motion).
- Block Barn: a tapped block now gives a soft squish as it flips (skipped with reduced motion).
- Block Barn: when the tower tumbles, the nearest named animals give one slow, wide-eyed look toward it and then settle (skipped with reduced motion).
- When you find the animal the barn asked for, it now gives a slow, happy side-to-side sway after its dance, then settles.

## 0.1.0 (2026-11-13)
- A toy barn full of big letter blocks: tap one and it flips into its animal while a voice says the letter and the name ("C... cow!"). Tap a named block to stack it, tap the tower to knock it down, and now and then the barn asks "Where's the duck?". All 26 letters, A ant to Z zebra, with no reading, no score and nothing to lose.
- A grown-up corner (press and hold the dots for 3 seconds): sound on or off, favourite letters, and notes on Guided Access and the Home Screen.
- A full barn: the blocks, their animals and the tower are sized from the screen and fill the floor on every phone, tablet and desktop window (two big columns on a tall phone, three columns on other upright screens, one big row of taller blocks on tablets on their side and desktop windows). Every animal's drawing fills its space, and the tower's animal sits on top of the stack or beside it, wherever there is more room. Before a block is tapped, its animal peeks over it as a soft hay-coloured silhouette, bobbing gently (still with reduced motion), so the barn never opens on bare hay.
- Slower, warmer device speech: the voice speaks at a gentle pace and natural pitch, says the letter, then the name (and the noise) with a pause between them, and uses the best English voice on the device itself (Premium or Enhanced voices first, then a plain local one; never an online voice, so the words never leave the device).
- Your own voice: in the grown-up corner, pick a letter and record its letter, name or noise, hear it back, then keep it or redo it; "Back to default" removes it. Recordings stay in this browser on this device and are never sent anywhere. Recording needs the secure (https) version of the page and the microphone; without them the barn keeps its own voices. A recording in progress stops (and the microphone turns off) when the tab is hidden, and the list says so if a recording couldn't be kept.
