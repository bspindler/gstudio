// One Hal check, run in the tree that holds this file and printed as `HAL-RESULT <json>` on the last line.
// Hal runs it in a candidate worktree under sandbox-exec (scripts/hal/sandbox.ts), never in its own process: the
// scorers, screens and controls execute the candidate's game code. scripts/hal/** is protected, so this file is main's.
//   check-entry.ts score <scorer> | screens <game> | controls <game> | shoot <game> <out.jpg>
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gearholdPlayScorer, SCORERS, scorerFor } from '@studio/core/hal';
import { repo } from './browser.js';

export const RESULT_PREFIX = 'HAL-RESULT ';
const out = (v: unknown) => { process.stdout.write(`\n${RESULT_PREFIX}${JSON.stringify(v)}\n`); };

async function main(op: string | undefined, a: string | undefined, b: string | undefined): Promise<void> {
  if (!a) throw new Error('usage: check-entry.ts <score|screens|controls|shoot> <name> [out]');
  switch (op) {
    case 'score': {
      const scorers = { ...SCORERS, 'gearhold-play': gearholdPlayScorer(async (o) => (await import('./gearhold-play.js')).runGearholdPlay(o)) };
      const s = scorerFor(a, scorers);
      return out(await s.score(s.defaults));
    }
    case 'screens': {
      const outDir = await mkdtemp(join(tmpdir(), 'hal-screens-'));
      const [r] = await (await import('./screens.js')).runScreens({ outDir, games: [a] });
      if (!r) throw new Error(`no screen flow for ${a}`);
      return out(r);
    }
    case 'controls': return out(await (await import('./controls.js')).runControlsCheck({ games: [a] }));
    case 'shoot': {
      if (!b) throw new Error('shoot needs an output path');
      await (await import('./screens.js')).shootGame(repo, a, b);
      return out({ ok: true });
    }
    default: throw new Error(`unknown check ${op}`);
  }
}

main(process.argv[2], process.argv[3], process.argv[4]).then(() => process.exit(0), (e) => {
  console.error(String((e as Error)?.message ?? e));
  process.exit(1);
});
