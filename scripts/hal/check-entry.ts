// One Hal check, run in the tree that holds this file and printed as `HAL-RESULT <json>` on the last line.
// Hal runs it in a candidate worktree under sandbox-exec (scripts/hal/sandbox.ts), never in its own process: the
// scorers, screens and controls execute the candidate's game code. scripts/hal/** is protected, so this file is main's.
//   check-entry.ts score <scorer> | screens <game> [outDir] | controls <game> | shoot <game> <out.jpg> [focus]
//                  | fingerprint <game>
// The result line is `HAL-RESULT <nonce> <json>`: the nonce comes in $HAL_CHECK_NONCE. check-nonce.ts is imported
// first: it deletes the nonce from the env and captures JSON.stringify and stdout.write before anything else loads;
// everything that can load game code is imported dynamically, after the channel has been taken.
//
// Residual (ruling R17, accepted): game code runs in this process when a scorer imports it, so in principle it could
// forge a score through intrinsics (patching Array/Object prototypes the scorer relies on, or recovering the nonce
// from the process's original exec environment). The score gate is a quality gate, not the safety boundary: the
// tripwires (host-api flags Node host APIs and any import of scripts/ or Hal's own modules) and the sandbox are, and
// Brian reviews every merge each morning.
import { takeResultChannel } from './check-nonce.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = takeResultChannel();

async function main(op: string | undefined, a: string | undefined, b: string | undefined, c?: string): Promise<void> {
  if (!a) throw new Error('usage: check-entry.ts <score|screens|controls|shoot|fingerprint> <name> [out] [focus]');
  switch (op) {
    case 'score': {
      const { blockBarnScorer, gearholdPlayScorer, SCORERS, scorerFor } = await import('@studio/core/hal');
      const scorers = {
        ...SCORERS,
        'gearhold-play': gearholdPlayScorer(async (o) => (await import('./gearhold-play.js')).runGearholdPlay(o)),
        'block-barn': blockBarnScorer(async () => (await import('./block-barn-play.js')).runBlockBarnPlay()),
      };
      const s = scorerFor(a, scorers);
      return out(await s.score(s.defaults));
    }
    case 'screens': {
      // `screens <game> [outDir]`: Hal's play phase names the (writable) dir to keep the shots; otherwise the child's own temp dir.
      const outDir = b ?? await mkdtemp(join(tmpdir(), 'hal-screens-'));
      const [r] = await (await import('./screens.js')).runScreens({ outDir, games: [a] });
      if (!r) throw new Error(`no screen flow for ${a}`);
      return out(r);
    }
    case 'controls': return out(await (await import('./controls.js')).runControlsCheck({ games: [a] }));
    case 'shoot': {
      if (!b) throw new Error('shoot needs an output path');
      const { repo } = await import('./browser.js');
      const focus = c === undefined ? undefined : Number(c);
      await (await import('./screens.js')).shootGame(repo, a, b, focus);
      return out({ ok: true });
    }
    case 'fingerprint': {
      const { repo } = await import('./browser.js');
      return out(await (await import('./focus.js')).fingerprintGame(repo, a));
    }
    default: throw new Error(`unknown check ${op}`);
  }
}

main(process.argv[2], process.argv[3], process.argv[4], process.argv[5]).then(() => process.exit(0), (e) => {
  console.error(String((e as Error)?.message ?? e));
  process.exit(1);
});
