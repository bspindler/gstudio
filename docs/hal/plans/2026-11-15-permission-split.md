# Hal permission split: content in the game, a "Hal asks" lane, read-only history

Status: approved by Brian 2026-11-15 ("do all three"). Each part is built on its own branch, reviewed, merged by
the operator session, and ticked here.

## Why

Of 130 ledger passes, 52 were discarded. Most are the gate working. About 12 hit the permission split itself:

- **Game facts pinned in protected judge code** (HAL-011, 018, 031, 035, 109): protected tests and scorers hard-coded
  "Gearhold has 3 levels", "Hyperline until 1900", "Tidepool has 20 levels", "moves are taps", so content growth
  failed a test Hal may not touch. Each was fixed by hand after it blocked a ticket.
- **The frozen hal hook holds game content** (HAL-010, 063, 130): Block Barn's tap-zone list lives inside the
  `// ---- hal hook` block, so a new tappable feature (HAL-130's weathervane) is blocked by design.
- **Missing tools** (HAL-001, 057, 066, 076): no score runner in the sandbox (since fixed by the score broker), no
  git history, no vendor copy.

The rule "Hal can't change what judges it" stays. What changes: content leaves the judge, and a blocked build
becomes a request to Brian instead of a dead end.

## A. Content lives in the game; the judge reads it

- [ ] Block Barn: the tap-zone list moves out of the hook into game-owned code (e.g. `tapZones()` next to `tapAt`),
  and `__hal.targets()` only reads it. The protected static test still proves every kind `tapAt` routes appears in the
  zone list (so a zone can't be hidden from `bigTargets`). Same treatment for any other game-owned content inside the
  Gearhold and Lanternkeep hooks.
- [ ] Audit every protected file (`packages/core/src/hal/**`, `scripts/hal/**`, `packages/core/test/hal-*.test.ts`,
  hook blocks) for pinned content facts: level/sector/night counts, level names, move kinds, until distances,
  catalog sizes. Each is derived from the game's own data or the test is made independent of it.
- [ ] A protected test per game that grows the content in memory (one more level/sector/night, one more Block Barn
  zone) and runs the scorer and the tests' content assumptions against it, so a future pin fails at once.

## B. "Hal asks": a blocked build becomes a request to Brian

- [ ] The implementer contract gets a way to say "needs a protected change": the game change it built plus a proposed
  patch to the protected file(s), with a one-line why. Allowed only for judge files (`scripts/hal/**`,
  `packages/core/src/hal/**`, `packages/core/test/hal-*.test.ts`, hook blocks). Never for policy, markets, CLAUDE.md,
  compliance, gateway, `.hal.env`, `.data/`, `infra/`, `.github/`, vendor, `package*.json`: those are refused outright.
- [ ] Hal holds the candidate like a feature (`refs/hal/held/HAL-xxx`), with the patch attached, and runs every check it
  can on game change + patch together (tripwires on the game part; tests, scores and gate on the combined tree).
- [ ] The report's "Needs you" shows the request: why, the protected diff in full, the game change, the checks. 👍 applies
  both (operator action, `hal ship`), runs ci:local, pushes; 👎 drops both. Hal never applies a protected patch itself.
- [ ] The planner prompt says when to use it (content growth that a judge file blocks), not as a way around a measure.

## C. Read-only git history for the implementer

- [ ] The implementer can run read-only history commands (`git log`, `git show`, `git diff` between commits) on its
  worktree, and nothing that writes refs, the index or the work tree, or reaches the network.

## Done when

All boxes ticked and merged, Hal's nightly run uses it, and Block Barn's weathervane (HAL-130) is re-planned by Hal
and lands without a hook change.
