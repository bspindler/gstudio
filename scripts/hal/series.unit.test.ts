// `hal run --times N`: N runs in a row, stopping early when one fails, Brian presses Stop, or the API cap is reached.
import { describe, expect, it } from 'vitest';
import { MAX_TIMES, runSeries, takeTimes } from './series.js';

describe('takeTimes', () => {
  it('pulls --times N (or --times=N) out of the run args and leaves the rest', () => {
    expect(takeTimes(['--game', 'gearhold'])).toEqual({ times: 1, rest: ['--game', 'gearhold'] });
    expect(takeTimes(['--times', '3', '--nightly'])).toEqual({ times: 3, rest: ['--nightly'] });
    expect(takeTimes(['--nightly', '--times=2'])).toEqual({ times: 2, rest: ['--nightly'] });
    expect(takeTimes(['--times', String(MAX_TIMES)]).times).toBe(MAX_TIMES);
  });
  it('rejects anything but a whole number from 1 to MAX_TIMES', () => {
    for (const bad of [['--times'], ['--times', '0'], ['--times', String(MAX_TIMES + 1)], ['--times', '2.5'], ['--times', 'x'], ['--times', '-1']])
      expect(() => takeTimes(bad), bad.join(' ')).toThrow(/--times/);
  });
});

describe('runSeries', () => {
  const logs: string[] = [];
  const log = (s: string) => { logs.push(s); };
  it('runs N times, each told its place in the series, and returns 0', async () => {
    const seen: Array<{ at: number; of: number } | undefined> = [];
    expect(await runSeries(3, async (s) => { seen.push(s); return 0; }, () => null, log)).toBe(0);
    expect(seen).toEqual([{ at: 1, of: 3 }, { at: 2, of: 3 }, { at: 3, of: 3 }]);
  });
  it('a single run is not a series', async () => {
    const seen: unknown[] = [];
    await runSeries(1, async (s) => { seen.push(s); return 0; }, () => null, log);
    expect(seen).toEqual([undefined]);
  });
  it('stops after a failed run and returns its code', async () => {
    let n = 0;
    expect(await runSeries(4, async () => (++n === 2 ? 2 : 0), () => null, log)).toBe(2);
    expect(n).toBe(2);
  });
  it('stops when asked to between runs (Stop pressed, API cap reached), saying why', async () => {
    let n = 0;
    logs.length = 0;
    expect(await runSeries(5, async () => { n++; return 0; }, () => (n === 2 ? 'Stop was pressed' : null), log)).toBe(0);
    expect(n).toBe(2);
    expect(logs.join('\n')).toMatch(/Stop was pressed: skipping runs 3-5 of 5/);
  });
});
