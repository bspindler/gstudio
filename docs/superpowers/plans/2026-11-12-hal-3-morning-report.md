# Hal plan 3: the morning report, votes and undo, Tell Hal, and per-game History — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brian spends ten minutes a morning on his phone. He reads the director's note, taps Play, sees where each game stands, taps 👍 Keep or 👎 Undo on each change Hal made that night (with an optional comment), answers "your calls", and tells Hal anything in a free-form box. Every change is recorded and the next run reads it. Separately, each game on the GStudio shelf gets a **History** page that rebuilds from git: night by night, with pictures, scores over time, search and filter, and a permalink per change.

**Architecture:**
- **The morning report is the existing token-gated Run-now server (`scripts/hal/server.ts`, port 5180), grown into the report page.** Votes, undos and notes reach the Mac directly as same-origin form POSTs into `.data/hal/`. The page is server-rendered HTML with no JavaScript (the CSP keeps `default-src 'none'`), so it works on any phone browser and there is nothing client-side to break.
- **Pure rendering and history logic in testable modules.** `packages/core/src/hal/history.ts` turns git commits into a per-game history (pure). `scripts/hal/report-page.ts` and `scripts/hal/history-page.ts` turn data into HTML strings (pure). Routes and git reads are thin wrappers around them.
- **History is served by the dev server (`npm run dev`, port 5174) next to the shelf**, read-only, from `git log` over `HEAD` and `refs/hal/main`, plus the files Hal commits under `docs/hal/history/<game>/<night>/`. It needs no token, because it only shows what is already in the repo, and it is bound to localhost unless `npm run dev:lan` is used, like the games.
- **A 👎 undoes the change the same morning:** the server records it, then starts `hal undo <pass>` if no run is going. Otherwise the next run's preflight applies it, which plan 2b already does.

**Tech Stack:** TypeScript strict, ESM, Node 22, vitest, Hono (already used), git CLI. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-11-hal-nightly-polish-design.md`, sections "4. The morning report" and "5. Game history", "Learning from Brian" (goal 5), and "Calls I made" (Run now, publishing the report). The look follows Brian's mockup (claude.ai artifact WyVFRgBt7gsedSiTixHZA9): one narrow column, director's note first, then Play, "Where each game stands", the change cards, "Your calls", "Tell Hal", and the collapsed fix list. The palette is the mockup's tokens (light and dark).

## Global Constraints

- **No outside requests from any page.** No Google Fonts (the mockup used them; use the system stack `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif` for body text, and for headings the same stack at weight 700). CSP on report pages: `default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'`. The History pages get the same CSP.
- **No JavaScript on the report or History pages.** Forms, links, `<details>` and query strings only.
- **Phone first:** a `max-width: 520px` column, a side gutter of `max(16px, env(safe-area-inset-*))`, no horizontal scroll at 360 px wide, tap targets at least 44 px tall, `font-size: 16px` on inputs (no iOS zoom). Light and dark via `prefers-color-scheme`.
- **Token gate unchanged:** every report route goes through the existing middleware: the bare 404 without the token, `?t=` on GET only, the cookie, and a same-origin `Origin` check on POST. The token is never rendered.
- **Validate everything a form sends against the run's own `report.json`:**
  - a vote or undo must name a pass that the run merged;
  - an approval must name a liability item exactly as that run's `calls` list has it;
  - `game` must be a known slug or empty;
  - text is trimmed and capped at 2000 characters; reasons and comments are one line, capped at 500;
  - anything else returns 400 with no change.
- **Arguments to spawned commands are never parsed as flags.** The undo reason goes as `--reason=<text>` (one argv element), and the pass id must match `^HAL-\d+$`.
- **Old reports still render.** Every field added in this plan (`perGame`, `planned`, `Vote.comment`) is optional when read; a report from before this plan shows without it.
- **Hal's protected paths are unchanged.** This plan only adds files under `scripts/hal/`, `packages/core/src/hal/` and `packages/core/test/hal-*`, all already protected from Hal's own edits.
- **Not part of any game build.** `npm run build:pages` output must not contain `_history` or a History link (a test pins this).

## Review Focus

