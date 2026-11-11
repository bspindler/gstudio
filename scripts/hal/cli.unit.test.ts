// Browser-free: the CLI with an injected fake gearhold-play runner (async scorer, errors -> exit 1, DISCARD -> exit 2).
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gearholdPlayScorer, SCORERS, type PlayRecord } from '@studio/core/hal';
import { main, type ScreensRun } from './cli.js';

const rec = (level: number, seed: number): PlayRecord => ({ level, seed, result: 'win', time: 60, hpLeft: 50, kills: 3, foes: 3, shotsFired: 10, hits: 5, damageTaken: 10, damageUnseen: 1, cause: '' });
let out: string[], err: string[], halDir: string;
beforeEach(async () => {
  out = []; err = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a) => { err.push(a.join(' ')); });
  halDir = await mkdtemp(join(tmpdir(), 'hal-cli-'));
});
afterEach(() => vi.restoreAllMocks());

const deps = (run: Parameters<typeof gearholdPlayScorer>[0], runScreens?: (o: { outDir?: string }) => Promise<ScreensRun[]>) =>
  ({ scorers: { ...SCORERS, 'gearhold-play': gearholdPlayScorer(run) }, halDir, runScreens });
const good = async (o: { levels: number[]; seeds: number }) => ({ records: o.levels.flatMap((l) => Array.from({ length: o.seeds }, (_, s) => rec(l, s))), errors: [] as string[] });

describe('hal CLI with an async scorer', () => {
  it('baseline then the same no-op check is DISCARD (exit 2) with an identical fitness', async () => {
    expect(await main(['baseline', '--game', 'gearhold-play', '--seeds', '2'], deps(good))).toBe(0);
    const base = JSON.parse(await readFile(join(halDir, 'baseline', 'gearhold-play.json'), 'utf8'));
    expect(base.range).toEqual({ levels: 3, seeds: 2 });
    for (let i = 0; i < 2; i++) expect(await main(['check', '--game', 'gearhold-play', '--seeds', '2', '--change', 'no-op'], deps(good))).toBe(2);
    expect(out.filter((l) => l.startsWith('DISCARD'))).toHaveLength(2);
    const ledger = JSON.parse(await readFile(join(halDir, 'ledger.json'), 'utf8'));
    expect(ledger.passes.map((p: { fitness: number }) => p.fitness)).toEqual([base.report.fitness, base.report.fitness]);
  });

  it('runner errors exit 1 with the message and write no baseline or ledger entry', async () => {
    const bad = async () => ({ records: [rec(0, 0)], errors: ['level 0 seed 1: page error: boom'] });
    for (const cmd of [['score'], ['baseline'], ['check', '--change', 'x']]) {
      err.length = 0;
      expect(await main([cmd[0]!, '--game', 'gearhold-play', ...cmd.slice(1)], deps(bad))).toBe(1);
      expect(err.join('\n')).toMatch(/page error: boom/);
    }
    await expect(readFile(join(halDir, 'baseline', 'gearhold-play.json'))).rejects.toThrow();
    await expect(readFile(join(halDir, 'ledger.json'))).rejects.toThrow();
  });

  it('a rejecting runner (browser unavailable) exits 1', async () => {
    const down = async (): Promise<never> => { throw new Error('browser unavailable: gpu: nope'); };
    expect(await main(['check', '--game', 'gearhold-play', '--change', 'x'], deps(down))).toBe(1);
    expect(err.join('\n')).toMatch(/^browser unavailable:/);
  });

  it('rejects --from for gearhold-play and a bad --levels', async () => {
    expect(await main(['score', '--game', 'gearhold-play', '--from', '1'], deps(good))).toBe(1);
    expect(await main(['score', '--game', 'gearhold-play', '--levels', '0'], deps(good))).toBe(1);
  });
});

describe('hal screens', () => {
  const shot = (o: Partial<ScreensRun>): ScreensRun => ({ game: 'g', shots: ['1.png'], errors: [], reached: true, notes: [], blockedRequests: [], ...o });
  it('prints a per-game summary and exits 0 when all reached cleanly', async () => {
    const code = await main(['screens'], deps(good, async () => [shot({ blockedRequests: ['https://fonts.googleapis.com/x'] })]));
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('g: reached gameplay, 1 shots, 0 errors, 1 blocked requests');
  });
  it('exits 1 when a game did not reach gameplay or had page errors', async () => {
    expect(await main(['screens'], deps(good, async () => [shot({ reached: false })]))).toBe(1);
    expect(await main(['screens'], deps(good, async () => [shot({ errors: ['pageerror: x'] })]))).toBe(1);
  });
});
