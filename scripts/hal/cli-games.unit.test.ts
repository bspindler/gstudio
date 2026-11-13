// cli.ts hands every subcommand the real game slugs, never scorer names: gearhold-play is Gearhold's second scorer,
// not a game, so neither `tell --game`, the Run-now page (serve) nor `run --game` may offer it.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blockBarnScorer, gearholdPlayScorer, SCORERS } from '@studio/core/hal';

const seen = vi.hoisted(() => ({ ops: [] as string[][], run: [] as string[][] }));
vi.mock('./cli-ops.js', async (orig) => ({
  ...(await orig<typeof import('./cli-ops.js')>()),
  runOpsCommand: async (_c: string, _r: string[], d: { games: string[] }) => { seen.ops.push(d.games); return 0; },
}));
vi.mock('./cli-run.js', async (orig) => ({
  ...(await orig<typeof import('./cli-run.js')>()),
  runRunCommand: async (_c: string, _r: string[], d: { games: string[] }) => { seen.run.push(d.games); return 0; },
}));
const { main } = await import('./cli.js');

let halDir: string, err: string[];
beforeEach(async () => {
  halDir = await mkdtemp(join(tmpdir(), 'hal-cli-games-'));
  err = [];
  seen.ops.length = 0; seen.run.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation((...a) => { err.push(a.join(' ')); });
});
afterEach(() => vi.restoreAllMocks());

// As scripts/hal.ts wires them: the core registry plus the two browser-backed scorers.
const deps = () => ({
  scorers: {
    ...SCORERS,
    'gearhold-play': gearholdPlayScorer(async () => ({ records: [], errors: [] })),
    'block-barn': blockBarnScorer(async () => { throw new Error('not run in this test'); }),
  },
  halDir, now: () => new Date('2026-11-12T03:00:00Z'),
});

describe('game slugs for subcommands', () => {
  it('tell --game accepts a real game and rejects gearhold-play', async () => {
    expect(await main(['tell', 'more robots', '--game', 'gearhold'], deps())).toBe(0);
    expect(await main(['tell', 'more robots', '--game', 'gearhold-play'], deps())).toBe(1);
    expect(err.join('\n')).toMatch(/unknown game gearhold-play/);
    expect(err.join('\n')).not.toMatch(/known: .*gearhold-play/);
  });
  it('tell --game accepts block-barn: its browser scorer is what makes it a game', async () => {
    expect(await main(['tell', 'a hiding duck', '--game', 'block-barn'], deps())).toBe(0);
  });
  it('serve (the Run-now page) and run get the game slugs only', async () => {
    expect(await main(['serve'], deps())).toBe(0);
    expect(await main(['run', '--report-only'], deps())).toBe(0);
    for (const games of [...seen.ops, ...seen.run]) {
      expect(games).toContain('gearhold');
      expect(games).not.toContain('gearhold-play');
      expect([...games].sort()).toEqual(['block-barn', 'gearhold', 'hyperline', 'tidepool-pals']);
    }
    expect(seen.ops).toHaveLength(1);
    expect(seen.run).toHaveLength(1);
  });
});
