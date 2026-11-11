# Tidepool Pals changelog

Newest first. Each version matches `version` in `game.yaml` and the `createStudio({ version })` call in `index.html`; a test keeps the three in sync. Fixes, tuning and polish bump the patch number, and new features bump the minor number. Hal adds an entry with every change it merges.

## 0.4.1 (2026-11-11)
- **Fonts ship with the game.** Bagel Fat One and Nunito now load from the game's own `fonts/` folder (SIL OFL), so players' phones no longer contact Google Fonts. The look is unchanged.
- Fix: the reef's litter art was renamed so the merged page script loads.

## 0.4.0 (2026-11-07)
- **Reef restoration:** a reef map, stage-up celebrations, a reef Home Pool, a photo card and field notes.
- **Tides:** tide gravity in four directions, a tide meter and a tide-turn sweep, plus rock pools, rescues, litter and helper abilities.
- Pal favourite pools spread three per pool across the first four pools. Pal sources are saved, and a bought-only helper marks the level as assisted.
- Side exit markers keep their arrow direction and fit the phone gutter.

## 0.3.0 (2026-11-07)
- Banked shells, a level map, boosters, a home pool and general polish.
- Hand-authored levels 1–20 and a generator that ramps features in gradually.
- Pure board rules: masks, sand, ice, specials, combos and goals.
- Runs on the studio SDK's no-ingest mode for local play.

## 0.2.0 (2026-10-26)
- First studio version: ported onto the studio SDK. Earlier versions predate this repo.
- Assisted wins pay pearls, not a shell, so there's no paid path to random rewards.
- Fix: the empty modal no longer covers the board.
