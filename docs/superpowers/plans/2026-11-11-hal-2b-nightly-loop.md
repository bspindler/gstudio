# Hal plan 2b: the nightly loop (tickets → build → check → merge), budget, schedule, Run now — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hal runs by itself, nightly at 1 a.m. and on demand, and improves the games. Each run plays every game, asks Claude for tickets, builds each ticket in its own worktree, and merges it into `main` only if every check passes. Each merge bumps the game's version, writes its changelog entry and history files, and stays within the $20/day API cap. Brian can undo a merged change with one command.

**Architecture:**
- **Pure decisions in `packages/core/src/hal/`**: budget, tripwires, release (version, changelog, trailers), tickets and gate modes, all testable without git or Claude.
- **Side effects in `scripts/hal/`**: env loading, the `claude -p` adapter, git and worktrees, the candidate pipeline, the run orchestrator, the Run-now server and launchd install. Every side effect is injected so the orchestrator is unit-testable with fakes.
- **Claude Code headless (`claude -p --output-format json`)** does the thinking in three roles:
  - planner: read-only, returns tickets as JSON;
  - implementer: edits one worktree;
  - director: no tools, writes the note.
- **Hal's own TypeScript, not Claude,** runs the checks, edits versions, writes commit messages and merges, so Claude can't skip or soften a check.

