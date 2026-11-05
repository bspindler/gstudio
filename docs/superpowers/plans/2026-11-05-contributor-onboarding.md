# Contributor Onboarding, Windows Support and Pages Test Builds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the repo work on Windows, give a beginner a one-command way to start a compliant game and play it on a phone, publish test builds to GitHub Pages, and put the repo on GitHub, private and protected.

**Architecture:** First fix the platform-sensitive code: paths, line endings and shell syntax. Move the game compliance rules into one reusable function in core, so they apply to every game folder and to the starter template. Add a no-ingest mode to the SDK so static hosting collects nothing. A small build script assembles `_site/` for Pages. Docs and Claude templates sit on top. The GitHub steps come last and need the operator.

**Tech Stack:** TypeScript (strict, ESM, Node 22), vitest, tsx, Hono dev server, plain-JS SDK, GitHub Actions (`actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`), `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-11-05-contributor-onboarding-design.md`

## Global Constraints

- All hard rules and conventions in `CLAUDE.md` apply. TDD with vitest: the failing test comes first.
- Every npm script must run unchanged in PowerShell, cmd and Git Bash. No POSIX-only syntax (`VAR=1 cmd`, `> /dev/null`, `rm -rf`, `&&` chains that rely on sh).
- Filesystem paths come from `fileURLToPath(new URL(..., import.meta.url))` or `node:path`, never from `URL.pathname`.
- Node floor: `"engines": { "node": ">=22.13" }`, and `.nvmrc` = `22`. Confirm that `node:sqlite` loads without `--experimental-sqlite` at 22.13; raise the floor if not.
- Local dev never requires Azure. `policy.yaml` is not edited.
- The starter game has **no purchases and no random rewards**.
- Pages sessions send nothing: no network calls to any ingest.
- The repo is **private** under `krakendevlord`. No push and no repo creation without the operator's explicit go-ahead in that session.

## Review Focus

1. **A third game breaks existing tests.** `services/api/test/e2e-local.test.ts` asserts that `seedLibrary` returns exactly `['hyperline', 'tidepool-pals']`, so the first game the son adds would turn CI red. Task 1 fixes this.
2. **CRLF checkouts.** The Tidepool function-slicing tests look for `'\n}'`, and YAML or regex checks may misread `\r`. `.gitattributes` must force LF. Task 1 adds a test that no tracked text file contains `\r\n`.
3. **Slugs that are valid for the schema but bad for a folder or URL:** uppercase, spaces, `..`, a leading hyphen, an existing slug, or a Windows-reserved name (`con`, `nul`, `aux`, `prn`, `com1`, `lpt1`). Task 4 tests them.
4. **The purchase check gives false positives and negatives.** `localStorage`, `restore` or `shopping` must not trigger it. A game with a `$`-price, a "Buy" button or `priceUsd` but no `purchase.offer(` must fail. Task 2 tests both.
5. **Running scripts from a subdirectory, or with backslash paths on Windows.** The dev server's `serveStatic` roots must resolve from any working directory. Task 1 normalises them.

---

### Task 1: Windows-safe paths, line endings, scripts and CI

**Files:**
- Modify: `scripts/local-env.ts:8` (`repo`), `scripts/demo-gate-cycle.ts:17`, `services/api/test/e2e-local.test.ts:10,23-24`, `packages/core/test/library.test.ts:35`
- Modify: `scripts/dev.ts` (the `--lan` flag and static roots)
- Modify: `package.json` (`engines`, `dev:lan`, `lint:infra`)
- Create: `.gitattributes`, `.nvmrc`, `scripts/bicep-lint.ts`
- Modify: `.github/workflows/ci.yml`
- Test: `packages/core/test/repo-hygiene.test.ts`

**Interfaces:**
- Produces: `repo` and `gamesDir` in `scripts/local-env.ts` are native OS paths. `npm run dev:lan` runs LAN mode.

- [ ] **Step 1: Write the failing hygiene tests** in `packages/core/test/repo-hygiene.test.ts`:
  - `no source file derives a filesystem path from URL.pathname`: read every `*.ts` under `scripts/`, `services/`, `packages/` and `adapters/` (skipping `node_modules` and `dist`), and expect none to match `/new URL\([^)]*\)\.pathname/`.
  - `tracked text files use LF`: run `git ls-files --eol` through `execFileSync('git', [...])` and expect no line whose index part (`i/`) is `i/crlf` or `i/mixed`.
  - `.gitattributes forces LF`: the file contains `* text=auto eol=lf`.
  - `npm scripts avoid POSIX-only shell syntax`: no script value in the root `package.json` matches `/\/dev\/null|^\w+=\S+\s|\brm -rf\b/`.
