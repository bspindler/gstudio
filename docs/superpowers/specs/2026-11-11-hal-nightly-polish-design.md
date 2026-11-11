# Hal: the nightly game-polish loop — design

Date: 2026-11-11. Status: draft for operator approval.

## Intent

Brian (the operator) wants to tell the studio "improve these games" and come back a day later to find them more polished. The three games (Tidepool Pals, Hyperline, Gearhold) are new and simple. The bar he named is Candy Crush and Fortnite: games where every action feels good, progress feels like a journey, screens are clear, and the look holds together.

"Hal" is the name for the loop, borrowed from a friend's project (`~/src/hal`, Rick Hicksted's HALWorld). Hal's useful idea is its RSI loop: measure with a score, try one change, keep it only if the score improved and nothing regressed, log every attempt, and stop when nothing is improving. This design takes that idea and none of Hal's plumbing (Hal drives ChatGPT through a Chrome tab, which is brittle). Here the loop is built in this repo, in TypeScript, and Claude Code (headless, `claude -p`) does the playing, noticing and changing.

The loop plays each game, notices what could be better, writes a ticket, builds the improvement on its own branch, checks it, merges it if it passes, and presents it for Brian's thumbs-up or thumbs-down the next morning. He spends about ten minutes a day: read the report, play the games, tap 👍 to keep or 👎 to revert. His taste is the score the machine can't compute ("is this more fun?"), so his votes and comments feed back into the next night.

## What success looks like

- After a night, the morning report shows real, checked improvements across the games, plus a **director's note**: a few paragraphs of Hal's overall thinking (what it focused on and why, where each game stands, what it plans next, what it learned from Brian's last votes). Brian asked for this specifically; it is the top of the report, not an afterthought.
- After a few weeks the games are visibly more finished, and Hal's suggestions have shifted toward what Brian keeps approving.
- Brian never has to dig through git or a terminal to review a night's work.

## Goals

1. **Robot player and scores (first).** Deterministic bot playtests for every game, producing numbers the loop can improve and must not regress: level win rates and difficulty curve (Tidepool), course survivability and crash-free runs over many seeds (Hyperline), reachability and controls checks (Gearhold), plus screenshots and short clips of each game at phone size.
2. **The improvement loop.** Play → notice → ticket → build on a branch → check → merge or discard → log. Scope is wide: bug fixes, level tuning, visual and audio polish ("juice"), clarity and layout, and **new features** (new mechanics, a level map, new earned rewards). Every change is a single idea on its own branch so it can be kept or undone alone.
3. **The morning report.** A phone-friendly page with, in order: the director's note, a "play" link, where each game stands, every change made that night (before/after pictures and clips, 👍 Keep / 👎 Undo), "your calls" for real questions, and a collapsed list of small fixes. The starting point for the look is the mockup at https://claude.ai/artifact/WyVFRgBt7gsedSiTixHZA9 (private to Brian).
4. **Runs nightly and on demand.** Nightly at a fixed time on Brian's Mac, plus a "Run now" he can trigger from his phone on home Wi-Fi or from the terminal (`npm run hal`). An on-demand run can be narrowed: one game, one kind of work, or "look and report only, change nothing."
5. **Learning from Brian.** Each 👍/👎 and comment is recorded and given to the next run. The director's note says what it took from them.

## Non-goals

- Running in the cloud. It runs on Brian's Mac only (his call).
- Real players or real metrics. The 2→3 gate data (D1, ratings) is not an input in this version. Synthetic players (`simulatePlayers`) are never a fitness signal: they take D1 as an input, so optimizing against them measures nothing.
- Publishing, posting, store submission, or anything outside the repo. Hal's only outward actions are pushing its merged changes to the studio's own GitHub repo (which updates the existing test-build site) and publishing the private report page.
- Replacing Brian's judgement on fun. Hal proposes; Brian decides.

## Anti-goals (would be a failure even if it technically works)

1. **Anything that makes the studio liable for usage or payments.** This is Brian's one stated worry. Concretely, Hal must never, without his explicit 👍 on a call that names it:
   - add a dependency of any kind to a game (CDN script, library, engine, font host, npm package used by a game);
   - add a call to any new network host, service, API, analytics, ads or tracking;
   - create accounts, use keys, or add anything that can bill or has usage fees;
   - touch purchase code, prices, IAP or anything money-shaped;
   - add art, sound, music or fonts that aren't generated in code by Hal or verifiably free with no attribution required (CC0 / public domain), with the source recorded next to the asset. **Fonts may also be SIL Open Font License 1.1** (Brian's decision, 2026-11-11), provided they are bundled locally in the game folder with the full license text and a `fonts/SOURCES.md` entry, and a font with a Reserved Font Name is bundled unmodified (no subsetting or conversion).
   Games today have no build step and no dependencies; that stays the default.
2. **Dark patterns.** An engagement-optimizing loop drifts toward fake timers, fake scarcity, nagging after "no", and paid luck. These are hard rule 4 and are rejected automatically, never weighed against a score.
3. **Generic drift.** Fifty "improvements" that each look fine but sand off each game's personality. The director's note must keep each game's identity in view, and Brian's 👎 is the brake.
4. **Copying.** Candy Crush and Fortnite are the bar for feel, not a source. No borrowed names, characters, art, music, levels or look (hard rule 6).
5. **A surprise bill.**