**Tech Stack:** TypeScript strict, ESM, Node 22, vitest, tsx, Hono (already a dependency, used by `scripts/dev.ts`), git CLI, the `claude` CLI (2.1.x, installed at `~/.local/bin/claude`), and macOS launchd and `caffeinate`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-11-hal-nightly-polish-design.md`. The sections that matter here are "How it runs", "Money", "Scope of change", "2. The improvement loop", "3. Tripwires", "5. Game history" (trailers and history files) and "Calls I made" (merging and pushing, Run now). Builds on plans 1, 1b and 2a, which are on `main`.

## Global Constraints

- **Runs on Brian's Mac only.** Nothing in this plan runs in CI except the unit tests. CI must stay browser-free and Claude-free: no test may spawn the real `claude` or touch the real repo's `main`.
- **Money:**
  - The daily cap is **$20.00 of API credits** per local calendar day, across all runs.
  - Each `claude -p` call gets `--max-budget-usd` = min(the role's slice, what's left today).
  - When the cap is reached, the run stops cleanly and the report says so.
  - Nightly runs use API billing. A run Brian starts uses his subscription first, and switches to API for the rest of the run only if Claude reports a subscription limit.
- **The key:**
  - It is `ANTHROPIC_API_KEY` in `.hal.env` at the repo root (already in `.gitignore`).
  - It is passed to the child process **only** for API-billed calls, and stripped from the inherited env for subscription calls.
  - It is never logged, written to `.data/`, or put into a prompt.
- **No new network hosts.** Hal's only outward actions are calling Claude via the CLI and `git push origin main`. Publishing the report is plan 3.
- **Protected paths** (Hal's tripwires reject any candidate that touches them):
  - `packages/core/src/hal/**`, `packages/core/test/hal-*.test.ts`, `scripts/hal.ts`, `scripts/hal/**`
  - `games/gearhold/levels.d.ts`, and the Gearhold `// ---- hal hook` block, compared byte for byte
  - `.data/**`, `.hal.env`, `policy.yaml`, `markets.yaml`, `infra/**`, `.github/**`, `CLAUDE.md`
  - gateway, policy and compliance code and its tests (`packages/core/src/**/{gateway,policy,compliance}*`, `packages/core/test/{compliance,games-compliance,no-external-fonts,game-versions}*.test.ts`)
  - `package.json`, `package-lock.json`: any dependency change is a liability item
  - `docs/superpowers/**`
- **Liability items** (spec anti-goal 1) are never built without an approval recorded in `.data/hal/approvals.json`, and the tripwires reject them in every automatic merge regardless.
- **One idea per squash commit on `main`.** Every Hal commit carries trailers: `Hal-Pass`, `Hal-Game`, `Hal-Kind`, `Hal-Why`, `Hal-Score-Before`, `Hal-Score-After`, `Hal-Version` and `Hal-Run`.
- **Every merge bumps the version and logs it,** per the spec's "Scope of change". Fixes, tuning and polish bump the patch number, features bump the minor number, and changes on the same night share one version. The `game-versions.test.ts` test must pass.
- **History images** are JPEG quality 70 at 390×844 and device scale 1 (around 40 KB), written to `docs/hal/history/<game>/<YYYY-MM-DD>/<pass>-{before,after}.jpg` in the same squash commit. The night's director's note is written to `docs/hal/history/<game>/<YYYY-MM-DD>/note.md` in one final commit per run.
- **Injected clock and IDs.** `packages/core/src/hal/` never calls `Date.now()` or `Math.random()`.

## Review Focus

1. **Spending past the cap.** This can happen through concurrent runs, a crash between a call and its spend record, or a call whose cost the CLI didn't report. Pin these:
   - the spend is recorded from the CLI's `total_cost_usd`, under the run lock, before the next call;
   - a call with no cost reported counts as its whole slice;
   - a second `run` exits "busy". Tests are in Tasks 1, 2 and 7.
2. **The key leaking or the wrong billing being used.**
   - Subscription calls must run with `ANTHROPIC_API_KEY` removed from the env.
   - API calls must have it set.
   - No log line or `.data` file contains the key.

   Tests in Task 2 assert the child env and grep every written file for the key value.
3. **Claude getting around a check.** Claude edits a test, a protected file or the hook. It adds a host, a dependency, a purchase, a countdown or a dropped level. Each tripwire has a positive and a negative test in Task 3, and Task 5's pipeline test proves a tripwire hit discards the candidate before merge.
4. **Leaving `main` broken or half-merged.**
   - A crash mid-merge, a failed squash or a failed push must leave `main` at a commit that passed every check.
   - Worktrees are always cleaned up.
   - Merges happen in Hal's own worktree of `main`, never in Brian's checkout.

   Tests in Tasks 5 and 7 use a temp git repo.
5. **The Run-now server.**
   - It must answer only to the token: without it, every route returns 404, using a constant-time compare.
   - It must not leak status or the token in error pages.
   - It must refuse a second run.
   - It serves the home network only.

   Tests in Task 8.

---

## File structure

```
packages/core/src/hal/budget.ts      daily spend ledger, slices, cap                              (Task 1)
scripts/hal/env.ts                   .hal.env parser/loader, child env per billing                 (Task 1)
scripts/hal/claude.ts                runClaude(): spawn claude -p, parse JSON, limit detection     (Task 2)
packages/core/src/hal/tripwires.ts   checkTripwires(diff) → violations                            (Task 3)
scripts/hal/git.ts                   git helpers: worktrees, diff collection, squash merge, revert (Task 3 diff; Task 5 rest)
packages/core/src/hal/release.ts     version bump, changelog entry, trailers format/parse         (Task 4)
packages/core/src/hal/gate.ts        + mode: 'score' | 'polish'                                    (Task 5)
scripts/hal/candidate.ts             one ticket: implement → tripwires → release → tests → gate   (Task 5)
packages/core/src/hal/tickets.ts     Ticket schema/validation, liability classification           (Task 6)
scripts/hal/store.ts                 .data/hal/{notes,feedback,approvals,spend}.json, atomic      (Task 6)
scripts/hal/prompts/{planner,implementer,director}.md                                             (Task 6)
scripts/hal/run.ts                   the run: lock, play, plan, candidates, note, history, push   (Task 7)
scripts/hal/server.ts                Run-now server (token), status page                          (Task 8)
scripts/hal/launchd.ts               install/uninstall the two LaunchAgents                       (Task 8)
scripts/hal/cli.ts                   + run, stop, undo, tell, notes, approve, spend, serve, install (Tasks 6-8)
```

### Task 1: Money and env (`budget.ts`, `env.ts`)

- **`parseHalEnv(text): Record<string,string>`:**
  - parses `KEY=VALUE` lines, with `#` comments, optional quotes and no interpolation;
  - throws on a malformed line, with the line number but never the value.
- **`loadHalEnv(repo)`** returns `{}` when the file is missing.
- **`childEnv(base: NodeJS.ProcessEnv, billing: 'api'|'subscription', key?: string)`:**
  - for `api`, it sets `ANTHROPIC_API_KEY`, and throws `no API key in .hal.env` if the key is absent;
  - for `subscription`, it **deletes** both `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`.
- **Budget types:**
  - `type SpendDay = { day: string /* YYYY-MM-DD local */; calls: { run: string; role: string; billing: 'api'|'subscription'; usd: number; at: string }[] }`.
  - `DAILY_CAP_USD = 20`.
  - `SLICES = { planner: 1.5, implementer: 3, director: 1 }`.
- **Budget functions:**
  - `apiSpent(day)`: the sum of api calls only;
  - `sliceFor(day, role)` = `min(SLICES[role], DAILY_CAP_USD - apiSpent)`; it returns 0 when the cap is reached, and the caller stops;
  - `recordCall(day, call)`: if a call's cost is unknown, its usd is the full slice it was given.
- **Tests:**
  - parse edge cases;
  - `childEnv` strips and sets the key correctly and never mutates `base`;
  - the cap is reached exactly at 20;
  - subscription calls don't count against the cap;
  - day rollover by local date with an injected clock.
- **Check that `.hal.env` is ignored:** add `scripts/hal/hal-env.unit.test.ts`, which runs `git check-ignore .hal.env` and expects exit 0.
- **`CLAUDE.md` note:** under hard rule 7, add the one line the spec asks for: "Local operator exception: Hal's `ANTHROPIC_API_KEY` lives in the git-ignored `.hal.env` on Brian's Mac (2026-11-11)." Hal itself may not edit CLAUDE.md. This edit is part of building Hal, which Brian approved.

### Task 2: The Claude adapter (`claude.ts`)

```ts
type ClaudeRole = 'planner' | 'implementer' | 'director';
type ClaudeCall = { role: ClaudeRole; prompt: string; cwd: string; billing: 'api'|'subscription'; maxBudgetUsd: number;
  model: string; allowedTools: string[]; disallowedTools: string[]; timeoutMs: number; appendSystemPromptFile?: string };