- [ ] **Step 2: Run** `npx vitest run packages/core/test/repo-hygiene.test.ts`. Expected: FAIL. The four `.pathname` files, the missing `.gitattributes` and `lint:infra` are all reported.
- [ ] **Step 3: Fix the paths.** Use `fileURLToPath(new URL('../', import.meta.url))` in `local-env.ts`, and the same pattern in the other three files.
- [ ] **Step 4: Make the e2e test independent of how many games exist.** Copy `games/hyperline` and `games/tidepool-pals` into the test's temp dir (`cpSync(..., { recursive: true })`) and seed from there, so the exact-match assertion stays meaningful.
- [ ] **Step 5: Add `.gitattributes`** with `* text=auto eol=lf`, plus `binary` for `*.png *.jpg *.jpeg *.gif *.webp *.ico *.mp3 *.ogg *.wav *.mp4 *.woff *.woff2`. Add `.nvmrc` (`22`) and `engines` in `package.json`. Run `git add --renormalize .`.
- [ ] **Step 6: Make `lint:infra` cross-platform.** `scripts/bicep-lint.ts` runs `az bicep build --file infra/main.bicep --stdout` through `execFileSync`, discards stdout and exits non-zero on failure. Use `shell: true` on win32 so `az.cmd` resolves. Set the script to `"lint:infra": "tsx scripts/bicep-lint.ts"`.
- [ ] **Step 7: Add `dev:lan`.** `scripts/dev.ts` sets `onLan = process.env.STUDIO_LAN === '1' || process.argv.includes('--lan')`. Add `"dev:lan": "tsx scripts/dev.ts --lan"`. Build the static roots with `relative(...).split(sep).join('/') || '.'`.
- [ ] **Step 8: Run** `npm test && npm run typecheck`. Expected: all pass, the hygiene tests included.
- [ ] **Step 9: Update CI** to a matrix `os: [ubuntu-latest, windows-latest]` running `npm ci`, `npm run typecheck` and `npm test`. Add a separate `infra` job on `ubuntu-latest` that runs `az bicep install && npm run lint:infra`. Name the matrix jobs `build (ubuntu-latest)` and `build (windows-latest)`; Task 7 refers to those names.
- [ ] **Step 10: Commit.** `fix: cross-platform paths, LF line endings, dev:lan and Windows CI`

### Task 2: One compliance function for every game, with a conditional purchase check

**Files:**
- Create: `packages/core/src/library/compliance.ts`, `packages/core/test/compliance.test.ts`
- Modify: `packages/core/src/index.ts` (export), `packages/core/test/games-compliance.test.ts`

**Interfaces:**
- Produces: `complianceViolations(html: string): string[]` from `@studio/core`. It returns one human-readable message per broken rule, and `[]` when the game is clean. It's used by Task 4's tests and Task 5's build.

- [ ] **Step 1: Write the failing rule tests** in `compliance.test.ts`. Use a minimal clean fixture: an SDK import, `track('level_start'`, `track('level_end'`, `feedback.maybePrompt(`, and no purchases. Tests:
  - the clean fixture returns `[]` (no purchases is fine);
  - a fixture with `<button>Buy coins</button>`, or `priceUsd: 0.99`, or `Shop` UI copy, or `PaymentRequest`, and no `purchase.offer(` reports a violation containing `purchase.offer`;
  - a fixture with `localStorage`, `restore()` and `shopping` in comments but no purchase UI returns `[]`;
  - each existing rule still fires on its trigger: a missing SDK import, a hard-coded `$1.99`, `randomReward: true`, `odds.roll(` without `odds.format(`, `RIVALS`, `hidden` without the `[hidden]{display:none !important}` rule, a missing `level_start`, `level_end` or `feedback.maybePrompt(`, `mockBuy`.
- [ ] **Step 2: Run** `npx vitest run packages/core/test/compliance.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `complianceViolations`.** Move each regex from `games-compliance.test.ts` into it, word for word. The purchase-like detector is `/\b(buy|shop|store|checkout)\b|priceUsd|PaymentRequest/i`. It is matched against the HTML with `<script>` comments stripped, so a `// store` code comment doesn't count. If the detector matches, `purchase.offer(` is required.
- [ ] **Step 4: Rewrite `games-compliance.test.ts`.** `GAMES` becomes every directory in `games/` that has an `index.html` (`readdirSync` with `withFileTypes`). The test is `describe.each(GAMES)` with `expect(complianceViolations(html)).toEqual([])`. Keep the Tidepool-specific `describe` blocks unchanged.
- [ ] **Step 5: Run** `npm test`. Expected: PASS. Both existing games are clean.
- [ ] **Step 6: Commit.** `feat(core): complianceViolations for every game; purchase check applies when a game sells`

