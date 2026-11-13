import { describe, expect, it } from 'vitest';

import {
  BLOCK_BARN_ALPHABET_STEPS, BLOCK_BARN_RULES, scoreBlockBarn, type BlockBarnPage, type BlockBarnRecord,
} from '../src/hal/block-barn-score.js';
import { blockBarnScorer, SCORERS } from '../src/hal/scorers.js';

const AZ = 'abcdefghijklmnopqrstuvwxyz'.split('');
const rec = (over: Partial<BlockBarnRecord> = {}): BlockBarnRecord => ({ kind: 'block', letter: 'a', ms: 4, changed: true, w: 160, h: 160, viewport: '390x844', ...over });
/** 20 good taps: 10 per viewport, every kind. */
const good = (): BlockBarnRecord[] => (['390x844', '1024x768'] as const).flatMap((viewport) =>
  (['block', 'block', 'block', 'animal', 'animal', 'tower', 'tower', 'floor', 'floor', 'corner'] as const).map((kind) =>
    rec({ kind, viewport, ...(kind === 'corner' ? { w: 46, h: 46 } : {}) })));
const page = (over: Partial<BlockBarnPage> = {}): BlockBarnPage => ({
  letters: [...AZ], voiced: [...AZ], pictured: [...AZ], flashes: 0, masterGain: 0.5, peakGain: 0.12, leftBarn: false, ...over,
});

describe('scoreBlockBarn', () => {
  it('pins the rules', () => {
    expect(BLOCK_BARN_RULES).toEqual({ responsiveMs: 100, minTarget: 88, flashMs: 333, masterCap: 0.5, peakCap: 0.15 });
    expect(BLOCK_BARN_ALPHABET_STEPS).toBe(52);
  });

  it('a healthy barn scores 100 on all five, fitness their mean', () => {
    const r = scoreBlockBarn(good(), page());
    expect(r.game).toBe('block-barn');
    expect(Object.keys(r.measures)).toEqual(['responsive', 'noDeadEnds', 'bigTargets', 'alphabet', 'calm']);
    expect(r.measures).toEqual({ responsive: 100, noDeadEnds: 100, bigTargets: 100, alphabet: 100, calm: 100 });
    expect(r.fitness).toBe(100);
    expect(r.hardFailures).toEqual([]);
    expect(r.levels.map((l) => [l.viewport, l.taps])).toEqual([['390x844', 10], ['1024x768', 10]]);
  });

  it('one slow tap among 20 is responsive 95; a tap at exactly 100 ms still counts', () => {
    const rs = good();
    rs[3] = { ...rs[3]!, ms: 140 };
    rs[4] = { ...rs[4]!, ms: 100 };
    const r = scoreBlockBarn(rs, page());
    expect(r.measures.responsive).toBe(95);
    expect(r.measures.noDeadEnds).toBe(100);
    expect(r.fitness).toBe(99);
  });

  it('a tap that changes nothing is a dead end and not responsive', () => {
    const rs = good();
    rs[0] = { ...rs[0]!, changed: false };
    const r = scoreBlockBarn(rs, page());
    expect(r.measures.noDeadEnds).toBe(95);
    expect(r.measures.responsive).toBe(95);
  });

  it('leaving the barn makes noDeadEnds 0', () => {
    expect(scoreBlockBarn(good(), page({ leftBarn: true })).measures.noDeadEnds).toBe(0);
  });

  it('a 60 px target lowers bigTargets; the grown-up corner (small on purpose) is not counted', () => {
    const rs = good();
    rs[12] = { ...rs[12]!, w: 60 }; // a 1024x768 block
    const r = scoreBlockBarn(rs, page());
    expect(r.measures.bigTargets).toBeLessThan(100);
    expect(r.measures.bigTargets).toBeCloseTo((100 * 17) / 18, 2);
    expect(r.levels[1]!.bigTargets).toBeCloseTo((100 * 8) / 9, 2);
    expect(scoreBlockBarn(good().map((x) => (x.kind === 'corner' ? { ...x, w: 10, h: 10 } : x)), page()).measures.bigTargets).toBe(100);
    // 88 is enough; 87.9 each way is not
    expect(scoreBlockBarn(good().map((x) => ({ ...x, w: 88, h: 88 })), page()).measures.bigTargets).toBe(100);
    expect(scoreBlockBarn(good().map((x) => ({ ...x, h: 87.9 })), page()).measures.bigTargets).toBe(0);
  });

  it('a letter with no voice, no picture, or never reached lowers alphabet', () => {
    const noVoice = scoreBlockBarn(good(), page({ voiced: AZ.filter((l) => l !== 'q') }));
    expect(noVoice.measures.alphabet).toBeLessThan(100);
    expect(noVoice.measures.alphabet).toBeCloseTo((100 * 25) / 26, 2);
    expect(scoreBlockBarn(good(), page({ pictured: AZ.slice(0, 13) })).measures.alphabet).toBe(50);
    expect(scoreBlockBarn(good(), page({ letters: AZ.filter((l) => l !== 'z' && l !== 'y') })).measures.alphabet).toBeCloseTo((100 * 24) / 26, 2);
    // only a..z count, once each
    expect(scoreBlockBarn(good(), page({ letters: [...AZ, 'a', '?'], voiced: [...AZ, '?'], pictured: [...AZ, '?'] })).measures.alphabet).toBe(100);
  });

  it('calm loses half for fast flashing and half for a sound over its cap', () => {
    expect(scoreBlockBarn(good(), page({ flashes: 1 })).measures.calm).toBe(50);
    expect(scoreBlockBarn(good(), page({ masterGain: 0.8 })).measures.calm).toBe(50);
    expect(scoreBlockBarn(good(), page({ peakGain: 0.4 })).measures.calm).toBe(50);
    expect(scoreBlockBarn(good(), page({ flashes: 3, peakGain: 0.4 })).measures.calm).toBe(0);
    expect(scoreBlockBarn(good(), page({ masterGain: 0.5, peakGain: 0.15 })).measures.calm).toBe(100);
  });

  it('reports hard failures: no taps, a missing viewport, a non-finite number', () => {
    expect(() => scoreBlockBarn([], page())).toThrow(/no tap records/);
    const phoneOnly = scoreBlockBarn(good().filter((x) => x.viewport === '390x844'), page());
    expect(phoneOnly.hardFailures).toEqual(['no taps at 1024x768']);
    const rs = good();
    rs[2] = { ...rs[2]!, ms: Number.NaN };
    const bad = scoreBlockBarn(rs, page());
    expect(bad.hardFailures).toEqual([expect.stringMatching(/record 2 .*ms is not finite/)]);
    expect(bad.levels[0]!.taps).toBe(9);
  });
});

describe('blockBarnScorer (injected browser runner)', () => {
  it('is not in the core registry (core cannot import Playwright); its slug is the game', () => {
    expect(Object.keys(SCORERS)).not.toContain('block-barn');
    const s = blockBarnScorer(async () => ({ records: good(), page: page(), errors: [] }));
    expect(s.game).toBe('block-barn');
    expect(s.defaults).toEqual({});
    expect(s.validate({})).toBeNull();
  });
  it('scores the runner\'s records', async () => {
    const r = await blockBarnScorer(async () => ({ records: good(), page: page(), errors: [] })).score({});
    expect(r.fitness).toBe(100);
  });
  it('runner errors are a hard failure: score rejects, never a fitness', async () => {
    await expect(blockBarnScorer(async () => ({ records: good(), page: page(), errors: ['page error: boom'] })).score({}))
      .rejects.toThrow(/block-barn hard failure \(1\): page error: boom/);
  });
});
