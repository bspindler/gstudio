# Block Barn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A toddler A-to-Z animal-blocks game (`games/block-barn/`) that collects nothing, plus the studio and Hal changes that let it live in the nightly loop safely.

**Architecture:** Plain HTML5 game, no build step: pure logic modules (animals, rotation, tower, voice choice) tested in vitest, a DOM shell in `index.html` with a `?hal` hook, and a separate `recorder.js` for parents' recordings (MediaRecorder + IndexedDB). The studio compliance check learns `childDirected: true` (stricter rules). Hal gets tripwire locks for the recorder, audio and privacy files, a browser-driven `block-barn` scorer, a screens flow and planner guidance.

**Tech Stack:** HTML/CSS/ES modules, Web Audio-free playback (`new Audio`, `speechSynthesis`), MediaRecorder, IndexedDB; TypeScript + vitest + Playwright for Hal.

**Spec:** `docs/superpowers/specs/2026-11-13-block-barn-design.md`

## Global Constraints

- Slug `block-barn`; folder `games/block-barn/`; title "Block Barn"; version starts `0.1.0`.
- `game.yaml`: `childDirected: true`, `targetSegment: "toddlers 2+, plays alone, with a grown-up nearby"`, `ageRating: null`.
- No network in game code: no `fetch(`, `sendBeacon`, `XMLHttpRequest`, `WebSocket`, `EventSource`, no remote `<script src>`.
- SDK: `createStudio({ game: 'block-barn', version, endpoint: '' })`. Never `resolveEndpoint(`, `track(`, `purchase.offer(`, `feedback.maybePrompt(`.
- Never use the words `buy`, `shop`, `store`, `checkout` or `priceUsd` as whole words in game code (the purchase-like compliance check). Name IndexedDB helpers `keep`/`vault`, not `store`.
- The `[hidden]{display:none !important}` CSS rule if the `hidden` attribute is used.
- No score, timer, lives, rewards, streaks, notifications, links out, or text the child must read. No flashing (nothing toggles brightness faster than 3 times a second).
- Tap targets at least 88 CSS px on a 390x844 phone. Every tap answers (visible change) within 100 ms.
- Assets: CC0 (source URL in `SOURCES.md` beside them) or Brian's recordings tagged `studio-owned`; audio `.m4a` named `audio/letter-<x>.m4a`, `audio/name-<x>.m4a`, `audio/noise-<x>.m4a` (x = a..z).
- The 26 animals, exactly: A ant, B bear, C cow, D duck, E elephant, F frog, G goat, H horse, I iguana, J jellyfish, K kangaroo, L lion, M monkey, N newt, O owl, P pig, Q quail, R rabbit, S sheep, T turtle, U urchin, V vulture, W whale, X fox (x highlighted), Y yak, Z zebra.
- Floor shows 5 blocks; the tower tumbles on a tap or at 6 blocks; the invitation comes after 8 s idle, once per idle spell; the grown-up corner opens on a 3 s press-and-hold.
- Hal may not change `games/block-barn/recorder.js`, `games/block-barn/privacy.js`, `games/block-barn/audio/**`, any `SOURCES.md` under the game, and may not add any non-code asset to the game.
- Only the operator pushes to `main`; merges are gated on `npm run ci:local -- <sha>`.

## Review Focus

1. A toddler hammering taps (10 a second, several fingers): the newest voice line replaces the one playing; nothing queues up or overlaps into noise. Test in Task 4.
2. iPhone `speechSynthesis` speaks nothing until a first user gesture and may have no voices loaded yet: the first tap still says the word (speak inside the tap handler; retry once on `voiceschanged`). Test in Task 4 (unit, with a fake synth).
3. No microphone permission, or IndexedDB unavailable (private mode, evicted data): the game still plays with defaults and the grown-up corner says why recording is off. Test in Task 6.
4. Tab hidden or phone locked mid-sound: audio stops, and on return the barn is exactly as she left it with nothing stuck "speaking". Test in Task 4.
5. Landscape or a tablet-sized screen: blocks stay at least 88 px and on screen, nothing overlaps the grown-up corner. Test in Task 7 (scorer `bigTargets` at 390x844 and 1024x768).