## Constraints

- All hard rules in `CLAUDE.md` apply, especially 2 (no bots on real channels: the robot player plays local builds only), 3, 4 and 6. Rewards are earned-only; anything random shows its odds.
- **Hard rules are pass/fail, never part of a score.** Any compliance failure discards the change before Brian sees it.
- Hal never edits `policy.yaml`, `markets.yaml`, `infra/`, the gateway or policy code in `packages/core`, the compliance checks, or its own tripwires and scores. (Otherwise the cheapest way to "improve" is to loosen the test.) Changes to Hal's own machinery are a separate, Brian-reviewed thing.
- Every kept change must pass `npm test`, `npm run typecheck`, and the compliance tests, plus Hal's tripwires and the bot playtests with no regression.
- Games use only the SDK for events, purchases, feedback, flags and odds (existing rule, enforced by `games-compliance.test.ts`).
- TDD and the repo's conventions apply to Hal's own code (TypeScript strict, ESM, Node 22, vitest, injected clock and IDs).

## How it runs (decided)

- **On Brian's Mac.** A launchd job starts the nightly run at a fixed time (default 1 a.m., configurable). The Mac must be plugged in; the run keeps it awake while working. A missed night runs at next wake and the report says so.
- **On demand.** `npm run hal` from the terminal, with options for scope (game, kind of work, report-only). A "Run now" button reachable from Brian's phone on home Wi-Fi, served the same way `npm run dev:lan` already serves games (home network only). Away from home he can start it through a Claude Code session or wait for the nightly run.
- **One run at a time.** A second start while one is running is refused with "busy". A Stop control ends a run and keeps whatever was finished and checked.
- **The report** is published after each run to the same private claude.ai link, so it opens on his phone from anywhere.

## Money (decided)

