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
The nightly job and the Run-now page already set it; hand-started runs warn without it.

```sh
export TSX_DISABLE_CACHE=1
```

Then:

```sh
npm run hal -- setup        # makes .hal.env with HAL_TOKEN, prints the Run-now bookmark for your phone
npm run hal -- install      # nightly run at 01:00 (--at HH:MM to change) and the Run-now server, via launchd
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
npm run hal -- serve               # the Run-now page on this Mac (--lan for your phone)
```

API spend is capped at $20 a day. Hal stops slicing at $19.50, so one call that overruns its slice still stays under
the cap, and it always keeps $1 back for the night's note.

## Where reports live

- `.data/hal/runs/<run id>/report.md`: the night's report (changes, your calls, replies to your notes, warnings).
  `report.json` beside it is the same data.
- `.data/hal/latest.json` points at the newest report. The Run-now page shows it too.
- `.data/hal/runs/<run id>/note.md`: the director's note. The per-game notes and before/after pictures are committed
  under `docs/hal/history/<game>/<night>/`.
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