type ClaudeResult = { ok: boolean; text: string; costUsd: number | null; subtype: string; limitHit: boolean; timedOut: boolean; stderrTail: string };
runClaude(call, deps: { spawn, env, now }): Promise<ClaudeResult>
```
- **Arguments:**
  - always `-p`, `--output-format json`, `--max-budget-usd <n>`, `--model`, `--allowedTools ...`, `--disallowedTools ...`, `--no-session-persistence` and `--permission-mode acceptEdits`;
  - API calls add `--bare`, which never reads OAuth or the keychain, plus `--append-system-prompt-file` for the repo's CLAUDE.md;
  - subscription calls add `--strict-mcp-config` and `--setting-sources project`, so Brian's personal hooks and plugins don't run inside Hal.
- **Always disallowed:** `WebFetch`, `WebSearch`, `Bash(git push:*)`, `Bash(git remote:*)`, `Bash(curl:*)`, `Bash(wget:*)`, `Bash(npm install:*)`, `Bash(npm i:*)`, `Bash(npx:*)` (except as allowed below) and `Bash(gh:*)`.
- **Role tools:**
  - **planner:** `Read`, `Glob`, `Grep`.
  - **implementer:** `Read`, `Edit`, `Write`, `Glob`, `Grep`, `Bash(npm test:*)`, `Bash(npm run typecheck)`, `Bash(npm run hal -- score:*)` and `Bash(npx vitest run:*)`.
  - **director:** none.
- **Parsing:** parse the last JSON object on stdout. `costUsd` comes from `total_cost_usd`, or is null if absent. `ok` is `subtype === 'success' && !is_error`.
- **Limit detection:** `limitHit` is set when the text or stderr matches `/you've hit your .*limit|usage limit reached|rate limit.*subscription/i`. Before finalizing the regex, the implementer verifies it against the installed CLI's errors docs (`claude --help`, Claude Code docs "errors") and records the exact strings in a comment.
- **Timeout:** kill the process group with SIGTERM, then SIGKILL 10 s later, and return `timedOut: true`.
- **Failure scenarios.** Tests with a fake spawn cover all of these:
  - success;
  - is_error;
  - budget exceeded (`subtype` of the form `error_max_budget*`);
  - no JSON on stdout;
  - limit text;
  - timeout;
  - non-zero exit.
- **Env and key assertions:** the env and args passed to spawn are asserted for both billing modes. The key value never appears in `ClaudeResult` or in any thrown error.
- **`runClaudeWithFallback(call, deps)`:** for a subscription call with `limitHit`, retry once with billing `api` and a fresh slice. It returns both results so both can be recorded.
- **Manual verification**, recorded in the report:
  - run one real subscription call with the prompt `Reply with the word ok` and the director role;
  - paste the JSON keys you got back, without the session text.
  - Don't run a real API call.

