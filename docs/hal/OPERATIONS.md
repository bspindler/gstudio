# Running Hal

Hal is the nightly polish loop. Each night it plays the games, plans a few small changes, builds and checks each one
in its own worktree, writes a note, and pushes what passed. This page is how to drive it.

**Shortcut:** `./hal.sh` at the repo root wraps the commands below and sets `TSX_DISABLE_CACHE=1` for you.
`./hal.sh` shows status, `./hal.sh run` is a standalone run in your terminal, `./hal.sh now` starts the launchd
nightly job immediately, `./hal.sh logs` follows it, and `./hal.sh restart-server` restarts the report server. `./hal.sh help` lists the rest; anything else passes
straight through to `npm run hal --`.

## What Hal touches

- Hal works only on its own ref, `refs/hal/main`, in its own worktree under `.data/hal/wt/`. It never checks out,
  commits to, or resets your branches, and it never edits your working copy.
- It pushes `refs/hal/main` to `origin main` **fast-forward only**. If origin moved in a way Hal can't fast-forward,
  it does not push, and the run turns report-only (see "Recovery").
- Everything it writes outside git is under `.data/hal/`.

## One-time setup

Add this to your shell profile (for example `~/.zprofile`). Hal must not load tsx's shared cache from the temp folder.
The nightly job and the report server already set it; hand-started runs warn without it.

```sh
export TSX_DISABLE_CACHE=1
```

Then:

```sh
npm run hal -- setup        # makes .hal.env with HAL_TOKEN, prints the morning-report bookmark for your phone
npm run hal -- install      # nightly run at 01:00 (--at HH:MM to change) and the report server, via launchd
npm run hal -- uninstall    # removes both launchd jobs
```

`install --dry-run` shows what it would write. Every run, the nightly one included, bills your Claude subscription
first and falls back to API credits only when the subscription hits a usage limit; `--billing api` forces credits.
The fallback needs `ANTHROPIC_API_KEY=...` in `.hal.env`. The key never goes anywhere else.

**Models.** The implementer, which builds the tickets and is almost all of a run's cost, runs on Sonnet. The planner
and director run on Opus. Set `HAL_IMPLEMENTER_MODEL` or `HAL_MODEL` in `.hal.env` to change either one.

## Everyday commands

```sh
npm run hal -- run --report-only   # play and plan, build nothing, push nothing: a safe look
npm run hal -- run                 # a full run now (subscription billing; --billing api to use credits)
npm run hal -- run --game gearhold --kind fix --max-tickets 2 --no-push
npm run hal -- stop                # finish the current step, skip the rest, still write the note and report
npm run hal -- undo HAL-012 --reason "felt worse"   # reverts that pass as a new version, then pushes (--no-push to keep it local)
npm run hal -- tell "more juice on Hyperline coins" --game hyperline   # a note for the planner
npm run hal -- notes               # your notes, with Hal's status and reply
npm run hal -- notes --clear N-003 # only this removes a note; until then Hal keeps seeing it
npm run hal -- approve "<item exactly as the report names it>"   # say yes to a liability item
npm run hal -- spend               # API spend today and the last 7 days
npm run hal -- serve               # the morning report on this Mac (--lan for your phone)
```

API spend is capped at $20 a day. Hal stops slicing at $19.50, so one call that overruns its slice still stays under
the cap, and it always keeps $1 back for the night's note.

## How a build scores itself

The implementer's shell runs in Claude Code's sandbox. That sandbox can't launch a browser, and its temp folder is
the one every Claude Code session on this Mac shares. So inside a build, `npm run hal -- score --game <scorer>`
doesn't score there. It asks Hal through a private request folder (`$HAL_SCORE_DIR`). Hal scores a snapshot of the
worktree as it is at that moment, with the same sandboxed check its gate runs afterwards, and hands back the per-level
results. That includes the browser-played `gearhold-play`, which takes about 30 seconds. Hal serves at most 12 scores
per build, always with the gate's defaults, and only for the ticket's own game. It refuses when the build has changed
Hal's scorer code (`scripts/hal/**`, `packages/core/src/hal/**`, `package.json`). None of this replaces the gate: Hal
scores the final tree again on its own.

### Lanternkeep (added 2026-11-13)

