# Phase 1b: SDK, Games, Ingest, Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real play in a browser produces events that are ingested locally, rolled up into the `MetricsSnapshot`s the gate engine already consumes, and drive a gate cycle, with no Azure.

**Architecture:** A zero-dependency browser SDK (`packages/sdk`) batches events to a Hono ingest app (`services/api`), which writes NDJSON through an `ObjectStore` port. A pure-TS rollup (`packages/core/src/metrics`) turns events into snapshots. Adapters in `adapters/local` provide a filesystem ObjectStore and a `node:sqlite` RegistryStore that passes the existing contract suite. The two prototypes are ported to `games/<slug>/` on the SDK, with hard-rule violations removed.

**Tech Stack:** Node 22 (`node:sqlite`), TypeScript strict ESM, vitest (+ happy-dom for SDK DOM tests), Hono + @hono/node-server, zod.

**Spec:** `docs/game-studio-prompt.md` (Phase 1 items 3–5), `docs/architecture.md` v0.4, `CLAUDE.md` hard rules.

## Global Constraints

- Hard rules 1, 3, 4, 5 from `CLAUDE.md` apply to every game and SDK line.
- Operator decision 2026-10-26: **random rewards are earned-only.** No purchasable item may contain a random reward (`markets.yaml design_constraints.paid_random_rewards: false`). Earned random rewards still show odds at the point of opening.
- Fake-door purchases: log intent, then tell the player honestly that the item is free during the beta, and grant it. No re-offer of a declined SKU in the same session.
- Anonymous player IDs only (random UUID). The ingest never stores IP addresses or user agents. Event props are primitives only.
- Local dev never requires Azure. Core stays free of Azure and Node-server dependencies.
- Money is USD numbers; rates are fractions 0–1; days are UTC.

## Review Focus

1. Hostile or malformed ingest batches (oversized, wrong types, nested props, 10k events): expect a 400/413 and nothing written.
2. A player with events on multiple channels: each channel's snapshot counts them independently.
3. Immature cohorts (installed today) must not count toward D1, and D7 only counts cohorts ≥ 7 days old; with no mature cohort the rate is `null`, not 0.
4. A declined fake-door offer must not reappear in the same session (no pressure after decline).
5. Storage unavailable in the browser (private mode throws on `localStorage`): the SDK still works with an in-memory ID.

---

### Task 1: Event schema in core

**Files:** Create `packages/core/src/events/schema.ts`; test `packages/core/test/events.test.ts`; export from `index.ts`.

**Produces:** `EVENT_NAMES` (`session_start`, `heartbeat`, `session_end`, `level_start`, `level_end`, `purchase_offer_shown`, `purchase_intent`, `purchase_declined`, `rating`, `exposure`, `error`, `custom`); `StudioEvent` type `{ v: 1; game: string; version: string; channel: 'portal'|'own_site'|'store'; playerId: string; sessionId: string; ts: number; name: EventName; props: Record<string, string|number|boolean|null> }`; `parseEventBatch(body: unknown): { ok: true; events: StudioEvent[] } | { ok: false; error: string }`.

- [ ] Tests: valid batch parses; >100 events rejected; nested object prop rejected; >20 props rejected; string prop >200 chars rejected; slug must match `^[a-z0-9-]{1,40}$`; playerId must be a UUID; unknown event name rejected; `rating` requires `props.stars` integer 1–5; ts outside now±7d is rejected (parse takes `now: number`).
- [ ] Run, watch fail, implement with zod, run green. Commit `feat(core): event schema`.

### Task 2: Metrics rollup

**Files:** Create `packages/core/src/metrics/rollup.ts`; test `packages/core/test/rollup.test.ts`.

**Produces:** `rollupMetrics(events: Iterable<StudioEvent>, opts: { game: string; asOf: Date }): MetricsSnapshot[]`, one per channel that has events.