---

### Task 1: Studio rules for child-directed games

**Files:**
- Modify: `packages/core/src/library/load.ts` (schema)
- Modify: `packages/core/src/library/compliance.ts`
- Modify: `packages/core/test/games-compliance.test.ts`, `packages/core/test/compliance.test.ts`
- Modify: `scripts/templates/game/game.yaml` only if the schema needs a default (it should not)

**Interfaces:**
- Produces: `GameMeta.childDirected?: boolean`; `complianceViolations(html: string, o?: { childDirected?: boolean }): string[]`.

- [ ] **Step 1: Failing tests** in `compliance.test.ts`:
  - `complianceViolations(kidHtml, { childDirected: true })` is `[]` for a page that imports createStudio, calls `createStudio({ ..., endpoint: '' })`, and has no `track(`/`maybePrompt(`.
  - With `{ childDirected: true }`, each of these yields one violation: `resolveEndpoint(` present; `track(` present; `purchase.offer(` present; `feedback.maybePrompt(` present; `endpoint: ''` absent; `fetch(` present.
  - Without the option, today's behaviour is unchanged (existing tests stay green).
  - `loadGameLibrary` accepts `childDirected: true` and rejects `childDirected: "yes"`.
- [ ] **Step 2:** Run `npx vitest run packages/core/test/compliance.test.ts`; expect the new tests to FAIL.
- [ ] **Step 3: Implement.** Schema gets `childDirected: z.boolean().optional()`. In `complianceViolations`, when `childDirected`: skip the `resolveEndpoint`, `level_start`, `level_end` and `maybePrompt` requirements; require `/endpoint\s*:\s*(['"])\1/`; forbid `resolveEndpoint(`, `track(`, `purchase.offer(`, `feedback.maybePrompt(` with plain-English messages naming the child-directed rule. All other rules still apply.
- [ ] **Step 4:** `games-compliance.test.ts` reads each game's `game.yaml` (yaml `parse`) and passes `{ childDirected: meta.childDirected === true }`.
- [ ] **Step 5:** Run both test files; PASS. Commit `feat(core): child-directed games: stricter compliance (no events, prompts or purchases)`.

### Task 2: Hal guards for Block Barn

**Files:**
- Modify: `packages/core/src/hal/tripwires.ts`, `packages/core/src/hal/tickets.ts`
- Test: `packages/core/test/hal-tripwires.test.ts`, `packages/core/test/hal-tickets.test.ts`

**Interfaces:**
- Produces: protected paths `games/block-barn/recorder.js`, `games/block-barn/privacy.js`, `games/block-barn/audio/` (prefix), `games/block-barn/**/SOURCES.md`; rule `kid-asset`; hook files list `HOOK_FILES = ['games/gearhold/index.html', 'games/block-barn/index.html']`.

- [ ] **Step 1: Failing tests:**
  - `isProtectedPath` is true for `games/block-barn/recorder.js`, `games/block-barn/privacy.js`, `games/block-barn/audio/name-c.m4a`, `games/block-barn/art/SOURCES.md`; false for `games/block-barn/index.html`, `games/block-barn/animals.js`.
  - A diff adding `games/block-barn/art/x.png` (with a CC0 SOURCES.md line) hits `kid-asset`; adding `games/block-barn/draw.js` does not.
  - `assetSource` accepts an `.m4a` listed with `studio-owned` outside block-barn's protected paths in a fixture (tag recognised), and still rejects an unlisted `.m4a`.
  - The hal-hook rule applies to `games/block-barn/index.html`: changing the block between `// ---- hal hook` markers hits `hal-hook`; adding a `__hal` line in `games/block-barn/animals.js` hits it.
  - `validateTickets` rejects a ticket whose why mentions `block-barn/recorder.js` or `block-barn/audio` (protected by description).
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3: Implement.** Add `m4a` to `ASSET_EXT`; add `studio-owned` to `LICENSE_RE` and the message; add `kid-asset` rule (any added/renamed asset-extension or binary file under `games/block-barn/`) and register it in `TRIPWIRE_RULES`; extend protected paths; generalise the hook to `HOOK_FILES` (per-game prefix check `games/<game>/`); extend `tickets.ts` PROTECTED.
- [ ] **Step 4:** Run the two test files and `npx vitest run packages/core/test/hal-*.test.ts`; PASS. Commit `feat(hal): lock Block Barn's recorder, audio and privacy; no new kid assets; m4a + studio-owned`.