### Task 3: Tripwires (`tripwires.ts`) and diff collection

- **Input types:**
  - `type FileChange = { path: string; status: 'A'|'M'|'D'|'R'; before: string | null; after: string | null; binary: boolean }`;
  - `type Diff = { files: FileChange[]; testCountBefore: number; testCountAfter: number; levelCounts: { before: Record<string,number>; after: Record<string,number> } }`.
- **Output:** `checkTripwires(diff): { rule: string; path?: string; detail: string }[]`. An empty result means it passed.
- **Rules.** Each is a named export so tests and the report can name them:
  - `protected-path`: any touched path matching the protected list in Global Constraints.
  - `hal-hook`: the text between `// ---- hal hook` and `// ---- end hal hook ----` in `games/gearhold/index.html` must be identical before and after.
  - `network`: added lines in `games/**` or `scripts/site/**` add any of these:
    - an `http(s)://` or `//host` URL whose host wasn't already present in that file;
    - `fetch(`, `XMLHttpRequest`, `new WebSocket`, `EventSource`, `sendBeacon` or `import(` of a URL;
    - an external `<script src>` or `<link href>`.
  - `dependency`: `package.json` or `package-lock.json` changed, or a game file adds a `<script src>` that isn't relative.
  - `payment`: added lines in `games/**` match `/purchase\.|mockBuy|PaymentRequest|stripe|paypal|braintree|\bIAP\b|\bprice\b|[$€£]\s?\d/i`.
  - `random-reward`: a file adds `Math.random` or an rng call, and in the same diff adds reward words (`/reward|loot|chest|crate|prize|gacha|pull|drop rate/i`), but adds no `odds` (the SDK odds call or a visible "odds" string).
  - `dark-pattern`: added lines in `games/**` match countdown or scarcity or nag copy (`/only \d+ left|limited time|hurry|expires in|last chance|don't miss|are you sure you want to (leave|quit)/i`), or add a `setInterval` or `setTimeout` near a word like offer, sale or deal.
  - `asset-source`: every added binary or asset file (`png jpg jpeg webp gif mp3 ogg wav woff2 woff ttf otf`, or `svg` files) must be named in a `SOURCES.md` in its own directory, with a license of `hal-generated`, `CC0`, `public domain` or `OFL-1.1`. An OFL font needs an `OFL*.txt` beside it.
  - `level-removed`: any `levelCounts.after[game] < before[game]`.
  - `tests-removed`: `testCountAfter < testCountBefore`, or a deleted `*.test.ts`.
  - `outside-scope`: any path outside the repo, or a symlink.
- **`collectDiff(worktree, base)` in `scripts/hal/git.ts`:**
  - gets files from `git diff --name-status -M base`;
  - reads before and after contents with `git show base:path` and the working tree;
  - flags binary files using `git diff --numstat` (`-` means binary);
  - gets level counts from `LEVELS.length` in Tidepool's `levels.js` and Gearhold's levels;
  - gets test counts from `npx vitest list --json` (the default project), counted before and after.
- **Tests:** every rule gets one hit and one near-miss. Two near-misses are required:
  - Hyperline's existing earned "Shop" doesn't trip `payment`;
  - an existing host in the same file doesn't trip `network`.

  `collectDiff` is tested against a temp git repo.

### Task 4: Release edits and trailers (`release.ts`)

- **`bumpKind(kind: 'fix'|'tuning'|'polish'|'feature'): 'patch'|'minor'`.**
- **`planVersion({ current, topEntryDate, night, kind, alreadyBumpedTonight })`.** If this night already has a top entry, the version stays as it is, except that a feature landing after only patch-level changes tonight upgrades the version to the next minor. Otherwise the version bumps from `current`.
- **`applyRelease(files: { yaml: string; html: string; changelog: string }, { slug, version, night, entry: { kind, text } })`** returns edited copies:
  - `version:` in game.yaml;
  - `createStudio({ … game: '<slug>', version: '…'` in index.html;
  - the changelog gets either a new `## <version> (<night>)` heading or one more bullet under tonight's.

  It throws if a file doesn't match the expected shape.
