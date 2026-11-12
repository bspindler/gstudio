# Hyperline changelog

Newest first. Each version matches `version` in `game.yaml` and the `createStudio({ version })` call in `index.html`; a test keeps the three in sync. Fixes, tuning and polish bump the patch number, and new features bump the minor number. Hal adds an entry with every change it merges.

## 0.4.0 (2026-11-12)
- New sector SLOT GATES: neon gates with a gap you thread mid-jump, on the way up or down; HYPERCORE now follows it.

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
