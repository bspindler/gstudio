# Studio in a Box

A platform that takes small mobile games from idea to worldwide launch with minimal human involvement. It covers the game registry, builds, QA, the stage-gate rollout, market expansion, marketing clips, and measurement. Brian is the operator; he is pulled in only for approvals, decisions, or when the system is stuck. The full brief is in `docs/game-studio-prompt.md`, and the approved design is in `docs/architecture.md`.

## Status

Phase 1a and 1b are merged to `main`. Plan 1c (console, portal, Azure adapters, deploy) is next and not yet written. `README.md` has the current status, the open 1c decision, the operator's outstanding setup steps, and the deferred minors from the 1b review (M1–M12). Read it first when resuming, and keep it updated at the end of each plan.

## Hard rules (never configurable)

1. **No real-money gambling, no crypto, no tokens, no prizes with cash value.** Paid random rewards always show drop odds.
2. **Follow every platform's rules.** Use only official APIs. No bots that mimic humans, no fake accounts, no fake reviews, no buying engagement, no scraping where terms forbid it. If an automation would need any of those, stop and tell me.
3. **No real charges outside the official store billing systems.** During web tests, purchase buttons are fake-door tests that log intent and honestly tell players the item is free during the beta.
4. **Protect minors.** No personal data from under-13s. Correct age-rating answers. No dark patterns: no fake timers, fake scarcity, or pressure after a player declines. Limited drops have real caps and real end dates.
5. **Privacy-light by default.** Anonymous player IDs. Store privacy labels must match what we actually collect.
6. **Original IP only.**
7. **Secrets in Azure Key Vault**, never in the repo. Least-privilege identity (managed identity + RBAC) per service. *(The original rule named AWS Secrets Manager and IAM; it was adapted when the platform moved to Azure on 2026-10-25, with the same intent.)*

## Autonomy

- Every external side effect (spending, posting, store submission, publishing, price changes, kills) goes through `createGateway()` in `packages/core`. Never call platform APIs directly from anywhere else.
- `policy.yaml` belongs to the operator. Propose a change with data first; never loosen it silently. When a heuristic turns out wrong, update `policy.yaml` and this file together.
- Approve floor, enforced by the policy loader: `spend`, `store.submit`, `market.expand`, `price.change`, `iap.change`, `account.create`, and `stage.kill` at stage 3 or later can never be classified below `approve`.
- Fail closed: if the policy is missing or invalid, or an action kind is unknown, the action is blocked.
- The kill switch blocks every `spend` and `post.public` action, including approvals that were pending when it was engaged.
- Random rewards are earned-only: nothing purchasable contains a random reward (operator decision, 2026-10-26; `markets.yaml` `paid_random_rewards: false`). The SDK refuses `randomReward` offers, and earned random rewards show odds at the point of opening.

## Conventions

- TypeScript strict, ESM, Node 22, npm workspaces.
- TDD with vitest. Write the failing test first.
- Inject time (`clock`) and IDs (`ids`) so that core logic stays deterministic.
- Core logic has no Azure dependencies. Storage, queues, secrets and notifications sit behind ports, with local adapters (SQLite and the filesystem) and Azure adapters. Local dev must never require Azure.
- Infrastructure is Bicep only (`infra/`). Secrets live in Key Vault and are reached via managed identity; never put them in the repo.
- Money is USD numbers. Rates are fractions from 0 to 1. Days are UTC.
- Games use only the SDK (`packages/sdk/studio-sdk.js`) for events, purchases, feedback, flags and odds. `packages/core/test/games-compliance.test.ts` checks every game statically.

## Local dev

- `npm test`, `npm run typecheck`
- `npm run dev`: API and ingest on :8787, games on :5174 (also on the LAN, for phones). Data goes to `.data/`.
- `npm run seed`, `npm run rollup`, `npm run gates`: register games, compute metrics, run a gate cycle.
- `npm run demo:1b`: synthetic players through the real ingest, written to `.data/demo`. Synthetic players are for local use only; never point them at a real channel (hard rule 2).

## Repo map

```
games/<slug>/        HTML5 games (no build step) + game.yaml
packages/core/       domain, policy, registry, gateway, gates, events, metrics rollup, library
packages/sdk/        browser game SDK (plain ES module, no deps)
adapters/local/      SQLite registry, filesystem object store
adapters/azure/      Cosmos, Blob, Queues, Key Vault          [Plan 1c]
services/api/        Hono app: ingest + API; jobs (seed, rollup)
apps/console|portal  operator PWA, public portal          [Plan 1c]
scripts/             dev server, seed, rollup, gates, demos
infra/               Bicep
policy.yaml          autonomy policy, gates, budgets (operator-owned)
markets.yaml         market tiers
docs/platforms/      platform research (Apple, Play, social, ads, portals, markets)
archive/prototypes/  original prototypes, kept as-is
```
