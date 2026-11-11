# Hal plan 1: Tidepool robot player, scores and keep/discard gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic robot that plays every Tidepool level, turns the results into scores, and decides "keep" or "discard" for a change by comparing scores before and after, with every attempt written to a ledger. Usable by hand today (`npm run hal -- check`), automated in plan 2.

**Architecture:** Pure logic in `packages/core/src/hal/` (bot, scores, gate, ledger), exported from a new `@studio/core/hal` subpath so the API service never loads game code. A thin CLI in `scripts/hal.ts` does the file I/O under `.data/hal/`. The bot reuses Tidepool's own `board.js`/`levels.js` engine and mirrors the turn order in `games/tidepool-pals/index.html` (`onTileTap` → `settle` → `afterMove` → `check`).

**Tech Stack:** TypeScript strict, ESM, Node 22, vitest, tsx. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-11-hal-nightly-polish-design.md` (this plan is build-order step 1; plans 2 and 3 cover the loop and the report).

## Global Constraints

- No new dependencies of any kind (spec anti-goal 1). This plan adds none.
- Hard rules are pass/fail, never part of a score. Level validity (`validateLevel`) is a hard check in the gate, not a fitness term.
- Hal never edits `policy.yaml`, `markets.yaml`, `infra/`, the gateway or policy code, the compliance checks, or its own tripwires and scores. (Plan 2 enforces this; this plan's code must not need any of them changed.)
- Inject time and IDs: no `Date.now()`, `Math.random()` or wall-clock in `packages/core/src/hal/`. All randomness from `mulberry32(hashSeed(...))`.
- Hal state lives in `.data/hal/` (already gitignored).
- Synthetic players (`simulatePlayers`) are never a fitness input.
- TDD: failing test first, per repo `CLAUDE.md`.

## Review Focus

1. **A level the bot can't finish or that loops forever** (no moves after shuffle, a board that reshuffles endlessly): every play must terminate and count as a loss. Pinned in Task 1 (`terminates on a board that always needs shuffling`).
2. **The bot drifting from the real game's turn order** (tides, rescue, gravity direction): the bot must apply tide turns and rescues exactly as `index.html` does. Pinned in Task 1 (`applies the tide on level 3` and `counts rescues on level 5`).
3. **Missing or corrupt baseline/ledger files**: a missing baseline means "nothing to compare, can't keep", never a crash or an automatic keep; a corrupt ledger is reported, not silently overwritten. Pinned in Task 4.
4. **Score runs too slow to use nightly**: the default `check` (levels 1–30, 20 seeds) must finish in about a minute on a laptop. Pinned in Task 2 (timing test on a reduced run) and checked by hand in Task 4.
5. **Comparing scores from different level sets** (a change adds levels 21–25): measures are fractions, so they compare; the gate must not crash on per-level arrays of different lengths. Pinned in Task 3.

---

## File structure

```
packages/core/package.json            + "./hal": "./src/hal/index.ts" export
packages/core/src/hal/index.ts        re-exports the four modules below
packages/core/src/hal/tidepool-bot.ts  playLevel(): one seeded, unassisted play of one level
packages/core/src/hal/tidepool-score.ts scoreTidepool(): many plays → per-level stats + measures
packages/core/src/hal/gate.ts          compareScores(): keep/discard with reasons
packages/core/src/hal/ledger.ts        pure ledger ops + markdown table
packages/core/test/hal-tidepool-bot.test.ts
packages/core/test/hal-tidepool-score.test.ts
packages/core/test/hal-gate.test.ts
packages/core/test/hal-ledger.test.ts
scripts/hal.ts                         CLI: score | baseline | check | status
package.json                           + "hal": "tsx scripts/hal.ts"
```

---

### Task 1: The robot plays one Tidepool level

**Files:**
- Create: `packages/core/src/hal/tidepool-bot.ts`, `packages/core/src/hal/index.ts`
- Modify: `packages/core/package.json` (add `"./hal": "./src/hal/index.ts"` to `exports`)
- Test: `packages/core/test/hal-tidepool-bot.test.ts`

**Interfaces:**
- Consumes: `games/tidepool-pals/board.js` (`buildBoard, maskOf, rockOf, activeMask, resolveTap, collapse, rescueLost, tideTurns, tidePhase, turnTide, hasMoves, shuffle, newProgress, addProgress, goalStatus, goalsMet, starsFor, group, mulberry32, hashSeed, counter`, types `LevelDef, Grid`), `games/tidepool-pals/levels.js` (`levelDef`).
- Produces:
  ```ts
  export type PlayResult = {
    won: boolean; movesUsed: number; movesLeft: number; stars: 0 | 1 | 2 | 3;
    shuffles: number; tideTurns: number; rescued: number;
    goalFrac: number; // 0..1, mean over goals of min(got, need) / need at the end
  };
  export function playLevel(def: LevelDef, seed: number): PlayResult;
  ```

- [ ] **Step 1: Write the failing tests**

  In `hal-tidepool-bot.test.ts` (import from `../src/hal/index.js`):
  - `is deterministic`: `playLevel(levelDef(1), 7)` deep-equals a second call with the same args.
  - `different seeds can differ`: over seeds 1..20 on level 10, the set of `movesUsed` values has size > 1.
  - `wins the easy first level almost always`: over seeds 1..20, at least 18 have `won === true`, and every win has `stars >= 1` and `movesLeft === def.moves - movesUsed`.
  - `a loss uses every move`: for any loss in levels 1..20 × seeds 1..5, `movesLeft === 0` and `stars === 0` (or `shuffles` hit the cap, see below).
  - `applies the tide on level 3`: some seed in 1..10 has `tideTurns >= 1` on `levelDef(3)`.
  - `counts rescues on level 5`: some seed in 1..10 has `rescued >= 1` on `levelDef(5)`.
  - `terminates on a board that always needs shuffling`: a hand-made `LevelDef` with `colors: 5`, `moves: 10`, a single `collect` goal of 999 and a layout of 7×8 with all but two cells `x` returns (doesn't hang) with `won === false`. Wrap in a 2-second vitest timeout.

- [ ] **Step 2: Run to verify failure**

  Run: `npx vitest run packages/core/test/hal-tidepool-bot.test.ts`
  Expected: FAIL, cannot resolve `../src/hal/index.js`.

- [ ] **Step 3: Implement `playLevel(def, seed)`**

  RNG `mulberry32(hashSeed(`${def.n}:${seed}`))`, ids `counter()`. The bot plays unassisted: no helpers, no boosters, no paid continues. Turn order, mirroring `index.html` lines 916–1131:

  ```
  grid = buildBoard(def, rng, newId, 'high'); mask = maskOf(def); rock = rockOf(def)
  phase='high'; dir='down'; prog=newProgress(); moves=def.moves; made=0; exit=def.exit ?? null
  while moves > 0 and not goalsMet(def, prog):
    if not hasMoves(grid): if shuffles == 50 break; shuffle(grid, rng, def.colors, newId); shuffles++; continue
    tap = choose(grid); res = resolveTap(grid, tap.r, tap.c, newId)   // res.ok guaranteed by choose
    moves--; made++; grid = res.grid; addProgress(prog, res.counts)
    settle()
    if tideTurns(def.tide, made) and not goalsMet and moves > 0:
      tp = tidePhase(def.tide, made); phase = tp.phase; dir = tp.dir; turns++
      t = turnTide(grid, mask, rock, phase, dir, rng, def.colors, newId); addProgress(prog, t.counts); settle()
  settle(): repeat { collapse(grid, activeMask(mask, rock, phase), rng, def.colors, newId, dir)
                     saved = rescueLost(grid, activeMask(mask, rock, phase), exit)
                     if none: stop; addProgress(prog, { rescue: saved.length }); rescued += saved.length }
  ```

  `choose(grid)`: consider one cell per distinct tappable group (dedupe cells via `group()`), plus every special cell. For each, `resolveTap` on the (unmutated) grid and value it as `10 × (goal progress gained, summing min(got, need) deltas from goalStatus) + cleared.length + (spawned ? 3 : 0)`. Highest value wins; ties go to the first in row-major order. Skip candidates where `res.ok` is false. `stars` is `starsFor(movesLeft, def.moves)` on a win, else 0.

- [ ] **Step 4: Run to verify pass**

  Run: `npx vitest run packages/core/test/hal-tidepool-bot.test.ts`
  Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

  ```bash
  git add packages/core/src/hal packages/core/package.json packages/core/test/hal-tidepool-bot.test.ts
  git commit -m "feat(hal): Tidepool robot player"
  ```

---

### Task 2: Scores for a set of levels

**Files:**
- Create: `packages/core/src/hal/tidepool-score.ts` (export from `hal/index.ts`)
- Test: `packages/core/test/hal-tidepool-score.test.ts`

**Interfaces:**
- Consumes: `playLevel` (Task 1); `levelDef`, `validateLevel`, `withoutTides`, `difficulty` from `levels.js`.
- Produces:
  ```ts
  export type LevelStats = { n: number; winRate: number; avgMovesLeftFrac: number; avgGoalFrac: number; difficulty: number; errors: string[] };
  export type Measures = Record<string, number>; // each 0..100, higher is better
  export type ScoreReport = {
    game: string; levels: LevelStats[]; measures: Measures; fitness: number;
    hardFailures: string[]; // non-empty means the gate must discard
  };
  export const TIDEPOOL_BANDS: { early: { upTo: number; minWin: number }; minWin: number; wallDrop: number };
  export function scoreTidepool(opts: { from: number; to: number; seeds: number }): ScoreReport;
  ```

- [ ] **Step 1: Write the failing tests**

  - `TIDEPOOL_BANDS` equals `{ early: { upTo: 5, minWin: 0.9 }, minWin: 0.25, wallDrop: 0.3 }` (pins the values; changing them is a Brian-reviewed change).
  - `reports every level in range`: `scoreTidepool({ from: 1, to: 6, seeds: 4 })` has `levels.map(l => l.n)` equal to `[1..6]`, every `winRate` in [0, 1], `game === 'tidepool-pals'`.
  - `measures are 0..100 and fitness is their mean`: keys are exactly `['inBand', 'noWalls', 'goalReach']`; each in [0, 100]; `fitness` equals their mean to 2 decimals.
  - `invalid levels are hard failures, not a lower score`: with `validateLevel` errors on any level (check via a level range that includes a generated level and assert `hardFailures` equals the flattened `level N: <error>` strings for each `errors` entry; for today's levels 1–30 it is `[]`).
  - `small run is fast`: `scoreTidepool({ from: 1, to: 10, seeds: 5 })` completes in under 5 s.

- [ ] **Step 2: Run to verify failure**

  Run: `npx vitest run packages/core/test/hal-tidepool-score.test.ts` → FAIL (`scoreTidepool` not exported).

- [ ] **Step 3: Implement `scoreTidepool`**

  Play each level `n` in `[from, to]` with seeds `1..seeds`. Measures:
  - `inBand`: 100 × fraction of levels whose `winRate` is ≥ `early.minWin` for `n ≤ early.upTo`, and ≥ `minWin` otherwise.
  - `noWalls`: 100 × (1 − walls / (levels − 1)), where a wall is a level whose `winRate` is more than `wallDrop` below the previous level's. 100 when there is one level.
  - `goalReach`: 100 × mean `avgGoalFrac` over levels that weren't always won (how close the bot gets when it loses; 100 if all levels were always won).
  - `hardFailures`: `validateLevel(def)` and `validateLevel(withoutTides(def))` errors for each level, as `level N: <error>`.
  Round measures and fitness to 2 decimals.

- [ ] **Step 4: Run to verify pass** → PASS (5 tests).

- [ ] **Step 5: Commit** `feat(hal): Tidepool scores (in-band win rate, no walls, goal reach)`

---

### Task 3: The keep/discard gate

**Files:**
- Create: `packages/core/src/hal/gate.ts` (export from `hal/index.ts`)
- Test: `packages/core/test/hal-gate.test.ts`

**Interfaces:**
- Consumes: `ScoreReport`, `Measures` (Task 2).
- Produces:
  ```ts
  export const GATE = { minGain: 0.5, tolerance: 1.0 } as const; // score points
  export type GateResult = { keep: boolean; gain: number; reasons: string[] };
  export function compareScores(before: ScoreReport | null, after: ScoreReport, target?: string): GateResult;
  ```

- [ ] **Step 1: Write the failing tests** (build `ScoreReport` fixtures inline)
  - `no baseline → discard`: `compareScores(null, r)` → `keep: false`, reasons contain `'no baseline'`.
  - `hard failure → discard even if better`: after has `hardFailures: ['level 3: x']` and +10 fitness → `keep: false`, reasons contain `'level 3: x'`.
  - `keeps a real gain`: fitness 70 → 71, no measure down → `keep: true`, `gain === 1`.
  - `discards a gain below minGain`: 70 → 70.4 → `keep: false`, reason mentions `'no real gain'`.
  - `discards a regression in another measure`: target `inBand` +5, `noWalls` −1.5 → `keep: false`, reason names `noWalls`.
  - `tolerates tiny wobble`: `noWalls` −0.8 with target +2 → `keep: true`.
  - `target measure`: with `target = 'noWalls'`, gain is measured on `noWalls`, not fitness.
  - `different level counts`: before has 20 levels, after 25 → no throw; compares measures only.

- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement `compareScores`**: discard on null baseline or any `after.hardFailures`; gain = after − before on the target measure (or `fitness`); discard if gain < `GATE.minGain`; discard if any measure present in both drops by more than `GATE.tolerance`. Reasons are short human-readable strings.
- [ ] **Step 4: Run to verify pass** → PASS (8 tests).
- [ ] **Step 5: Commit** `feat(hal): keep/discard gate`

---

### Task 4: Ledger and the `npm run hal` CLI

**Files:**
- Create: `packages/core/src/hal/ledger.ts` (export from `hal/index.ts`), `scripts/hal.ts`
- Modify: root `package.json` (add `"hal": "tsx scripts/hal.ts"`), `scripts/tsconfig.json` only if the new import needs it
- Test: `packages/core/test/hal-ledger.test.ts`

**Interfaces:**
- Consumes: `scoreTidepool`, `compareScores`, `ScoreReport`, `GateResult`.
- Produces:
  ```ts
  export type Pass = {
    id: string; ts: string; game: string; change: string; target?: string;
    fitness: number; baseline: number | null; measures: Measures;
    kept: boolean; reasons: string[]; costUsd: number;
  };
  export type Ledger = { version: 1; passes: Pass[]; best: Record<string, number>; streak: Record<string, number> };
  export const emptyLedger: () => Ledger;
  export function parseLedger(json: string): Ledger;          // throws Error('corrupt ledger: ...') on bad input
  export function nextPassId(l: Ledger): string;              // 'HAL-001', 'HAL-002', ...
  export function recordPass(l: Ledger, p: Omit<Pass, 'id'>): Ledger; // returns a new ledger
  export function stagnated(l: Ledger, game: string, k?: number): boolean; // default k = 5
  export function ledgerMarkdown(l: Ledger, last?: number): string;
  ```

- [ ] **Step 1: Write the failing ledger tests**
  - `ids count up from HAL-001`, and keep counting after 3 passes (`HAL-004`).
  - `recordPass` doesn't mutate its input; `best[game]` rises only when a kept pass beats it; `streak[game]` resets to 0 on a kept pass and +1 on a discarded one.
  - `stagnated` is false at 4 discards in a row and true at 5 (default k).
  - `parseLedger('{')` and `parseLedger('{"version":2}')` throw `/corrupt ledger/`; `parseLedger(JSON.stringify(emptyLedger()))` round-trips.
  - `ledgerMarkdown` has header `| ID | game | change | fitness | baseline | Δ | kept |` and one row per pass, newest last, limited to `last` rows.

- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement the ledger functions.** The ledger keeps the last 500 passes.
- [ ] **Step 4: Run to verify pass** → PASS.

- [ ] **Step 5: Implement `scripts/hal.ts`** with four commands, all writing under `.data/hal/` (create the directory as needed):
  - `score [--from 1] [--to 30] [--seeds 20] [--json]`: runs `scoreTidepool`, prints a table (level, win %, moves left %, difficulty) and the measures; `--json` prints the report instead.
  - `baseline [same flags]`: scores and writes `.data/hal/baseline/tidepool-pals.json`.
  - `check --change "<what changed>" [--target <measure>] [same flags]`: scores the working tree, loads the baseline (missing → treated as `null`), runs `compareScores`, records a pass in `.data/hal/ledger.json` (corrupt ledger → print the error and exit 1 without writing), prints KEEP or DISCARD with reasons, and on KEEP writes the new report as the baseline. Exit code 0 on KEEP, 2 on DISCARD.
  - `status`: prints `ledgerMarkdown(ledger, 10)` and whether Tidepool has stagnated.
  Time comes from `new Date().toISOString()` in the script (the core functions take it as a value).

- [ ] **Step 6: Verify by hand**
  Run: `npm run hal -- baseline` then `npm run hal -- check --change "no-op"`.
  Expected: baseline writes in about a minute or less; `check` prints `DISCARD` with `no real gain` (identical scores), exits 2, and `npm run hal -- status` shows `HAL-001` as not kept.

- [ ] **Step 7: Run the full suite and typecheck**
  Run: `npm test && npm run typecheck`
  Expected: all tests pass (298 existing plus the new ones), typecheck clean.

- [ ] **Step 8: Commit** `feat(hal): ledger and npm run hal (score, baseline, check, status)`

---

## What plans 2 and 3 add (not in this plan)

- **Plan 2, the loop:** Hyperline and Gearhold scores, headless-browser screenshots and clips, tripwires, the Claude-driven ticket → worktree → check → squash-merge → push flow, `.hal.env` loading and the `CLAUDE.md` note on it, the $20/day budget, launchd nightly runs, "Run now", and one-run-at-a-time locking.
- **Plan 3, the report:** the director's note, the phone report page and its publishing, votes and 👎 reverts, and feeding votes into the next run.
