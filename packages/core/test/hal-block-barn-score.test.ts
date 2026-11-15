import { describe, expect, it } from 'vitest';

import {
  BLOCK_BARN_ALPHABET_STEPS, BLOCK_BARN_RULES, BLOCK_BARN_TODDLER_SEEDS, BLOCK_BARN_VARIETY, scoreBlockBarn, type BlockBarnGesture, type BlockBarnPage, type BlockBarnRecord, type BlockBarnTargetSize,
} from '../src/hal/block-barn-score.js';
import { GATE, noiseBand } from '../src/hal/gate.js';
import { blockBarnScorer, SCORERS } from '../src/hal/scorers.js';

const AZ = 'abcdefghijklmnopqrstuvwxyz'.split('');
const round2 = (x: number): number => Math.round(x * 100) / 100;
const rec = (over: Partial<BlockBarnRecord> = {}): BlockBarnRecord => ({ kind: 'block', letter: 'a', ms: 4, changed: true, w: 160, h: 160, viewport: '390x844', ...over });
/** 20 good taps: 10 per viewport, every kind. */
const good = (): BlockBarnRecord[] => (['390x844', '1024x768'] as const).flatMap((viewport) =>
  (['block', 'block', 'block', 'animal', 'animal', 'tower', 'tower', 'floor', 'floor', 'corner'] as const).map((kind) =>
    rec({ kind, viewport, ...(kind === 'corner' ? { w: 46, h: 46 } : {}) })));
/** Every target seen before each tap: 9 for her and the corner, per viewport. */
const sizes = (): BlockBarnTargetSize[] => (['390x844', '1024x768'] as const).flatMap((viewport) =>
  (['block', 'block', 'block', 'block', 'block', 'animal', 'animal', 'tower', 'floor', 'corner'] as const).map((kind) =>
    ({ kind, viewport, w: kind === 'corner' ? 46 : 160, h: kind === 'corner' ? 46 : 160 })));
const gest = (over: Partial<BlockBarnGesture> = {}): BlockBarnGesture => ({
  viewport: '390x844', phase: 'random', gesture: 'tap', on: 'floor', state: '', responses: 1, signature: 'same|fx|1', feature: 'touch:fx', stuck: [], ...over,
});
/**
 * The toddler phase at each viewport: every kind of gesture, each answered once (a cancel never), nothing stuck; its
 * 12 random answers are 12 different signatures reaching 12 features (over both variety targets).
 */
const gestures = (): BlockBarnGesture[] => (['390x844', '1024x768'] as const).flatMap((viewport) => [
  ...(['tap', 'run', 'run', 'run', 'two', 'palm', 'press'] as const).map((gesture, i) => gest({ viewport, gesture, signature: `s${i}`, feature: `f${i}` })),
  gest({ viewport, gesture: 'cancel', responses: 0, signature: '', feature: '' }),
  gest({ viewport, phase: 'combo', state: 'door', on: 'block', signature: 'name|slots|2', feature: 'name' }),
  gest({ viewport, phase: 'combo', state: 'dusk', on: 'block', signature: 'name|slots|2', feature: 'name' }),
  ...[7, 8, 9, 10, 11].map((i) => gest({ viewport, signature: `s${i}`, feature: `f${i}` })),
]);
const page = (over: Partial<BlockBarnPage> = {}): BlockBarnPage => ({
  letters: [...AZ], voiced: [...AZ], pictured: [...AZ], flashes: 0, masterGain: 0.5, peakGain: 0.12, leftBarn: false, targets: sizes(), gestures: gestures(), ...over,
});

