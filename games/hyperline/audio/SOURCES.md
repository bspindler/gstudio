# Audio sources

Every sound effect in `sfx.js` comes from Kenney's audio packs, which are CC0 1.0 (public domain). They were downloaded
from OpenGameArt on 2026-11-25; kenney.nl refuses automated downloads, so it wasn't used. Each sound is trimmed (leading
silence, long tails), peak-normalised to -1 dBFS and encoded as 96 kbps mono MP3. The wind loop is left whole so it
loops seamlessly.

| Sound | Source file | Pack | Licence |
| --- | --- | --- | --- |
| `jump` | `phaseJump1.mp3` | Digital SFX Set (Kenney), https://opengameart.org/content/63-digital-sound-effects-lasers-phasers-space-etc | CC0 1.0 |
| `pad` | `phaserUp3.mp3` | Digital SFX Set (Kenney), https://opengameart.org/content/63-digital-sound-effects-lasers-phasers-space-etc | CC0 1.0 |
| `land` | `drop_002.ogg` | Interface Sounds (Kenney), https://opengameart.org/content/interface-sounds | CC0 1.0 |
| `chip` | `pepSound3.mp3` | Digital SFX Set (Kenney), https://opengameart.org/content/63-digital-sound-effects-lasers-phasers-space-etc | CC0 1.0 |
| `near` | `zapTwoTone.mp3` | Digital SFX Set (Kenney), https://opengameart.org/content/63-digital-sound-effects-lasers-phasers-space-etc | CC0 1.0 |
| `crash` | `explosionCrunch_000.ogg` | Sci-Fi Sounds (Kenney), https://opengameart.org/content/sci-fi-sounds | CC0 1.0 |
| `crashLow` | `lowFrequency_explosion_000.ogg` | Sci-Fi Sounds (Kenney), https://opengameart.org/content/sci-fi-sounds | CC0 1.0 |
| `flipIn` | `phaserUp1.mp3` | Digital SFX Set (Kenney), https://opengameart.org/content/63-digital-sound-effects-lasers-phasers-space-etc | CC0 1.0 |
| `flipOut` | `phaserDown1.mp3` | Digital SFX Set (Kenney), https://opengameart.org/content/63-digital-sound-effects-lasers-phasers-space-etc | CC0 1.0 |
| `sector` | `powerUp4.mp3` | Digital SFX Set (Kenney), https://opengameart.org/content/63-digital-sound-effects-lasers-phasers-space-etc | CC0 1.0 |
| `mission` | `confirmation_002.ogg` | Interface Sounds (Kenney), https://opengameart.org/content/interface-sounds | CC0 1.0 |
| `streak` | `maximize_003.ogg` | Interface Sounds (Kenney), https://opengameart.org/content/interface-sounds | CC0 1.0 |
| `gate` | `select_005.ogg` | Interface Sounds (Kenney), https://opengameart.org/content/interface-sounds | CC0 1.0 |
| `revive` | `powerUp10.mp3` | Digital SFX Set (Kenney), https://opengameart.org/content/63-digital-sound-effects-lasers-phasers-space-etc | CC0 1.0 |
| `crate` | `confirmation_004.ogg` | Interface Sounds (Kenney), https://opengameart.org/content/interface-sounds | CC0 1.0 |
| `click` | `click_002.ogg` | Interface Sounds (Kenney), https://opengameart.org/content/interface-sounds | CC0 1.0 |
| `back` | `back_002.ogg` | Interface Sounds (Kenney), https://opengameart.org/content/interface-sounds | CC0 1.0 |
| `toggle` | `toggle_001.ogg` | Interface Sounds (Kenney), https://opengameart.org/content/interface-sounds | CC0 1.0 |
| `error` | `error_004.ogg` | Interface Sounds (Kenney), https://opengameart.org/content/interface-sounds | CC0 1.0 |
| `slowmo` | `lowDown.mp3` | Digital SFX Set (Kenney), https://opengameart.org/content/63-digital-sound-effects-lasers-phasers-space-etc | CC0 1.0 |
| `wind` | `spaceEngineLow_002.ogg` | Sci-Fi Sounds (Kenney), https://opengameart.org/content/sci-fi-sounds | CC0 1.0 |

The music is not a recording: `audio.js` synthesises it in Web Audio (a kick, snare, hats, bass, arpeggio and pads,
sequenced per theme). It is original.
