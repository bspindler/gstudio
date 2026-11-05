# Contributor onboarding and Windows support: design

Date: 2026-11-05. Status: draft for operator approval.

## Intent

Brian (the operator) wants to bring in his first outside contributor: his son, who is 18. The son is a beginner. He has made a couple of Minecraft mods, taken basic coding classes and written simple local scripts. He uses Windows, and he'll work in VS Code with the Claude Code extension, learning alongside the AI.

**Success, a month in:** he has made his own simple game and can play it on his phone. Brian hopes he makes many. His games are real studio games: they get registered, go through the same stage gates and are held to the same hard rules as every other game.

So the repo needs to:

1. be on GitHub, private, with him as a collaborator;
2. work on Windows the first time, in PowerShell and in Git Bash;
3. give a beginner one obvious starting point (make a game) and keep him away from the platform internals;
4. make his Claude a patient tutor that teaches and stays inside the guardrails;
5. catch mistakes, his or the AI's, at a pull request before they reach `main`.

## Goals

- Every documented command (`npm install`, `npm test`, `npm run typecheck`, `npm run dev`, `seed`, `rollup`, `gates`, `demo:1b`, and the new scripts below) works on Windows 11 with Node 22 from PowerShell, cmd and Git Bash.
- CI runs on both `ubuntu-latest` and `windows-latest`.
- A brand-new game can be scaffolded with one command, passes every compliance check unchanged, and can be played on a phone on the same Wi-Fi.
- The compliance test covers every game in `games/` automatically.
- A beginner-friendly start guide gets him from a fresh Windows laptop to a game on his phone.
- `main` is protected: changes arrive by pull request, CI must pass on both OSes, and Brian approves.

## Non-goals

- Making the repo public, or choosing an open-source license. The repo stays private. Going public is a separate future decision.
- Rewriting `CLAUDE.md` or the README for a general audience. They stay operator-facing.
- Teaching him the platform internals (core, gateway, policy, gates, infra).
- Plan 1c work (console, portal, Azure adapters).
- Fixing the deferred minors M1–M12, except where they block this work. None are known to.

## Anti-goals (failure even if it technically works)

- His first session ends in a confusing error: a path bug, a CRLF test failure, an env-var syntax error, or a native-build failure.
- His Claude does the work for him without explaining it, or edits `policy.yaml`, `infra/`, the gateway, or pushes to `main`.
- A new game ships without the hard-rule compliance checks running on it.
- Anything in the onboarding pushes a beginner toward breaking a hard rule, for example a starter template with fake timers, hard-coded prices or paid random rewards.

## Constraints

- All hard rules and conventions in `CLAUDE.md` apply unchanged: TDD with vitest, strict TypeScript, ESM, Node 22, games only through the SDK.
- Local dev must never require Azure. The son needs no Azure access.
- No secrets are in the repo. A scan on 2026-11-05 found none in the tracked files or the history. The UUIDs found are test fixtures and Azure's public built-in role IDs.
- `policy.yaml` is operator-owned. Nothing here changes it.
- The son is 18, so his own GitHub account and his own Claude account are both within their terms. He signs in to Claude Code with his own account.
- **GitHub Pro (or an org on Team) is required** for two features on a private repo: branch protection that is actually enforced, and GitHub Pages. Upgrading is a spend, so Brian does it himself. Until then, the plan creates the repo and documents the protection and Pages setup, but those two steps stay blocked.

## Current state (findings from recon)

Windows breakers:

1. **`new URL(...).pathname` used as a filesystem path.** On Windows it returns `/C:/...`, which is invalid. Found in:
   - `scripts/local-env.ts` (`repo`, which feeds `dev`, `seed`, `rollup`, `gates` and `demo:1b`)
   - `scripts/demo-gate-cycle.ts`
   - `services/api/test/e2e-local.test.ts`
   - `packages/core/test/library.test.ts`

   The fix is `fileURLToPath(new URL(...))`, which other tests already use. The builder should sweep for any other `.pathname` uses and string-built paths.
