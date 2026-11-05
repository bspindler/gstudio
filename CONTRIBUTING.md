# Contributing

Thanks for helping. The repo is private, and contributors are invited by the operator.

1. **Start with [`docs/START-HERE.md`](docs/START-HERE.md).** It covers setup on Windows, making a game (`npm run new-game <slug>`), playing it on a phone, and the Git loop.
2. **Work on a branch.** Nobody pushes to `main` except the operator. Branch from an up-to-date `main`: `git switch -c <short-name>`.
3. **Open a pull request.** Changes reach `main` only through a PR, which needs the operator's review and passing CI on Windows and Linux.
4. **Tests must pass.** Run `npm test` and `npm run typecheck` before you push. `npm test` includes the compliance check on every game; fix the game, never weaken the test.
5. **The hard rules in [`CLAUDE.md`](CLAUDE.md) apply to every change and every game.** No gambling or crypto, no real charges outside store billing, no dark patterns, no data from under-13s, original IP only, no secrets in the repo.
6. **Stay in your lane.** Contributors don't edit `policy.yaml`, `markets.yaml`, `infra/`, or the gateway and policy code in `packages/core` unless the operator asks. Games use only the SDK (`packages/sdk/studio-sdk.js`); ask before adding any purchase.
7. **Using Claude Code?** Copy the personal templates in `docs/contributor/` (START-HERE step 3 shows how).
