# Hyperline: quality plan, phase by phase

2026-11-25. This builds on the "Quality Bar and Art & Feel Plan" (Brian, 2026-11-25). The quality bar table in that
doc is the finish line, and this plan is how we get there **without hiring anyone**. Every asset is CC0 (Quaternius
first) or made in code. Each phase ships on its own, keeps all tests green, and ends with a check that someone else
can rerun.

## Calls made

- **No freelancers. Start from Quaternius** (Brian, 2026-11-25). The runner, the obstacles and the city come from
  Quaternius's CC0 packs, re-materialled in our own neon look. Code-built pieces fill any gaps. CC0 allows
  commercial use and changes, needs no attribution, and the models are generic, so hard rule 6 holds. Every model
  in a game is logged in `games/hyperline/models/SOURCES.md` with its pack, URL and CC0 licence.
- **The runner is an animated Quaternius character.** Quaternius makes rigged characters, not vehicles, and comes
  with run, jump and death animations. The test model is RobotExpressive (Tomás Laulhé / Quaternius, CC0, from the
  three.js examples), already working in the lab. Skins recolour our materials, so every existing skin maps onto the
  character, Chrome Serpent owners keep a premium look, and nobody loses anything they own.
- **No glTF loader in the game.** `npm run model` (`scripts/vendor/glb-to-module.ts`) converts a GLB offline into a
  data-only JS module (`games/hyperline/models/*.js`). `games/hyperline/lib/rig.js` turns it into skinned or rigid
  meshes with our own materials and three.js animation clips. The "no network code in games" check stays exactly as
  strict as it is now. The three.js bundle gained only the skinning and animation classes.
- **Sound effects come from CC0 packs plus designed synthesis. Music is a code-driven sequencer playing CC0 drum and
  synth one-shots.** We own the arrangement, every track's BPM and beat grid are exact (which beat sync needs), and
  nothing has to be licensed. Each sample is logged in `games/hyperline/audio/SOURCES.md` with its CC0 source.
- **Beat sync is an experiment on new sectors only.** The existing sectors keep their timing, so daily runs, ghosts
  and bests stay valid.
- **Native haptics come last**, through Capacitor, once the web build passes the feel checklist. Creating accounts
  and submitting to the store go through the gateway as approvals.

## Phase 0: cheap fixes (in progress)

Shipped in 0.15.0:
- [x] Fast retry. "Run again" is the first button and starts a run in one tap. The summary sits under "Run details",
  and the death screen appears 0.52 s after the crash (it used to be 0.75 s).
- [x] Coyote time of 80 ms (`COYOTE` in `lib/world.js`). The jump buffer is already 120 ms.
- [x] A 70 ms hit-stop on crash.
- [x] Nothing paid before run 4 and 2 minutes of play (`paidOffersOpen` in `lib/meta.js`). The credits revive is
  always listed first.

Shipped in 0.16.0:
- [x] A 0.3× slow-motion moment for 300 ms on three near-miss clears in a row (`lib/feel.js`; world time only, and
  the simulation stays at a fixed step).
- [x] Camera: a spring kick up on jump and a dip on landing scaled by fall height, plus up to +6° FOV at top speed.
  The kick is off with reduced motion.
- [x] A landing thud whose pitch follows the fall height (with a light haptic where supported), chips that are drawn
  sliding toward the runner, and a pop on the chip counter.
- [x] A reward by run 2: the first Neon Crate comes on run 2, then every 5th run (`crateDue` in `lib/meta.js`).

