import { describe, it, expect } from 'vitest';
import { compareScores, GATE } from '../src/hal/gate.js';
import type { ScoreReport, Measures } from '../src/hal/types.js';

function report(fitness: number, measures: Measures = {}, hardFailures: string[] = [], levelCount = 20): ScoreReport {
  const levels = Array.from({ length: levelCount }, () => ({ n: 10, winRate: 0.5, avgMovesLeftFrac: 0.2, avgGoalFrac: 0.8, difficulty: 50, errors: [] }));
  return { game: 'tidepool', levels, measures, fitness, hardFailures };
}

describe('compareScores', () => {
  it('discards with no baseline', () => {
    const r = compareScores(null, report(70));
    expect(r.keep).toBe(false);
    expect(r.reasons.join(' ')).toContain('no baseline');
  });
  it('discards hard failures even if better', () => {
    const r = compareScores(report(70), report(80, {}, ['level 3: x']));
    expect(r.keep).toBe(false);
    expect(r.reasons.join(' ')).toContain('level 3: x');
  });
  it('keeps a real gain', () => {
    const r = compareScores(report(70, { inBand: 50 }), report(71, { inBand: 50 }));
    expect(r.keep).toBe(true);
    expect(r.gain).toBe(1);
  });
  it('discards a gain below minGain', () => {
    const r = compareScores(report(70), report(70.4));
    expect(r.keep).toBe(false);
    expect(r.reasons.join(' ')).toContain('no real gain');
  });
  it('discards a regression in another measure', () => {
    const r = compareScores(report(70, { inBand: 50, noWalls: 90 }), report(75, { inBand: 55, noWalls: 88.5 }), 'inBand');
    expect(r.keep).toBe(false);
    expect(r.reasons.join(' ')).toContain('noWalls');
  });
  it('tolerates tiny wobble', () => {
    const r = compareScores(report(70, { inBand: 50, noWalls: 90 }), report(72, { inBand: 52, noWalls: 89.2 }), 'inBand');
    expect(r.keep).toBe(true);
  });
  it('measures gain on the target measure', () => {
    const r = compareScores(report(70, { noWalls: 80 }), report(60, { noWalls: 83 }), 'noWalls');
    expect(r.gain).toBe(3);
    expect(r.keep).toBe(true); // fitness is not a measure, so its fall does not veto
  });
  it('handles different level counts', () => {
    expect(() => compareScores(report(70, { a: 1 }, [], 20), report(72, { a: 1 }, [], 25))).not.toThrow();
    expect(compareScores(report(70, { a: 1 }, [], 20), report(72, { a: 1 }, [], 25)).keep).toBe(true);
  });
  it('discards a prototype-key target instead of keeping it', () => {
    for (const key of ['constructor', 'toString', '__proto__']) {
      const r = compareScores(report(70, { inBand: 50 }), report(70, { inBand: 50 }), key);
      expect(r.keep).toBe(false);
      expect(r.reasons.join(' ')).toContain(key);
    }
  });
  it('discards a NaN fitness', () => {
    const r = compareScores(report(70), report(NaN));
    expect(r.keep).toBe(false);
    expect(r.reasons.join(' ')).toContain('fitness');
  });
  it('discards a NaN baseline fitness', () => {
    expect(compareScores(report(NaN), report(80)).keep).toBe(false);
  });
  it('discards a NaN measure in the after report', () => {
    const r = compareScores(report(70, { inBand: 50, noWalls: 90 }), report(75, { inBand: 55, noWalls: NaN }), 'inBand');
    expect(r.keep).toBe(false);
    expect(r.reasons.join(' ')).toContain('noWalls');
  });
  it('discards a NaN or infinite target value', () => {
    expect(compareScores(report(70, { inBand: 50 }), report(70, { inBand: NaN }), 'inBand').keep).toBe(false);
    expect(compareScores(report(70, { inBand: 50 }), report(70, { inBand: Infinity }), 'inBand').keep).toBe(false);
    expect(compareScores(report(70, { inBand: NaN }), report(70, { inBand: 60 }), 'inBand').keep).toBe(false);
  });
  it('discards a measure present before but missing after', () => {
    const r = compareScores(report(70, { inBand: 50, noWalls: 90 }), report(75, { inBand: 55 }), 'inBand');
    expect(r.keep).toBe(false);
    expect(r.reasons.join(' ')).toContain('noWalls');
  });
  it('discards when the target measure is missing from either report', () => {
    const missingAfter = compareScores(report(70, { inBand: 50 }), report(75, {}), 'inBand');
    expect(missingAfter.keep).toBe(false);
    const missingBefore = compareScores(report(70, {}), report(75, { inBand: 55 }), 'inBand');
    expect(missingBefore.keep).toBe(false);
    expect(missingBefore.reasons.join(' ')).toContain('inBand');
  });
  it('exposes the gate constants', () => {
    expect(GATE).toEqual({ minGain: 0.5, tolerance: 1.0, ceiling: 100, soft: ['tension'] });
  });
});

