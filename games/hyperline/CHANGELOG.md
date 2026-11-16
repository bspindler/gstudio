# Hyperline changelog

Newest first. Each version matches `version` in `game.yaml` and the `createStudio({ version })` call in `index.html`; a test keeps the three in sync. Fixes, tuning and polish bump the patch number, and new features bump the minor number. Hal adds an entry with every change it merges.

## 0.7.0 (2026-11-15)
- Sector intros are sharper: the Crumble Track and Twin Fangs openers now ask for tighter jump timing.
- New sector BOOST PADS: pads launch you over tall walls onto a short landing strip, then time one tap through the spikes.
- Flip City's first gravity-flip stretch now has wider ceiling spike clusters, so timing your drop matters.
- Tapping fast to jump no longer triggers double-tap or pinch zoom on iPhone Safari.

## 0.6.1 (2026-11-14)
- A cyan neon ripple spreads across the track each time you land, making jump timing easier to feel.

## 0.6.0 (2026-11-13)
- Hyperline's neon now really glows: a soft bloom lights up the rails, edges and sun on phones that support it, and the game looks as before on those that don't.
- New sector: PULSE RAILS. A rail across the track blinks lit and dark to a steady beat. Stay in the air while it glows, land in the dark half, then hop again. It comes before HYPERCORE, which is now sector 10.
- New sector: CRUMBLE TRACK. Floor panels glow, then fall away, leaving holes to leap: jump, land, and jump again. It comes before HYPERCORE, which is now sector 11.

## 0.5.1 (2026-11-13)
- Hyperline: the camera is back to the original angled chase view from 0.4.1.

## 0.5.0 (2026-11-13)
- New sector: SWEEP COLUMNS. After SLOT GATES you now meet rows of slot gates, a jump apart: thread one, land, and jump again in rhythm. HYPERCORE is now sector 9.
- Hyperline: the camera now sits straight behind your lane, with the vanishing point at the centre, so obstacles are easier to read.
- Hyperline: the camera is now higher and further back with a gentler tilt, so the runner looks smaller and you can see more track ahead.
- Game over now has a "Main Menu" button that takes you back to the ready screen and sector picker.

## 0.4.1 (2026-11-12)
- Sound now plays on iPhone even when the ring/silent switch is set to silent. Use the in-game sound setting to turn it off.

## 0.4.0 (2026-11-12)
- New sector SLOT GATES: neon gates with a gap you thread mid-jump, on the way up or down; HYPERCORE now follows it.
- Endless: start a run from any sector you've already reached with the free sector picker on the ready screen; these practice starts never touch your BEST, ghost or missions.
- Near misses now flash a quick neon cyan edge spark and play a bright synth blip.

## 0.3.1 (2026-11-11)
- **Fonts ship with the game.** Monoton and Chakra Petch now load from the game's own `fonts/` folder (SIL OFL), so players' phones no longer contact Google Fonts. The look is unchanged.
- Obstacles are solid and lit, and the course is faster and denser.
- A course preview on the ready screen, the game pauses while settings are open, and small-screen polish.
- Fix: new events are sent as custom events so the ingest accepts the batch.

## 0.3.0 (2026-11-07)
- Sectors, a daily run, ghosts, missions and trails.
- A Canvas2D perspective renderer and a WebAudio synth.
- Pure game logic modules with tests.
- Runs on the studio SDK's no-ingest mode for local play.

## 0.2.0 (2026-10-26)
- First studio version: ported onto the studio SDK. Earlier versions predate this repo.