Still to do in this phase:
- [x] Hal: new Hyperline sectors are frozen (Brian's OK, 2026-11-25). The tripwire `content-frozen` discards a
  candidate that adds one, and the planner prompt points Hal at feel and readability work instead. To lift it, see
  `docs/hal/OPERATIONS.md` under "Content freezes".
- [ ] A 10-minute session of 0.16.0 on Brian's iPhone.

**Done when:** every item is checked off, the full test suite is green, and one 10-minute session on Brian's iPhone
turns up no regressions.

## Phase 1: measure feel before changing the look

Build the measuring tools first, so the renderer port in phase 2 is judged on numbers.
- A Playwright feel probe at 390×844 that reports:
  - p50, p95 and max frame time over a 3-minute scripted run
  - input-to-jump-frame latency
  - death-to-running time through Run again
  - cold start to playable
- An event-coverage check: every simulation event (jump, land, chip, near, pad, gate, flip, die) triggers a sound
  call, and a haptic call where the feel checklist asks for one.
- A 60-second phone-size video for every build (Playwright `recordVideo`), kept next to the previous build's video.
- Hal: a Hyperline **feel score** built from the probe, scored like Block Barn's `responsive`. A regression in a
  candidate fails it.

**Done when:** the probe runs in CI-local and in Hal's scorer, and it has recorded a baseline for 0.15.0.

## Phase 2: the three.js renderer

- Write the style guide first (`docs/hyperline/style-guide.md`). It sets the colour rules (cyan for the runner and
  safe ground, magenta and red for hazards, gold for rewards, and nothing else glows), requires every silhouette to
  be readable in black, and defines the three themes (Neon District, Flip City, Hypercore).
- Add `render3d.js` behind `?r=3d`. It takes the same state object that `drawScene` gets, so `lib/` stays untouched.
  It uses lit low-poly meshes, emissive materials, exponential fog, instanced track pieces and the existing bloom.
- Port obstacle types in sector order. A parity test renders every obstacle type in both renderers, and a
  black-silhouette shot gets a readability check.
- Switch the default to 3D only when every sector renders, and the probe shows 60 fps on an iPhone 12 (the weekly
  real-device check) with no frame over 33 ms. Delete the 2D path one release after the switch.

**Done when:** 3D is the default and the phase 1 numbers are no worse than the 2D baseline.

Status (2026-11-25, 0.17.0):
- [x] `render3d.js` draws everything `drawScene` does, from the same camera and state: the track, all 22 sectors'
  obstacle types, chips, the best-distance gate, the ghost, every skin shape (including glitch and rainbow), all six
  trails, particles, shards, ripples, the sky, sun, mountains and floor grid, plus bloom. Text pops and the binary
  trail's digits go through `drawOverlay`, a 2D overlay composited before bloom.
- [x] A side-by-side check of all 22 sectors on the same daily course against the 2D renderer.
- [x] 3D is the default. `?r=2d`, a failed WebGL setup or a lost context fall back to the 2D renderer.
- [x] A frame-time probe on the Mac (Metal), at 390×844 and DPR 3, with the CPU throttled 4× to stand in for a
  phone: p50 and p95 at 16.7 ms, max 16.8 ms, no frame over 33 ms.
- [ ] The weekly real-device check: 60 fps on an iPhone 12 or newer (Brian).
- [ ] Delete the 2D scene path one release after the switch. The skin thumbnails stay 2D until phase 3 renders the
  character.
- [ ] The style guide (`docs/hyperline/style-guide.md`) and its colour rules. They land with phase 3's art pass.

## Phase 3: art from Quaternius

Started 2026-11-25. The pipeline (`npm run model`, `lib/rig.js`) and the runner lab (`games/hyperline/lab.html`,
dev only) are done, with the Quaternius robot running, jumping, crashing and recolouring in each skin.

Packs to pull (the free Standard portion of each, CC0, glTF). These are downloaded from itch.io by hand, because its
pay-what-you-want page is built for a person and not a script:
- **Universal Base Characters**, for a humanoid runner, if the robot loses.
- **Universal Animation Library**, the "root motion disabled" export, for sprint, jump, fall, land and death clips
  that share UBC's rig.
- **Cyberpunk Game Kit** and **Ultimate Space Kit**, as candidates for obstacles and props.
- **Downtown City MegaKit**, for skyline buildings.

Steps:
- Pick the runner: the robot or a UBC humanoid. Compare them in the lab at phone size, on silhouette, readability at
  speed, and how well each wears a skin colour.
- The existing skins become material sets and effects (rainbow and glitch shaders). The locker and shop thumbnails
  render the character.
- Hit-stop and the crash use the death clip and then the existing shard break-apart.
- The physics owns the jump, and the animation only follows it (Brian, 2026-11-25: the full Jump clip read as a
  "two twitch" jump). Start the clip at its take-off frame, ease into the airborne pose over the rise, hold that pose
  until touchdown, then blend straight back into the run. Skip the clip's own crouch and landing, and let the game's
  squash play the landing. The lab does this (`JUMP = { from: 0.21, hold: 0.33 }` for the robot).
- The model is mirrored so its left side faces the camera, and gestures (wave, the flex card) turn the character
  toward the camera.
- An obstacle kit of about 15 pieces (spike, block, blade, pillar, gate, pad, rail, ledge, slab and so on), from the
  kits where a piece fits and built in code where none does. Every piece has to pass the black-silhouette check.
- Environments: a shader sun, layered mountains, an instanced skyline from the City MegaKit with parallax and lit
  windows, and neon signs drawn as canvas textures. Each theme gets its own colour grade and skyline.
- Speed streaks at the track edges at top speed.
- A triangle budget: the runner at 15k or fewer, and the whole scene at 150k or fewer.

**Done when:** three phone screenshots, set beside three reference-game screenshots, get 4 out of 5 or better from at
least 3 of 5 testers (the visual row of the bar).

## Phase 4: audio

- About 25 effects from CC0 packs, layered with designed synthesis where a pack falls short (jump, land, chip, near
  miss, crash, UI taps, sector banner, wind).
- A mix bus: a limiter on the effects, music ducking on crash, and a wind whoosh that rises with speed. Check it on
  iPhone speakers, where the bass mostly disappears.
- A music sequencer with one track per theme at a fixed BPM. Sector banners land on a downbeat. The current synth
  loop stays as the fallback.
- Keep the existing iPhone silent-switch handling.

**Done when:** a listening review on phone speakers and earbuds finds no oscillator beeps and no effects buried
under the music.

## Phase 5: beat-sync experiment

- Course generator v2 places patterns on the beat grid in time (`t = beats × 60 / BPM`), converting with the speed
  curve. That's needed because speed rises during a run.
- Add a course `version` field. Daily seeds, ghosts and best distances carry the version they were made with, so old
  data never replays on a new course.
- Build 2 new sectors on the beat and compare them against free-timed sectors on first-try clear rate and session
  length.

**Done when:** there's data from both sides, and Brian decides whether to roll beat sync out to every sector.

## Phase 6: first session and playtests

- Tune for a first run of at least 20 s and running within 5 s of opening.
- Run playtest rounds of 5 people aged 16–30. Brian recruits them; we provide a script and a recording setup. Two
  rounds come before the web-test gate.

**Done when:** the first-session row of the bar passes with real testers.

## Phase 7: native wrap

- Wrap the game in Capacitor with the Haptics plugin: light on jump, medium on landing, heavy on crash. It's a
  no-op on the web.
- TestFlight through the gateway (`account.create` and `store.submit` are approval-gated).

**Done when:** the feel checklist passes 100% on a real device, haptics included.

## Out of scope until the bar passes

New sectors (unless they're part of the phase 5 experiment), new monetization, and work on the other four games.