### Task 3: Animals, rotation and tower (pure logic)

**Files:**
- Create: `games/block-barn/animals.js` (+ `animals.d.ts`), `games/block-barn/rotation.js` (+ `.d.ts`), `games/block-barn/tower.js` (+ `.d.ts`)
- Test: `packages/core/test/block-barn-logic.test.ts`

**Interfaces:**
- Produces:
  - `ANIMALS: ReadonlyArray<{ letter: string; name: string; spell?: string; sound: 'call' | 'move'; move: string }>` (26, a..z order; X has `name: 'fox'`, `spell: 'fo[x]'`).
  - `createRotation(seed: number, floor = 5): { floor(): string[]; next(taken: string): string[]; seen(): Set<string> }`: letters on the floor; `next` replaces a tapped-and-stacked letter with the next unseen one.
  - `createTower(max = 6): { blocks(): string[]; add(letter): 'added' | 'tumble'; tumble(): string[] }`.
  - `FLOOR = 5`, `TOWER_MAX = 6`.

- [ ] **Step 1: Failing tests:** exactly the 26 letters/names of Global Constraints; every animal with `sound: 'move'` has a non-empty `move`; `createRotation(s)` for 5 seeds shows all 26 letters within 26 `next` calls and never shows a duplicate on the floor; same seed gives the same order; `createTower()` returns `'tumble'` on the 6th add and empties; `tumble()` returns the blocks it held.
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement (mulberry32 seeded shuffle inline; no dependencies). **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(block-barn): animals, letter rotation and tower logic`.

### Task 4: Voice choice and playback

**Files:**
- Create: `games/block-barn/voice.js` (+ `.d.ts`)
- Test: `packages/core/test/block-barn-voice.test.ts`

**Interfaces:**
- Consumes: `ANIMALS`.
- Produces: `createVoice(o: { audio: (url) => { play(): Promise<void>; pause(): void }; synth: SpeechLike | null; recordings: (key) => Promise<string | null>; base: string }): { say(key: 'letter-c' | 'name-c' | 'noise-c' | ..., text: string): Promise<void>; stop(): void }`. Order: parent recording (object URL) > bundled clip (`audio/<key>.m4a`, known from a `CLIPS` set exported by `audio/clips.js`) > `synth.speak(text)` > silent.
- Produces: `audio/clips.js` exporting `CLIPS: ReadonlySet<string>` (empty at first; protected by Task 2 as part of `audio/`).

- [ ] **Step 1: Failing tests** (fakes for audio and synth): recording wins over clip, clip over synth; a `say` while another is playing stops the first (Review Focus 1); `stop()` cancels synth and pauses audio (Review Focus 4); a synth with no voices still gets `speak` called inside `say`, and one retry after `voiceschanged` if speaking fails (Review Focus 2); a missing synth and no clip resolves silently.
- [ ] **Steps 2-4:** FAIL, implement, PASS. **Step 5:** Commit `feat(block-barn): voice: recording, clip, then device speech`.

### Task 5: The barn (game shell, art, hook)

**Files:**
- Create: `games/block-barn/index.html`, `games/block-barn/draw.js` (code-drawn SVG animals, blocks, barn), `games/block-barn/privacy.js`, `games/block-barn/game.yaml`, `games/block-barn/CHANGELOG.md`, `games/block-barn/art/` (Kenney PNGs) + `games/block-barn/art/SOURCES.md`, `games/block-barn/audio/SOURCES.md`
- Test: `scripts/hal/block-barn-page.test.ts` (Playwright, served by `serveGames` from `scripts/hal/browser.ts`, like `screens.test.ts`)

**Interfaces:**
- Consumes: Tasks 3-4.
- Produces: `privacy.js` exporting `studioFor(version)` that calls `createStudio({ game: 'block-barn', version, endpoint: '' })`; hook `window.__hal` (only with `?hal`) between `// ---- hal hook` / `// ---- end hal hook ----` markers: `state(): { floor: string[]; named: string[]; tower: string[]; corner: boolean; speaking: string | null; invited: string | null }`, `targets(): Array<{ kind: 'block' | 'animal' | 'tower' | 'floor' | 'corner'; letter?: string; x: number; y: number; w: number; h: number }>`, `idle(ms)` (advance the idle clock), `seed(n)`.

