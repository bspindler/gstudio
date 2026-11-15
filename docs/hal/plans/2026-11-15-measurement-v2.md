# Hal measurement v2: make the scores steer again

Status: in progress (started 2026-11-15). Worked by a `/loop` (P0, P1, one item per turn) and then a Workflow
(P2, P3, one agent per game in its own worktree, each with an independent review). Tick an item when it is
committed and pushed.

## Why

The review on 2026-11-15 (five per-game reviews, 123 ledger passes) found the measurement has mostly stopped
steering: 11 of 73 kept passes moved fitness. Causes, common to every game:

- **Noise beats the gate.** Fixed small seed sets move scores more than the gate's 0.5 gain / 1.0 tolerance
  (Gearhold tension 35.0 / 20.9 / 21.9 on three seed blocks; Hyperline fitness 99.9 → ~89 on other seeds).
- **Tension vetoes real gains.** 8 discards, e.g. Lanternkeep HAL-059 (+4.6 fitness) for tension −4.2.
- **Bots can't see the mechanics** (Tidepool rescue-blind; Gearhold ignores presses; Hyperline frame-perfect;
  Lanternkeep hoards gold and plays without perks; Block Barn never taps doors or sky).
- **Measures punish growth or are coarse** (Hyperline reach shrinks per new sector; Gearhold counts levels in band,
  25-point steps); several are pinned at 100.
- **Fixes are gated for gain** (three level 9 fixes discarded for "no gain").

## Operator decisions (Brian, 2026-11-15)

- **D1 Tension is not a veto.** A tension drop discards only when the ticket targets tension. Otherwise it is
  reported on the card/report as a note. Early levels/nights (the "opening must feel good" band) are excluded
  from the tension mean.
- **D2 Noise-aware tolerance.** The flat 1.0 tolerance and 0.5 min gain become per-measure: each scorer reports a
  standard error per measure (`ScoreReport.noise`), and the gate uses
  `tol = max(1.0, 2·√(seB² + seA²))`, `minGain = max(0.5, same)`. A report without `noise` behaves as today.
- **D3 Lanternkeep "close" = under half the lives left** (1 star territory), not "missed three stars".

## Rules for whoever works this plan

- TDD: failing test first. `npm run typecheck` and `npm test` green before every commit.
- Push only through this guard, which fails when a Hal run is live or Hal has unpushed commits:
  `git fetch -q && [ ! -f .data/hal/run.lock ] && [ -z "$(git log --oneline origin/main..refs/hal/main)" ] && git push -q origin main && git update-ref refs/hal/main HEAD`.
  If Hal has unpushed commits (and no run is live): cherry-pick `origin/main..refs/hal/main` onto main first, test,
  then push through the guard. If a run is live, wait for it to finish.
- Hal's nightly job is paused (`launchctl bootout`) while this runs; don't start Hal runs. Re-enable at the end.
- An item that moves a game's numbers re-baselines that game in the same commit and says so in the message
  (`Hal-Baseline-Break: <game>`), and adds a line to that game's CHANGELOG only if game code changed.
- Commit messages end with the session attribution lines.

## P0: unblock (serial, /loop)

