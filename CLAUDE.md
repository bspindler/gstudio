# Studio in a Box

A platform that takes small mobile games from idea to worldwide launch with minimal human involvement. It covers the game registry, builds, QA, the stage-gate rollout, market expansion, marketing clips, and measurement. Brian is the operator; he is pulled in only for approvals, decisions, or when the system is stuck. The full brief is in `docs/game-studio-prompt.md`, and the approved design is in `docs/architecture.md`.

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

## Conventions

- TypeScript strict, ESM, Node 22, npm workspaces.
- TDD with vitest. Write the failing test first.
- Inject time (`clock`) and IDs (`ids`) so that core logic stays deterministic.
- Core logic has no Azure dependencies. Storage, queues, secrets and notifications sit behind ports, with local adapters (SQLite and the filesystem) and Azure adapters. Local dev must never require Azure.
- Infrastructure is Bicep only (`infra/`). Secrets live in Key Vault and are reached via managed identity; never put them in the repo.
- Money is USD numbers. Rates are fractions from 0 to 1.

## Repo map

```
games/<slug>/        HTML5 games (no build step)          [Plan 1b]
packages/core/       domain, policy, registry, gateway, gates
adapters/local|azure ports implementations                 [Plan 1c]
apps/console|portal  operator PWA, public portal          [Plan 1c]
infra/               Bicep
policy.yaml          autonomy policy, gates, budgets (operator-owned)
markets.yaml         market tiers
docs/platforms/      platform research (Apple, Play, social, ads, portals, markets)
archive/prototypes/  original prototypes, kept as-is
```