- **`undoEntry(...)`** adds the bullet `Undone: <title> (HAL-0xx): <reason>` under a new patch version. Versions never go backwards.
- **Trailers:**
  - `formatTrailers(t: HalTrailers)` and `parseTrailers(message)`;
  - the keys are listed in Global Constraints, plus `Hal-Undo` and `Hal-Reason` for undo commits;
  - values are single-line, so newlines are replaced and the result round-trips.
- **Night date:** a run that starts before 6 a.m. belongs to the previous calendar day's night. That's `nightOf(date, tzOffset)`, with the clock injected.
- **Tests:**
  - round-trip;
  - two fixes the same night share a version;
  - a fix followed by a feature becomes a minor bump;
  - undo;
  - each malformed file throws;
  - the output passes the `game-versions.test.ts` assertions. Import its checker, or reimplement the same three-way check in the test.

### Task 5: Candidate pipeline (`gate.ts` modes, `git.ts`, `candidate.ts`)

- **Gate modes:** `compareScores(before, after, opts?: { mode?: 'score'|'polish'; target?: string })`.
  - **score mode** (when a target is given): the current behaviour, a gain of at least 0.5 on the target with nothing else regressing past the tolerance.
  - **polish mode:** keep the change if no measure regresses past `GATE.tolerance` and there are no hard failures.

  Existing callers and tests stay unchanged, with the default derived from `target`.
- **Git helpers in `git.ts`.** Each one takes `{ git: (args, cwd) => Promise<{code,stdout,stderr}> }`:
  - `ensureMainWorktree(repo)` creates `.data/hal/wt/main` on `main`, and fast-forwards it from `origin/main` when fetch works;
  - `newCandidateWorktree(passId)` creates branch `hal/<pass>` from main's HEAD at `.data/hal/wt/<pass>`;
  - `squashMerge(passId, message)` runs `merge --squash`, then commit, in the main worktree. On any failure it runs `reset --hard ORIG_HEAD` and returns `false`;
  - `removeWorktree(passId)` always runs and also deletes the branch;
  - `revertPass(passId)` finds the commit by its `Hal-Pass` trailer.
