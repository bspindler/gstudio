# Hal plan 2a: browser robot and Gearhold gunplay scores — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A robot that plays the real Gearhold page in a headless browser (moving, aiming, shooting, getting hurt), scores the gunplay, and takes phone-size screenshots of all three games, so the nightly loop can judge and show what players actually experience.

**Architecture:**
- **Game hook.** Gearhold's combat lives in `games/gearhold/index.html` and is tied to the page. Rather than rewrite it, the page gets a small test hook, active only when the URL has `?hal`. The hook exposes a state snapshot and a `step(dt, input)` that runs the game's own `update(dt)` with injected controls, so the robot drives time instead of `requestAnimationFrame`.
- **Determinism.** It comes from seeding `Math.random` before the page loads, with Playwright's `addInitScript` and `mulberry32`. There is no game-logic change for that.
- **Bot policy.** A pure TypeScript function in `packages/core/src/hal/`, tested without a browser: given a state snapshot and the level map, it returns the next input.
- **Browser runner.** A thin Playwright runner in `scripts/hal/` connects page and policy.
- **Scores.** The result is a `ScoreReport` registered as a second Gearhold scorer, `gearhold-play`, so the gate, ledger and CLI work unchanged.

**Tech Stack:** TypeScript strict, ESM, Node 22, vitest, tsx; **Playwright (new dev dependency, Apache-2.0, studio tooling only, never loaded by a game; approved in the spec's "Calls I made" #6)** with its bundled Chromium.

**Spec:** `docs/superpowers/specs/2026-11-11-hal-nightly-polish-design.md` ("1. Robot player and scores": Gearhold and "All games: a headless browser…"). Builds on plans 1 and 1b on this branch.

## Global Constraints

- The only new dependency is `playwright` in the root `devDependencies`. Nothing in `games/` imports it or loads anything new. The hook adds no network calls, no new hosts and no SDK changes, and the compliance tests must pass unchanged.
- The hook is inert without `?hal`. With `?hal`, nothing is sent to the studio ingest (the SDK stays in no-ingest mode, or `track` is a no-op).
- No `Date.now()`/`Math.random()` in `packages/core/src/hal/`. Policy randomness (reaction delay, aim error) comes from a seeded `mulberry32`.
- The robot plays local builds only (hard rule 2): `http://localhost` from `npm run dev`, or the static `games/` folder served by the runner. Never Pages or any real channel.
- Gameplay is pass/fail where it's a hard failure (page errors, a level that can't be started, NaN state) and a score otherwise.
- Default `gearhold-play` run (3 levels × 10 seeds) finishes in about 5 minutes or less. The nightly budget allows this; Tidepool and Hyperline take seconds.

## Review Focus

1. **The hook changes how the game plays for real players.** Without `?hal` the page must behave exactly as before. Pinned by a Playwright test that loads without `?hal` and checks `window.__hal` is undefined and the rAF loop runs.
2. **Non-determinism leaking in** (timing from rAF, `Date`, unseeded randomness). Two runs with the same seed must produce identical results. Pinned in Task 3.
3. **A robot that's too good or too bad to tell anything.** It is either aimbot-perfect or never hits. Reaction delay and aim error are pinned, and the measured win rate on level 1 must land between 0.4 and 0.95. Pinned in Task 2/3.
4. **Headless WebGL unavailable.** The runner must report "browser unavailable" as a clear error (exit 1), never a score of 0 that the gate compares.
5. **A stuck robot** (walking into a wall forever, or a level that never ends): each run has a sim-time cap (240 s) and reports `timeout` as a loss with its cause.

---

## File structure

```
games/gearhold/index.html               ?hal hook: window.__hal = { state(), step(dt, input), start(level) } (Task 1)
packages/core/src/hal/gearhold-bot.ts   pure policy: decide(state, map, memory, rng) → input               (Task 2)
packages/core/src/hal/gearhold-play-score.ts  measures from many PlayRecords → ScoreReport               (Task 2)
scripts/hal/browser.ts                  Playwright launch, static server for games/, seeded init script  (Task 3)
scripts/hal/gearhold-play.ts            runs the policy against the page, returns PlayRecords             (Task 3)
scripts/hal/screens.ts                  phone-size screenshots + console errors for all three games      (Task 4)
packages/core/src/hal/scorers.ts        + 'gearhold-play' (async score)                                   (Task 5)
scripts/hal.ts                          awaits async scorers; `screens` command                           (Task 5)
```

### Task 1: The `?hal` hook in Gearhold

