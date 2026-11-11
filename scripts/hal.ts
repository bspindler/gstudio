// npm run hal: score the game, keep a baseline, gate a change, show the ledger, take screenshots. Writes only under .data/hal/.
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
const code = await main(process.argv.slice(2), {
  scorers,
  halDir: join(repo, '.data', 'hal'),
  runScreens: async (o) => (await import('./hal/screens.js')).runScreens(o),
});
process.exit(code);