- **`runCandidate(ticket, ctx): Promise<CandidateResult>`.** `CandidateResult = { pass, ticket, verdict: 'merged'|'discarded'|'skipped', reasons: string[], scoresBefore, scoresAfter, costUsd, commit?, shots? }`. The steps run in this order:
  1. Get a slice from the budget. If it's 0, the result is `skipped: budget`.
  2. Run the implementer `claude -p` in the candidate worktree, with the ticket, the implementer prompt, and the changelog text it must return as `{"changelog": "...", "summary": "..."}`. A failed result, a timeout or no edits means discard.
  3. Run `collectDiff`, then `checkTripwires`. Any violation means discard, with each rule named.
  4. Run `applyRelease` for the ticket's game, taking the version from tonight's state.
  5. Run `npm test` and `npm run typecheck` in the worktree. A failure means discard, with the tail of the output.
  6. Score the game with its scorer(s) and gate it. Gearhold runs both `gearhold` and `gearhold-play`. The ticket's `target` picks the mode. Screens and the controls check for that game must pass with no failure, no blocked request and no page error.
  7. Save the before shot (taken from main's worktree before building) and the after shot as JPEG into the history path.
  8. Commit inside the candidate worktree, then `squashMerge` with a subject `<kind>(<game>): <title>`, a body with `why`, and the trailers.
  9. Always remove the worktree.
- **Tests:** use a temp git repo and fakes for Claude and the scorer, and cover each step's failure path. Pin two things in particular:
  - a tripwire hit never reaches the merge step;
  - a squash failure leaves main at its old HEAD.

### Task 6: Tickets, notes, feedback and prompts

- **`Ticket`:** `{ id, game, kind: 'fix'|'tuning'|'polish'|'feature', title (≤80 chars), why, target?: string /* a measure name */, liability?: string, fromNote?: string }`.
- **`validateTickets(json, games, measures)`** rejects:
  - unknown games;
  - unknown measures;
  - more than 8 tickets;
  - duplicate titles;
  - a ticket that touches a protected area by its own description, for example "edit the score". This one is a heuristic.
- **`splitLiability(tickets, approvals)`:** liability tickets without an approval become calls for the report. Approved ones are built and keep their `liability` field, which is shown in the report.
- **`store.ts` (atomic JSON under `.data/hal/`):**
  - `notes.json`: `{ id, at, game|null, text, status: 'open'|'acted'|'queued'|'asked', reply? }[]`;
  - `feedback.json`: votes and undo reasons;
  - `approvals.json`: `{ item, at, by: 'brian' }[]`;
  - `spend.json`: one SpendDay per day, keeping 60 days;
  - `runs/<runId>/…`.
- **CLI commands:**
  - `npm run hal -- tell "<text>" [--game g]`;
  - `notes [--clear id]`;
  - `approve "<item>"`;
  - `spend` (today and the last 7 days, split by billing).
- **Prompts** (plain Markdown, protected):
  - **`planner.md`:**
    - **inputs:** scores, ledger markdown, the screen paths it can Read, the controls check and console errors, the changelogs, open notes (marked as Brian's direction, ranked first), recent feedback and approvals, the stagnation flags, and the remaining budget;
    - **output:** `{"tickets":[…]}` only.
    - **rules:** the CLAUDE.md hard rules, the anti-goals verbatim, "one idea per ticket", "keep each game's identity", and "prefer the measure's band over a bigger number".
  - **`implementer.md`:** one ticket, the files you may touch (games/<slug>/**, tests for the game, `docs/hal/history` is written by Hal not you), the protected list, "don't edit versions or CHANGELOG.md, Hal does", "run the tests", and the output contract.
  - **`director.md`:** the run's results, the notes and how each was handled, the stagnation flags. It returns `{"note": "<markdown>", "perGame": {slug: "<markdown>"}, "noteReplies": [{id, status, reply}]}`.
- **Tests:** ticket validation edge cases, liability split, store round-trips with atomic writes, and the CLI commands with a temp `halDir`.

### Task 7: The run (`run.ts`) and undo

- **`npm run hal -- run`.** Its flags:
  - `[--game g]...` and `[--kind k]...`;
  - `[--report-only]` (play and plan, build nothing);
  - `[--max-tickets n=6]`;
  - `[--nightly]` (API billing, push on, the default for launchd);
  - `[--no-push]`;
  - `[--billing api|subscription]`, which overrides the default.
- **Phases.** Each one is a function with injected deps:
  1. **Lock.** Write `.data/hal/run.lock` with `{pid, runId, startedAt}`. If a live pid holds it, exit 2 with "busy". If the pid is dead, take over the stale lock. Clear any old stop flag (`.data/hal/stop`).
  2. **Preflight.**
     - `ensureMainWorktree`.
     - Push permission is checked with `git push --dry-run origin main`. If that fails, the run continues with push off and the report says so.
     - Apply pending undos from `feedback.json`, using the same path as `undo`.
     - **CI follow-up:** for Hal commits from the last run, check `gh run list --commit <sha> --json conclusion`. Only `failure` triggers an undo, with the reason `CI failed`. A queued or unknown result is just reported, since CI runners can be unavailable. If `gh` is missing or not logged in, skip with a note.
  3. **Play.** Score every game in scope with every scorer, then run screens and controls once on main. Save everything to `runs/<runId>/play/`.
  4. **Plan.** Run the planner `claude -p` and validate its tickets. Liability tickets without an approval become calls. Keep at most `--max-tickets`.
  5. **Build.** Run `runCandidate` for each ticket in order. Check the stop flag and the budget between candidates. Record each one with `recordPass` in the ledger, and include its cost.
  6. **Note.** Run the director `claude -p`. Write `runs/<runId>/note.md` and each game's `docs/hal/history/<game>/<night>/note.md`, then commit them in main's worktree with the trailer `Hal-Run`. Apply `noteReplies` to `notes.json`.
  7. **Push.** Run `git push origin main` unless push is off. If it fails, report it and keep the commits local.
  8. **Report.** Write `runs/<runId>/report.json` (the schema is plan 3's input):
     - `runId`, `night`, `startedAt`, `endedAt`, `trigger`;
     - `billing`, `spend: {api, subscription}`;
     - `games: {slug: {before, after, measures}}`;
     - `changes[]` (the CandidateResults);
     - `calls[]`, `notes[]`, `pushed`, `warnings[]`.

     Also write a short `report.md`, and update `.data/hal/latest.json`.
  9. **Unlock,** always, in `finally`.
- **Stop.** `npm run hal -- stop` writes the stop flag. The run finishes the current step, skips the remaining candidates, and still writes the note and the report.
- **Undo.** `npm run hal -- undo HAL-0xx --reason "<text>"`:
  - takes the lock, then reverts the pass's commit in main's worktree;
  - applies `undoEntry` to the version and changelog, and runs `npm test`;
  - commits with the trailers `Hal-Undo` and `Hal-Reason`;
  - pushes, unless `--no-push` is given;
  - records the feedback, which the next planner sees.

  If the revert conflicts, nothing changes, it exits 1, and the reason is saved to `feedback.json` so the next run can retry.
- **Power.** launchd starts runs wrapped in `caffeinate -is`. `run` itself doesn't need it.
- **Tests:**
  - **full-run fake:** with a temp repo and fake Claude, scorers and screens, a full run merges one good ticket, discards one that trips a tripwire, and skips one when the budget runs out. All three appear in report.json with the right states.
  - **lock:** a second run while locked gives "busy".
  - **stop:** the stop flag skips the remaining candidates.
  - **undo:** produces a revert commit with the trailers and a changelog entry.
  - **report-only:** never creates a worktree.
  - **no key:** after a full fake run, a grep of `.data/hal` for a fake key value finds nothing.

### Task 8: Run now and the schedule (`server.ts`, `launchd.ts`)

- **`npm run hal -- serve`.** A Hono server on port **5180**:
  - It binds `0.0.0.0` when `--lan` is given, otherwise `127.0.0.1`, and prints the LAN URL with the token.
  - The token is `HAL_TOKEN` in `.hal.env`. `npm run hal -- setup` generates 32 random bytes as base64url and appends them if missing, then prints the bookmark URL.
  - Each request carries the token as `?t=` or as a cookie set on first use, compared with `timingSafeEqual`.
  - Any request without a valid token gets a plain `404 Not Found`, whatever the route.
- **Routes** (all behind the token):
  - `GET /`: a phone-friendly status page. It shows:
    - idle or running, with the run's phase from `run.lock`;
    - today's spend against the $20 cap;
    - the latest `report.md` rendered as escaped text;
    - **Run now** with scope options (game, report-only), and **Stop**;
    - a link to play: the dev server's games URL when it is running.

    It makes no outside requests and uses system fonts.
  - `POST /run`: starts `npm run hal -- run` detached with subscription billing (Brian-started). It returns 409 "busy" if a run is locked.
  - `POST /stop`: writes the stop flag.
  - Every POST requires the token and a same-origin `Origin` header.
- **`npm run hal -- install`** writes and loads two LaunchAgents in `~/Library/LaunchAgents/`:
  - `com.gstudio.hal.nightly.plist`: `StartCalendarInterval` Hour 1 Minute 0 (configurable with `--at HH:MM`). It runs `/usr/bin/caffeinate -is <npm> run hal -- run --nightly` with `WorkingDirectory` set to the repo, and logs to `.data/hal/logs/`. launchd runs a missed time at next wake, and the report notes the late start.
  - `com.gstudio.hal.server.plist`: `KeepAlive`, running `npm run hal -- serve --lan`.

  `uninstall` unloads and removes both. `install --dry-run` prints the plists. Paths come from `process.execPath` and the repo root, with no hard-coded user name.
- **Tests:**
  - every route returns 404 without the token or with a wrong one;
  - a wrong-length token doesn't throw;
  - POST without the same Origin header is rejected;
  - `/run` while locked returns 409;
  - the plist XML snapshot is escaped and has the right keys;
  - `setup` doesn't overwrite an existing token.

### Task 9: First real runs (manual verification; no new code unless a run exposes a bug)

1. `npm run hal -- setup` and `npm run hal -- run --report-only --billing subscription --no-push`. Check that the planner's tickets are sensible and that `report.json` and `report.md` are written. Record the spend.
2. `npm run hal -- run --game tidepool-pals --max-tickets 1 --billing subscription --no-push`. This is one real candidate on Brian's subscription. Report the ticket, the verdict, the diff summary, the version and changelog, and the history files.
3. `npm run hal -- install --dry-run`, and paste the plists. Don't load them; Brian does that with `npm run hal -- install` once he has read the report.
4. Report any bug a run exposes, fix it with a test, and re-run that step.

## What plan 3 adds next

The morning report page (published to the private claude.ai artifact, phone layout), before/after pictures, 👍 Keep and 👎 Undo wired to `undo`, the "Tell Hal" box wired to `tell`, and the per-game History pages built from git trailers and `docs/hal/history/`.