### Task 3: SDK no-ingest mode, endpoint resolution, relative SDK imports

**Files:**
- Modify: `packages/sdk/studio-sdk.js`, `packages/sdk/test/sdk.test.ts`
- Modify: `games/hyperline/index.html:144-145`, `games/tidepool-pals/index.html:171` (and its `createStudio` call)

**Interfaces:**
- Produces: `resolveEndpoint(loc: { protocol: string; hostname: string }, config?: { endpoint?: string }): string`, exported from the SDK. It returns `config.endpoint` when that is set (including `''`). Otherwise it returns `''` when `hostname` ends with `.github.io`, and `${protocol}//${hostname}:8787` in every other case.
- `createStudio({ endpoint: '' })` runs in no-ingest mode.

- [ ] **Step 1: Write the failing tests:**
  - `no-ingest mode sends nothing`: `make({ endpoint: '' })`, then track 30 events, call `flush()`, fire `visibilitychange` to hidden and `pagehide`, and expect `fakeFetch` not to have been called.
  - `no-ingest mode keeps the APIs working`: `purchase.offer` still shows the fake-door "free during the beta" dialog, and the feedback, flags and odds calls behave the same as in normal mode.
  - The `resolveEndpoint` cases: `x.github.io` → `''`; `192.168.1.5` → `http://192.168.1.5:8787`; an explicit `{ endpoint: 'https://e' }` wins; an explicit `{ endpoint: '' }` wins.
- [ ] **Step 2: Run** `npx vitest run packages/sdk`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `createStudio`, `const ingest = opts.endpoint !== ''`. `drain` and `sendNow` clear the queue and return without sending when `!ingest`. Export `resolveEndpoint`. Update the `StudioOptions` JSDoc to say that `endpoint: ''` means no-ingest.
- [ ] **Step 4: Switch the games** to `import { createStudio, resolveEndpoint } from '../sdk/studio-sdk.js'` and `endpoint: resolveEndpoint(location, window.STUDIO_CONFIG)`.
- [ ] **Step 5: Run** `npm test && npm run typecheck`. Expected: PASS. Then run `npm run dev` and check that `http://localhost:5174/hyperline/` loads the SDK (200 for `/sdk/studio-sdk.js`) and that events reach `.data/objects/events`.
- [ ] **Step 6: Commit.** `feat(sdk): no-ingest mode and resolveEndpoint; games import the SDK relatively`

### Task 4: `npm run new-game` and the starter game

**Files:**
- Create: `packages/core/src/library/scaffold.ts`, `packages/core/test/scaffold.test.ts`
- Create: `scripts/templates/game/index.html`, `scripts/templates/game/game.yaml`, `scripts/new-game.ts`
- Modify: `packages/core/src/index.ts`, `package.json` (`"new-game": "tsx scripts/new-game.ts"`)

**Interfaces:**
- Consumes: `complianceViolations` (Task 2) and `resolveEndpoint` (Task 3).
- Produces:
  - `validateSlug(slug: string, existing: string[]): string | null`, which returns an error message or `null`;
  - `titleFromSlug(slug: string): string` (`'star-catcher'` → `'Star Catcher'`);
  - `fillTemplate(tpl: string, vars: Record<string, string>): string`, which replaces `{{name}}` and throws if a placeholder is left over.

- [ ] **Step 1: Write the failing tests:**
  - `validateSlug` accepts `star-catcher` and `game2`. It rejects `Star`, `star catcher`, `../x`, `-star`, `star-`, an empty string, a 41-character slug, `hyperline` when that is in `existing`, and `con`, `nul`, `aux`, `prn`, `com1` and `lpt1`. Each rejection message says what to change, in plain words.
  - `titleFromSlug` handles the case above.
  - `fillTemplate` throws on `{{missing}}`.
  - `the starter passes compliance`: fill both template files with slug `test-starter`, write them to a temp `games/test-starter/`, and expect `complianceViolations(html)` to be `[]` and `loadGameLibrary(tempGames)` to return one game, `test-starter`, at version `0.1.0`.