- [ ] **Step 1: Art.** Download Kenney's Animal Pack Redux (https://kenney.nl/assets/animal-pack-redux, CC0) into a fresh scratch dir; copy only the PNGs for animals on the list into `art/`, each on a `SOURCES.md` line: file, Kenney URL, `CC0`. The rest are drawn in `draw.js` in the same flat style. Never run anything from the download.
- [ ] **Step 2: Failing page tests** (390x844 touch): page loads with no console errors and no network request outside its origin; 5 floor blocks, each target at least 88 px; tapping block C makes `named` include `c` and `speaking` become `name-c` or `letter-c` within 100 ms; tapping a named block adds it to `tower`; the 6th tumbles; a tap on empty floor changes something visible; 8 s idle sets `invited` to a floor animal once, and it is cleared by any tap; a 3 s hold on the corner opens it, a short tap does not; hidden tab stops speaking (Review Focus 4).
- [ ] **Step 3: Implement the shell:** DOM blocks as big buttons (CSS transforms for flip/wobble/tumble), nearest-target routing for any tap (pointerup, one per gesture, extra fingers ignored), letters shown as "C c", X spelled with the x highlighted, the invitation, small surprises (pair reactions), the grown-up corner (sound on/off, pin letters, Guided Access note, Home Screen note; recording UI arrives in Task 6), and the hook.
- [ ] **Step 4:** `game.yaml` per Global Constraints; `CHANGELOG.md` "## 0.1.0 (date)" entry; createStudio version kept in sync (the versions test). Run the page tests, `games-compliance.test.ts` and the game-versions test; PASS.
- [ ] **Step 5:** Commit `feat(block-barn): the barn: blocks, animals, tower, invitations, grown-up corner`.

### Task 6: Parents' recordings

