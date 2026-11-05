# Studio in a Box

A platform that takes small HTML5 mobile games from idea to worldwide launch with minimal human involvement. The operator (Brian) is pulled in only for approvals, decisions, or when the system is stuck.

- Brief: `docs/game-studio-prompt.md`
- Approved design: `docs/architecture.md` (Azure + Bicep, local-first)
- Rules and conventions for agents: `CLAUDE.md`
- Plans: `docs/superpowers/plans/`

## Status (as of 2026-11-05)

Phase 1 is split into three plans: 1a, 1b and 1c.

| Plan | Scope | State |
|---|---|---|
| **1a** Foundation core | Repo scaffold, `policy.yaml`, Bicep skeleton, registry, stage-gate engine, ActionGateway, audit log | ✅ merged to `main` |
| **1b** SDK, ingest, metrics | Game SDK, ports of Tidepool Pals and Hyperline, event ingest, metrics rollup (D1, D7, session length, purchase intent, rating, crash-free), local SQLite and filesystem adapters, local dev loop | ✅ merged to `main` (last commit `00bbc03`) |
| **1c** Console, portal, Azure | Operator console v1 (pipeline board, game pages, Inbox, kill switch), public web portal with a landing page per game, Azure adapters (Cosmos, Blob, Queues, Key Vault), Functions API, deploy to Azure dev | ⏭ next, not yet planned |
| **Onboarding** Contributors + Windows | Windows-safe scripts and CI, compliance for every game file, SDK no-ingest mode, `npm run new-game`, Pages test builds, START-HERE guide (`docs/superpowers/plans/2026-11-05-contributor-onboarding.md`) | ✅ merged to `main` (last commit `7f0dca9`); GitHub steps pending |

298 tests pass and `npm run typecheck` is clean.

**Phase 1b demo:** `npm run demo:1b` promotes Hyperline to stage 3 (D1 37.9%). Tidepool is held (D1 22.2%, but its rating of 3.69 is below the 3.8 bar).

**Both games play locally.** Tidepool's gray-overlay bug is fixed (a missing `[hidden]` CSS rule). It still needs a full manual playthrough: open a shell, decline +5 Moves, buy something, open the Album.

## Run it locally (no Azure needed)

Requires Node 22.

```bash
npm install
npm test               # vitest, all workspaces
npm run typecheck
npm run seed           # register the games in .data/ (stage 2)
npm run dev            # API/ingest :8787, games :5174 (localhost only)
npm run dev:lan        # same, also on the LAN for phones; prints the addresses (home networks only)
npm run new-game <slug>  # scaffold a compliant starter game in games/<slug>/
npm run build:pages    # build the Pages test-build site into _site/
npm run rollup         # events -> metrics snapshots
npm run gates          # run a gate cycle
npm run demo:1b        # synthetic players through the real ingest, into .data/demo
```

To play, open `http://localhost:5174/tidepool-pals/` or `/hyperline/`. Local data lives in `.data/`, which git ignores; delete it to reset.

**Test builds on GitHub Pages.** Every push to `main` runs `.github/workflows/pages.yml`, which publishes `games/` and the SDK as a static test-build site: a `noindex` index page, `robots.txt` disallowing everything, a "test build" badge on each game, and the SDK in no-ingest mode, so nothing is collected and these sessions never feed metrics or gates. Pages needs GitHub Pro (or Team) on the private repo before it can be turned on. The workflow stays off until then: to turn it on, set Settings > Pages > Source to "GitHub Actions", then add the Actions variable `PAGES_ENABLED` with the value `true`.

## Contributors

New contributors start at [`docs/START-HERE.md`](docs/START-HERE.md) (a beginner's guide: Windows setup, a first game, playing it on a phone, the Git loop) and [`CONTRIBUTING.md`](CONTRIBUTING.md). Personal Claude Code templates (tutor instructions and conservative permissions) are in `docs/contributor/`.

## Picking back up

1. **Decide where 1c runs.** Should Plan 1c deploy to Azure, or stay local until the startup credits land? My default: build the console and portal locally first (SQLite and filesystem adapters), then add the Azure adapters and deploy once the subscription exists.
2. Write the Plan 1c document in `docs/superpowers/plans/`, then execute it the same way as 1a and 1b: a branch, TDD per task, a final review, then merge.

### Operator setup still outstanding (Brian)

- Microsoft for Startups credits, then the Azure subscriptions (dev and prod).
- Delaware LLC, then the EIN, then the D-U-N-S number (needed for the Apple and Google organization accounts in Phase 3).
- Domain for the portal.
- GitHub repo. There is no remote yet; everything is local on `main`. In this order:
  1. Create the private repo and push `main`.
  2. Confirm CI is green on `build (ubuntu-latest)`, `build (windows-latest)` and `infra`.
  3. Upgrade to GitHub Pro (or an org on Team), then protect `main`: PR plus 1 review, those three checks required, no force-push.
  4. Enable Pages (source: GitHub Actions) and set the repo variable `PAGES_ENABLED=true`.
  5. Only then invite the contributor with write access. Ideally run `docs/START-HERE.md` once on a real Windows machine first.
- Follow-ups parked from the onboarding review: the payment-word check flags "striped" (needs word boundaries); an unquoted `<script src=https://…>` slips past the network check; Hyperline and Tidepool load Google Fonts, which sends visitor IPs to Google on Pages.

### Decisions already made

- **Platform:** Azure plus Bicep. The original brief said AWS and CDK.
- **Local dev:** never requires Azure.
- **Random rewards are earned-only.** Nothing purchasable contains a random reward (`markets.yaml` `paid_random_rewards: false`).
- **Hyperline:** the limited drop and the fake leaderboard were removed. The drop returns in Phase 5 with real caps and real end dates.
- **Rollup:** pure TypeScript, not DuckDB.
- **SDK:** 4xx responses are dropped, not retried.
- **Rate limiting:** deferred to Azure Front Door/WAF in 1c.

### Known minor issues (deferred from the 1b review)

- **M1:** one bad event rejects its whole batch. A stored non-UUID player ID is rejected forever.
- **M2:** `error` event messages can carry PII and have no length cap. Benign errors also lower crash-free.
- **M3:** a back/forward-cache restore extends the old session.
- **M5:** the 2→3 gate counts a player twice when they play on both the portal and our own site.
- **M6:** the SQLite store's compare-and-set does a select, then an update, so it isn't atomic.
- **M7:** `latestMetrics` breaks ties differently from MemoryStore, and the table has no index.
- **M8:** the object store's writes aren't atomic, so a partial write can abort the rollup.
- **M9:** Tidepool's "Open a Shell" card does nothing.
- **M10:** Hyperline's flex card says "Pulled… Season 1" and promises sharing.
- **M11:** a paid continue sends two `level_end` events.
- **M12:** small gaps in the event schema.
