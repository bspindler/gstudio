// npm run hal: score the game, keep a baseline, gate a change, show the ledger, take screenshots, check real controls. Writes only under .data/hal/.
// Hal runs with TSX_DISABLE_CACHE=1: tsx's transform cache lives in the shared tmpdir, which Hal must never load code
// from. The launchd plists and the Run-now spawn set it. The npm script cannot (scripts stay Windows-safe, see the repo
// hygiene test), so a hand-started `npm run hal -- run` warns unless the shell exports it:
//   export TSX_DISABLE_CACHE=1   (e.g. in ~/.zprofile)
// The npm script is `node --import tsx`, never the tsx CLI: the CLI opens an IPC socket in the temp dir, which Claude
// Code's sandbox (the implementer's Bash) refuses with EPERM.
// The logic lives in scripts/hal/cli.ts; this wires the real scorers. Core never imports Playwright, so the browser-backed
// gearhold-play and block-barn scorers are built here from core's gearholdPlayScorer / blockBarnScorer and lazily loaded
// runners. Block Barn's only scorer is the browser one, so registering it here is what puts the game in Hal's loop.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blockBarnScorer, gearholdPlayScorer, SCORERS, type Scorer } from '@studio/core/hal';
import { main } from './hal/cli.js';
import { askHalToScore, SCORE_DIR_ENV } from './hal/score-broker.js';

// Same root local-env.ts uses; not imported from there so this CLI doesn't load the SQLite adapter.
const repo = fileURLToPath(new URL('../', import.meta.url));
const scorers: Record<string, Scorer> = {
  ...SCORERS,
  'gearhold-play': gearholdPlayScorer(async (o) => (await import('./hal/gearhold-play.js')).runGearholdPlay(o)),
  'block-barn': blockBarnScorer(async () => (await import('./hal/block-barn-play.js')).runBlockBarnPlay()),
};
if (process.env.TSX_DISABLE_CACHE !== '1' && ['run', 'undo'].includes(process.argv[2] ?? '')) {
  console.error('warning: TSX_DISABLE_CACHE is not set; Hal should not load tsx\'s shared-tmp transform cache (export TSX_DISABLE_CACHE=1)');
}
// Set only for the implementer, inside a Hal build: `score` asks Hal (scripts/hal/score-broker.ts).
const scoreDir = process.env[SCORE_DIR_ENV];
const code = await main(process.argv.slice(2), {
  scorers,
  ...(scoreDir ? { askHal: (scorer: string) => askHalToScore(scoreDir, scorer) } : {}),
  halDir: join(repo, '.data', 'hal'),
  repo,
  runScreens: async (o) => (await import('./hal/screens.js')).runScreens(o),
  runControlsCheck: async () => (await import('./hal/controls.js')).runControlsCheck(),
});
process.exit(code);
