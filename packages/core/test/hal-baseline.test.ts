import { describe, expect, it } from 'vitest';
import { parseBaseline, parseScoreReport, rangeMismatch } from '../src/hal/baseline.js';

const report = { game: 'g', levels: [], measures: { a: 1 }, fitness: 50, hardFailures: [] };
const range = { from: 1, to: 5, seeds: 2 };

describe('hal baseline', () => {
  it('accepts a valid report and baseline', () => {
    expect(parseScoreReport(JSON.stringify(report))).toEqual(report);
    expect(parseBaseline(JSON.stringify({ range, report }))).toEqual({ range, report });
  });
  it('rejects garbage and wrong shapes', () => {
    for (const j of ['{', '{}', 'null', '[]', JSON.stringify({ ...report, fitness: null }), JSON.stringify({ ...report, measures: { a: 'x' } }),
      JSON.stringify({ ...report, levels: 3 }), JSON.stringify({ ...report, game: 1 }), JSON.stringify({ ...report, hardFailures: [1] })]) {
      expect(() => parseScoreReport(j)).toThrow(/corrupt baseline/);
    }
    expect(() => parseBaseline('{')).toThrow(/corrupt baseline/);
    expect(() => parseBaseline('{}')).toThrow(/corrupt baseline/);
    expect(() => parseBaseline(JSON.stringify({ range: { from: 1 }, report }))).toThrow(/corrupt baseline/);
    expect(() => parseBaseline(JSON.stringify({ range, report: {} }))).toThrow(/corrupt baseline/);
  });
  it('flags mismatched ranges', () => {
    expect(rangeMismatch(range, { ...range })).toBeNull();
    expect(rangeMismatch(range, { from: 1, to: 6, seeds: 3 })).toBe('baseline was scored on levels 1–5 × 2 seeds; this run is 1–6 × 3');
  });
});