- **The API key lives in a local `.hal.env` file** at the repo root, listed in `.gitignore` (Brian's decision, 2026-11-11; the existing `.env*` pattern does not match it, so add `.hal.env` explicitly). Hal loads it only for runs that should use the key. Hard rule 7 (secrets in Key Vault) is about the deployed platform; this local tool is an operator-approved exception, and `CLAUDE.md` gets a one-line note saying so. A test asserts the file is ignored by git.
- **Nightly runs use API credits** (`ANTHROPIC_API_KEY`). Clear terms for unattended use, a firm cap, and Brian's subscription stays untouched for his own work.
- **Runs Brian starts himself use his subscription first**; if a run hits the subscription limit (Claude prints "You've hit your … limit"), Hal continues the rest of that run on API credits. The key is passed only to runs that should use it (with the key present, `claude -p` always uses it).
- **Daily cap: $20 of API credits**, across all runs that day. Each `claude -p` call gets a `--max-budget-usd` slice of what's left; when the day's cap is reached, the run stops cleanly and reports. The report shows every run's spend and which billing it used.
- Facts behind this are from the Claude Code docs as of 2026-11-11 (authentication precedence, `--max-budget-usd`, error strings in the errors page). The builder should re-verify the exact limit-error detection on the installed version.

## Scope of change (decided)

- **Go far.** New mechanics, a level map, new kinds of earned rewards are all in scope. "It's all in git, we can roll it back."
- **Everything that passes goes straight in** (Brian's decision, 2026-11-11). Fixes and new features alike: once a change passes every check and tripwire, Hal merges it into `main` the same night. Brian sees each one in the next morning's report and approves or disapproves it then.
- **One idea per commit on `main`.** Each change is built on its own branch and squash-merged as a single commit, so a 👎 is a clean `git revert` of just that idea. Undoing something weeks later works the same way.
- **👍 = keep, 👎 = revert.** A 👎 reverts the commit the same morning (or on the next run, if the Mac is busy) and records Brian's reason for the next run. No vote means it stays; there is no "stale" timeout.
- **Big ideas still get a short pitch** in the director's note, so Brian knows why a new feature appeared, but they don't wait for a vote before going in.
- **The one exception: liability items need a 👍 before they're built.** Anything on anti-goal 1's list (a dependency, a network host, anything that can bill, purchase code, non-original assets) is never merged automatically. Hal asks in "your calls", naming the exact item, and builds it only after a 👍. The tripwires reject these items in any automatic merge regardless.
- **Two changes that conflict:** the later one is rebuilt on top of the earlier, or dropped and retried the next run.

## The parts

### 1. Robot player and scores

- Tidepool: the board engine (`board.js`), `levels.js` (`difficulty`, `validateLevel`, `generateLevel`) are pure and already tested. A bot plays each level many times (seeded) and reports win rate, moves left, and where it gets stuck. The score rewards a difficulty curve that rises in waves with no walls (e.g. no level whose win rate drops sharply from the previous one) and every generated level passing `validateLevel`.
- Hyperline: `lib/sim.js`, `course.js`, seeded `rng.js` are pure. A bot runs many seeds; the score covers crash-free runs, no unwinnable course segments, and a reasonable survival curve.
- Gearhold: newer and mostly in `index.html` with WebGL. Start with what can be measured: the game loads and runs without errors, controls are reachable and big enough at phone size, levels are completable by a simple bot where feasible. Pulling logic into testable modules (as Tidepool and Hyperline did) is itself a valid early improvement.
- All games: a headless browser loads each game at phone size, plays a scripted few seconds, captures screenshots and a short clip, and records console errors. These feed both the "noticing" step and the before/after pictures in the report.
- Scores live per game and per measure. A change is kept only if its target measure improves and no other measure gets worse beyond a small tolerance.

### 2. The improvement loop

Each run: play every game in scope → Claude reviews scores, screenshots, clips, recent votes and open tickets → writes new tickets → picks the most valuable few that fit the remaining budget → for each, a fresh git worktree and branch, Claude implements, checks run → squash-merged into `main` if it passes, discarded with the reason logged if not → the director's note is written last, from the whole run.

Tickets and the ledger (every attempt: what, why, scores before/after, kept or discarded, cost) are stored in the repo's local state (under `.data/hal/`), not in git history. A readable summary of the ledger is part of the report.

**When a game scores 100** (Brian's decision, 2026-11-11): 100 means every measure is in its healthy band, not that the game is done. From then on, the score acts as a guardrail. Changes must not make any measure worse, and work is driven by the director's note, polish and features judged by Brian's vote, and what screens, controls and console errors show. When a game has sat at 100 for a while, Hal may propose a new measure or a tighter band. Each proposal is a normal 👍/👎 card in the morning report, and Hal never changes its own scoring without that 👍 (scoring code is protected).

**Stagnation:** if a game's attempts keep failing to improve anything for several runs, Hal stops retrying that line of work and says so in the note, asking Brian for direction.

### 3. Tripwires (automatic rejection)

Run on every candidate change, before it can be merged:
- the full test suite, typecheck and compliance tests;
- no new network host, CDN, script source, font host or package in any game file;
- no new or changed purchase, price, IAP or payment-shaped code;
- no new random reward without visible odds; nothing purchasable containing randomness;
- no edits to protected files (listed in Constraints);
- new assets have a recorded source and are Hal-generated or CC0/public domain, or are fonts under SIL OFL 1.1 bundled with their license file (unmodified if the font has a Reserved Font Name);
- no dark-pattern shapes (countdown pressure, fake scarcity, repeated prompts after decline) that static checks can catch.

### 4. The morning report

As in the mockup, with one change from it: since everything goes straight in, every change made that night gets Keep/Undo, not just the two "calls". Bigger changes (features, anything that changes look or feel) show before/after pictures or a clip and a one-line why; small fixes are a compact list with Undo on each. "Your calls" holds only true questions: liability items awaiting a 👍 before being built, and direction questions when Hal is stuck. Votes and an optional comment are recorded and read by the next run. "Play" opens the current `main` build, served locally for home-Wi-Fi play.

## Build order (decided)

1. Robot player, scores, and level tuning on Tidepool (smallest, proves the loop).
2. The ticket → branch → check → keep/discard loop across all three games, with tripwires, budget, nightly and on-demand runs.
3. The morning report with director's note, pictures, clips and votes.

## Left to the builder

- How the bot plays each game and the exact score formulas and tolerances.
- How tickets are chosen and how many changes a run attempts within budget.
- How the report page receives votes (the page is a claude.ai artifact; the votes need to reach the Mac).
- File layout of Hal's code (suggested: `scripts/hal/` and `packages/core` for pure logic).

## Calls I made (not Brian's; check these)

- Built in this repo in TypeScript with Claude Code headless, not by reusing `~/src/hal`.
- A headless browser (e.g. Playwright, Apache-2.0, dev tooling only, never shipped in a game) for screenshots and clips. This is a new development dependency of the studio tooling, not of any game.
- Default nightly time 1 a.m.
- Hal's state lives in `.data/hal/` (already gitignored).
- **Merging and pushing:** Hal merges into local `main` and pushes to `origin` with Brian's own git credentials, so CI runs and the GitHub Pages test build (noindex, already public-by-link today) updates. If CI fails on a pushed change, Hal reverts it at the start of the next run and reports why. As the operator's tool this is Brian pushing to his own `main`; contributor rules are unchanged. A git push is not a gateway action (the gateway covers spending, posting, store, prices, kills); the Pages deploy is the existing CI behavior.
- **Publishing the report:** the report is published to the private claude.ai artifact by a short final step that uses Brian's claude.ai login (subscription), since publishing an artifact needs it and an API key can't. It's one small call per run. If publishing fails, the report is still written locally and served on the home-Wi-Fi page, and the next successful run publishes both.
- **Pitched-but-unbuilt calls** (liability items): one 👍 approves building that named item; the built change then goes in like any other and appears in the next report with Keep/Undo.
- **"Run now" and the play page:** a small server kept running by launchd on Brian's Mac, home network only, protected by a long random token in the URL (Brian bookmarks it on his phone). Without the token it refuses every request, so nobody else on the Wi-Fi can start a run or spend the budget.