1. **A 👎 tapped while a run is going, or tapped twice.** Expected: the first one records a pending undo and the page says "Undo queued: the run in progress finishes first". The second shows the existing state and adds nothing. No second `hal undo` starts. (Task 4 tests both.)
2. **A report from before this plan, or a report-only run with no changes.** Expected: the page renders the note, the scores and the planned list, and shows no empty sections or crashes. (Task 3 renders a fixture without `perGame` or `planned`, and one with only `planned`.)
3. **Hostile text in a reason, note or commit message,** such as `<script>`, `--no-push`, 10 kB of text or newlines. Expected: it is escaped in HTML, capped, flattened to one line where it is one line, and never becomes a flag. (Tasks 3, 4 and 5.)
4. **Brian reverts a Hal commit by hand with `git revert`.** Expected: History shows that change as "reverted later (by you)". Brian's own commits show as his, and Hal's director's-note commits never show as changes. (Task 1.)
5. **A history image path that isn't one Hal wrote,** for example `..`, an absolute path, another game, or a symlink. Expected: 404. Only `docs/hal/history/<game>/<YYYY-MM-DD>/<HAL-n>-(before|after).jpg` is ever read, and it is read from git, never from disk. (Tasks 4 and 5.)

---

## Execution order

Tasks 1, 2 and 3 share no files and can run in parallel. Task 4 needs 2 and 3. Task 5 needs 1 and 2 (the `scores.json` format). Task 6 runs last.

### Task 1: Per-game history from git (pure)

**Files:**
- Create: `packages/core/src/hal/history.ts`
- Modify: `packages/core/src/hal/index.ts` (re-export)
- Test: `packages/core/test/hal-history.test.ts`

**Interfaces:**
- Consumes: `parseTrailers`, `nightOf`, `ChangeKind` from `release.ts`.
- Produces:
  ```ts
  export type CommitRecord = { sha: string; author: string; date: string /* ISO */; message: string };
  export type ChangeStatus =
    | { kind: 'kept' }
    | { kind: 'undone'; by: 'hal'; reason: string; commit: string; version: string }
    | { kind: 'reverted'; commit: string; date: string };
  export type HistoryEntry =
    | { type: 'hal'; sha: string; pass: string; game: string; kind: ChangeKind; title: string; why: string;
        version: string; run: string; night: string; scoreBefore: number; scoreAfter: number; status: ChangeStatus;
        shots: { before?: string; after?: string } }
    | { type: 'brian'; sha: string; night: string; title: string; author: string; date: string };
  export type HistoryNight = { night: string; entries: HistoryEntry[] };
  export function buildHistory(game: string, commits: CommitRecord[], files: string[], tzOffsetMinutes: number): HistoryNight[];
  export type HistoryFilter = { q?: string; kind?: ChangeKind | 'brian'; status?: 'kept' | 'undone' };
  export function filterHistory(nights: HistoryNight[], f: HistoryFilter): HistoryNight[];
  ```
  `files` is the list of repo paths under `docs/hal/history/<game>/` (from `git ls-tree`). It is used to attach shots: `docs/hal/history/<game>/<night>/<pass>-before.jpg`.

- [ ] **Step 1: Write the failing tests**, in `packages/core/test/hal-history.test.ts`, with commit fixtures built with `formatTrailers` so they match real Hal commits:
  - `hal change is an entry with its trailers, title from the subject after "<kind>(<game>): ", status kept`
  - `a Hal-Undo commit marks its pass undone with Hal-Reason and the undo's Hal-Version, and is not itself an entry`
  - `"This reverts commit <sha>" in a commit body marks that Hal change reverted (date of the revert), and the revert shows as a brian entry`
  - `"docs(hal): director's note" commits (Hal-Run trailer, no Hal-Pass) are never entries`
  - `a commit with no Hal trailers is a brian entry, title = subject`
  - `entries for another game (Hal-Game) are dropped`
  - `nights newest first, entries in a night newest first; night of a hal entry = nightOf(commit date, tz)`
  - `shots attached only when the file is in files`
  - `filterHistory: q matches title/why/pass case-insensitively; kind; status undone includes reverted; empty nights dropped`
