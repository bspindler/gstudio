// npm run hal: score the game, keep a baseline, gate a change, show the ledger, take screenshots, check real controls. Writes only under .data/hal/.
// Hal runs with TSX_DISABLE_CACHE=1: tsx's transform cache lives in the shared tmpdir, which Hal must never load code
// from. The launchd plists and the Run-now spawn set it. The npm script cannot (scripts stay Windows-safe, see the repo
// hygiene test), so a hand-started `npm run hal -- run` warns unless the shell exports it:
//   export TSX_DISABLE_CACHE=1   (e.g. in ~/.zprofile)
// The logic lives in scripts/hal/cli.ts; this wires the real scorers. Core never imports Playwright, so the browser-backed
// gearhold-play scorer is built here from core's gearholdPlayScorer and a lazily loaded runner.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gearholdPlayScorer, SCORERS, type Scorer } from '@studio/core/hal';
import { main } from './hal/cli.js';

// Same root local-env.ts uses; not imported from there so this CLI doesn't load the SQLite adapter.
const repo = fileURLToPath(new URL('../', import.meta.url));
const scorers: Record<string, Scorer> = {
  ...SCORERS,
  'gearhold-play': gearholdPlayScorer(async (o) => (await import('./hal/gearhold-play.js')).runGearholdPlay(o)),
};
if (process.env.TSX_DISABLE_CACHE !== '1' && ['run', 'undo'].includes(process.argv[2] ?? '')) {
  console.error('warning: TSX_DISABLE_CACHE is not set; Hal should not load tsx\'s shared-tmp transform cache (export TSX_DISABLE_CACHE=1)');
}
const code = await main(process.argv.slice(2), {
  scorers,
  halDir: join(repo, '.data', 'hal'),
  runScreens: async (o) => (await import('./hal/screens.js')).runScreens(o),
  runControlsCheck: async () => (await import('./hal/controls.js')).runControlsCheck(),
});
process.exit(code);