2. **`lint:infra` uses `> /dev/null`.** That redirect fails in cmd and PowerShell. Rewrite it so it works everywhere, for example `az bicep build --file infra/main.bicep --stdout` piped through a small Node wrapper, or `--outfile` into an ignored temp dir. The builder chooses. On Windows CI, the infra lint may run on Linux only; one OS is enough for Bicep.
3. **No `.gitattributes`.** Git on Windows may convert files to CRLF on checkout. That can break tests that read source files with regexes (games-compliance) and YAML parsing, and it produces noisy diffs. Add `* text=auto eol=lf`, plus binary rules for images and audio.
4. **`STUDIO_LAN=1 npm run dev`** is POSIX-only syntax. Add `npm run dev:lan`, which sets LAN mode without shell env syntax, for example a `--lan` flag read by `scripts/dev.ts`. Keep the env var working too.
5. **`scripts/dev.ts` static roots** use `relative(process.cwd(), repo)` to build `serveStatic` roots. Verify this works on Windows, where the path may contain backslashes, once item 1 is fixed.
6. **CI is Ubuntu-only.**

Contributor gaps: there is no start guide, no Node version pinning (no `engines` field and no `.nvmrc`), no scaffold for new games, and the compliance test hard-codes `const GAMES = ['tidepool-pals', 'hyperline']`.

Already good: SQLite is built-in `node:sqlite`, so there's no native build. `.editorconfig` sets LF. `.gitignore` covers `.data/`, `.env*` and `*.pem`. Games are plain HTML with no build step.

## Decided

### GitHub

