// Measurement v2, P1.2: each seeded scorer reports ScoreReport.noise, a standard error for every measure and for
// fitness, from resampling its seeds (noise.ts). Deterministic scorers (Block Barn, static Gearhold) report none.
import { describe, expect, it } from 'vitest';
import { scoreGearholdPlay, type PlayRecord } from '../src/hal/gearhold-play-score.js';
import { scoreHyperline } from '../src/hal/hyperline-score.js';
import { scoreLanternkeep } from '../src/hal/lanternkeep-score.js';
import { scoreTidepool } from '../src/hal/tidepool-score.js';
import type { ScoreReport } from '../src/hal/types.js';

function expectNoise(r: ScoreReport<unknown>) {
  expect(r.noise, 'noise').toBeDefined();
  expect(Object.keys(r.noise!).sort()).toEqual([...Object.keys(r.measures), 'fitness'].sort());
  for (const v of Object.values(r.noise!)) { expect(Number.isFinite(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(0); }
}

describe('seeded scorers report noise', () => {
  it('tidepool', () => {
    const r = scoreTidepool({ from: 1, to: 8, seeds: 6 });
    expectNoise(r);
    expect(Object.values(r.noise!).some((v) => v > 0)).toBe(true);
    expect(scoreTidepool({ from: 1, to: 8, seeds: 6 }).noise).toEqual(r.noise);
  });

  it('hyperline', () => {
    expectNoise(scoreHyperline({ seeds: 6, until: 900 }));
  });

  it('lanternkeep', () => {
    expectNoise(scoreLanternkeep({ seeds: 2 }));
  }, 120_000);

  it('gearhold-play: resamples seeds, and records with one seed have zero noise', () => {
    const rec = (level: number, seed: number, win: boolean): PlayRecord => ({
      level, seed, result: win ? 'win' : 'dead', time: 60, hpLeft: win ? 30 + seed : 0, kills: 3, foes: 3,
      shotsFired: 10, hits: 5, damageTaken: 40, damageUnseen: 0, cause: win ? 'win' : 'shot',
    });
    const recs = [0, 1].flatMap((level) => Array.from({ length: 10 }, (_, s) => rec(level, s, (s + level) % 3 !== 0)));
    const r = scoreGearholdPlay(recs);
    expectNoise(r);
    expect(r.noise!.winnable).toBeGreaterThan(0);
    expect(Object.values(scoreGearholdPlay(recs.filter((x) => x.seed === 1)).noise!).every((v) => v === 0)).toBe(true);
  });
});
