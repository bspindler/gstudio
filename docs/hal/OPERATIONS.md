# Running Hal

Hal is the nightly polish loop. Each night it plays the games, plans a few small changes, builds and checks each one
in its own worktree, writes a note, and pushes what passed. This page is how to drive it.

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

`install --dry-run` shows what it would write. The nightly run always bills API credits, so it needs
`ANTHROPIC_API_KEY=...` in `.hal.env`; without it the nightly run makes no Claude calls. Runs you start use your
subscription first. The key never goes anywhere else.

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

`npm run hal` is `node --import tsx`, not the `tsx` command, because the tsx command opens a socket in the temp
folder, and the sandbox allows none.

## The morning report

The bookmark from `npm run hal -- setup` opens the morning report. `npm run hal -- serve` serves it (add `--lan` so
your phone can reach it). `install` keeps it running. The page shows the newest report. Earlier reports links to past
ones.

Each change has two buttons:

- **Keep** records a 👍, with an optional comment.
- **Undo** records a 👎 with your reason and starts `hal undo` right away. That reverts the change as a new version
  and pushes it (one `ci:local`, one push). Any other pending undos are applied in the same go. If Hal is busy, the
  page says "Undo queued: Hal is busy, so the next run applies it", and the next run does it.

Each liability item under Your calls has two buttons:

- **Approve** says yes. Hal builds it on its next run.
- **Leave it** says no.

**Tell Hal** sends a note aimed at one game or the whole studio. Hal reads your notes every run, ranks them above its
own ideas, and replies in the director's note. A note stays until you clear it, with Clear on the page or
`hal notes --clear`.

The next run's planner and director also read your votes and comments.

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

**"refs/hal/main and origin/main have diverged".** Someone pushed to origin while Hal had commits it had not pushed.
Hal runs report-only until you fix it. First see what Hal has that origin doesn't, and keep anything you want:

```sh
git fetch origin
git log origin/main..refs/hal/main
```

Then point Hal's ref back at origin. The next run starts from there:

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
