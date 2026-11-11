# Hal plan 1b: Hyperline and Gearhold robot players and scores — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Hyperline and Gearhold the same robot player → scores → keep/discard check that Tidepool got in plan 1, so `npm run hal -- check --game <slug>` works for all three games.

**Architecture:** Two new pure scorers in `packages/core/src/hal/` (`hyperline-*.ts`, `gearhold-*.ts`) that return the existing `ScoreReport` shape, so the gate and ledger are unchanged. A small registry (`scorers.ts`) maps each game slug to its scorer, default run settings and flags; the CLI dispatches on `--game`. Hyperline reuses the search bot that already lives in `packages/core/test/hyperline-course.test.ts` (moved into `src/hal/`). Gearhold is scored from its tile maps (`games/gearhold/levels.js`); its play logic lives in `index.html` with WebGL, so this plan measures what the maps alone can tell.

**Tech Stack:** TypeScript strict, ESM, Node 22, vitest, tsx. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-11-hal-nightly-polish-design.md` ("The parts → 1. Robot player and scores", Hyperline and Gearhold bullets). Builds on plan 1 (`docs/superpowers/plans/2026-11-11-hal-1-tidepool-robot-and-scores.md`), already on this branch.

## Global Constraints

- No new dependencies of any kind.
- Hard rules and validity are pass/fail (`hardFailures`), never part of a score.
- No `Date.now()`, `Math.random()` or wall-clock in `packages/core/src/hal/`. Hyperline randomness from `mulberry32` in `games/hyperline/lib/rng.js`.
- Don't change the gate (`GATE`, `compareScores`) or the ledger; they already work for any `ScoreReport`.
- Don't change game behaviour. Moving the Hyperline search bot out of a test file is allowed; the existing Hyperline tests must keep passing unchanged in meaning.
- Every scorer's default run finishes in about a minute or less on a laptop (Tidepool's takes about a second).
- Hal state lives in `.data/hal/`.

## Review Focus

1. **A baseline from one game compared against another game's score** (`--game hyperline` reading Tidepool's baseline): must be refused as corrupt or mismatched, never compared. Pinned in Task 1.
2. **The Hyperline casual player is degenerate** (survives everything or dies at once), making its measures meaningless: the implementer measures and pins the slip rate so the median run ends somewhere in sectors 2–6. Pinned in Task 2.
3. **Search-bot runaway on a new pattern** (the search explodes and never returns): every clearability check has a hard step budget and reports "unknown" as a hard failure rather than hanging. Pinned in Task 2.
4. **Gearhold maps that are unfinishable** (exit unreachable, key behind its own door): hard failures, matching the existing `gearhold-levels.test.ts` rules. Pinned in Task 3.
5. **Old Tidepool baselines and flags keep working**: `npm run hal -- check` with no `--game` still means Tidepool, and existing Tidepool baselines still load. Pinned in Task 1.

---

## File structure

```
packages/core/src/hal/types.ts          ScoreReport gains a type parameter for its per-item stats (setup commit)
packages/core/src/hal/scorers.ts        registry: slug → { flags, defaults, score(range) }        (Task 1, Task 4)
packages/core/src/hal/baseline.ts       range becomes Record<string, number>; checks report.game     (Task 1)
packages/core/src/hal/hyperline-bot.ts  clearable() search bot (moved) + casualRun() player          (Task 2)
packages/core/src/hal/hyperline-score.ts scoreHyperline()                                             (Task 2)
packages/core/src/hal/gearhold-walk.ts  map parsing, reachability, route walk                          (Task 3)
packages/core/src/hal/gearhold-score.ts scoreGearhold()                                               (Task 3)
packages/core/test/hal-scorers.test.ts, hal-hyperline-*.test.ts, hal-gearhold-*.test.ts
packages/core/test/hyperline-course.test.ts  imports clearable() instead of its local copy          (Task 2)
scripts/hal.ts                          --game flag, per-game flags from the registry                 (Task 1, Task 4)
```

**Setup (controller, before Task 1):** in `types.ts`, `ScoreReport` becomes `ScoreReport<L = LevelStats>` with `levels: L[]`. Every existing use keeps compiling with the default.

---

### Task 1: Per-game CLI and baselines

**Files:** Create `packages/core/src/hal/scorers.ts`; modify `baseline.ts`, `index.ts`, `scripts/hal.ts`; test `packages/core/test/hal-scorers.test.ts`, `hal-baseline.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export type Range = Record<string, number>;
  export type Scorer = {
    game: string;
    defaults: Range;                     // e.g. tidepool-pals: { from: 1, to: 30, seeds: 20 }
    validate(range: Range): string | null; // null if ok, else a message
    score(range: Range): ScoreReport<unknown>;
  };
  export const SCORERS: Record<string, Scorer>; // Task 1 registers only 'tidepool-pals'
  export function scorerFor(game: string): Scorer; // throws Error('unknown game: <slug>')
  // baseline.ts
  export type Baseline = { range: Range; report: ScoreReport<unknown> };
  export function parseBaseline(json: string, game: string): Baseline; // throws 'corrupt baseline: …'
  export function rangeMismatch(base: Range, now: Range): string | null;
  ```

- [ ] **Step 1: Failing tests**
  - `scorerFor('tidepool-pals').defaults` equals `{ from: 1, to: 30, seeds: 20 }`; `scorerFor('nope')` throws `/unknown game: nope/`.
  - `parseBaseline(json, 'hyperline')` on a Tidepool baseline throws `/corrupt baseline: .*tidepool-pals.*hyperline/`.
  - An existing-format Tidepool baseline (`{ range: { from, to, seeds }, report }`) still parses with `game = 'tidepool-pals'`.
  - `rangeMismatch({ from: 1, to: 5, seeds: 20 }, { from: 1, to: 6, seeds: 20 })` returns a message naming both ranges; equal ranges with keys in a different order return `null`; an extra key on one side is a mismatch.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Keep the existing range-mismatch wording for Tidepool's `from/to/seeds` (`baseline was scored on levels A–B × S seeds; this run is C–D × T`); other games get `baseline was scored with k=v, …; this run is k=v, …`.
- [ ] **Step 4: CLI.** `--game <slug>` (default `tidepool-pals`) on every command. Numeric flags come from the scorer's `defaults` keys: `--<key> <int>` for each; unknown flags still error. Baseline path `.data/hal/baseline/<slug>.json`. `status` shows stagnation for every game that has passes.
- [ ] **Step 5: Verify** `npm test`, `npm run typecheck`; by hand `npm run hal -- baseline --to 5` then `npm run hal -- check --to 5 --change x` → DISCARD exit 2 (unchanged behaviour); `npm run hal -- check --game nope --change x` → exit 1 with `unknown game: nope`. Clean `.data/hal/`.
- [ ] **Step 6: Commit** `feat(hal): per-game scorers registry and --game`

---

### Task 2: Hyperline robot players and scores

**Files:** Create `hyperline-bot.ts`, `hyperline-score.ts`; modify `packages/core/test/hyperline-course.test.ts` (import `clearable` instead of the local `solvable`); test `hal-hyperline-bot.test.ts`, `hal-hyperline-score.test.ts`. Do not edit `scorers.ts` or `index.ts` (Task 4 wires them).

**Interfaces:**
- Consumes: `games/hyperline/lib/{course,sim,world,rng}.js`.
- Produces:
  ```ts
  // hyperline-bot.ts
  export const SEARCH_BUDGET: number; // max states explored per clearable() call: 2_000_000
  export function clearable(c: Course, until: number): boolean | 'unknown'; // 'unknown' when the budget runs out
  export const HYPERLINE_CASUAL: { slip: number; look: number }; // look = 0.35 (seconds); slip pinned in Step 3
  export type CasualRun = { dist: number; sector: number; cause: string; jumps: number };
  export function casualRun(seed: number, until: number): CasualRun;
  // hyperline-score.ts
  export type SectorStats = { sector: number; reached: number; died: number; deathRate: number; causes: Record<string, number> };
  export const HYPERLINE_BANDS: { early: { upTo: number; minSurvive: number }; minSurvive: number; spikeJump: number };
  export function scoreHyperline(range: { seeds: number; until: number }): ScoreReport<SectorStats>;
  ```

- [ ] **Step 1: Failing tests**
  - `clearable` is the existing search bot, unchanged in behaviour: the moved tests in `hyperline-course.test.ts` (6 seeds clearable to 1900, impossible pit fails, spike-then-low-ceiling fails) pass against the import. A fixture that exhausts the budget (budget lowered via a test-only parameter is fine: `clearable(c, until, budget?)`) returns `'unknown'`.
  - `casualRun` is deterministic per seed; over seeds 1..20 the set of `sector` values has size > 1; `dist` is never above `until`; a run that reaches `until` has `cause === ''`.
  - `HYPERLINE_BANDS` equals `{ early: { upTo: 1, minSurvive: 0.8 }, minSurvive: 0.4, spikeJump: 0.3 }`.
  - `scoreHyperline({ seeds: 8, until: 1900 })`: `game === 'hyperline'`; `levels` has one `SectorStats` per sector 0..7; measures keys exactly `['inBand', 'noSpikes', 'reach']`, each 0..100; `fitness` is their mean (2 dp); `hardFailures` is `[]` for today's game.
  - An injected unclearable seed (mock `createCourse` for one seed to return the impossible-pit course) produces `hardFailures` containing `seed N: not clearable to 1900m` and leaves measures equal to the clean run's; a budget-exhausted seed produces `seed N: clearability unknown`.
  - `scoreHyperline` throws unless `seeds` and `until` are positive integers.
  - `scoreHyperline({ seeds: 20, until: 1900 })` finishes in under 30 s.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**
  - `clearable`: move `solvable` from the test file verbatim, add the state budget.
  - `casualRun`: one runner on `createCourse(seed)`. It decides on the landing frame and every 8th frame (15 Hz), like the search bot. On a decision frame, simulate `look` seconds ahead twice on cloned runners: waiting and jumping now. Jump if waiting dies within the look-ahead and jumping doesn't; if both die, jump; otherwise wait. With probability `slip` (seeded `mulberry32(seed ^ 0x9e3779b9)`), skip the decision, as if reacting late. Lookahead stepping may set per-object flags (`done`, `mc`, `got`); deep-copy only the objects within the look-ahead window if that changes the outcome, otherwise share them as the search bot does. Record the death sector (`sectorAt(dist)`) and cause.
  - Pin `slip`: measure the median death sector over seeds 1..40 for slip in {0.05, 0.1, 0.15, 0.2, 0.3}, and pick the smallest slip whose median is in sectors 2–6. Report the table. If none is, report DONE_WITH_CONCERNS with the table.
  - Measures (per sector s = 0..sectorAt(until − 1)):
    - `inBand`: 100 × fraction of sectors whose survival (1 − deathRate) is ≥ `early.minSurvive` for s ≤ `early.upTo`, else ≥ `minSurvive`. Sectors no run reached count as out of band.
    - `noSpikes`: 100 × (1 − spikes / (sectors − 1)), where a spike is a sector whose deathRate exceeds the previous sector's by more than `spikeJump`.
    - `reach`: 100 × median casual `dist` / `until`.
    - `hardFailures`: for each seed 1..seeds, `clearable(createCourse(seed), until)`: `false` → `seed N: not clearable to <until>m`, `'unknown'` → `seed N: clearability unknown`.
- [ ] **Step 4: Run → PASS**; `npm test` (the existing Hyperline tests must still pass), `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(hal): Hyperline robot players and scores`

---

### Task 3: Gearhold map walker and scores

**Files:** Create `gearhold-walk.ts`, `gearhold-score.ts`; test `hal-gearhold-walk.test.ts`, `hal-gearhold-score.test.ts`. Do not edit `scorers.ts`, `index.ts`, or `gearhold-levels.test.ts`.

**Interfaces:**
- Consumes: `games/gearhold/levels.js` (`LEVELS`, `WALLS`, `FLOOR_THINGS`; legend in its header comment).
- Produces:
  ```ts
  // gearhold-walk.ts
  export type Cell = [number, number]; // [x, y]
  export type Walk = {
    route: Cell[];            // start → (key, if any locked door blocks the exit) → a floor cell next to an exit X
    keyFirst: boolean;
    threatOnRoute: number;    // sum of THREAT for enemies within SIGHT steps (BFS, walls block) of any route cell
    supplyOnRoute: number;    // repair crystals (h) within DETOUR steps of the route
    startThreat: number;      // THREAT within SAFE steps of S
    problems: string[];       // validity failures, worded like gearhold-levels.test.ts
  };
  export const THREAT: Record<'d' | 'c' | 'b', number>; // { d: 2, c: 1, b: 5 }
  export const SIGHT = 5, DETOUR = 4, SAFE = 4;
  export function walkLevel(map: string[]): Walk;
  // gearhold-score.ts
  export type MapStats = { n: number; name: string; routeLen: number; threat: number; threatPerStep: number; supply: number; startThreat: number };
  export const GEARHOLD_BANDS: { maxStartThreat: number; minSupplyPerThreat: number; wallRatio: number };
  export function scoreGearhold(range?: Record<string, never>): ScoreReport<MapStats>;
  ```

- [ ] **Step 1: Failing tests**
  - On a hand-made map with a locked door `K` between start and exit and the key `k` reachable, `walkLevel` gives `keyFirst === true`, a route that visits the key cell before passing the `K` cell, and ends next to an `X`.
  - A map whose exit is unreachable gives `problems` containing `exit unreachable`; key behind its own locked door gives `key unreachable before locked door`; an unsealed edge gives `not sealed`; an unknown tile gives `unknown tile "<c>"`.
  - `threatOnRoute` counts an enemy seen through open floor but not one behind a wall at the same distance; `startThreat` counts only within `SAFE`.
  - `GEARHOLD_BANDS` equals `{ maxStartThreat: 0, minSupplyPerThreat: 0.1, wallRatio: 2 }`.
  - `scoreGearhold()`: `game === 'gearhold'`; one `MapStats` per level in `LEVELS`; measures keys exactly `['safeStarts', 'supplied', 'rising']`, each 0..100; `fitness` is their mean; `hardFailures` is `[]` for today's levels (they pass `gearhold-levels.test.ts`).
  - An injected broken level (mock `levels.js` to append a level with an unreachable exit) yields `hardFailures` containing `level N: exit unreachable`, and the measures for the other levels are unchanged.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**
  - The route is the shortest BFS path. Plain doors `D` are passable; locked doors `K` are passable only after the key. Walls are `WALLS`, and `X` is reached by standing next to it, as in `gearhold-levels.test.ts`.
  - Measures:
    - `safeStarts`: 100 × fraction of levels with `startThreat ≤ maxStartThreat`.
    - `supplied`: 100 × fraction of levels with `supply / max(1, threat) ≥ minSupplyPerThreat`.
    - `rising`: 100 × (1 − walls / (levels − 1)), where a wall is a level whose `threatPerStep` is more than `wallRatio` × the previous level's. 100 for one level.
  - `hardFailures` is each level's `problems` as `level N: <problem>`.
- [ ] **Step 4: Run → PASS**; `npm test`, `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(hal): Gearhold map walker and scores`

---

### Task 4: Register both and verify end to end

**Files:** Modify `scorers.ts`, `index.ts`; test `hal-scorers.test.ts`.

- [ ] **Step 1: Failing test:** `Object.keys(SCORERS).sort()` equals `['gearhold', 'hyperline', 'tidepool-pals']`; `scorerFor('hyperline').defaults` equals `{ seeds: 20, until: 1900 }`; `scorerFor('gearhold').defaults` equals `{}`; each scorer's `score(defaults)` returns a report whose `game` is its slug.
- [ ] **Step 2: Implement:** register both scorers and re-export the new modules from `hal/index.ts`.
- [ ] **Step 3: Verify by hand** for each game: `npm run hal -- baseline --game <slug>` then `npm run hal -- check --game <slug> --change no-op` → DISCARD `no real gain`, exit 2. Then `npm run hal -- status` lists all three. Report each game's fitness and run time. Clean `.data/hal/`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`, then commit `feat(hal): score all three games`.