describe('compareScores modes', () => {
  it('an opts object with a target is score mode, same as the string form', () => {
    const b = report(70, { inBand: 50, noWalls: 90 }), a = report(75, { inBand: 52, noWalls: 89.5 });
    expect(compareScores(b, a, { target: 'inBand' })).toEqual(compareScores(b, a, 'inBand'));
    expect(compareScores(b, report(75, { inBand: 50.2, noWalls: 90 }), { target: 'inBand' }).keep).toBe(false);
  });
  it('an opts object without a target defaults to polish mode: no gain needed', () => {
    const r = compareScores(report(70, { inBand: 50, noWalls: 90 }), report(70, { inBand: 49.5, noWalls: 90 }), {});
    expect(r.keep).toBe(true);
    expect(r.gain).toBe(0);
  });
  it('no third argument stays score mode on fitness (existing callers unchanged)', () => {
    expect(compareScores(report(70), report(70.2)).keep).toBe(false);
    expect(compareScores(report(70), report(70.2), {}).keep).toBe(true);
  });
  it('polish mode discards a measure regressing past the tolerance', () => {
    const r = compareScores(report(70, { inBand: 50, noWalls: 90 }), report(72, { inBand: 52, noWalls: 88.5 }), { mode: 'polish' });
    expect(r.keep).toBe(false);
    expect(r.reasons.join(' ')).toContain('noWalls regressed');
  });
  it('polish mode discards a fitness drop past the tolerance', () => {
    const r = compareScores(report(70, { a: 50 }), report(68, { a: 50 }), { mode: 'polish' });
    expect(r.keep).toBe(false);
    expect(r.reasons.join(' ')).toContain('fitness regressed');
  });
  it('polish mode discards hard failures, missing measures and non-finite values', () => {
    expect(compareScores(report(70, { a: 50 }), report(70, { a: 50 }, ['boom']), { mode: 'polish' }).reasons.join(' ')).toContain('hard failure: boom');
    expect(compareScores(report(70, { a: 50 }), report(70, {}), { mode: 'polish' }).keep).toBe(false);
    expect(compareScores(report(70, { a: 50 }), report(NaN, { a: 50 }), { mode: 'polish' }).keep).toBe(false);
    expect(compareScores(report(70, { a: 50 }), report(70, { a: NaN }), { mode: 'polish' }).keep).toBe(false);
    expect(compareScores(null, report(70), { mode: 'polish' }).keep).toBe(false);
  });
  it('polish mode ignores a target, and explicit score mode without a target uses fitness', () => {
    expect(compareScores(report(70, { a: 50 }), report(70, { a: 50 }), { mode: 'polish', target: 'a' }).keep).toBe(true);
    expect(compareScores(report(70, { a: 50 }), report(70.2, { a: 50 }), { mode: 'score' }).reasons.join(' ')).toContain('no real gain');
  });
});

