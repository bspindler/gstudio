// Browser-free: the CLI with an injected fake gearhold-play runner (async scorer, errors -> exit 1, DISCARD -> exit 2).
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gearholdPlayScorer, SCORERS, type PlayRecord, type Scorer } from '@studio/core/hal';
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
  it('baseline then a no-op check is DISCARD (exit 2); a deterministic fake gives the same fitness (real determinism: hal-browser project)', async () => {
    expect(await main(['baseline', '--game', 'gearhold-play', '--seeds', '2'], deps(good))).toBe(0);
    const base = JSON.parse(await readFile(join(halDir, 'baseline', 'gearhold-play.json'), 'utf8'));
    expect(base.range).toEqual({ levels: 3, seeds: 2, seedBase: 0 });
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

describe('--seed-base', () => {
  it('is part of the range: passed to the runner, rejected when negative, a mismatch against a baseline', async () => {
    const seen: number[] = [];
    const run = async (o: { levels: number[]; seeds: number; seedBase: number }) => { seen.push(o.seedBase); return good(o); };
    expect(await main(['baseline', '--game', 'gearhold-play', '--seeds', '1', '--seed-base', '50'], deps(run))).toBe(0);
    expect(seen).toEqual([50]);
    expect(await main(['score', '--game', 'gearhold-play', '--seed-base', '-1'], deps(run))).toBe(1);
    expect(await main(['check', '--game', 'gearhold-play', '--seeds', '1', '--change', 'x'], deps(run))).toBe(2);
    expect(out.join('\n')).toMatch(/baseline was scored with .*seedBase.*50/);
    expect(await main(['score', '--game', 'tidepool-pals', '--seed-base', '1'], deps(run))).toBe(1);
    expect(err.join('\n')).toContain('--seed-base does not apply to tidepool-pals');
  });
});

// The gate path for the older games, pinned after the CLI moved into cli.ts. `fake` has a settable fitness.
describe('hal CLI gate semantics', () => {
  let fit = 50;
  const fake: Scorer = {
    game: 'fake', defaults: { n: 1 }, validate: () => null,
    score: () => ({ game: 'fake', levels: [], measures: { a: fit }, fitness: fit, hardFailures: [] }),
  };
  const d = () => ({ scorers: { ...SCORERS, fake }, halDir });
  const file = (...p: string[]) => join(halDir, ...p);
  const rd = async (...p: string[]) => JSON.parse(await readFile(file(...p), 'utf8'));
  beforeEach(() => { fit = 50; });

  it('no baseline: DISCARD, ledger row, no baseline written', async () => {
    expect(await main(['check', '--game', 'fake', '--change', 'x'], d())).toBe(2);
    await expect(readFile(file('baseline', 'fake.json'))).rejects.toThrow();
    expect((await rd('ledger.json')).passes).toHaveLength(1);
  });
  it('KEEP: exit 0, baseline overwritten, ledger kept: true', async () => {
    expect(await main(['baseline', '--game', 'fake'], d())).toBe(0);
    fit = 60;
    expect(await main(['check', '--game', 'fake', '--change', 'better'], d())).toBe(0);
    expect(out.join('\n')).toMatch(/^KEEP/m);
    expect((await rd('baseline', 'fake.json')).report.fitness).toBe(60);
    expect((await rd('ledger.json')).passes[0].kept).toBe(true);
  });
  it('a regression is DISCARD and leaves the baseline alone', async () => {
    await main(['baseline', '--game', 'fake'], d());
    fit = 40;
    expect(await main(['check', '--game', 'fake', '--change', 'worse'], d())).toBe(2);
    expect((await rd('baseline', 'fake.json')).report.fitness).toBe(50);
  });
  it('range mismatch: DISCARD with the mismatch reason, baseline untouched', async () => {
    await main(['baseline', '--game', 'fake'], d());
    fit = 90;
    expect(await main(['check', '--game', 'fake', '--n', '2', '--change', 'x'], d())).toBe(2);
    expect(out.join('\n')).toMatch(/DISCARD.*baseline was scored with/);
    expect((await rd('baseline', 'fake.json')).report.fitness).toBe(50);
  });
  it('missing --change: exit 1, nothing written', async () => {
    expect(await main(['check', '--game', 'fake'], d())).toBe(1);
    expect(err.join('\n')).toMatch(/needs --change/);
    await expect(readFile(file('ledger.json'))).rejects.toThrow();
  });
  it('corrupt ledger: exit 1 before scoring', async () => {
    mkdirSync(halDir, { recursive: true });
    writeFileSync(file('ledger.json'), '{nope');
    const spy = vi.spyOn(fake, 'score');
    expect(await main(['check', '--game', 'fake', '--change', 'x'], d())).toBe(1);
    expect(spy).not.toHaveBeenCalled();
    expect(await main(['status'], d())).toBe(1);
  });
  it('non-finite fitness: exit 1, nothing recorded', async () => {
    fit = NaN;
    expect(await main(['check', '--game', 'fake', '--change', 'x'], d())).toBe(1);
    expect(err.join('\n')).toMatch(/non-finite/);
    await expect(readFile(file('ledger.json'))).rejects.toThrow();
  });
  it('real scorers: tidepool and gearhold score, baseline and check at a small range', async () => {
    const real = { scorers: SCORERS, halDir };
    expect(await main(['baseline', '--from', '1', '--to', '1', '--seeds', '1'], real)).toBe(0);
    expect(await main(['check', '--from', '1', '--to', '1', '--seeds', '1', '--change', 'no-op'], real)).toBe(2);
    expect(await main(['score', '--from', '1', '--to', '1', '--seeds', '1', '--json'], real)).toBe(0);
    expect(await main(['baseline', '--game', 'gearhold'], real)).toBe(0);
    expect(await main(['check', '--game', 'gearhold', '--change', 'no-op'], real)).toBe(2);
    expect(out.join('\n')).toContain('"game": "tidepool-pals"');
  });
  it('status: table plus stagnation lines; unknown --game and bad range still exit 1', async () => {
    await main(['check', '--game', 'fake', '--change', 'x'], d());
    out.length = 0;
    expect(await main(['status'], d())).toBe(0);
    expect(out.join('\n')).toMatch(/HAL-001.*fake/);
    expect(out.join('\n')).toContain('Tidepool stagnated: no');
    expect(out.join('\n')).toContain('fake stagnated:');
    expect(await main(['status', '--game', 'nope'], d())).toBe(1);
    expect(err.join('\n')).toContain('unknown game: nope');
    expect(await main(['status', '--seeds', '0'], d())).toBe(1);
  });
  it('unknown command and flags a command does not use', async () => {
    expect(await main(['frobnicate'], d())).toBe(1);
    expect(await main(['score', '--game', 'fake', '--out', 'x'], d())).toBe(1);
    expect(await main(['screens', '--game', 'x'], { ...d(), runScreens: async () => [] })).toBe(1);
  });
  it('screens with no results exits 1', async () => {
    expect(await main(['screens'], { ...d(), runScreens: async () => [] })).toBe(1);
  });
});