- [x] **P0.1 Hyperline reach doesn't shrink per sector.** `packages/core/src/hal/hyperline-score.ts` `reachScore`,
  `scorers.ts` `HYPERLINE_UNTIL`. Score reach against a fixed distance (today's 2650) or as a median-death-sector
  band, not a fraction of the growing course. Test: adding a dummy sector to the course leaves `reach` unchanged.
- [x] **P0.2 Tension per D1.** `gate.ts` (tension regressions are notes unless targeted; result gets `notes`),
  `candidate.ts` (notes go to `scoreNotes`), `tension.ts` (`tensionMeasure` takes an `exclude` / early cut),
  `lanternkeep-score.ts` (exclude nights ≤ `early.upTo`), `tidepool-score.ts` (exclude its early band, if any).
  Tests in `packages/core/test/hal-*.test.ts`.
- [x] **P0.3 Fix tickets use polish mode.** `candidate.ts`: a `kind: 'fix'` ticket with a target is gated in polish
  mode (no gain needed; target gain still reported). Test with a fix ticket whose target doesn't move.
- [x] **P0.4 Block Barn hook lists every tap zone.** `games/block-barn/index.html` `__hal.targets()` includes `door`
  and `sky` (from `doorBox()` / `skyBox()`); a test checks every `tapAt` branch kind appears in the hook's targets.
  `scripts/hal/block-barn-play.ts` fallback then taps them; `bigTargets` measures them.
- [x] **P0.5 Gearhold effects get their own random stream.** `games/gearhold/index.html`: particles, sparks, steam,
  smoke, cogs, muzzle draw from a separate seeded stream, so a visual-only change doesn't reshuffle gameplay.
  Test: a scorer run with an effect's count changed gives identical gearhold-play numbers. Re-baseline gearhold-play.

## P1: cut the noise (serial, /loop)

- [x] **P1.1 `ScoreReport.noise` and the D2 gate.** `types.ts`, `baseline.ts` (validate optional `noise`), `gate.ts`.
  Tests: noisy measures tolerate more; no `noise` = today's behaviour.
- [x] **P1.2 Scorers report noise.** Each scorer estimates a per-measure standard error (bootstrap over seeds, fixed
  RNG, e.g. 200 resamples, from per-seed records it already has): `tidepool-score.ts`, `gearhold-play-score.ts`,
  `hyperline-score.ts`, `lanternkeep-score.ts`. Block Barn and static Gearhold are deterministic: noise 0.
- [ ] **P1.3 More seeds.** `scorers.ts` defaults: Tidepool 20 → 100, Gearhold-play → 150 (check the run fits Hal's
  check timeout), Lanternkeep 4 → 12, Hyperline stays 100 until P2 makes it per-sector. Re-baseline each.
- [ ] **P1.4 Hyperline score-time test is deterministic.** `hal-hyperline-score.test.ts`: assert on explored-state
  count, not wall time; skip `clearable` for seeds the casual run finished.

## P2: bots that play like people (Workflow, one agent per game)

- [ ] **Tidepool** `tidepool-bot.ts`: rescue-aware `value()` (play the settle out on a copy; reward rescues and pals
  nearer the exit); call `ensureBubbles` at start and in settle exactly as `index.html` does.
- [ ] **Gearhold** `gearhold-bot.ts`: read `press.js` (`pressState`, `PRESS`) and wait out warn/down press cells;
  cap firing range at ~10–12 tiles.
- [ ] **Hyperline** `hyperline-bot.ts`: aim for the middle of the feasible jump window; fire at target +
  N(0, σ≈30 ms) plus a reaction delay (seeded). Re-pin slip/σ so early sectors stay in band.
- [ ] **Lanternkeep** `lanternkeep-bot.ts`: spend past `maxTowers` when nothing is left to upgrade and gold is
  plentiful; `lanternkeep-score.ts` plays each night with the perks a typical player owns by then (~2 stars a night).
- [ ] **Block Barn** `block-barn-play.ts`: a seeded "toddler" phase (random taps incl. gaps, 3–6-tap runs on one
  target, two-finger/palm touches, a 1 s press, a cancel) plus state combos (doors open, dusk). Every gesture gives
  exactly one response and nothing sticks.

## P3: measures that see design (Workflow, same agents, after their P2)

- [ ] **Gearhold** `gearhold-play-score.ts`: winnable, pace and feel scored per level with `bandScore` and averaged
  (no 25-point steps); feel per level, not pooled. Retire static `gearhold` from fitness (keep walker problems as
  hard failures). New-level gate path: existing levels' per-level scores must hold; the new level must be within
  tolerance of its band.
- [ ] **Hyperline** `hyperline-score.ts`: per-pattern `fair` (p10 timing window ≥ ~50 ms) and `bites` (each sector's
  intro mechanic kills the noisy bot 3–25% per encounter); score each sector from its own start
  (`createCourse(seed, startX)`); add tension (near-miss rate under the noisy bot).
- [ ] **Tidepool** `tidepool-score.ts`: tiered win-rate bands with a ceiling (1–5 ≥ 0.9; 6–15 0.7–0.95; 16+ 0.45–0.85);
  a "+5 helps" measure (win-rate gain replaying with 5 more moves) that also lists levels where the offer should
  hide; a variety measure across neighbouring levels.
- [ ] **Lanternkeep**: `watch` narrowed or per style so it stops adding a free 33 points.
- [ ] **Block Barn** `block-barn-score.ts`: capped `variety` / discovery (distinct responses and features reached per
  60 random taps) against a reviewed target; `calm` below 100 is a hard failure.

## Done when

All boxes ticked, every game re-baselined, `docs/hal/IMPROVEMENTS.md` has a "measurement v2" entry, Hal's
nightly job is back on, and one Hal run completes with the new gate.
