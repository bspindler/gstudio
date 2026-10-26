# Phase 1a: Foundation Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the repo scaffold, `CLAUDE.md`, `policy.yaml` and `markets.yaml`, and the registry domain model. On top of those, build the ActionGateway (kill switch, hard rules, autonomy policy, budget caps), the immutable audit trail, the Inbox approval flow, and the stage-gate engine. All of it runs and is tested locally with an in-memory store. This plan also adds a Bicep skeleton that compiles, ready to deploy once the Azure subscription exists.

**Architecture:** This plan covers Phase 1 steps 1–2 from `docs/game-studio-prompt.md`. Everything lives in `packages/core` as plain TypeScript with no Azure dependencies. Storage sits behind a `RegistryStore` interface: this plan ships `MemoryStore`, and Plan 1c adds `CosmosStore`. All side effects go through `createGateway()`. Gate rules are pure functions over metrics snapshots. Time and IDs are injected so tests are deterministic.

**Tech Stack:** Node 22, TypeScript 5 (strict, ESM, NodeNext), npm workspaces (pnpm isn't installed, and npm keeps us dependency-light), vitest, zod, yaml. Infra is Bicep, built with `az bicep` (az 2.87 is installed).

**Spec:** `docs/architecture.md` (v0.3, approved 2026-10-25) and `docs/game-studio-prompt.md`. The research behind the thresholds is in `docs/platforms/`.

**Follow-on plans (written after this one lands, so they build against the real interfaces):**
- **1b:** shared game SDK, ports of Tidepool Pals and Hyperline, analytics ingest, metric rollups.
- **1c:** `CosmosStore`, the Functions API, operator console v1, the web portal, and deploying to Azure dev.

## Global Constraints

- The hard rules are never configurable. They live in code (`packages/core/src/gateway/hard-rules.ts`), and `CLAUDE.md` copies them verbatim from the prompt.
- These action kinds have an **approve floor**: `policy.yaml` can never classify them below `approve`. The policy loader rejects any file that tries.
  - `spend`
  - `store.submit`
  - `market.expand`
  - `price.change`
  - `iap.change`
  - `account.create`
  - `stage.kill` for games at stage 3 or later
- **Fail closed.** If policy is missing or invalid, or an action kind is unknown, the action is blocked; it is never treated as `auto`.
- The kill switch blocks every `spend` and `post.public` action. That includes approvals that were already pending when the switch was engaged.
- Budget caps are enforced in code before execution, using an atomic reserve-then-execute pattern.
- No secrets in the repo. `.gitignore` must cover `local.settings.json`, `.env*`, and `*.pem`.
- Every gateway decision appends an audit entry. The store API has no update or delete for audit entries.
- Stage numbers and names: 0 concept, 1 prototype, 2 web_test, 3 beta, 4 soft_launch, 5 expansion, 6 live_ops, 7 sunset.
- Units: money is in USD as a number with cents precision, and rates are fractions from 0 to 1.

## Review Focus

1. **Typo in `policy.yaml`** (unknown key or action kind, or an invalid class): loading throws an error naming the offending path. Gateway tests prove an unloadable policy blocks every non-auto action. Covered in Tasks 2 and 6.
2. **Kill switch engaged while an approval is pending:** approving the item afterwards returns `blocked: kill_switch`, and its executor never runs. Covered in Task 6.
3. **Two spend actions that each fit the cap but together exceed it:** the second one is blocked, `budget_cap`, even when the two are submitted concurrently with `Promise.all`. Covered in Task 5.
4. **Gate run with missing metrics, stale metrics, or too few players:** the decision is `hold` with `insufficientData: true`, never `kill`. Covered in Task 7.
5. **Inbox item approved twice** (a double-tap on the phone, or two devices): the executor runs exactly once, and the second call returns `blocked: already_decided`. Covered in Task 6.

---

## File Structure

```
package.json                    npm workspaces root (scripts: test, typecheck, lint:infra)
tsconfig.base.json
.gitignore  .editorconfig
CLAUDE.md                       rules for agents (hard rules verbatim, policy summary, conventions)
policy.yaml                     autonomy policy, gates, budgets (operator-editable)
markets.yaml                    market tiers (from docs/platforms/markets.md)
docs/game-studio-prompt.md      moved from repo root
archive/prototypes/             tidepool.html, hyperline.html (originals, untouched)
packages/core/
  package.json  tsconfig.json  vitest.config.ts
  src/index.ts                  public exports
  src/domain/types.ts           Stage, Game, MetricsSnapshot, AuditEntry, InboxItem, LedgerEntry, Settings
  src/domain/actions.ts         ActionKind catalog, Action, APPROVE_FLOOR
  src/policy/schema.ts          zod schema for policy.yaml
  src/policy/load.ts            loadPolicy(path) / parsePolicy(text)
  src/policy/classify.ts        classifyAction(action, policy)
  src/markets/load.ts           loadMarkets(path)
  src/registry/store.ts         RegistryStore interface
  src/registry/memory-store.ts  MemoryStore
  src/gateway/hard-rules.ts     checkHardRules(action)
  src/gateway/budget.ts         reserveBudget / settleBudget / budgetStatus
  src/gateway/gateway.ts        createGateway()
  src/gates/evaluate.ts         evaluateGate()
  src/gates/cycle.ts            runGateCycle()
  test/*.test.ts                one per src module
infra/
  main.bicep  modules/{monitoring,storage,cosmos,keyvault,functions}.bicep
  dev.bicepparam  prod.bicepparam
.github/workflows/ci.yml
```

---

### Task 1: Repo scaffold, CLAUDE.md, CI

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `.editorconfig`, `CLAUDE.md`, `.github/workflows/ci.yml`, `packages/core/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`, `packages/core/test/smoke.test.ts`
- Move: `game-studio-prompt.md` → `docs/game-studio-prompt.md`; `tidepool.html`, `Hyperline.html` → `archive/prototypes/tidepool.html`, `archive/prototypes/hyperline.html` (lowercase the filename)

**Interfaces:**
- Produces: `npm test` (vitest across workspaces) and `npm run typecheck` (`tsc -b`). The package name is `@studio/core`, ESM, and its exports come from `src/index.ts`.

- [ ] **Step 1:** Run `git init -b main`, then make the moves listed above with `git mv` after the first commit of the untouched originals. That way the history shows the move instead of a delete-and-add.
- [ ] **Step 2:** Write the root `package.json`:
  - `"private": true`
  - `"type": "module"`
  - `"workspaces": ["packages/*"]`
  - scripts `test: vitest run --root packages/core` (later plans broaden this to a workspace glob), `typecheck: tsc -b packages/core`, and `lint:infra: az bicep build --file infra/main.bicep --stdout > /dev/null`
  - devDependencies `typescript@^5.6`, `vitest@^2`, `@types/node@^22`, `tsx@^4`
  - In `packages/core`, dependencies `zod@^3.23` and `yaml@^2.5`
- [ ] **Step 3:** Write `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`, `module/moduleResolution: NodeNext`, `target: ES2023`, and `declaration`.
- [ ] **Step 4:** Write `packages/core/test/smoke.test.ts`, which asserts that `import('@studio/core')` resolves. Run `npm install && npm test` and expect 1 passing test.
- [ ] **Step 5:** Write `CLAUDE.md` with these sections:
  1. Purpose (a two-line summary of Studio in a Box).
  2. **Hard rules (never configurable)**, copied verbatim from `docs/game-studio-prompt.md`.
  3. Autonomy: all external side effects go through `createGateway()`; never call platform APIs directly. `policy.yaml` is operator-owned; propose changes with data and never loosen it silently.
  4. Approve-floor action kinds (the list in Global Constraints).
  5. Conventions:
     - TypeScript strict and ESM.
     - TDD with vitest.
     - Inject time and IDs.
     - Infrastructure is Bicep only.
     - Secrets go in Key Vault, accessed via managed identity.
  6. Repo map (the File Structure tree above, trimmed).
  7. Where the research lives (`docs/platforms/`).
- [ ] **Step 6:** Write `.github/workflows/ci.yml`. On push and PR, it runs on ubuntu-latest: Node 22, then `npm ci`, `npm run typecheck`, `npm test`, `az bicep install && npm run lint:infra`.
- [ ] **Step 7:** Commit with the message `chore: scaffold monorepo, CLAUDE.md, CI`.

### Task 2: Action catalog, policy.yaml, markets.yaml, loaders, classifier

**Files:**
- Create: `packages/core/src/domain/actions.ts`, `src/policy/{schema,load,classify}.ts`, `src/markets/load.ts`, `policy.yaml`, `markets.yaml`
- Test: `packages/core/test/policy.test.ts`, `test/markets.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const ACTION_KINDS = ['build','qa.run','clip.generate','draft.generate','data.analyze','report.file',
    'stage.advance','stage.kill','web.publish','balance.tweak','spend','post.public','store.listing',
    'store.submit','market.expand','price.change','iap.change','account.create'] as const;
  export type ActionKind = typeof ACTION_KINDS[number];
  export type ActionClass = 'auto' | 'notify' | 'approve';
  export type Stage = 0|1|2|3|4|5|6|7;            // re-exported from domain/types.ts
  export interface Action {
    kind: ActionKind; gameSlug?: string; params: Record<string, unknown>;
    costUsd?: number; channel?: string; fromStage?: Stage; toStage?: Stage;
    requestedBy: 'system' | 'operator'; rationale?: string;
  }
  export const APPROVE_FLOOR: ReadonlySet<ActionKind>; // spend, store.submit, market.expand, price.change, iap.change, account.create
  export type Policy = z.infer<typeof PolicySchema>;
  export function parsePolicy(yamlText: string): Policy;      // throws PolicyError(message incl. path)
  export function loadPolicy(path: string): Promise<Policy>;
  export function classifyAction(a: Action, p: Policy): ActionClass; // throws on unknown kind
  export interface Markets { excluded: { regions: string[]; countries: string[] }; tiers: Record<'tier3'|'tier2'|'tier1', MarketTier> }
  export function loadMarkets(path: string): Promise<Markets>;
  ```

`policy.yaml`, with exact values. Values Brian didn't set are marked `# claude-default` so he can see which ones were my calls:

```yaml
version: 1
actions:
  build: auto
  qa.run: auto
  clip.generate: auto
  draft.generate: auto
  data.analyze: auto
  report.file: auto
  web.publish: notify
  balance.tweak: notify
  store.listing: approve
  store.submit: approve
  market.expand: approve
  price.change: approve
  iap.change: approve
  account.create: approve
  spend: approve
  post.public:
    default: approve
    channels: { tiktok: approve, instagram: approve, youtube: approve }
  stage.advance:            # key "from->to"
    "0->1": auto
    "1->2": approve         # fun-check by Brian
    "2->3": notify
    "3->4": approve         # store submission + first markets
    "4->5": approve         # market expansion
    "5->6": notify
  stage.kill:
    max_auto_stage: 2       # stages 0-2 auto; 3+ forced to approve (floor)
gates:
  "0->1": { min_concept_score: 0.6 }                      # claude-default
  "1->2": { require: [qa_passed, bot_playable] }
  "2->3":
    min_players: 200
    min_avg_rating: 3.8
    min_rating_count: 20                                  # claude-default
    d1: { portal: 0.15, own_site: 0.30 }                  # research-adjusted, see docs/architecture.md
    kill_d1: { portal: 0.07, own_site: 0.15 }             # claude-default: "clearly fails"
    max_metrics_age_days: 3
  "3->4": { min_crash_free: 0.995, require: [store_readiness] }
  "4->5": { d1: 0.35, d7: 0.12, min_ltv_over_cpi: 1.0, min_players: 500, max_metrics_age_days: 10 }
  sunset: { consecutive_failing_cycles: 2 }
budgets:                    # all zero until Phase 4; any spend is blocked
  overall: { daily_usd: 0, total_usd: 0 }
  per_game_default: { daily_usd: 0, total_usd: 0 }
  per_game: {}
  claude: { monthly_usd: 100 }
inbox:
  escalate_after_hours: 24
```

`markets.yaml`: copy the YAML block from `docs/platforms/markets.md` (lines 100–~150), keeping its structure.

- [ ] **Step 1: Write failing tests** in `policy.test.ts`:
  - `parses repo policy.yaml`: `loadPolicy('../../policy.yaml')` returns `actions.build === 'auto'` and `gates['2->3'].d1.portal === 0.15`.
  - `rejects unknown action key`: parsing the policy with `actions.spnd: auto` added throws a message containing `actions.spnd`.
  - `rejects invalid class`: `build: sometimes` throws a message containing `actions.build`.
  - `rejects loosening an approve-floor kind`: `spend: notify` throws a message containing `approve floor`. Repeat for each kind in `APPROVE_FLOOR`.
  - `rejects stage.kill.max_auto_stage > 2`: setting it to 3 throws.
  - `classifies stage.advance by transition`:
    - `{kind:'stage.advance', fromStage:1, toStage:2}` gives `approve`.
    - `0->1` gives `auto`.
    - `2->3` gives `notify`.
    - A transition missing from the policy (for example `6->7`) gives `approve`, because unlisted transitions fail closed.
  - `classifies stage.kill by stage`: `fromStage:2` gives `auto`; `fromStage:3` gives `approve`.
  - `classifies post.public by channel`: channel `youtube` gives `approve`; an unknown channel `x` falls back to `default`, which is `approve`.
  - `classifyAction throws on unknown kind`: `{kind:'nuke'}` cast to Action throws.
- [ ] **Step 2: Write failing test** in `markets.test.ts`: loading the repo `markets.yaml` gives `tiers.tier3.countries` deep-equal to `['PH','MY','TH','BR','MX']`, and `excluded.countries` contains `'VN'`.
- [ ] **Step 3:** Run `npm test`. Expected: FAIL (modules not found).
- [ ] **Step 4:** Implement the schema with `z.object(...).strict()` at every level so unknown keys are rejected. Add a `superRefine` for the approve floor and `max_auto_stage ≤ 2`. `PolicyError` formats `ZodError` issues as `path.join('.') + ': ' + message`.
- [ ] **Step 5:** Run `npm test`. Expected: PASS.
- [ ] **Step 6:** Commit with the message `feat(core): action catalog, policy + markets config with fail-closed loader`.

### Task 3: Domain types and RegistryStore with MemoryStore

**Files:**
- Create: `packages/core/src/domain/types.ts`, `src/registry/store.ts`, `src/registry/memory-store.ts`
- Create: `packages/core/src/registry/contract.ts` (an exported contract suite)
- Test: `packages/core/test/memory-store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Game {
    slug: string; title: string; genre: string; targetSegment: string; stage: Stage;
    markets: string[];                                   // ISO codes where live
    versions: { version: string; createdAt: string; notes: string }[];
    ageRating: string | null;
    storeIds: { appStore?: string; play?: string; crazygames?: string; itch?: string };
    valueEstimate: { ltvUsd: number; cpiUsdByMarket: Record<string, number>; asOf: string; workings: string } | null;
    failingCycles: number; createdAt: string; updatedAt: string;
  }
  export type MetricsChannel = 'portal' | 'own_site' | 'store';
  export interface MetricsSnapshot {
    gameSlug: string; channel: MetricsChannel; asOf: string; players: number;
    d1: number | null; d7: number | null; avgSessionSec: number | null;
    purchaseIntentRate: number | null; avgRating: number | null; ratingCount: number;
    crashFreeRate: number | null;
  }
  export interface AuditEntry { id: string; at: string; actor: 'system'|'operator'|'claude';
    gameSlug?: string; type: string; summary: string; data: Record<string, unknown>; }
  export type InboxStatus = 'pending' | 'approved' | 'rejected';
  export interface InboxItem { id: string; createdAt: string; status: InboxStatus; action: Action;
    title: string; recommendation: string; keyNumbers: { label: string; value: string }[];
    decision?: { at: string; by: string; choice: 'approve'|'reject'|'modify'; modifiedParams?: Record<string, unknown> };
    escalatedAt?: string; }
  export interface LedgerEntry { id: string; at: string; gameSlug: string | null; amountUsd: number;
    kind: 'reserve' | 'release' | 'actual'; reservationId: string; }
  export interface Settings { killSwitch: { engaged: boolean; at?: string; by?: string } }

  export interface RegistryStore {
    getGame(slug: string): Promise<Game | undefined>;
    putGame(g: Game): Promise<void>;
    listGames(): Promise<Game[]>;
    appendAudit(e: Omit<AuditEntry, 'id'>): Promise<AuditEntry>;
    listAudit(f?: { gameSlug?: string }): Promise<AuditEntry[]>;           // oldest first
    putInboxItem(i: InboxItem): Promise<void>;
    getInboxItem(id: string): Promise<InboxItem | undefined>;
    listInbox(status?: InboxStatus): Promise<InboxItem[]>;
    /** Compare-and-set: applies patch only if current status === expected. Returns false otherwise. */
    transitionInboxItem(id: string, expected: InboxStatus, patch: Partial<InboxItem>): Promise<boolean>;
    appendLedger(e: Omit<LedgerEntry, 'id'>): Promise<LedgerEntry>;
    listLedger(f?: { gameSlug?: string; sinceIso?: string }): Promise<LedgerEntry[]>;
    /** Serializes fn against other calls with the same key (budget reservations). */
    withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
    putMetrics(m: MetricsSnapshot): Promise<void>;
    latestMetrics(slug: string): Promise<MetricsSnapshot[]>;               // latest per channel
    getSettings(): Promise<Settings>;                                      // default {killSwitch:{engaged:false}}
    putSettings(s: Settings): Promise<void>;
  }
  export class MemoryStore implements RegistryStore { constructor(ids?: () => string) }
  /** Shared vitest suite that every RegistryStore adapter (Memory now; SQLite and Cosmos in 1c) must pass. */
  export function registryStoreContract(name: string, make: () => Promise<RegistryStore>): void;
  ```

- [ ] **Step 1: Write failing tests** inside `registryStoreContract` in `src/registry/contract.ts`. `memory-store.test.ts` just calls `registryStoreContract('memory', async () => new MemoryStore())`. The suite contains:
  - `game round-trip`: `putGame` then `getGame` returns a deep-equal copy, and mutating the returned object doesn't change stored state, because the store clones on both read and write.
  - `audit is append-only and ordered`: three appends come back from `listAudit()` in insertion order with unique ids. `Object.keys(MemoryStore.prototype)` has no method matching `/audit/i` other than `appendAudit` and `listAudit`.
  - `transitionInboxItem is CAS`: put a pending item. `transitionInboxItem(id,'pending',{status:'approved'})` returns `true`, and repeating the call returns `false`.
  - `withLock serializes`: two concurrent `withLock('b', ...)` calls, each of which awaits a 10ms timer and pushes to an array, record `['a-start','a-end','b-start','b-end']`.
  - `latestMetrics returns newest per channel`: two `portal` snapshots and one `own_site` snapshot give two results, and the portal result is the one with the later `asOf`.
  - `settings default`: a fresh store's `getSettings()` returns `{killSwitch:{engaged:false}}`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement `MemoryStore` with Maps, `structuredClone` on every read and write, and a promise-chain mutex per key in `withLock`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit with the message `feat(core): registry domain types and in-memory store`.

### Task 4: Hard rules

**Files:**
- Create: `packages/core/src/gateway/hard-rules.ts`
- Test: `packages/core/test/hard-rules.test.ts`

**Interfaces:**
- Produces: `export function checkHardRules(a: Action): string | null`. It returns null when the action is allowed, or a rule id with a reason, e.g. `'HR1: paid random reward without drop odds'`.

The rules apply to action params. Only these are checked in code; the rest are enforced by review and by `CLAUDE.md`:

| Rule | Check |
|---|---|
| HR1 | `iap.change`, `price.change`, or `balance.tweak` with `params.randomReward === true` must have `params.dropOdds`, an object of fractions summing to 1 ± 0.001 |
| HR1 | Any `params.realMoneyPrize`, `params.crypto`, or `params.cashValue` set to true is rejected |
| HR3 | `web.publish` with `params.realPayments === true` is rejected (web builds may only use fake-door purchases) |
| HR4 | `params.limitedDrop` must have `cap` (a positive integer), `endsAt` (an ISO date in the future relative to `params.now ?? Date.now()`), and must not have `params.syntheticClaimCount` |
| HR4 | `params.countdownResets === true` is rejected (a timer that resets is a fake timer) |
| HR2 | `post.public` and `spend` must have `params.via === 'official_api'` or `params.via === 'manual_by_operator'` |
| — | `spend` must have a numeric `costUsd` ≥ 0 and a `gameSlug` |

- [ ] **Step 1: Write failing tests.** Each row of the table needs one rejecting case and one allowed case. Also add `fake scarcity from Hyperline prototype is rejected`: `{kind:'balance.tweak', params:{limitedDrop:{cap:5000,endsAt:<+7d>}, syntheticClaimCount:true}}` returns a string starting with `HR4`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the checks as a list of `(a: Action) => string | null`, returning the first non-null result.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with the message `feat(core): hard-rule checks enforced in code`.

### Task 5: Budget ledger

**Files:**
- Create: `packages/core/src/gateway/budget.ts`
- Test: `packages/core/test/budget.test.ts`

**Interfaces:**
- Consumes: `RegistryStore.withLock/appendLedger/listLedger`, and `Policy.budgets`.
- Produces:
  ```ts
  export type CapName = 'game_daily' | 'game_total' | 'overall_daily' | 'overall_total';
  export function reserveBudget(store: RegistryStore, policy: Policy,
    req: { gameSlug: string; amountUsd: number; now: Date })
    : Promise<{ ok: true; reservationId: string } | { ok: false; cap: CapName; capUsd: number; committedUsd: number }>;
  export function settleBudget(store: RegistryStore, reservationId: string,
    outcome: { actualUsd: number } | { release: true }, now: Date): Promise<void>;
  export function budgetStatus(store: RegistryStore, policy: Policy, now: Date)
    : Promise<{ overall: { dailyUsd: number; totalUsd: number }; perGame: Record<string, { dailyUsd: number; totalUsd: number }> }>;
  ```
- **How committed spend is counted:** committed = the sum over reservations, where each reservation counts its `actual` amount if one is recorded, otherwise its `reserve` amount if it hasn't been released.
- **The day boundary is UTC midnight.**
- **Per-game caps:** use `policy.budgets.per_game[slug]` if present, otherwise `per_game_default`.

- [ ] **Step 1: Write failing tests**, using a policy fixture with `per_game_default {daily_usd:50,total_usd:200}` and `overall {daily_usd:80,total_usd:1000}`:
  - `reserves within caps`: 30 gives ok.
  - `blocks over game daily`: 30 then 25 gives `{ok:false, cap:'game_daily', capUsd:50, committedUsd:30}`.
  - `concurrent reservations cannot jointly exceed`: `Promise.all([reserve 30, reserve 30])` with daily cap 50 gives exactly one ok.
  - `overall cap across games`: game A 50 and game B 40 against overall daily 80 gives B `overall_daily`.
  - `release frees budget`: reserve 30, release, then reserve 50 gives ok.
  - `actual replaces reservation`: reserve 30 settled with actual 10, then reserve 40 gives ok.
  - `daily resets at UTC midnight`: reserve 50 at 23:59Z, then 50 at 00:01Z the next day, gives ok.
  - `zero caps block everything`: with the repo `policy.yaml`, reserving 0.01 gives `game_daily`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the logic. The read, check, and append steps all happen inside `store.withLock('budget', ...)`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with the message `feat(core): atomic budget ledger with game/overall daily+total caps`.

### Task 6: ActionGateway, kill switch, Inbox decisions, audit

**Files:**
- Create: `packages/core/src/gateway/gateway.ts`
- Test: `packages/core/test/gateway.test.ts`

**Interfaces:**
- Consumes: `classifyAction`, `checkHardRules`, `reserveBudget`, `settleBudget`, and `RegistryStore`.
- Produces:
  ```ts
  export type Executor = (a: Action) => Promise<{ ok: boolean; detail?: string; actualUsd?: number }>;
  export interface Notification { title: string; body: string; gameSlug?: string; urgent: boolean }
  export interface GatewayDeps {
    store: RegistryStore;
    policy: Policy | (() => Promise<Policy>);           // a throwing loader => fail closed
    executors: Partial<Record<ActionKind, Executor>>;
    notify: (n: Notification) => Promise<void>;
    onKillSwitch?: () => Promise<void>;                  // pause all campaigns, cancel scheduled posts
    clock: () => Date; ids: () => string;
  }
  export interface InboxMeta { title: string; recommendation: string; keyNumbers: { label: string; value: string }[] }
  export type BlockReason = 'kill_switch' | 'hard_rule' | 'policy_unavailable' | 'unknown_action'
    | 'budget_cap' | 'no_executor' | 'already_decided' | 'not_found' | 'rejected';
  export type GatewayResult =
    | { status: 'executed'; notified: boolean; detail?: string }
    | { status: 'pending_approval'; inboxItemId: string }
    | { status: 'blocked'; reason: BlockReason; detail?: string }
    | { status: 'failed'; detail?: string };
  export function createGateway(d: GatewayDeps): {
    submit(a: Action, meta: InboxMeta): Promise<GatewayResult>;
    decide(itemId: string, d: { by: string; choice: 'approve'|'reject'|'modify'; modifiedParams?: Record<string, unknown> }): Promise<GatewayResult>;
    engageKillSwitch(by: string): Promise<void>;
    releaseKillSwitch(by: string): Promise<void>;
  };
  ```
- **What `submit` does, in order:**
  1. Kill switch (applies to `spend` and `post.public`).
  2. Hard rules.
  3. Load the policy and classify the action. A loader error gives `policy_unavailable`; a classification error gives `unknown_action`.
  4. If the class is `approve`: create a pending Inbox item, audit `inbox.created`, call `notify` with `urgent:false`, and return `pending_approval`.
  5. Otherwise, run the steps in `executeNow`.
- **What `executeNow` does:**
  1. Look up the executor. If there isn't one, return `no_executor`.
  2. If `costUsd > 0`, reserve budget. When the reservation fails:
     - audit `budget.cap_hit`
     - create an Inbox item titled `Budget cap hit: <cap>`
     - call `notify` with `urgent:true`
     - return `blocked: budget_cap`
  3. Run the executor.
  4. Settle the budget: record the actual amount on success, or release the reservation on failure.
  5. Audit `action.executed` or `action.failed`.
  6. If the class was `notify`, call `notify`.
- **What `decide` does:**
  - First, compare-and-set the item from `pending` to `approved` or `rejected`. If that fails, return `already_decided`.
  - **Approve:** re-run the kill switch, hard rules, and budget checks against the current state, then `executeNow`.
  - **Modify:** merge `modifiedParams` into `action.params`, re-run the hard rules, then treat it as approve.
  - **Reject:** audit it and return `blocked: rejected`.
- **Every path appends exactly one terminal audit entry**, with `data: { action, class, result }`.

- [ ] **Step 1: Write failing tests**, using `MemoryStore`, a fixed clock, sequential ids, spy executors, and a spy `notify`. Fixture `spend` and `post.public` actions carry `params.via: 'official_api'`, plus `gameSlug` and `costUsd`, so they pass HR2:
  - `auto action executes and audits`: `build` gives `executed`, notified false, the executor called once, and an audit entry of type `action.executed`.
  - `notify action executes then notifies`: `web.publish` gives `executed`, notified true, and `notify` called once.
  - `approve action creates inbox item and does not execute`: `store.submit` gives `pending_approval`, `listInbox('pending')` has length 1, and the executor is not called.
  - `approving executes once`: `decide(id,{choice:'approve'})` gives `executed`. A second identical `decide` gives `blocked: already_decided`, and the executor call count is still 1. This is Review Focus 5.
  - `reject never executes`: the result is `blocked: rejected` and the executor is not called.
  - `modify re-checks hard rules`: a pending `iap.change` modified to `{randomReward:true}` with no odds gives `blocked: hard_rule`.
  - `kill switch blocks spend and posting`: after `engageKillSwitch('brian')`, `spend` and `post.public` give `blocked: kill_switch`, while `build` still executes. `onKillSwitch` was called once.
  - `kill switch blocks a pending approval decided later`: submit `spend` (pending), engage the kill switch, then approve. The result is `blocked: kill_switch` and the executor is not called. This is Review Focus 2.
  - `policy loader failure fails closed`: the policy function throws, so `build` gives `blocked: policy_unavailable`. This is Review Focus 1.
  - `unknown action kind`: the result is `blocked: unknown_action`.
  - `budget cap creates urgent inbox item`: with per-game daily 50, approve a spend of 60. The result is `blocked: budget_cap`, there is an Inbox item whose title starts with `Budget cap hit`, and `notify` was called with `urgent:true`.
  - `executor failure releases budget`: an executor returning `{ok:false}` on a spend of 30 gives `failed`, and a new 50 reservation then succeeds.
  - `stage.kill at stage 3 needs approval`: `{kind:'stage.kill', fromStage:3}` gives `pending_approval`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement `createGateway` in `src/gateway/gateway.ts`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with the message `feat(core): ActionGateway with kill switch, policy classes, inbox approvals, audit`.

### Task 7: Stage-gate evaluation and gate cycle

**Files:**
- Create: `packages/core/src/gates/evaluate.ts`, `src/gates/cycle.ts`, `scripts/demo-gate-cycle.ts`
- Test: `packages/core/test/gates.test.ts`, `test/cycle.test.ts`

**Interfaces:**
- Consumes: `Game`, `MetricsSnapshot`, `Policy.gates`, `createGateway().submit`, and `RegistryStore`.
- Produces:
  ```ts
  export interface GateContext { now: Date; conceptScore?: number; qaPassed?: boolean; botPlayable?: boolean; storeReadiness?: boolean }
  export interface GateCheck { name: string; required: string; actual: string; pass: boolean }
  export interface GateEvaluation { slug: string; fromStage: Stage; toStage: Stage | null;
    decision: 'promote' | 'hold' | 'kill'; insufficientData: boolean; checks: GateCheck[] }
  export function evaluateGate(g: Game, m: MetricsSnapshot[], p: Policy, ctx: GateContext): GateEvaluation;

  export interface RationaleWriter { (e: GateEvaluation, g: Game): Promise<string> }  // Claude impl in 1c
  export const templateRationale: RationaleWriter;   // deterministic text from checks
  export function runGateCycle(d: { store: RegistryStore; gateway: ReturnType<typeof createGateway>;
    policy: Policy; rationale: RationaleWriter; context: (g: Game) => Promise<GateContext>; now: Date })
    : Promise<GateEvaluation[]>;
  ```
- **Gate logic** (all thresholds come from the policy; the numbers below come from the repo policy):
  - **0→1:** promote if `conceptScore ≥ 0.6`. Kill if the score is below that. Hold if the score is missing.
  - **1→2:** promote if both `qaPassed` and `botPlayable` are true; otherwise hold. Never kill from this gate; killing a prototype is Brian's call through the Inbox.
  - **2→3:** use the `portal` and `own_site` snapshots.
    - Insufficient data: if no snapshot is fresher than `max_metrics_age_days`, or total players are below 200, hold with `insufficientData`.
    - Promote: if a channel with enough players meets its own D1 target, and the combined rating is at least 3.8 over at least 20 ratings.
    - Kill: if total players ≥ 200 and every channel with any players is below its `kill_d1`.
    - Otherwise hold.
  - **3→4:** promote if the store snapshot's `crashFreeRate ≥ 0.995` and `storeReadiness` is true; otherwise hold. Never kill automatically.
  - **4→5:** use the store snapshot, with `max_metrics_age_days: 10` covering the Play data lag.
    - Promote: `d1 ≥ 0.35`, `d7 ≥ 0.12`, `players ≥ 500`, and `valueEstimate.ltvUsd / max(cpiUsdByMarket) ≥ 1.0`.
    - Hold with `insufficientData`: a missing `valueEstimate` or missing metrics.
    - Never kill automatically.
  - **Stages 5, 6 and 7:** return `hold` with a single check, `{name:'not_evaluated', required:'Phase 4'}`.
- **What `runGateCycle` does for each game:**
  1. Evaluate the gate.
  2. Append an audit entry `gate.evaluated` with the evaluation.
  3. On a hold, set `failingCycles` to 0 when the hold is due to insufficient data, and increment it when a check failed. On a promote or kill, reset it to 0.
  4. On a promote, submit a `stage.advance` (from→to). On a kill, submit a `stage.kill`.
  5. The submitted action's `rationale` comes from the `RationaleWriter`. `InboxMeta.keyNumbers` comes from the checks (label = name, value = `actual` vs `required`).
  6. Skip submitting if a pending Inbox item already exists for the same game, kind and transition, so no duplicates pile up.
  7. If the gateway result is `executed` and the kind is `stage.advance`, the stage executor updates `game.stage` itself. Register a default `stage.advance` executor and a `stage.kill` executor in the test gateway to show the flow end to end. The kill executor sets the stage to 7.

- [ ] **Step 1: Write failing tests** in `gates.test.ts`, using the repo `policy.yaml` and a fixed `now = 2026-11-01T00:00Z`:
  - `0->1 promotes at score 0.6, kills at 0.59, holds when missing`.
  - `1->2 holds unless qa and bot both pass`.
  - `2->3 promotes on portal D1 0.16 with 250 players and rating 4.0 over 25`.
  - `2->3 own_site needs 0.30`: own_site D1 0.25 with 250 players, rating fine, and no portal data gives `hold`.
  - `2->3 kills clear failure`: portal D1 0.05 with 300 players gives `kill`.
  - `2->3 never kills on insufficient data`: portal D1 0.01 with 150 players gives `hold` with `insufficientData: true` (Review Focus 4).
  - `2->3 stale metrics hold`: a snapshot with `asOf` 5 days before `now` gives `hold` with `insufficientData`.
  - `4->5 promotes when LTV covers max CPI`: d1 0.36, d7 0.13, 600 players, LTV 1.20, CPI {PH:0.40, MY:0.90} gives `promote`. With CPI MY at 1.30 it gives `hold`.
  - `4->5 missing value estimate is insufficient data`.
  - `stage 6 not evaluated yet`.
- [ ] **Step 2: Write failing tests** in `cycle.test.ts`, using `MemoryStore`, a real `createGateway` and the repo policy:
  - `cycle auto-advances 0->1 and audits`: a stage-0 game with concept score 0.8 ends at stage 1. The audit types include `gate.evaluated` and `action.executed`.
  - `cycle routes 1->2 to inbox`: a stage-1 game with qa and bot passing stays at stage 1, gets one pending Inbox item whose `keyNumbers` includes `qa_passed`, and its stage is unchanged.
  - `cycle does not duplicate pending items`: running the cycle twice still leaves one pending item.
  - `cycle auto-kills stage-2 clear failure`: the game ends at stage 7 and the audit includes the rationale text.
  - `failingCycles increments on failed hold, resets on insufficient data`.
- [ ] **Step 3:** Run the tests. Expected: FAIL.
- [ ] **Step 4:** Implement `evaluate.ts`, with one function per transition, dispatched by `fromStage`. Then implement `cycle.ts`, and write `scripts/demo-gate-cycle.ts` as described in the Phase 1a demo section.
- [ ] **Step 5:** Run the tests. Expected: PASS.
- [ ] **Step 6:** Commit with the message `feat(core): stage-gate evaluation and daily gate cycle`.

### Task 8: Bicep infra skeleton

**Files:**
- Create: `infra/main.bicep`, `infra/modules/{monitoring,storage,cosmos,keyvault,functions}.bicep`, `infra/dev.bicepparam`, `infra/prod.bicepparam`, `infra/README.md`

**Interfaces:**
- Produces: `main.bicep` (resourceGroup scope).
  - **Parameters:** `env` (`'dev'|'prod'`), `location` (default `'eastus2'`), `namePrefix` (default `'sib'`).
  - **Outputs:** `cosmosEndpoint`, `storageAccountName`, `keyVaultUri`, `functionAppName`, `appInsightsConnectionString`.
  - Plan 1c deploys this and adds the console and portal.

Resource decisions:
- **monitoring:** a Log Analytics workspace (PerGB2018, 30-day retention, `dailyQuotaGb: 1` as a cost guard) plus a workspace-based App Insights.
- **storage:** StorageV2 with `isHnsEnabled: true` (ADLS Gen2), `allowBlobPublicAccess: false`, TLS 1.2 minimum, and shared key access disabled.
  - Containers: `events`, `audit`, `builds`.
  - The `audit` container gets a time-based immutability policy of 3650 days. Leave it **unlocked** in dev, and add a comment that locking it in prod is a separate operator step.
  - Queues: `jobs`, `jobs-poison`.
- **cosmos:** a NoSQL account with `enableFreeTier: true` and `disableLocalAuth: true`. One database `registry` with shared throughput of 1000 RU/s.
  - Containers, as `name:/partitionKey`: `games:/slug`, `audit:/gameSlug`, `inbox:/id`, `ledger:/gameSlug`, `metrics:/gameSlug`, `settings:/id`.
- **keyvault:** RBAC authorization, soft-delete, and purge protection in prod only.
- **functions:** a Flex Consumption plan (`sku: FC1`) with a Node 22 runtime, a system-assigned identity, and `httpsOnly`.
  - Role assignments: Cosmos DB Built-in Data Contributor (via `sqlRoleAssignments`), Storage Blob Data Owner, Storage Queue Data Contributor, and Key Vault Secrets User.
  - The gateway-only secret split comes in Plan 1c, when there are separate apps.

- [ ] **Step 1:** Write the modules and `main.bicep`. Each param file sets `env` only.
- [ ] **Step 2:** Run `npm run lint:infra` and `az bicep lint --file infra/main.bicep`. Expected: exit 0 with no errors. Fix any warnings unless they're about the unlocked immutability policy.
- [ ] **Step 3:** Write `infra/README.md`: the prerequisites (a subscription per env and `az login`), the deploy command (`az stack group create --name sib-<env> --resource-group sib-<env>-rg --template-file infra/main.bicep --parameters infra/<env>.bicepparam --action-on-unmanage deleteResources --deny-settings-mode none`), and a `what-if` example.
- [ ] **Step 4:** Commit with the message `feat(infra): Bicep skeleton for registry, lake, vault, functions`.

---

## Phase 1a demo (end of plan)

- `npm test`: every test passes.
- `npx tsx scripts/demo-gate-cycle.ts`, a script created in Task 7 Step 4 that is about 40 lines. It seeds three games:
  - Tidepool Pals at stage 1, with QA passing.
  - Hyperline at stage 2, with healthy portal metrics.
  - A dummy at stage 2 that's clearly failing.

  It then runs one gate cycle and prints each evaluation, the Inbox items it created, and the audit trail.
- `npm run lint:infra` exits 0.