- [ ] **Step 2: Run** `npx vitest run packages/core/test/scaffold.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `scaffold.ts`.** The slug rule is `/^[a-z0-9]+(-[a-z0-9]+)*$/`, at most 40 characters, plus the reserved-name list.
- [ ] **Step 4: Write the starter template.** It's an original tap-the-target game: targets appear, you tap them before they fade, and each level needs N hits, with N rising per level. The page has a mobile viewport, pointer events and the `[hidden]` CSS rule. It uses `createStudio` with `resolveEndpoint`, `track('level_start' | 'level_end', { level, result })`, and `feedback.maybePrompt()` after a level ends. There are no purchases, no random rewards, no timers that pressure the player and no prices. Plain-language `<!-- CHANGE ME: ... -->` comments mark the colours, the speed, the hits per level and the title, and one comment explains why the SDK calls are there. `game.yaml`: `slug: {{slug}}`, `title: {{title}}`, `genre: arcade`, `targetSegment: casual, short sessions 13+`, `version: 0.1.0`, `ageRating: null`.
- [ ] **Step 5: Write `scripts/new-game.ts`.** It reads the slug from `process.argv[2]`, takes `existing` from `readdirSync(gamesDir)`, prints the validation error and exits 1 on failure, writes the two filled files, and prints the next steps: `npm run dev`, then open `http://localhost:5174/<slug>/`, then edit `games/<slug>/index.html`.
- [ ] **Step 6: Run** `npm test`, then `npm run new-game demo-check`, then `npm test` again (the compliance test now covers `demo-check`). Expected: all pass. Delete `games/demo-check`.
- [ ] **Step 7: Commit.** `feat: npm run new-game with a compliant starter game`

### Task 5: GitHub Pages test-build site

**Files:**
- Create: `packages/core/src/library/pages.ts`, `packages/core/test/pages.test.ts`, `scripts/build-pages.ts`, `.github/workflows/pages.yml`
- Modify: `package.json` (`"build:pages": "tsx scripts/build-pages.ts"`), `.gitignore` (`_site/`)

**Interfaces:**
- Consumes: `GameMeta`, `loadGameLibrary` and `complianceViolations`.
- Produces:
  - `pagesGameHtml(html: string): string` inserts `<meta name="robots" content="noindex">` after `<head>` and a fixed corner badge, `<div id="studio-test-badge">test build</div>` with inline styles, before `</body>`;
  - `pagesIndexHtml(games: GameMeta[]): string` returns a page titled "Test builds", with a noindex meta, one sentence saying these are test builds and that nothing is collected, and a list of `<a href="./<slug>/">Title</a>` links (relative links).

- [ ] **Step 1: Write the failing tests:**
  - `pagesGameHtml` adds exactly one noindex meta and one badge, and is idempotent when applied twice;
  - `pagesIndexHtml` lists every game with relative links, includes noindex, and HTML-escapes titles (`<b>` → `&lt;b&gt;`).
- [ ] **Step 2: Run** `npx vitest run packages/core/test/pages.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `pages.ts`.**
- [ ] **Step 4: Write `scripts/build-pages.ts`.** It clears `_site/` with `rmSync`. For each game it fails the build if `complianceViolations` is non-empty, then writes `_site/<slug>/index.html` through `pagesGameHtml` and copies the game's other files. It copies `packages/sdk/studio-sdk.js` to `_site/sdk/` and writes `_site/index.html`, `_site/robots.txt` (`User-agent: *\nDisallow: /`) and `_site/.nojekyll`.
- [ ] **Step 5: Verify.** Run `npm run build:pages`, then `npx serve _site` or a short `serveStatic` script on a sub-path, to reproduce `/<repo>/`. Open a game: it loads, the badge shows, and the network panel shows no request to `:8787`. Note: off `github.io` the SDK would still try `:8787`. To simulate Pages locally, `build-pages` injects `<script>window.STUDIO_CONFIG={endpoint:''}</script>` before the game's module script, which also makes the Pages build independent of the hostname.
- [ ] **Step 6: Add the Pages workflow** `.github/workflows/pages.yml`: `on: push: branches: [main]` and `workflow_dispatch`. Permissions: `pages: write`, `id-token: write`, `contents: read`. Steps: checkout, set up Node 22, `npm ci`, `npm run build:pages`, `actions/upload-pages-artifact@v3` (path `_site`), and `actions/deploy-pages@v4`. Use `concurrency: pages`.
- [ ] **Step 7: Commit.** `feat: GitHub Pages test-build site (noindex, no ingest)`

### Task 6: Contributor docs and Claude tutor templates

**Files:**
- Create: `docs/START-HERE.md`, `CONTRIBUTING.md`, `docs/contributor/CLAUDE.local.md.example`, `docs/contributor/settings.local.json.example`
- Modify: `README.md` (a "Contributors" section, the new scripts, the Pages note), `CLAUDE.md` (a "Contributors" section and the new scripts under Local dev), `.gitignore` (`CLAUDE.local.md`, `.claude/settings.local.json`)
- Test: extend `packages/core/test/repo-hygiene.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - `contributor settings template is valid JSON with allow and deny lists`: parse the example file, check that `permissions.allow` includes `Bash(npm test)` and that `permissions.deny` includes a rule for `policy.yaml` and one for force-push;
  - `.gitignore covers personal Claude files`: both paths are listed;
  - `START-HERE references only scripts that exist`: every `npm run <x>` in `docs/START-HERE.md` is a key in the root `package.json` scripts.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Write `docs/START-HERE.md`**, following the spec's "Start guide" section in order:
  - what this is;
  - the hard rules in plain language, with why;
  - one-time Windows setup: Git for Windows (default options; it sets line endings to "checkout as-is" because of `.gitattributes`), Node 22 LTS from nodejs.org or `winget install OpenJS.NodeJS.LTS`, VS Code with the Claude Code extension, signing in to Claude with his own account, accepting the GitHub invite, cloning, `npm install` and `npm test`, copying the two templates from `docs/contributor/`;
  - your first game: `npm run new-game`, `npm run dev`, editing the CHANGE ME spots;
  - playing on your phone: `npm run dev:lan`, being on the same Wi-Fi, allowing Windows Firewall on **private** networks only, home networks only;
  - test builds on Pages: they appear after Dad merges;
  - the Git loop with exact commands;
  - when you're stuck;
  - folders to leave alone for now: `packages/core`, `services`, `adapters`, `infra`, `policy.yaml`, `markets.yaml`.