**Files:**
- Create: `games/block-barn/recorder.js`
- Modify: `games/block-barn/index.html` (grown-up corner recording list)
- Test: `scripts/hal/block-barn-recorder.test.ts` (Playwright Chromium with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`, on 127.0.0.1)

**Interfaces:**
- Produces: `createRecorder(): { available(): { ok: boolean; why?: 'insecure' | 'no-mic' | 'no-storage' }; start(key): Promise<void>; finish(): Promise<Blob>; keep(key, blob): Promise<void>; get(key): Promise<string | null>; reset(key): Promise<void> }` (IndexedDB database `block-barn-voices`, object store `voices`); `voice.js`'s `recordings` uses `get`.

- [ ] **Step 1: Failing tests:** on 127.0.0.1 with a fake mic, record `name-c`, keep it, reload, and tapping C plays the recording (an object URL, not a clip or synth); "back to default" removes it; with mic permission denied, `available()` is `{ ok: false, why: 'no-mic' }` and the corner says recording is off while play still works (Review Focus 3); with IndexedDB throwing, `why: 'no-storage'`; on a non-secure origin (simulate `isSecureContext === false` with an init script), `why: 'insecure'` and the corner says recording needs the secure (HTTPS) version.
- [ ] **Steps 2-4:** FAIL, implement, PASS. **Step 5:** Commit `feat(block-barn): parents record their own voice, kept on the device`.

### Task 7: Hal's scorer, screens and controls for Block Barn

**Files:**
- Create: `packages/core/src/hal/block-barn-score.ts` (pure measures), `scripts/hal/block-barn-play.ts` (runner)
- Modify: `packages/core/src/hal/index.ts`, `packages/core/src/hal/scorers.ts` (export `blockBarnScorer(run)`), `scripts/hal.ts`, `scripts/hal/check-entry.ts` (register `block-barn`), `scripts/hal/screens.ts` (a `block-barn` flow), `scripts/hal/controls.ts` (touch check), `scripts/hal/git.ts` only if a level-count entry is wanted (not wanted: the alphabet is fixed)
- Test: `packages/core/test/hal-block-barn-score.test.ts`, `scripts/hal/block-barn-play.test.ts`

**Interfaces:**
- Produces: `scoreBlockBarn(records: BlockBarnRecord[]): ScoreReport` with measures `responsive`, `noDeadEnds`, `bigTargets`, `alphabet`, `calm`, each 0-100, fitness their mean; `BlockBarnRecord = { kind; ms; changed: boolean; w; h; viewport: '390x844' | '1024x768' }` plus page-level facts `{ letters: string[]; voiced: string[]; flashes: number }`.
- Measure rules: `responsive` = share of taps changed within 100 ms; `noDeadEnds` = share of taps (all kinds, all states visited, including after tumble and with the corner closed) that changed something, 0 if the page navigated away; `bigTargets` = share of targets at least 88x88 at both viewports (Review Focus 5); `alphabet` = share of the 26 letters reached within 26 rotations that have an image and a voice source; `calm` = 100 unless brightness toggles faster than 3/s were seen or a sound starts louder than the cap.
- `scorersFor('block-barn')` stays `['block-barn']`; the game shows up in `--game`, Run now, tell, screens and the report via the scorer registry.

- [ ] **Step 1: Failing tests:** pure scorer on fixed records gives the expected measures (all-good = 100s; one slow tap among 20 = responsive 95; a 60 px target = bigTargets below 100; a missing voice = alphabet below 100); the runner on the real page returns records for every target kind at both viewports with no errors; `npm run hal -- score --game block-barn` prints a report.
- [ ] **Steps 2-4:** FAIL, implement, PASS. Screens flow: load, shoot the barn, tap two blocks, shoot, build and tumble a tower, shoot, open the corner, shoot.
- [ ] **Step 5:** Commit `feat(hal): Block Barn scorer, screens and touch check`.

### Task 8: Planner guidance, docs and the recording guide

**Files:**
- Modify: `scripts/hal/prompts/planner.md` (and `implementer.md` if game rules live there)
- Create: `docs/block-barn-recording.md` (Brian's checklist: the 78 file names, how to record in Voice Memos, trim, export `.m4a`, drop into `games/block-barn/audio/`, add a `studio-owned` line to `audio/SOURCES.md` and the key to `audio/clips.js`)
- Modify: `docs/STATUS.md`, `docs/hal/IMPROVEMENTS.md` (note the game)
- Test: `scripts/hal/prompts.unit.test.ts`

- [ ] **Step 1: Failing test:** the planner prompt contains a Block Barn section naming the anti-goals (no score, timers, rewards, nudges, purchases, prompts, events, links out, reading, flashing) and the locked files.
- [ ] **Step 2:** FAIL. **Step 3:** Write the section: Block Barn is child-directed (2+); new letters/animals are not a thing; good tickets are animations, reactions, surprises, softer sounds, bigger or clearer targets; the scorer measures are what matter. **Step 4:** PASS.
- [ ] **Step 5:** Full `npm run ci:local -- <sha>` on the branch tip; PASS. Commit `docs(block-barn): planner guidance and Brian's recording guide`.

### Task 9: The shelf card and the Pages build

**Files:**
- Modify: `scripts/site/index.html` (a `block-barn` entry in `COVERS`: an animated canvas cover in the game's look — warm barn red, hay floor, a couple of chunky letter blocks and an animal, gentle motion, no flashing)
- Modify: `scripts/build-pages.ts` (pass `{ childDirected: g.childDirected === true }` to `complianceViolations`)
- Test: the existing site/no-external-fonts and Pages tests; add a test that `npm run build:pages` (or its core function) accepts a child-directed game and still rejects an ordinary game without level events

- [ ] **Step 1:** Failing test: building Pages with Block Barn present fails today (the plain compliance check demands level events). **Step 2:** FAIL. **Step 3:** Implement both changes. **Step 4:** PASS; screenshot the shelf at 390x844 and 1280x800 and look at the card.
- [ ] **Step 5:** Commit `feat(site): Block Barn on the shelf; Pages build honours childDirected`.