Definitions (UTC days; a player's cohort day is the day of their first event on that channel):
- `players`: distinct playerIds.
- `d1`: of players whose cohort day + 1 is a finished UTC day (cohort day + 1 < asOf day), the fraction with any event on cohort day + 1. `null` if none mature.
- `d7`: same with +7 (cohort day + 7 < asOf day).
- `avgSessionSec`: mean over sessions of (max ts − min ts)/1000, sessions with one event count as 0.
- `purchaseIntentRate`: players with ≥1 `purchase_intent` ÷ players with ≥1 `purchase_offer_shown`; `null` if no offers.
- `avgRating` / `ratingCount`: each player's latest `rating.stars`; `null` / 0 if none.
- `crashFreeRate`: sessions without an `error` event ÷ sessions.
- Events after `asOf` are ignored.

- [ ] Tests pin each definition with hand-built events, including Review Focus 2 and 3. Watch fail, implement, green. Commit `feat(core): metrics rollup`.

### Task 3: Local adapters

**Files:** Create `adapters/local/` workspace (`@studio/adapters-local`): `src/object-store.ts`, `src/sqlite-store.ts`, `src/index.ts`; tests `test/object-store.test.ts`, `test/sqlite-store.test.ts`. Add `ObjectStore` port to `packages/core/src/ports/object-store.ts`.

**Produces:** `interface ObjectStore { put(key: string, body: string): Promise<void>; get(key: string): Promise<string|undefined>; list(prefix: string): Promise<string[]> }`; `createFsObjectStore(root: string): ObjectStore` (keys are `/`-separated, rejects `..` and absolute keys); `createSqliteStore(path: string): RegistryStore` (`':memory:'` allowed). Documents are stored as JSON columns; `withLock` is a per-key promise chain like MemoryStore (single-process); `transitionInboxItem` is a single `UPDATE … WHERE status = ?`.

- [ ] `sqlite-store.test.ts` runs `registryStoreContract(() => createSqliteStore(':memory:'))`, plus a persistence test (write, reopen file, read). Object store tests: round-trip, list by prefix sorted, traversal rejected. Watch fail, implement, green. Root `test` script runs all workspaces. Commit `feat(adapters): local fs object store and sqlite registry`.

### Task 4: Ingest + API app

**Files:** Create `services/api/` workspace (`@studio/api`): `src/app.ts`, `src/server.ts`; test `test/ingest.test.ts`.

**Produces:** `createApp(deps: { objects: ObjectStore; clock: () => Date; ids: () => string; allowedOrigins: string[] }): Hono`. `POST /v1/events`: body ≤ 64 KB (413), `parseEventBatch` (400), groups by game, writes `events/day=YYYY-MM-DD/game=<slug>/<id>.ndjson`, returns 202 `{ accepted: n }`. CORS only for `allowedOrigins`. `GET /healthz`. Stores nothing from request headers.

- [ ] Tests with `app.request()`: 202 and file content; 413; 400 on bad batch with nothing written; CORS header present for allowed origin, absent otherwise; no IP or UA in the stored line. Watch fail, implement, green. Commit `feat(api): event ingest`.

### Task 5: Game SDK

**Files:** Create `packages/sdk/studio-sdk.js` (plain ES module, JSDoc types, no deps, no build step) and `packages/sdk/test/sdk.test.ts` (vitest, happy-dom).

**Produces:** `createStudio(opts: { game, version, endpoint, channel?, storage?, fetch?, now?, random?, document? })` returning:
- `track(name, props?)`; automatic `session_start`, a `heartbeat` every 30 s while visible, `session_end` + flush on `pagehide`. Batches flush at 20 events or 10 s. Flush failures are kept for one retry and then dropped (bounded to 200 queued).
- `playerId` (UUID in storage; in-memory if storage throws, per Review Focus 5).
- `channel`: `opts.channel`, or the `?ch=` URL param (`portal`|`own_site`), default `own_site`.
- `purchase.offer({ sku, title, priceUsd, randomReward? }): Promise<'granted'|'declined'|'suppressed'>`: throws if `randomReward` is true (earned-only). Logs `purchase_offer_shown`; shows a modal with the title and price and two buttons; on buy, logs `purchase_intent`, then shows "Free during the beta: nothing was charged" and resolves `granted`; on decline, logs `purchase_declined`, and further offers of that SKU this session resolve `suppressed` without UI.
- `feedback.maybePrompt()`: asks for 1–5 stars at most once per 7 days and only from the second session onward; logs `rating`. Dismissing logs nothing and is not re-asked that session.
- `flag(experiment, variants)`: deterministic FNV-1a hash of playerId+experiment; logs one `exposure` per experiment per session.
- `odds.format(table)` and `odds.roll(table)` for earned random rewards: the table weights must sum to 1 ± 1e-9 or it throws.

- [ ] Tests cover each bullet, including suppression after decline and the throwing storage. Watch fail, implement, green. Commit `feat(sdk): studio game SDK`.

### Task 6: Port the games

**Files:** Create `games/tidepool-pals/{index.html,game.yaml}` and `games/hyperline/{index.html,game.yaml}`; core `src/library/load.ts` with `loadGameLibrary(dir): GameMeta[]` (zod: slug, title, genre, targetSegment, version, ageRating); test `packages/core/test/library.test.ts`; `test/games-compliance.test.ts` (static checks).

Changes from the archived originals, and nothing else:
- Every `mockBuy` call goes through `studio.purchase.offer`. No "simulated purchase" toasts.
- **Earned-only:** Tidepool's shell pouch and chest, and Hyperline's crates, become earned-only (from play) or are replaced by deterministic paid items (a named creature or skin). Earned random openings show odds at the point of opening via `odds.format`.
- **Hyperline drop:** remove the synthetic claimed counter and the resetting weekly countdown. A drop shows only when `game.yaml` has `drop: { endsAt, cap }`, with no claim count, because there's no server count in web test.
- **Hyperline RIVALS:** remove the fake leaderboard; show the player's own best runs.
- Level and run events: `level_start` / `level_end` with `{ level, result, score }`; `feedback.maybePrompt()` after a win or death screen.
- **Compliance test** (reads the HTML): no `mockBuy`, no `RIVALS`, no `Math.random` next to `claimed`, every `$` price is inside a `purchase.offer` call, the SDK is imported.

- [ ] Library test, then the compliance test, both red before porting, green after. Commit `feat(games): port Tidepool Pals and Hyperline onto the SDK`.

### Task 7: Dev loop, seed, rollup job, demo

**Files:** `scripts/dev.ts` (API on :8787, static games plus SDK on :5174 with `/sdk/studio-sdk.js`), `scripts/seed.ts` (library → SQLite registry at `.data/registry.db`, stage 2, idempotent), `scripts/rollup.ts` (ObjectStore events → `rollupMetrics` → `putMetrics`), `scripts/demo-1b.ts` (fresh `.data/demo/`; simulates players through the real ingest HTTP; rollup; `runGateCycle`; prints snapshots and outcomes); `test/e2e-local.test.ts` in `services/api`, which runs the same path in-process.

- [ ] E2E test red, then green. Root scripts: `dev`, `seed`, `rollup`, `gates`, `demo:1b`. Commit `feat: local dev loop, seed, rollup, demo`.