- [ ] **Step 2: Run them to verify they fail.** Run `npx vitest run packages/core/test/hal-history.test.ts`. Expected: FAIL, because the module isn't found.
- [ ] **Step 3: Implement `history.ts`.** Two passes: first collect the undos and reverts by target, then the entries. A reverted SHA is matched by a full or 7+ character prefix.
- [ ] **Step 4: Run the tests to verify they pass.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(hal): per-game history model from git commits`.

### Task 2: Data the report and History need

**Files:**
- Modify: `scripts/hal/run.ts`, `scripts/hal/store.ts`
- Test: `scripts/hal/run.unit.test.ts`, `scripts/hal/store.unit.test.ts`

**Interfaces:**
- Produces:
  - `RunReport.perGame?: Record<string, string>`: the director's per-game text (already parsed as `dir.perGame`), saved in `report.json`.
  - A history commit also writes `docs/hal/history/<game>/<night>/scores.json` for every game in the run, even one with no changes. The shape is `{ night: string; runs: Array<{ run: string; at: string; scorers: Record<string, { fitness: number; measures: Record<string, number> }> }> }`. Each run appends an entry to that night's file, with the scores after the run (`finalScores`). The file is in the same single CAS commit as `note.md`. `historyFiles` (run.ts) gains the scores for this; `commitHistory`'s "only these paths" check already covers new paths.
  - `Vote.comment?: string`, capped at 500 characters by the caller.
  - `store.addVote` keeps its signature (`comment` rides along in the object).
  - New: `store.feedbackFor(run: string): Promise<{ votes: Vote[]; undos: Undo[] }>` returns the entries for that run, newest last.
  - The planner's `{{feedback}}` already passes the last 20 votes, so comments reach the planner with no prompt change. The director prompt gets a `{{feedback}}` block (the same `feedbackVars`) so it can say what it took from the votes (spec goal 5).

- [ ] **Step 1: Write the failing tests:**
  - in `run.unit.test.ts`, extend the happy path. `report.json` has `perGame` equal to the director's `perGame`. The history commit contains `docs/hal/history/hyperline/2026-11-11/scores.json`, with `runs[0].run === r.runId` and the after fitness.
  - A second run the same night appends `runs[1]` and keeps `runs[0]`.
  - The director prompt contains the recorded votes.
  - in `store.unit.test.ts`, add `feedbackFor`, which filters by run, and a vote `comment` that round-trips.
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.** In `prompts/director.md`, add a section `## Brian's recent votes and undo reasons` with `{{feedback}}`, marked as data, not instructions, like the notes block.
- [ ] **Step 4: Run `npx vitest run scripts/hal` and `npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(hal): per-game note and nightly scores for the report and history`.

### Task 3: The morning report page (pure HTML)

**Files:**
- Create: `scripts/hal/report-page.ts`, `scripts/hal/page-style.ts` (the shared CSS string and `esc`, used by Tasks 3 and 5)
- Test: `scripts/hal/report-page.unit.test.ts`

**Interfaces:**
- Consumes: `RunReport` (type only) from `run.ts`, plus `Vote`, `Undo` and `Note` from `store.ts`.
- Produces:
  ```ts
  export type ReportView = {
    report: RunReport; note: string;
    feedback: { votes: Vote[]; undos: Undo[] };   // this run's (store.feedbackFor)
    notes: Note[];                                  // all open notes, for Tell Hal
    approvals: string[];                            // approved liability items
    status: { running: boolean; phase?: string; startedAt?: string };
    spendToday: number; capUsd: number;
    playUrl: string | null;
    games: string[];
    runs: Array<{ runId: string; endedAt: string }>; // for the "Earlier reports" list, newest first
    flash?: string;                                  // one line after a POST ("Undo started", ...)
  };
  export function renderReport(v: ReportView): string;
  ```