Expose, only when `new URLSearchParams(location.search).has('hal')`:
```ts
window.__hal = {
  start(level: number): void,                // like startLevel(level), skips title/overlay/pointer lock
  state(): GearholdState,                    // plain JSON snapshot
  step(dt: number, input: GearholdInput): GearholdState, // one update(dt) with these controls; no render
  render(): void,                            // draw one frame (for screenshots)
};
type GearholdInput = { fwd: -1|0|1; str: -1|0|1; turn: number /* radians this step */; pitch: number; fire: boolean; weapon?: 0|1 };
type GearholdState = {
  mode: string; level: number; time: number;
  p: { x: number; y: number; a: number; look: number; hp: number; shells: number; key: boolean; weapon: number };
  enemies: { kind: string; x: number; y: number; hp: number; awake: boolean; dead: boolean; prop: boolean }[];
  items: { kind: string; x: number; y: number }[];
  kills: number; foes: number; shotsFired: number; hits: number; damageTaken: number; damageUnseen: number;
  result: '' | 'win' | 'dead';
};
```
In hal mode the rAF loop stops calling `update` (it may still render if asked). `turn` and `pitch` are applied directly to `P.a`/`P.look`, like mouse input. Add `shotsFired`/`hits`/`damageTaken`/`damageUnseen` counters (`damageUnseen` is damage from an enemy without line of sight to the player at the time it attacked, or from a shot whose shooter wasn't visible when fired). Tests: Playwright tests in `packages/core/test/` are not possible without a browser; put browser tests in `scripts/hal/*.test.ts` run by a new vitest project `scripts/hal` only when `HAL_BROWSER=1` (CI stays browser-free). The compliance tests must pass unchanged.

### Task 2: The policy and the gunplay scores (pure, no browser)

- `decide(state, map, mem, rng): GearholdInput`, deciding at 15 Hz (the runner steps 4 × 1/60 s per decision):
  - If an awake or visible enemy is in line of sight (grid raycast on the map, doors as open once opened), turn toward the nearest. A seeded reaction delay applies, `REACT = 0.25 s` before first shot at a newly seen enemy, plus aim error `AIM_ERR = 0.04 rad` Gaussian.
  - Fire when the aim error to the target's centre is under the target's angular radius. Switch to the scatter cannon under 4 tiles if owned.
  - Otherwise follow the Gearhold map route from `gearhold-walk.ts` (key first if needed). Detour for `h` when hp < 50, and for `a` when the scatter cannon is out of shells.
  - Unstick: if position hasn't changed 0.3 tiles in 2 s, strafe randomly for 0.5 s.
- `PlayRecord = { level, seed, result: 'win'|'dead'|'timeout', time, hpLeft, kills, foes, shotsFired, hits, damageTaken, damageUnseen, cause }`.
- `scoreGearholdPlay(records): ScoreReport<LevelPlayStats>`, with measures (0–100):
  - `winnable` (two-sided, so "easier" never scores higher): share of levels whose win rate is in [0.8, 1.0] on level 1 and in [0.5, 0.9] on later levels.
  - `fairDamage`: 100 × (1 − total damageUnseen / max(1, damageTaken)).
  - `pace`: share of levels whose median win time is between 30 s and 180 s.
  - `feel` (two-sided, so bigger hitboxes don't score higher): 100 when the median hit ratio (hits / shotsFired) is in [0.35, 0.8], falling linearly to 0 at 0 and at 1. This catches hit registration breaking.
  - `hardFailures` are page errors, a level that won't start, and any NaN in state.
- Unit tests use hand-built states: it turns toward a visible enemy and not one behind a wall, waits `REACT` before firing, fires only when aligned, follows the route to the key first, detours for health under 50, and unsticks.

### Task 3: The browser runner

- `scripts/hal/browser.ts` launches Chromium headless with WebGL. It tries the default GPU, then `--use-angle=swiftshader`, and if that fails exits 1 with `browser unavailable: <reason>`.
- It serves `games/` from a local static server on an ephemeral port bound to 127.0.0.1.
- It injects `Math.random = mulberry32(seed)` via `addInitScript`.
- `runGearholdPlay({ levels, seeds })` gives one fresh page per (level, seed): `__hal.start(level)`, then loop `decide` → `step(1/60, input)` × 4 until `result` is set or 240 s of sim time passes.
- Determinism test (`HAL_BROWSER=1`): the same level and seed twice gives identical PlayRecords.
- Calibration: report level 1's win rate over 10 seeds. If it's outside 0.4–0.95, adjust `REACT`/`AIM_ERR`, never the bands, and report the table.

### Task 4: Screens for all three games

`npm run hal -- screens` loads each game at 390×844 (phone), presses through to gameplay where it can (Gearhold via `__hal.start(0)`; Tidepool and Hyperline by their start buttons), and writes PNGs to `.data/hal/screens/<game>/<n>.png`. It also writes a JSON of console errors per game. Any console error or page crash is listed. These feed plan 2b's "noticing" step and plan 3's before/after pictures.

### Task 5: Register and verify

- `SCORERS['gearhold-play']` with defaults `{ levels: 3, seeds: 10 }`; `Scorer.score` may return a Promise, and the CLI awaits it.
- By hand: `npm run hal -- baseline --game gearhold-play` then `check --game gearhold-play --change no-op` gives DISCARD exit 2, and the same seed twice gives the same fitness.
- Report each level's win rate, median time, hit ratio and unseen-damage share. That's the first real read on Gearhold's gunplay.

## Lessons carried over from plan 1b's review

- Every measure must be two-sided: making the game easier, emptier or more generous must never raise the score.
- Measure the noise before trusting it. Report the fitness spread over three disjoint seed blocks; if it exceeds the gate's 0.5 minimum gain, raise `seeds`.
- Plan 2b protects Hal's own scoring code from the loop's edits: `packages/core/src/hal/**`, `packages/core/test/hal-*.test.ts`, `scripts/hal*`, the `?hal` hook block in `games/gearhold/index.html`, and `.data/hal/baseline/*`.

## What plan 2b adds next

The autonomous loop: Claude (headless `claude -p`) reads scores, screens and votes, writes tickets, builds each change in its own worktree, passes tripwires and gates, then squash-merges and pushes. It also brings `.hal.env`, the $20/day budget, one-run-at-a-time locking, nightly launchd and "Run now".
