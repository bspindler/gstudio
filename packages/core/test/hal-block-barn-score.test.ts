import { describe, expect, it } from 'vitest';

import {
  BLOCK_BARN_ALPHABET_STEPS, BLOCK_BARN_RULES, scoreBlockBarn, type BlockBarnPage, type BlockBarnRecord, type BlockBarnTargetSize,
} from '../src/hal/block-barn-score.js';
import { blockBarnScorer, SCORERS } from '../src/hal/scorers.js';

const AZ = 'abcdefghijklmnopqrstuvwxyz'.split('');
const rec = (over: Partial<BlockBarnRecord> = {}): BlockBarnRecord => ({ kind: 'block', letter: 'a', ms: 4, changed: true, w: 160, h: 160, viewport: '390x844', ...over });
/** 20 good taps: 10 per viewport, every kind. */
const good = (): BlockBarnRecord[] => (['390x844', '1024x768'] as const).flatMap((viewport) =>
  (['block', 'block', 'block', 'animal', 'animal', 'tower', 'tower', 'floor', 'floor', 'corner'] as const).map((kind) =>
    rec({ kind, viewport, ...(kind === 'corner' ? { w: 46, h: 46 } : {}) })));
/** Every target seen before each tap: 9 for her and the corner, per viewport. */
const sizes = (): BlockBarnTargetSize[] => (['390x844', '1024x768'] as const).flatMap((viewport) =>
  (['block', 'block', 'block', 'block', 'block', 'animal', 'animal', 'tower', 'floor', 'corner'] as const).map((kind) =>
    ({ kind, viewport, w: kind === 'corner' ? 46 : 160, h: kind === 'corner' ? 46 : 160 })));
const page = (over: Partial<BlockBarnPage> = {}): BlockBarnPage => ({
  letters: [...AZ], voiced: [...AZ], pictured: [...AZ], flashes: 0, masterGain: 0.5, peakGain: 0.12, leftBarn: false, targets: sizes(), ...over,
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

  it('bigTargets counts every target seen, not only the tapped ones; a 60 px one lowers it; the corner (small on purpose) is not counted', () => {
    const ts = sizes();
    ts[12] = { ...ts[12]!, w: 60 }; // a 1024x768 block that was never tapped
    const r = scoreBlockBarn(good(), page({ targets: ts }));
    expect(r.measures.bigTargets).toBeLessThan(100);
    expect(r.measures.bigTargets).toBeCloseTo((100 * 15) / 16, 2);
    expect(r.levels[1]!.bigTargets).toBeCloseTo((100 * 7) / 8, 2);
    expect(scoreBlockBarn(good(), page({ targets: sizes().map((x) => (x.kind === 'corner' ? { ...x, w: 10, h: 10 } : x)) })).measures.bigTargets).toBe(100);
    // the floor is the bare hay between things: a full barn leaves only a sliver of it
    expect(scoreBlockBarn(good(), page({ targets: sizes().map((x) => (x.kind === 'floor' ? { ...x, h: 58 } : x)) })).measures.bigTargets).toBe(100);
    // 88 is enough; 87.9 each way is not
    expect(scoreBlockBarn(good(), page({ targets: sizes().map((x) => ({ ...x, w: 88, h: 88 })) })).measures.bigTargets).toBe(100);
    expect(scoreBlockBarn(good(), page({ targets: sizes().map((x) => ({ ...x, h: 87.9 })) })).measures.bigTargets).toBe(0);
  });

  it('a target of a kind the scorer has never heard of is measured like any other, and tapping it is no failure', () => {
    const r = scoreBlockBarn([...good(), rec({ kind: 'bell', w: 40, h: 40 })], page({ targets: [...sizes(), { kind: 'bell', viewport: '390x844', w: 40, h: 40 }] }));
    expect(r.hardFailures).toEqual([]);
    expect(r.measures.bigTargets).toBeCloseTo((100 * 16) / 17, 2);
    expect(r.levels[0]!.kinds).toContain('bell');
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
    const phoneOnly = scoreBlockBarn(good().filter((x) => x.viewport === '390x844'), page({ targets: sizes().filter((x) => x.viewport === '390x844') }));
    expect(phoneOnly.hardFailures).toEqual(['no taps at 1024x768', 'no targets measured at 1024x768']);
    expect(scoreBlockBarn(good(), page({ targets: [...sizes(), { kind: 'block', viewport: '390x844', w: Number.NaN, h: 1 }] })).hardFailures)
      .toEqual([expect.stringMatching(/target 20 .*w is not finite/)]);
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