- [ ] **Step 4: Write the templates.** `CLAUDE.local.md.example` follows the spec's "Claude as tutor" bullets word for word in intent. In `settings.local.json.example`, the `allow` list holds `Bash(npm test)`, `Bash(npm run typecheck)`, `Bash(npm run dev)`, `Bash(npm run dev:lan)`, `Bash(npm run new-game:*)`, `Bash(git status)`, `Bash(git diff:*)` and `Bash(git log:*)`. The `deny` list holds `Bash(git push --force:*)`, `Bash(git push -f:*)`, `Bash(git push origin main:*)`, `Edit(policy.yaml)`, `Edit(markets.yaml)` and `Edit(infra/**)`. Check the rule syntax against the current Claude Code settings docs before finalising.
- [ ] **Step 5: Write `CONTRIBUTING.md`** (under 30 lines: start here, branch, PR, tests must pass, the hard rules apply). Add a short "Contributors" section to `CLAUDE.md`: contributors work on branches through PRs, nobody pushes to `main` except the operator, and contributors don't edit `policy.yaml`, `markets.yaml`, `infra/` or the gateway or policy code unless the operator asks. Update the README and the `CLAUDE.md` Local dev section with `dev:lan`, `new-game` and `build:pages`.
- [ ] **Step 6: Run** `npm test`. Expected: PASS.
- [ ] **Step 7: Commit.** `docs: START-HERE guide, CONTRIBUTING, Claude tutor templates`

### Task 7: Merge, create the GitHub repo, push (needs the operator)

- [ ] **Step 1:** Run `npm test && npm run typecheck` on the branch, then do the final whole-branch review and merge to `main`, following the project's usual process.
- [ ] **Step 2: Ask the operator** to confirm creating the private repo and pushing. Stop until he confirms. Then run `gh repo create krakendevlord/<name> --private --source . --remote origin --push`. The name is the operator's choice; the suggestion is `studio-in-a-box`. Push tags if there are any.
- [ ] **Step 3:** Watch the first CI run with `gh run watch`. Expected: `build (ubuntu-latest)`, `build (windows-latest)` and `infra` are all green. Fix any Windows-only failure through systematic debugging before continuing.
- [ ] **Step 4 (blocked until GitHub Pro):** branch protection on `main`, set with `gh api repos/:owner/:repo/branches/main/protection -X PUT`. Require a PR with 1 approving review, require the status checks `build (ubuntu-latest)` and `build (windows-latest)`, and block force-pushes and deletion. `enforce_admins: false` lets the operator bypass.
- [ ] **Step 5 (blocked until GitHub Pro):** enable Pages with source "GitHub Actions" (`gh api repos/:owner/:repo/pages -X POST -f build_type=workflow`), then re-run `pages.yml` and open the URL.
- [ ] **Step 6:** Invite the son as a collaborator with write access, once the operator gives his GitHub username (`gh api repos/:owner/:repo/collaborators/<user> -X PUT -f permission=push`).
- [ ] **Step 7:** Update the README status section: the remote exists, the protection and Pages state, and what's still pending.
