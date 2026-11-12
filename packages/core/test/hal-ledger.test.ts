import { describe, expect, it } from 'vitest';
import { emptyLedger, ledgerMarkdown, nextPassId, parseLedger, recordPass, stagnated, type Pass } from '../src/hal/ledger.js';

const pass = (over: Partial<Omit<Pass, 'id'>> = {}): Omit<Pass, 'id'> => ({
  ts: '2026-11-11T00:00:00.000Z', game: 'tidepool-pals', change: 'tweak', fitness: 50, baseline: 40,
  measures: { fun: 50 }, kept: true, reasons: [], costUsd: 0, ...over,
});

describe('hal ledger', () => {
  it('counts ids up from HAL-001', () => {
    let l = emptyLedger();
    expect(nextPassId(l)).toBe('HAL-001');
    for (let i = 0; i < 3; i++) l = recordPass(l, pass());
    expect(l.passes.map((p) => p.id)).toEqual(['HAL-001', 'HAL-002', 'HAL-003']);
    expect(nextPassId(l)).toBe('HAL-004');
  });

  it('does not mutate its input', () => {
    const l = emptyLedger();
    const snap = JSON.stringify(l);
    recordPass(l, pass());
    expect(JSON.stringify(l)).toBe(snap);
  });

  it('raises best only when a kept pass beats it', () => {
    let l = recordPass(emptyLedger(), pass({ fitness: 50 }));
    expect(l.best['tidepool-pals']).toBe(50);
    l = recordPass(l, pass({ fitness: 70, kept: false }));
    expect(l.best['tidepool-pals']).toBe(50);
    l = recordPass(l, pass({ fitness: 40 }));
    expect(l.best['tidepool-pals']).toBe(50);
    l = recordPass(l, pass({ fitness: 60 }));
    expect(l.best['tidepool-pals']).toBe(60);
  });

  it('resets streak on keep and increments on discard, per game', () => {
    let l = recordPass(emptyLedger(), pass({ kept: false }));
    l = recordPass(l, pass({ kept: false }));
    l = recordPass(l, pass({ game: 'other', kept: false }));
    expect(l.streak).toEqual({ 'tidepool-pals': 2, other: 1 });
    l = recordPass(l, pass());
    expect(l.streak['tidepool-pals']).toBe(0);
    expect(l.streak.other).toBe(1);
  });

  it('stagnates at 5 discards in a row by default', () => {
    let l = emptyLedger();
    for (let i = 0; i < 4; i++) l = recordPass(l, pass({ kept: false }));
    expect(stagnated(l, 'tidepool-pals')).toBe(false);
    l = recordPass(l, pass({ kept: false }));
    expect(stagnated(l, 'tidepool-pals')).toBe(true);
    expect(stagnated(l, 'tidepool-pals', 6)).toBe(false);
    expect(stagnated(l, 'unknown')).toBe(false);
  });

  it('keeps only the last 500 passes and keeps ids increasing', () => {
    let l = emptyLedger();
    for (let i = 0; i < 502; i++) l = recordPass(l, pass());
    expect(l.passes).toHaveLength(500);
    expect(l.passes[0]!.id).toBe('HAL-003');
    expect(nextPassId(l)).toBe('HAL-503');
  });

  it('rejects corrupt ledgers and round-trips a valid one', () => {
    expect(() => parseLedger('{')).toThrow(/corrupt ledger/);
    expect(() => parseLedger('{"version":2}')).toThrow(/corrupt ledger/);
    expect(() => parseLedger('{"version":1,"passes":[{"id":1}],"best":{},"streak":{}}')).toThrow(/corrupt ledger/);
    expect(() => parseLedger('null')).toThrow(/corrupt ledger/);
    const e = emptyLedger();
    expect(parseLedger(JSON.stringify(e))).toEqual(e);
    const l = recordPass(e, pass());
    expect(parseLedger(JSON.stringify(l))).toEqual(l);
  });

  it('renders a markdown table, newest last, limited to last rows', () => {
    let l = emptyLedger();
    l = recordPass(l, pass({ change: 'a', fitness: 55, baseline: 50 }));
    l = recordPass(l, pass({ change: 'b', fitness: 45, baseline: null, kept: false }));
    l = recordPass(l, pass({ change: 'c' }));
    const lines = ledgerMarkdown(l).split('\n');
    expect(lines[0]).toBe('| ID | game | change | fitness | baseline | Δ | kept |');
    expect(lines).toHaveLength(2 + 3);
    expect(lines[2]).toContain('HAL-001');
    expect(lines[2]).toContain('+5.0');
    expect(lines[3]).toContain('HAL-002');
    expect(lines[4]).toContain('HAL-003');
    const two = ledgerMarkdown(l, 2).split('\n');
    expect(two).toHaveLength(4);
    expect(two[2]).toContain('HAL-002');
  });
});

describe('pass ids with a floor from git', () => {
  const p = (): Omit<Pass, 'id'> => ({ ts: 't', game: 'g', change: 'c', fitness: 1, baseline: null, measures: {}, kept: true, reasons: [], costUsd: 0 });
  it('next id = max(ledger, floor) + 1, and recordPass takes it', () => {
    expect(nextPassId(emptyLedger(), 3)).toBe('HAL-004');
    let l = recordPass(emptyLedger(), p(), nextPassId(emptyLedger(), 3));
    expect(l.passes.map((x) => x.id)).toEqual(['HAL-004']);
    expect(nextPassId(l, 3)).toBe('HAL-005');
    expect(nextPassId(l, 9)).toBe('HAL-010');
    l = recordPass(l, p());
    expect(l.passes.map((x) => x.id)).toEqual(['HAL-004', 'HAL-005']);
    expect(() => recordPass(l, p(), 'x')).toThrow(/bad pass id/);
  });
});