describe('compareScores at the ceiling (a healthy game keeps improving)', () => {
  const full = { inBand: 100, noSpikes: 100, reach: 100 };
  it('a target already at 100 cannot rise, so it is judged holding the line: kept when nothing regresses', () => {
    const r = compareScores(report(100, full), report(100, full), { mode: 'score', target: 'noSpikes' });
    expect(r).toMatchObject({ keep: true, atCeiling: true });
  });
  it('fitness at 100 with no target (legacy score mode) is judged the same way', () => {
    expect(compareScores(report(100, full), report(100, full))).toMatchObject({ keep: true, atCeiling: true });
  });
  it('just under the ceiling, where a minGain rise no longer fits, counts as at the ceiling too', () => {
    const r = compareScores(report(99.8, { m: 99.8 }), report(99.8, { m: 99.8 }), { mode: 'score', target: 'm' });
    expect(r).toMatchObject({ keep: true, atCeiling: true });
  });
  it('at the ceiling, a regression past the tolerance still discards (the target, another measure, or fitness)', () => {
    expect(compareScores(report(100, full), report(100, { ...full, noSpikes: 98 }), { mode: 'score', target: 'noSpikes' }).keep).toBe(false);
    expect(compareScores(report(100, full), report(100, { ...full, reach: 97 }), { mode: 'score', target: 'noSpikes' }).keep).toBe(false);
    const f = compareScores(report(100, full), report(98, full), { mode: 'score', target: 'noSpikes' });
    expect(f.keep).toBe(false);
    expect(f.reasons.join(' ')).toContain('fitness regressed');
  });
  it('at the ceiling, hard failures still discard', () => {
    expect(compareScores(report(100, full), report(100, full, ['sector 9: unwinnable']), { mode: 'score', target: 'noSpikes' }).keep).toBe(false);
  });
  it('below the ceiling the gain rule is unchanged', () => {
    const r = compareScores(report(90, { m: 90 }), report(90.2, { m: 90.2 }), { mode: 'score', target: 'm' });
    expect(r.keep).toBe(false);
    expect(r.atCeiling).toBeUndefined();
    expect(r.reasons.join(' ')).toContain('no real gain');
  });
});

// Operator decision D1 (2026-11-15, measurement v2): tension is not a veto. A tension drop discards only when the
// ticket targets tension; otherwise it is a note that travels with the change.
describe('compareScores: soft measures (tension)', () => {
  it('tension is a soft measure', () => {
    expect(GATE.soft).toContain('tension');
  });

  it('polish: a tension drop is a note, not a discard', () => {
    const r = compareScores(report(80, { inBand: 80, tension: 50 }), report(84, { inBand: 84, tension: 45 }), { mode: 'polish' });
    expect(r.keep).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(r.notes?.join(' ')).toMatch(/tension regressed 5\.00/);
  });

  it('score mode on another target: a tension drop is a note, the target gain still counts', () => {
    const r = compareScores(report(86, { inBand: 73, tension: 49 }), report(91, { inBand: 80, tension: 45 }), { mode: 'score', target: 'inBand' });
    expect(r.keep).toBe(true);
    expect(r.notes?.length).toBe(1);
  });

  it('a ticket that targets tension is still gated on it', () => {
    const r = compareScores(report(80, { tension: 50 }), report(80, { tension: 45 }), { mode: 'score', target: 'tension' });
    expect(r.keep).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/no real gain/);
  });

  it('a hard (non-soft) measure regression still discards, and a missing tension still counts as missing', () => {
    expect(compareScores(report(80, { inBand: 80, tension: 50 }), report(80, { inBand: 70, tension: 50 }), { mode: 'polish' }).keep).toBe(false);
    expect(compareScores(report(80, { tension: 50 }), report(80, {}), { mode: 'polish' }).keep).toBe(false);
  });

  it('no notes field when nothing soft regressed', () => {
    expect(compareScores(report(80, { tension: 50 }), report(80, { tension: 50 }), { mode: 'polish' }).notes).toBeUndefined();
  });
});
