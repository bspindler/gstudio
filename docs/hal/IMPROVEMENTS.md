# Hal: known weaknesses and improvements

From the review on 2026-11-12, after Hal's first full day. Most important first. Each entry: what is weak, why it
matters, what would fix it. Mark an entry done with a date and a commit when it ships.

## 0. Run cost (urgent)

**Weak:** a run's Claude spend is almost all implementer calls (17 calls, $10.51 of $11.93 over the first 5 runs,
88%). Every role runs on Opus. Runs started from the page bill the subscription (no money, but weekly quota);
the nightly run bills the API, up to the $20/day cap, which is about $600 a month at the cap. Two of today's six
implementer calls in the last run were aimed at the wrong level, and two others hit guardrails: money spent on
tickets that could not succeed.
**Fix:** a cheaper model per role (the implementer above all), a lower nightly cap, fewer tickets per night, and
not paying for tickets that are doomed (better diagnosis before building; see 3).
**Done 2026-11-12 (partly):** the implementer runs on Sonnet (half Opus's price) and the planner and director stay on
Opus; every run, nightly included, bills the subscription first. Still open: a lower API cap, fewer tickets, and
less spend on doomed tickets. Watch the first nights' dropped list in case Sonnet builds drop more often.

## 1. It improves numbers, not fun

**Weak:** every score is a bot measuring whether levels sit in a healthy band (win rate, pace, deaths). It catches
broken and unfair levels but cannot tell dull from delightful. At 100 the gate only checks nothing broke, so "is it
better?" rests entirely on the morning review.
**Fix:** at least one measure aimed at fun rather than balance, such as near-misses and close finishes (tension),
variety of challenges in a level or sector, or decisions per minute.
**Done 2026-11-12 (tension, Tidepool and Gearhold):** `tension` = how often a level's wins are close finishes
(Tidepool: at most 2 moves left, or a tenth of the moves; Gearhold: 35 health or less), healthy at 15-50%. It is a
measure (targetable, gated against falling) but not in fitness yet, so earlier nights still compare. On day one:
Tidepool 39 (6 of 29 levels in band), Gearhold 0 (every bot win ends at 60-99 health). Still open: Hyperline
(its bot doesn't track near-misses), variety, and folding tension into fitness once its bands are trusted.

## 2. It ships first and asks later

**Weak:** changes reach `main` (and players) before a person has looked, and the review is a screenshot plus a
score, not a play session. Fine for a moved crystal; risky for a whole new level or sector nobody has played.
**Fix:** tuning, polish and fixes ship as now; new features are held on their own branch until a 👍, then
shipped (or dropped on 👎).
**Done 2026-11-12:** features are built last and kept at `refs/hal/held/HAL-xxx`. The report's "Waiting for your
OK" has ▶ Try it (the held game served straight from its commit, with no network and no form posts), 👍 Ship it
(`hal ship`: replayed onto main, ci:local, pushed) and 👎 Drop it (`hal drop`). A decision made while Hal is busy is
applied by the next run. A held feature that no longer applies is dropped, and the planner is asked to rebuild it.

## 3. The learning is shallow

**Weak:** memory is the last 20 votes, the last 10 undos, open threads and a simple stagnation flag. Nothing
records "moving crystals works on Gearhold, adding moves doesn't work on Tidepool". Each change is tried once,
with no comparison of alternatives. Two tickets aimed at the wrong level show weak diagnosis.
**Fix:** a lessons file the director keeps each night (short, specific, retired when wrong), read by the planner
and director. Later: try two variants of a tuning ticket and keep the better one.
**Done 2026-11-12 (lessons):** `.data/hal/lessons.json`; the director adds up to 5 a night (one sentence, a known game
or the whole studio, citing the pass) and retires contradicted ones; the planner and director read them; the report
shows them under "What Hal has learned". Still open: trying variants.

## 4. It can't improve itself

**Weak:** Hal's scorers, checks and prompts are protected from Hal (rightly), so every improvement to the loop
needs a human-driven session. The "recursive" fixes on day one were made outside Hal.
**Fix:** let the director write "Hal itself" proposals as tickets for the operator to approve and apply.

## 5. Security soft spots

- The report page is plain HTTP on the home network with the token in the URL; anyone on the network who sees
  the link can drive Hal. (Fix: HTTPS with a local certificate, or Tailscale, and rotate the token.)
- Tripwires are pattern checks on the diff text; a cleverly obfuscated network call could slip past them. The
  sandbox and the browser's request blocking are the real backstop.
- Game code runs inside the scoring process and could in principle forge its own score (accepted ruling R17).
- Pushes use the operator's GitHub login, via a repo-local credential helper.

## 6. Operations are fragile

- **Two writers, one file:** the page and a running Hal can write `notes.json` / `feedback.json` at the same moment
  and lose a message. (Fix: a lock around every read-modify-write.) **Done 2026-11-12:** every read-modify-write of
  notes, feedback and approvals holds an O_EXCL lock file; a dead holder's lock is taken over. Without it, a test of
  31 concurrent replies kept 2.
- **No overnight alert:** a broken night only shows when someone opens the report. (Fix: a notification when a run
  fails or doesn't push.) **Done 2026-11-12:** a macOS notification when a run fails, doesn't push for a reason the
  operator didn't choose, or a warning says it needs him; a run he started also says when it's done.
- **One Mac:** it must be awake, its home network address can change, and a `gh` account switch broke pushes once.
- **Unpushed local work runs too:** Hal runs whatever is in the operator's checkout, including edits never pushed.
- **Pushing mid-run:** pushing to `main` while Hal runs forces a replay and caused two failed pushes on day one.

## 7. Big for one day's work

About 500 Hal tests and a lot of custom git plumbing (replay, push triage) built fast. Each piece is tested, but
nobody has seen them together over weeks of real nights. The push triage and the replay are the likeliest to
surprise, because they rewrite history.

## 9. Block Barn (added 2026-11-13)

Block Barn is a child-directed toddler game (age 2+, plays alone) and is on the shelf. Hal scores it with five measures
(responsive, noDeadEnds, bigTargets, alphabet, calm) and the planner has a Block Barn section with the anti-goals and the
locked files (`recorder.js`, `audio/**`, every `SOURCES.md`, the `childDirected` flag, new non-code assets).
**Open:** a real-iPhone check that speech and sound effects unlock; Brian's recordings (`docs/block-barn-recording.md`);
HTTPS hosting, needed for in-game recording.

## 10. Measurement v2: the scores steer again (added 2026-11-15)

**Weak:** the 2026-11-15 review (five per-game reviews, 123 ledger passes) found only 11 of 73 kept passes moved
fitness. Seed noise beat the gate's 0.5 gain / 1.0 tolerance, tension vetoed real gains, the bots couldn't see the
games' mechanics, some measures punished growth or moved in 25-point steps, and fix tickets were thrown out for "no gain".
**Done 2026-11-15 (plan `docs/hal/plans/2026-11-15-measurement-v2.md`):**
- Gate: a tension drop is a note unless the ticket targets tension, and the opening levels 1-5 don't count toward
  tension (D1). Tolerance and min gain widen with each measure's seed noise, `max(flat, 2·√(seB²+seA²))` (D2).
  Fix tickets only need to avoid making things worse.
- Every seeded scorer reports per-measure noise (a bootstrap over seeds), with more seeds: Tidepool 100, Gearhold 150,
  Lanternkeep 12. Gearhold's visual effects have their own random stream.
- Bots that play like people: Tidepool rescues pals and keeps bubbles; Gearhold waits out presses and shoots within
  11 tiles; Hyperline taps with human timing noise; Lanternkeep spends its gold and plays with typical perks; Block
  Barn has a seeded toddler phase (runs, palms, presses, cancels) over 12 seeds.
- Measures that see design: Gearhold per-level band scores (static scorer out of fitness, new-level path); Hyperline
  per-sector `fair`, `bites` and `tension`, scored from each sector's own start; Tidepool tiered win-rate bands with
  a ceiling and `variety`, with `plusFive` reported beside fitness and never a target (hard rule 4); Lanternkeep
  `watch` per style and "close" = under half the lives (D3); Block Barn `variety`, with `calm` below 100 a hard failure.
- Baselines broke on purpose (the new numbers see more): Lanternkeep 81.75 → 53.61, Hyperline 99.88 → 90.19, Tidepool
  87.0 → 89.81, Gearhold-play 87.37 → 87.47, Block Barn 100.
**Open:** Block Barn's scorer now takes about 5 min (real-time browser play); the fake-clock follow-up in the plan
should cut it. Watch the first nights for gains that the wider noise bands now reject.
Done 2026-11-15: Block Barn plays on a fake clock (paused page clock + stopped animation timeline, advanced frame by
frame); a default score run went from 4 min 53 s to 22 s with an identical report.

## 8. Smaller issues

- A CI-triggered undo tells players a change "failed an automated check", internal detail they don't need.
- Before/after shots show only the first level a change touched; UI-only changes get the generic shot.
- Each run does several full CI and browser scoring passes: about 30 minutes per run.