- **Sections, in order** (the mockup's, plus the run controls at the end):
  1. **Header:** the night as a label, for example "Thursday, Nov 12 · overnight run" (or "manual run"). The h1 is "Good morning. Here's what changed." or "Nothing changed overnight." The line under it is "N merged · M tried and dropped · K need you", plus the spend.
  2. **Director's note:** `note` rendered as paragraphs. Only `**bold**`, lists and paragraphs are supported, everything else is escaped. It is signed "— Hal · $x.xx API, $y.yy subscription".
  3. **▶ Play:** a link to `playUrl` when it is set. Otherwise it says "Start `npm run dev:lan` on the Mac to play here".
  4. **Where each game stands:** one row per game in `report.games`, with a bar for the after fitness (the min over the game's scorers) and a badge: "Improving" (after > before), "Healthy" (all 100), "Slipped" (after < before), "Steady" otherwise. The why is `perGame[game]` when present.
  5. **Changes:** one card per merged change whose kind is `feature`, `polish` or `tuning`. A card has:
     - the title, the `summary` or the changelog line, and the version;
     - the before/after images (`/shot?run=&pass=&which=before|after`) when the change has `shots`;
     - the score change;
     - a Keep form (`POST /vote`) and an Undo form (`POST /undo`), each with a one-line optional comment field (for Undo, the comment is the reason);
     - its state from `feedback`: "Kept ✓", "Undo queued", "Undone in v0.2.2", or "Undo failed: <error>". Once it has a state, the buttons become a one-line state with "change" (a `<details>` with the forms).
  6. **Your calls:** one card per `report.calls` item, with Approve (`POST /approve`) and Leave it (`POST /decline`, which records a down vote on the item). An approved item shows "Approved; Hal builds it next run".
  7. **Tell Hal:** a form (`POST /tell`, with `game` as a select of "The whole studio" or each game, and `text` as a textarea). Below it is each open note with its status and Hal's reply, and a Clear button (`POST /notes/clear`).
  8. **What got fixed (n):** a `<details>` list of the merged `fix` changes, each with its own small Undo form and state.
  9. **Tried and dropped (n):** a `<details>` list of the discarded and skipped changes with their reasons (max 300 characters each). It has no buttons.
  10. **Planned, not built (n):** shown only when `report.planned` is non-empty (for example on a report-only run).
  11. **Warnings:** shown only when there are any.
  12. **Run Hal:** the existing status line, the spend, the Run now form (game select, report-only) and Stop. Below it, "Earlier reports" links to `/runs/<id>` (the 10 newest).
- Every form has a hidden `run` (and `pass` where needed). Every user and Claude string goes through `esc`.

- [ ] **Step 1: Write the failing tests.** Fixtures: a full report (2 cards, 1 fix, 1 discarded, 1 call, 1 note) and the two from Review Focus 2.
  - `sections appear in order` (index of each section heading)
  - `a merged tuning change is a card with Keep and Undo forms carrying run and pass; a fix is in the collapsed list with Undo`
  - `card shows Kept ✓ after an up vote, Undo queued / Undone in vX / Undo failed: e from undos`
  - `images only when shots exist; src is /shot?run=..&pass=..&which=before`
  - `a call has Approve and Leave it; an approved call says so`
  - `Tell Hal lists open notes with status and reply and a Clear form per note`
  - `old report (no perGame, no planned) renders without those parts; report-only with only planned shows Planned, not built and "Nothing changed overnight."`
  - `escapes <script> in a note, title, reason and director text; director **bold** becomes <strong>`
  - `no <script, no http(s):// URL other than playUrl, viewport meta present, no inline style width over 520px`
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement** `renderReport` and `page-style.ts`. Use the mockup's tokens (`--bg #f3f6f7`, `--surface #fff`, `--fg #14232b`, `--muted #5b6d76`, `--line #dbe4e8`, `--accent #0f7c8c`, `--good #2f8a4e`, `--warn #b5701a`, and their soft and dark variants as in the mockup) with the system fonts.
- [ ] **Step 4: Run the tests to verify they pass.**
- [ ] **Step 5: Commit** `feat(hal): morning report page`.

### Task 4: Report routes, votes, same-morning undo

**Files:**
- Modify: `scripts/hal/server.ts`, `scripts/hal/cli-ops.ts` (only if `serve` needs the new deps)
- Test: `scripts/hal/server.unit.test.ts`

**Interfaces:**
- Consumes: `renderReport` (Task 3), `store.feedbackFor` and `Vote.comment` (Task 2), and the existing `createStore`, `SpawnRun` and lock helpers.
- Produces, all behind the existing token middleware:
  - **Pages:**
    - `GET /` renders the report for `latest.json`. With no report yet, it shows the Run Hal section only.
    - `GET /runs/:id` renders that run's report (`store.runDir` validates the id).
    - `GET /shot?run&pass&which` returns the image for that change, via `git show <commit>:<path>` through `execFile` (no shell). It needs a merged change and `which` in {before, after}. The path must match `^docs/hal/history/[a-z0-9-]+/\d{4}-\d{2}-\d{2}/HAL-\d+-(before|after)\.jpg$` and the game must be the change's game. It is served as `image/jpeg` with `Cache-Control: private, max-age=86400`, and anything else gets a 404.
  - **Votes and undo:**
    - `POST /vote {run, pass, comment?}` records an up vote for a merged pass.
    - `POST /undo {run, pass, reason?}`:
      - if this run already has a pending or done undo for that pass, it does nothing;
      - otherwise it records a down vote and `addUndo({ run, pass, reason: reason || 'no reason given', status: 'pending' })`;
      - when no run is live, it spawns `['undo', pass, `--reason=${reason}`]` with the log in `logs/undo-<stamp>.log`.
      - The flash says "Undo started", or "Undo queued: the run in progress finishes first".
  - **Calls:**
    - `POST /approve {run, item}` requires `item` to be in that run's `calls` liabilities. It calls `store.addApproval(item)`.
    - `POST /decline {run, item}` records a down vote with the item.
  - **Tell Hal:**
    - `POST /tell {game, text}` calls `store.addNote`.
    - `POST /notes/clear {id}` calls `store.clearNote`.
  - Every POST redirects 303 to `/` (or `/runs/:id` when `run` isn't the latest) with the flash in a short-lived cookie, never in the URL.
  - `/run` and `/stop` are unchanged.
  - `ServerDeps.git?: (args: string[]) => Promise<Buffer>` is injected for `/shot`. The default runs `git -C <repo>`.

- [ ] **Step 1: Write the failing tests** with `app.request`:
  - `GET / without token is the bare 404; with cookie renders the report (contains "Director's note" and a card)`
  - `POST /vote records an up vote with comment; unknown pass or a discarded pass is 400 and records nothing`
  - `POST /undo when idle records pending undo and spawns exactly ['undo','HAL-003','--reason=felt worse']`
  - `POST /undo while a run is live records it, spawns nothing, flash says queued`
  - `POST /undo twice: second records nothing and spawns nothing`
  - `a reason "--no-push" stays inside --reason=; a 10 kB reason is capped to 500; newlines flattened`
  - `POST /approve with an item not in calls is 400; with the exact item adds the approval`
  - `POST /tell with unknown game is 400; empty text 400; ok adds a note; /notes/clear removes it`
  - `GET /shot serves the jpeg bytes from the injected git; ../, other game, wrong pattern, discarded pass all 404`
  - `GET /runs/..%2f and bad ids 404`
  - `POST without same-origin Origin is 403 (existing)`
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.** Move the current `/` HTML into `renderReport`'s Run Hal section. Keep `tokenOk`, the middleware and `secure` as they are, but widen the CSP with `img-src 'self'`.
- [ ] **Step 4: Run `npx vitest run scripts/hal` and `npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(hal): report routes, votes, same-morning undo, Tell Hal`.

### Task 5: History pages on the shelf

**Files:**
- Create: `scripts/hal/history-git.ts` (reads git), `scripts/hal/history-page.ts` (pure HTML), `scripts/hal/history-routes.ts` (`mountHistory`)
- Modify: `scripts/dev.ts` (mount it and inject the History flag), `scripts/site/index.html` (a History link per card when the flag is set)
- Test: `scripts/hal/history-page.unit.test.ts`, `scripts/hal/history-routes.unit.test.ts` (temp git repo), plus a Pages test in `scripts/hal/history-routes.unit.test.ts` that runs the `pagesIndexHtml` from `@studio/core` and checks for no `_history`

**Interfaces:**
- Consumes: `buildHistory` and `filterHistory` (Task 1), and the `scores.json` shape (Task 2).
- Produces:
  - `readGameHistory(repo: string, game: string): Promise<{ nights: HistoryNight[]; notes: Record<string, string>; scores: Array<{ night: string; run: string; scorers: Record<string, { fitness: number; measures: Record<string, number> }> }> }>`:
    - reads `git log --format=%H%x00%an%x00%aI%x00%B%x1e HEAD refs/hal/main -- games/<game> docs/hal/history/<game>`, leaving out `refs/hal/main` when it doesn't exist;
    - takes `git ls-tree -r --name-only <tip> docs/hal/history/<game>`, where the tip is `refs/hal/main` if it contains `HEAD`, else `HEAD`;
    - reads `note.md` and `scores.json` per night with `git show`.
    - It uses `execFile` only, and takes `game` from the shelf's slug list, never as free text.
  - `renderHistory(v: { game: string; title: string; nights: HistoryNight[]; notes: Record<string, string>; scores: ...; filter: HistoryFilter; focus?: string }): string`:
    - **header:** the game title, "History", and a link back to the shelf.
    - **filter form:** GET with `q`, `kind` and `status`.
    - **score over time:** one inline-SVG line per measure from `scores` (the last run of each night), 0–100, labelled. With fewer than 2 nights it says "Scores over time appear after two nights".
    - **nights**, newest first. Each night has the director's note for that game (collapsed after the first 3 nights), then its entries:
      - a Hal change shows the title, why, kind, version, score change, before/after images, status ("Kept", "Undone: <reason>", "Reverted later (by you)") and a permalink `#<pass>` (`id` on the entry);
      - a Brian entry shows "Yours", the subject and the date.
    - `focus` (from `/_history/<game>/<pass>`) renders just that entry, with a link to the full page.
  - `mountHistory(site: Hono, o: { repo: string; games: Array<{ slug: string; title: string }> })` serves:
    - `GET /_history/:game`;
    - `GET /_history/:game/:pass` (`^HAL-\d+$`);
    - `GET /_history/:game/img/:night/:file`, where `night` is `^\d{4}-\d{2}-\d{2}$` and `file` is `^HAL-\d+-(before|after)\.jpg$`, read via `git show <tip>:docs/hal/history/<game>/<night>/<file>`.
    - An unknown game gets 404. Each response gets the page CSP and `Cache-Control: no-store` (images get `max-age=86400`).
  - In `scripts/dev.ts`, call `mountHistory(site, ...)` before the static `/*`, and replace `/*__HISTORY__*/false` in the shelf HTML with `true`. In `scripts/site/index.html`, `const HISTORY = /*__HISTORY__*/false;` adds an `<a class="alt" href="/_history/${slug}">History</a>` to each card when it is true.

- [ ] **Step 1: Write the failing tests:**
  - page: `renders nights newest first with the note above entries`, `status texts`, `permalink ids`, `focus shows one entry`, `filter form keeps its values`, `svg line per measure; fewer than 2 nights shows the placeholder`, `escapes commit subjects and notes`, `no <script, no external URLs`
  - routes (a temp repo with two Hal commits made with `formatTrailers`, one Hal undo, one plain commit, and history files):
    - `GET /_history/hyperline lists both nights`;
    - `?status=undone shows only the undone`;
    - `/_history/hyperline/HAL-002 focuses`;
    - `img route serves the committed bytes`;
    - `img traversal / bad names / other game 404`;
    - `unknown game 404`;
    - `works with no refs/hal/main`.
  - pages: `pagesIndexHtml output has no "_history"`, and `scripts/site/index.html served without the flag has no History link`.
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npx vitest run scripts/hal` and `npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(hal): per-game History pages on the shelf`.

### Task 6: Docs and a real look

**Files:**
- Modify: `docs/hal/OPERATIONS.md` (the "Where reports live" section: the report page, voting, undo from the phone, Tell Hal, History)

- [ ] **Step 1: Update OPERATIONS.md.** It should cover:
  - the bookmark opens the morning report;
  - what Keep, Undo, Approve and Leave it do;
  - an Undo while a run is going waits for it;
  - notes stay until cleared;
  - History is on the shelf (`npm run dev`).
- [ ] **Step 2: Real look, by the controller, not a subagent.**
  - Run `npm run hal -- serve` against the four real reports in `~/src/games/.data/hal/runs/` (copied there earlier), then screenshot `/` at 390×844 and at 360 px wide with the repo's Playwright, in light and dark.
  - Run `npm run dev` and screenshot `/_history/gearhold`.
  - Check there is no horizontal scroll, that the pictures load, and that the forms post (Keep on HAL-003 in a scratch `.data` copy, not the real one).
- [ ] **Step 3: Run `npm run ci:local`.** Expected: passes.
- [ ] **Step 4: Commit** `docs(hal): morning report and history`.

## Not in this plan (rulings, for Brian to check)

- **Clips.** The spec mentions before/after "pictures or a clip". Hal 2b only captures pictures, and adding video capture to the candidate checks is a pipeline change with its own review surface. The cards and History are built so a `clip` can sit next to `shots` later.
- **Publishing the report to the private claude.ai artifact.** That was a call I made in the spec, not Brian's. A claude.ai page can't reach the Mac, so votes made there would never arrive. The token-gated page on the Mac is where 👍/👎 actually works, so this plan makes that the report and drops the artifact step.
- **Before/after pictures of later levels.** The shots always show the start of level 1 (seen in the first live run). Choosing the shot per ticket belongs to the candidate pipeline, so it is a follow-up.