- A **private** repo under Brian's account `krakendevlord`, created with `gh` once Brian approves. Push `main` with its full history.
- The son is added as a collaborator with **write** access. He can push branches, but not to `main`.
- **Branch protection on `main`:** a pull request is required, one approving review (Brian's) is required, the CI checks on both OSes must pass, and force-pushes and deletion are blocked. Brian, as admin, may bypass for himself. That's the builder's call; the default is to allow it, since he works solo on `main` today.

### Windows support

- Fix items 1–6 above.
- CI matrix: `ubuntu-latest` and `windows-latest`, each running `npm ci`, `npm run typecheck` and `npm test`. Bicep lint stays on Ubuntu.
- Pin Node: add `"engines": { "node": ">=22.13" }` and `.nvmrc` with `22`. The builder should confirm the minimum version at which `node:sqlite` works without a flag and set it accordingly.

### Making games

- **`npm run new-game <slug>`** creates `games/<slug>/index.html` and `games/<slug>/game.yaml` from a starter template. It validates the slug (lowercase, kebab-case, not already taken) and fills in the title.
- **The starter game** is tiny and original: something like a tap-the-target game with levels. It imports `createStudio` from the SDK, emits `level_start` and `level_end`, calls `feedback.maybePrompt()`, includes the `[hidden]` CSS rule, and has a mobile viewport and touch input. It contains **no purchases and no random rewards**. Those come later, deliberately, with the SDK's fake-door and odds helpers. Plain-language comments in the code mark the parts he should change first and explain why the SDK calls are there.
- The starter's `game.yaml` uses the same schema as the existing games. `ageRating: null` is honest, because it's set later at the store stage.
- **The compliance test discovers games** by reading `games/*/` instead of using a hard-coded list. A test also checks that a freshly scaffolded game passes compliance. That's TDD: write it first.
- **The purchase check becomes conditional (designer's call, flagged to Brian).** Today it requires `purchase.offer(` in every game. It changes to: if a game shows anything purchase-like (a buy or shop button, a price, `priceUsd`, the word "store" in UI copy, any payment API), it must route through `purchase.offer(`. A game with no purchases passes. The rule is unchanged, and the starter doesn't need a fake store. Add tests proving that a purchase-like game without `purchase.offer` still fails.
- New games go through the normal pipeline. `npm run seed` registers them like any studio game. Every step that makes a game public through the pipeline or spends money already requires Brian's approval through the gateway (the approve floor in `policy.yaml`), so no extra draft flag is needed.

### Test builds on GitHub Pages

- **Purpose:** family and friends play his builds from a link. It's for playtesting only. These sessions do not feed the metrics or the stage gates.
- **Deploy:** a GitHub Actions workflow publishes `games/` plus the SDK to Pages on every push to `main`. Merges to `main` require Brian's approved PR, and that approval is the human gate for this side effect. This is outside `createGateway()` because it's a static test site, not a platform API action. That's the designer's call, flagged to Brian; the real public portal stays in Plan 1c through the gateway.
- **The SDK gets a "no ingest" mode.** When `endpoint` is empty, or the page is on the Pages host, the SDK keeps every API working (`track`, `purchase.offer` fake-door, `feedback`, `flags`, `odds`) but sends nothing and makes no network calls. That keeps it honest with the privacy labels: nothing is collected. TDD in `packages/sdk`.
- **Paths:** games import the SDK from `/sdk/studio-sdk.js`, which breaks under a Pages project path (`/<repo>/`). Change games and the starter to a relative import (`../sdk/studio-sdk.js`). The dev server and the Pages build both serve the SDK at `<root>/sdk/`. Update the compliance regex if needed.
- **The site** is a generated index page listing the games and labeled "test builds". It has a `noindex` meta tag and a `robots.txt` that disallows everything. Each game shows a small "test build" badge. The fake-door purchase copy ("free during the beta") applies as usual.
- It is public to anyone with the link, which is acceptable because nothing is collected and the games follow every hard rule.

### Playing on a phone

- `npm run dev:lan` prints the LAN address(es). The guide covers the same-Wi-Fi requirement, Windows Firewall's first-run prompt ("Allow" on private networks only), and the existing caveat that the LAN ingest has no auth, so it's for home networks only.

### Start guide

- `docs/START-HERE.md` is written for him, in plain language: what this project is, in two paragraphs; the hard rules in plain language and why they exist; one-time setup on Windows (Git for Windows, Node 22 LTS, VS Code, the Claude Code extension and sign-in, a GitHub account, cloning, `npm install`, `npm test`); making your first game; playing it on your phone; and the Git loop (branch, commit, push, open a PR, wait for review). It ends with "when you're stuck" (ask Claude, then ask Dad) and which folders to leave alone at first.
- The README links to it under a "Contributors" heading.
- `CONTRIBUTING.md` is short and points to START-HERE, the branch and PR flow, and "tests must pass".

### Claude as tutor

- The checked-in `CLAUDE.md` gets one short section: contributors work on branches through PRs; nobody pushes to `main`; contributors leave `policy.yaml`, `infra/` and `packages/core` gateway and policy code alone unless the operator asks.
- **A template, `docs/contributor/CLAUDE.local.md.example`,** which he copies to `CLAUDE.local.md` at the repo root. Add `CLAUDE.local.md` to `.gitignore` and confirm Claude Code loads it. It tells Claude: you are working with a beginner who learns by doing. Explain what you change and why, in plain words. Make small steps. Offer to let him try the next step himself. Teach Git as it's used. Run the tests before suggesting a commit. Never push to `main`, never force-push, never edit `policy.yaml` or `infra/`, and never weaken a compliance test to make a game pass.
- **A template of conservative Claude Code permissions** (designer's call): `docs/contributor/settings.local.json.example`, which he copies to his own untracked `.claude/settings.local.json`. It is not a checked-in `.claude/settings.json`, because that would also bind Brian, who commits to `main` and owns `policy.yaml`. The template has an allowlist of safe read-only and test commands (`npm test`, `npm run typecheck`, `npm run dev`, `npm run dev:lan`, `npm run new-game`, `git status`, `git diff`, `git log`) and a deny list (`git push --force`, `git push origin main`, edits to `policy.yaml`). Everything else asks first. The builder should verify the settings format against current Claude Code docs.

## Left to the builder

- How the `lint:infra` redirect is made cross-platform.
- How `dev:lan` passes the flag.
- The starter game's exact mechanic and look, as long as it's original, tiny, touch-friendly and compliant.
- Where the scaffold template lives (for example `scripts/templates/game/`).
- Exact wording of the guide and the Claude template, within the tone above.
- The order of the work. Suggested: Windows fixes and CI first (everything else depends on them), then compliance discovery and the conditional purchase check, then the SDK no-ingest mode and relative paths, then scaffold and starter, then the Pages workflow, then the guide and Claude files, then the GitHub push, with protection and Pages enabled last.
- IP ownership of contributed games is out of scope. Settle it once the LLC exists.

## Operator steps (Brian)

- Approve creating the private repo and pushing.
- Upgrade to GitHub Pro (or create an org on Team), then turn on branch protection and Pages.
- The son creates his GitHub account. Brian invites him.
- Sit with him for the first setup session.