describe('scoreBlockBarn', () => {
  it('pins the rules', () => {
    expect(BLOCK_BARN_RULES).toEqual({ responsiveMs: 100, minTarget: 88, flashMs: 333, masterCap: 0.5, peakCap: 0.15 });
    expect(BLOCK_BARN_ALPHABET_STEPS).toBe(52);
  });

  it('a healthy barn scores 100 on all six, fitness their mean', () => {
    const r = scoreBlockBarn(good(), page());
    expect(r.game).toBe('block-barn');
    expect(Object.keys(r.measures)).toEqual(['responsive', 'noDeadEnds', 'bigTargets', 'alphabet', 'calm', 'variety']);
    expect(r.measures).toEqual({ responsive: 100, noDeadEnds: 100, bigTargets: 100, alphabet: 100, calm: 100, variety: 100 });
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
    expect(r.fitness).toBe(99.17); // (95 + 5 x 100) / 6
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

  it('calm below 100 is a hard failure, never a trade (measurement v2, P3)', () => {
    expect(scoreBlockBarn(good(), page({ flashes: 2 })).hardFailures).toEqual(['calm 50 (must be 100): 2 fast brightness changes']);
    expect(scoreBlockBarn(good(), page({ masterGain: 0.8, peakGain: 0.4 })).hardFailures)
      .toEqual(['calm 50 (must be 100): master gain 0.8 over 0.5; loudest moment 0.4 over 0.15']);
    expect(scoreBlockBarn(good(), page({ flashes: 1, peakGain: 0.2 })).hardFailures)
      .toEqual(['calm 0 (must be 100): 1 fast brightness change; loudest moment 0.2 over 0.15']);
    expect(scoreBlockBarn(good(), page()).hardFailures).toEqual([]);
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

describe('scoreBlockBarn: the toddler phase (measurement v2, P2)', () => {
  it('every gesture answered once (a cancel never) and nothing stuck is no failure', () => {
    expect(scoreBlockBarn(good(), page()).hardFailures).toEqual([]);
  });
  it('a two-finger tap or a palm answered twice is a hard failure; so is a tap nothing answers', () => {
    const gs = gestures();
    gs[4] = { ...gs[4]!, responses: 2 }; // two fingers
    gs[5] = { ...gs[5]!, responses: 5 }; // a palm
    gs[1] = { ...gs[1]!, responses: 0 }; // a run's tap
    expect(scoreBlockBarn(good(), page({ gestures: gs })).hardFailures).toEqual([
      '390x844 random run 2 on floor: 0 responses, expected 1',
      '390x844 random two 5 on floor: 2 responses, expected 1',
      '390x844 random palm 6 on floor: 5 responses, expected 1',
    ]);
  });
  it('a cancelled touch that answers is a hard failure; the state it landed in is named', () => {
    const gs = gestures();
    gs[7] = { ...gs[7]!, responses: 1, state: 'door+dusk' };
    expect(scoreBlockBarn(good(), page({ gestures: gs })).hardFailures).toEqual(['390x844 random cancel 8 on floor (door+dusk): 1 response, expected 0']);
  });
  it('anything left stuck after a gesture is a hard failure', () => {
    const gs = gestures();
    gs[23] = { ...gs[23]!, stuck: ['the grown-up corner is open'] };
    // gestures are numbered from 1 within their viewport
    expect(scoreBlockBarn(good(), page({ gestures: gs })).hardFailures).toEqual(['1024x768 combo tap 9 on block (door): stuck: the grown-up corner is open']);
  });
  it('no toddler gestures at a viewport is a hard failure', () => {
    expect(scoreBlockBarn(good(), page({ gestures: gestures().filter((g) => g.viewport === '390x844') })).hardFailures).toEqual(['no toddler gestures at 1024x768']);
  });
  it('lists at most 10 gesture failures, then how many more', () => {
    const gs = Array.from({ length: 14 }, () => gest({ responses: 2 }));
    const h = scoreBlockBarn(good(), page({ gestures: [...gs, ...gestures()] })).hardFailures;
    expect(h).toHaveLength(11);
    expect(h[10]).toBe('and 4 more gesture failures');
  });
});

describe('scoreBlockBarn: variety (measurement v2, P3)', () => {
  type V = '390x844' | '1024x768';
  /** One seed's random phase: `n` answering taps cycling through `sigs` signatures and `feats` features (f0, f1, ...). */
  const random = (viewport: V, sigs: number, feats: number, seed?: number, n = 60): BlockBarnGesture[] =>
    Array.from({ length: n }, (_, i) => gest({ viewport, ...(seed === undefined ? {} : { seed }), signature: `s${i % sigs}`, feature: `f${i % feats}` }));
  /** One seed's random phase reaching exactly these features, one answer each. */
  const reaching = (viewport: V, seed: number, features: string[]): BlockBarnGesture[] =>
    features.map((feature, i) => gest({ viewport, seed, signature: `s${i}`, feature }));
  const both = (a: BlockBarnGesture[], b: BlockBarnGesture[]) => page({ gestures: [...a, ...b] });
  const T = BLOCK_BARN_VARIETY;
  /** Like today's barn: 12 seeds, every seed finds the 6 common features, odd seeds the doors and the sky too, even seeds the tumble (means 7.5, 9 reached). */
  const todays = (v: V, without = '') => Array.from({ length: 12 }, (_, i) => reaching(v, i + 1,
    ['name', 'stack', 'knock', 'puff', 'animal', 'bump', ...(i % 2 ? ['door', 'sky'] : ['tumble'])].filter((f) => f !== without))).flat();

  it('pins the reviewed targets and the seeds', () => {
    expect(BLOCK_BARN_VARIETY).toEqual({ reached: 9, perSeed: 7 });
    expect(BLOCK_BARN_TODDLER_SEEDS).toBe(12);
  });
  it('is capped: finding more than the targets never scores over 100', () => {
    expect(scoreBlockBarn(good(), both(random('390x844', 40, 20), random('1024x768', 9, T.reached))).measures.variety).toBe(100);
  });
  it('half for the features reached, half for the features one seed finds, per viewport, then the mean', () => {
    // phone, one seed: 3 of 9 reached (16.67) + 3 of 7 per seed (21.43) = 38.1; tablet: 100
    const r = scoreBlockBarn(good(), both(random('390x844', 4, 3), random('1024x768', 9, 9)));
    expect(r.measures.variety).toBe(69.05);
    expect(r.levels.map((l) => [l.viewport, l.reached, l.features, l.signatures])).toEqual([['390x844', 3, 3, 4], ['1024x768', 9, 9, 9]]);
  });
  it('reached counts over all the seeds; per seed is the mean over the seeds before the cap (a lucky seed makes up for an unlucky one)', () => {
    // phone: seeds find 9 and 5 features (9 reached, mean 7): on target. tablet: 6 and 6 (6 reached, mean 6): 33.33 + 42.86
    const r = scoreBlockBarn(good(), both([...random('390x844', 9, 9, 1), ...random('390x844', 5, 5, 2)], [...random('1024x768', 6, 6, 1), ...random('1024x768', 6, 6, 2)]));
    expect(r.levels.map((l) => [l.viewport, l.seeds, l.reached, l.features])).toEqual([['390x844', 2, 9, 7], ['1024x768', 2, 6, 6]]);
    expect(r.measures.variety).toBe(round2((100 + 50 * 6 / 9 + 50 * 6 / 7) / 2));
  });
  it("today's barn scores 100; losing one answer every seed reaches costs more than the gate's noise band", () => {
    const before = scoreBlockBarn(good(), both(todays('390x844'), todays('1024x768')));
    expect(before.levels.map((l) => [l.reached, l.features])).toEqual([[9, 7.5], [9, 7.5]]);
    expect(before.measures.variety).toBe(100);
    const after = scoreBlockBarn(good(), both(todays('390x844', 'animal'), todays('1024x768', 'animal')));
    expect(after.levels.map((l) => [l.reached, l.features])).toEqual([[8, 6.5], [8, 6.5]]);
    expect(after.measures.variety).toBe(round2(50 * 8 / 9 + 50 * 6.5 / 7)); // 90.87
    expect(before.measures.variety! - after.measures.variety!).toBeGreaterThan(noiseBand(GATE.tolerance, before.noise!.variety, after.noise!.variety));
    expect(before.fitness - after.fitness).toBeGreaterThan(noiseBand(GATE.tolerance, before.noise!.fitness, after.noise!.fitness));
  });
  it('a feature only one seed ever reaches is lost on some other draws of seeds: the noise says so', () => {
    const rare = [...todays('390x844', 'tumble'), ...reaching('390x844', 13, ['tumble'])];
    const r = scoreBlockBarn(good(), both(rare, todays('1024x768')));
    expect(r.levels[0]!.reached).toBe(9);
    expect(r.noise!.variety).toBeGreaterThan(0);
  });
  it('reports seed noise for variety (and fitness); the deterministic measures have none', () => {
    const r = scoreBlockBarn(good(), both([...random('390x844', 9, 9, 1), ...random('390x844', 5, 5, 2), ...random('390x844', 6, 6, 3), ...random('390x844', 7, 7, 4)], random('1024x768', 9, 9, 1)));
    expect(r.noise).toBeDefined();
    expect(r.noise!.variety).toBeGreaterThan(0);
    expect(r.noise!.fitness).toBeGreaterThan(0);
    for (const k of ['responsive', 'noDeadEnds', 'bigTargets', 'alphabet', 'calm']) expect(r.noise![k], k).toBe(0);
    // A barn whose every seed finds the same is not noisy.
    expect(scoreBlockBarn(good(), both([...random('390x844', 9, 9, 1), ...random('390x844', 9, 9, 2)], [...random('1024x768', 9, 9, 1), ...random('1024x768', 9, 9, 2)])).noise!.variety).toBe(0);
  });
  it('a seed with no answers at a viewport counts as finding nothing there', () => {
    const r = scoreBlockBarn(good(), both([...random('390x844', 9, 9, 1), ...random('390x844', 9, 9, 2)], random('1024x768', 9, 9, 1)));
    expect(r.levels.map((l) => [l.viewport, l.seeds, l.reached, l.features])).toEqual([['390x844', 2, 9, 9], ['1024x768', 2, 9, 4.5]]);
  });
  it('reads only the random phase\'s answers: combinations, cancels and unanswered gestures add nothing', () => {
    const extra = [
      gest({ phase: 'combo', signature: 'c1', feature: 'g1' }), gest({ phase: 'combo', signature: 'c2', feature: 'g2' }),
      gest({ gesture: 'cancel', responses: 0, signature: 'x', feature: 'y' }), gest({ responses: 0, signature: 'z', feature: 'w' }),
    ];
    const r = scoreBlockBarn(good(), both([...random('390x844', 4, 3), ...extra], random('1024x768', 9, 9)));
    expect(r.measures.variety).toBe(69.05);
  });
  it('a viewport without random answers scores 0 there', () => {
    const r = scoreBlockBarn(good(), both([gest({ phase: 'combo' })], random('1024x768', 9, 9)));
    expect(r.measures.variety).toBe(50);
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