`lanternkeep` is scored by bot plays, not a browser: every night is played by a greedy bot in four styles (spread
wide, or 4, 6 or 8 plants grown tall) times `--seeds` placement seeds (default 4, so 16 plays a night), plus Night
Watch. It takes about 20 seconds. The game has no randomness of its own, so seeds only vary which of the bot's best
few tiles it picks. Measures, with Brian's bands from 2026-11-13 (`LANTERNKEEP_BANDS` in
`packages/core/src/hal/lanternkeep-score.ts`):

- `inBand`: nights 1-5 win at least 90% of the time (no upper limit, the opening should feel good); nights 6-15
  win between 40% and 90%.
- `noSpikes`: no night's win rate falls more than 30 points below the night before.
- `watch`: Night Watch's median wave reached is 30-60% of its 60 waves.
- `tension` (reported, not in fitness): 15-50% of a night's wins miss three stars.

A night that no style can win, that planting nothing wins, or whose paths or waves are malformed is a hard failure.
These checks live in the scorer because Hal may edit `packages/core/test/lanternkeep-*`. The bot lives in
`packages/core/src/hal/lanternkeep-bot.ts` for the same reason. Screens and controls drive the real page with
`?hal=1`, whose hook (protected like Gearhold's) only reads the page, seeds progress, and tops up gold.

`npm run hal` is `node --import tsx`, not the `tsx` command, because the tsx command opens a socket in the temp
folder, and the sandbox allows none.

## The morning report

The bookmark from `npm run hal -- setup` opens the morning report. `npm run hal -- serve` serves it (add `--lan` so
your phone can reach it). `install` keeps it running. The page shows the newest report. On a laptop the report is on
the left and a panel stays in view on the right: Run Hal, Tell Hal and the 5 newest reports. On a phone it is one
column, with Run Hal first. Run Hal updates itself while a run is going (phase, progress, Stop), with no refresh, and
says when a new report is ready. All reports (`/runs`) lists every report, 25 to a page. Long lists (planned work,
notes, warnings) show 5 and fold the rest under "Show all".

Each change has two buttons:

- **Keep** records a 👍, with an optional comment.
- **Undo** records a 👎 with your reason and starts `hal undo` right away. That reverts the change as a new version
  and pushes it (one `ci:local`, one push). Any other pending undos are applied in the same go. If Hal is busy, the
  page says "Undo queued: Hal is busy, so the next run applies it", and the next run does it.

Each liability item under Your calls has two buttons:

- **Approve** says yes. Hal builds it on its next run.
- **Leave it** says no.

**Tell Hal** is a set of threads with Hal. Start one about a game or the whole studio, or reply under the Director's
note, which starts a thread tied to that report. Each thread shows your messages and Hal's. When Hal asks you
something, the thread goes to the top, marked "Hal asked you", with a box to answer. A reply reopens the thread. Hal
reads every thread in the next run, with the whole conversation, ranks your direction above its own ideas, and
answers in the thread. It does not answer right away. A thread stays until you clear it, with Clear on the page or
`hal notes --clear`.

The next run's planner and director also read your votes and comments.

**New features wait for you.** Fixes, tuning and polish ship on their own. A new feature passes the same checks
but stays off `main`, under "Waiting for your OK" at the top of the report. **▶ Try it** opens the game as that
feature built it, in a new tab. **👍 Ship it** puts it on `main`, runs ci:local and pushes. **👎 Drop it** throws it
away (the planner reads your reason). The same from the terminal: `npm run hal -- ship HAL-0xx` or
`npm run hal -- drop HAL-0xx`. If Hal is busy, your decision is saved and the next run applies it.

**What Hal has learned.** Each night the director may write up to five lessons, short and specific things the
results showed, such as "Gearhold: moving a repair crystal fixed `supplied`" (in `.data/hal/lessons.json`). It
retires one when later results contradict it. The planner reads them all before it plans. They show on the report
under "What Hal has learned". If one is wrong, tell Hal in a thread.

**Play** opens the dev server (`npm run dev:lan`), and the dev server serves your checkout, not Hal's ref. Hal's
merges sit on `refs/hal/main` (and origin) until you pull, so run `git pull` on the Mac to play Hal's latest. When
your checkout is behind `refs/hal/main`, the report says so next to Play, with how many Hal commits you are missing.

### History

On the shelf (`npm run dev`), each game has a History button. It shows, night by night, what changed and why, with
the pictures. Each change shows its status: kept, undone (with your reason), or reverted later by you. It also shows
your own commits, scores over time, search and filter, and a permalink for each change. It is built from git
(`docs/hal/history/` plus commit trailers), so it survives a wiped `.data/`. A night where nothing merged for a game
still shows its director's note. Commits by the repo's `git config user.name` say "Yours"; anyone else's show their
name.

The History pages have no token. With `npm run dev:lan`, anyone on your Wi-Fi can read them. They show only what is
already in git, but that includes your undo reasons and the director's notes.

### Where the files live

- `.data/hal/runs/<run id>/report.md`: the night's report (changes, your calls, replies to your notes, warnings).
  `report.json` beside it is the same data.
- `.data/hal/latest.json` points at the newest report. The morning report page shows it too.
- `.data/hal/runs/<run id>/note.md`: the director's note. The per-game notes, `scores.json` and before/after pictures
  are committed under `docs/hal/history/<game>/<night>/`.
- `.data/hal/logs/nightly.log` and `server.log`: the launchd jobs' output.

## Recovery

**A failing build is Hal's to fix, not yours.** Two places catch one:

- *While building a change.* If the full `npm test` or `npm run typecheck` fails on the implementer's change, Hal hands
  the failure output back to the implementer for up to 2 fix rounds, each with its own budget slice. The implementer
  has to fix the cause and add a test that would have caught it, and it may not weaken or delete tests (Hal counts
  them). Every round goes through all the checks again. Only a change still failing after the last round is
  discarded, and the report says how many rounds it had.
- *Before pushing.* If ci:local fails on Hal's branch, Hal runs it again. A pass means a flaky test, and Hal pushes. If
  origin/main fails ci:local as well, the problem is not Hal's, so it waits. That is the one case the report flags for
  you. Otherwise Hal finds the first of its own commits that fails, undoes it the way a 👎 does, checks again and
  pushes the rest. The game's changelog says only that the change "failed an automated check". The full failure goes
  into the undo's record in `feedback.json`, so the next night's planner can retry the ticket with a fix.
  Each commit is checked twice before Hal blames it, at most 8 unpushed commits are checked, and an undo that does not
  make ci:local pass is taken back rather than shipped. A manual `hal undo` never triages: it only undoes what you
  asked for. A test that fails only sometimes can still get through on the re-run; the report names the first failure,
  so a flaky test shows up there.

**origin/main moved while Hal had unpushed commits.** This happens after a `--no-push` run, or a night whose push
failed, when someone then pushes to origin. Hal handles it itself at the start of the next run. It rebuilds its own
commits on top of origin/main with git plumbing (no checkout, no hooks), runs ci:local on the result, and only then
moves `refs/hal/main` there. The report says so in a warning. The changes are the same but the SHAs are new, and the
commits are still not on origin until Hal pushes. 👎 still works, because undo finds a change by its `Hal-Pass` trailer.

**"refs/hal/main and origin/main have diverged and Hal could not replay its commits".** One of Hal's commits conflicts
with origin, or ci:local failed on the replay. The warning says which. Hal runs report-only until you fix it, and its
commits are untouched. **They are not on origin/main**, so do not just reset. To keep them, replay them yourself:

```sh
git fetch origin
git log origin/main..refs/hal/main          # what Hal has that origin lacks
git worktree add --detach /tmp/hal-fix origin/main
cd /tmp/hal-fix && git cherry-pick <oldest>^..<newest>   # resolve, git cherry-pick --continue
npm run ci:local -- HEAD
git update-ref refs/hal/main HEAD <old refs/hal/main>     # compare-and-swap from the ref you replayed
```

Only if you don't want Hal's commits at all, point its ref back at origin. This discards them:

```sh
git update-ref refs/hal/main origin/main
```

**"trust root modified".** Something changed `node_modules` during a pass. Hal stopped building and did not push.
Reinstall before the next run:

```sh
npm ci
```

**A run that died.** A stale `.data/hal/run.lock` is taken over automatically once its process is gone. `hal stop`
followed by a fresh `hal run` is always safe.
