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
    expect(GATE).toEqual({ minGain: 0.5, tolerance: 1.0 });
  });
});
