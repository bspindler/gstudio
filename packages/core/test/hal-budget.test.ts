import { describe, expect, it } from 'vitest';
import { DAILY_CAP_USD, SLICES, apiSpent, dayFor, dayOf, recordCall, reserveCall, settleCall, sliceFor, type SpendDay } from '../src/hal/budget.js';

const empty = (day = '2026-11-11'): SpendDay => ({ day, calls: [] });
const call = (usd: number | undefined, billing: 'api' | 'subscription' = 'api', role = 'planner') => ({ run: 'r1', role, billing, usd, at: '2026-11-11T01:00:00Z' });

describe('hal budget', () => {
  it('has the spec constants', () => {
    expect(DAILY_CAP_USD).toBe(20);
    expect(SLICES).toEqual({ planner: 1.5, implementer: 3, director: 1 });
  });
  it('apiSpent sums api calls only', () => {
    let d = empty();
    d = recordCall(d, call(2));
    d = recordCall(d, call(5, 'subscription'));
    d = recordCall(d, call(1.5));
    expect(apiSpent(d)).toBe(3.5);
  });
  it('sliceFor is the role slice, clipped to the remaining cap', () => {
    expect(sliceFor(empty(), 'implementer')).toBe(3);
    const d: SpendDay = { day: '2026-11-11', calls: [{ run: 'r', role: 'x', billing: 'api', usd: 18.5, at: 't' }] };
    expect(sliceFor(d, 'implementer')).toBe(1.5);
  });
  it('cap is reached exactly at 20 and slice is 0', () => {
    const d: SpendDay = { day: '2026-11-11', calls: [{ run: 'r', role: 'x', billing: 'api', usd: 20, at: 't' }] };
    expect(sliceFor(d, 'director')).toBe(0);
    const over: SpendDay = { day: '2026-11-11', calls: [{ run: 'r', role: 'x', billing: 'api', usd: 25, at: 't' }] };
    expect(sliceFor(over, 'planner')).toBe(0);
  });
  it('subscription calls do not count against the cap', () => {
    const d: SpendDay = { day: '2026-11-11', calls: [{ run: 'r', role: 'x', billing: 'subscription', usd: 99, at: 't' }] };
    expect(sliceFor(d, 'implementer')).toBe(3);
  });
  it('unknown cost records the full slice given', () => {
    const d = recordCall(empty(), call(undefined, 'api', 'implementer'));
    expect(d.calls[0]!.usd).toBe(3);
    const d2 = recordCall(empty(), { ...call(undefined, 'api', 'planner'), usd: Number.NaN });
    expect(d2.calls[0]!.usd).toBe(1.5);
  });
  it('unknown cost never exceeds what is left of the cap', () => {
    const d: SpendDay = { day: '2026-11-11', calls: [{ run: 'r', role: 'x', billing: 'api', usd: 19, at: 't' }] };
    expect(recordCall(d, call(undefined, 'api', 'implementer')).calls[1]!.usd).toBe(1);
  });
  it('recordCall does not mutate its input', () => {
    const d = empty();
    recordCall(d, call(1));
    expect(d.calls).toHaveLength(0);
  });
  it('dayOf uses the local date of the injected clock', () => {
    expect(dayOf(new Date(2026, 10, 11, 23, 59))).toBe('2026-11-11');
    expect(dayOf(new Date(2026, 10, 12, 0, 1))).toBe('2026-11-12');
    expect(dayOf(new Date(2026, 0, 5, 12))).toBe('2026-01-05');
  });
  it('rollover: dayFor keeps a same-day ledger (still capped) and resets on a new local day', () => {
    const prev: SpendDay = { day: '2026-11-11', calls: [{ run: 'r', role: 'x', billing: 'api', usd: 20, at: 't' }] };
    const same = dayFor(prev, new Date(2026, 10, 11, 23, 59, 59));
    expect(same).toBe(prev);
    expect(sliceFor(same, 'planner')).toBe(0);
    const next = dayFor(prev, new Date(2026, 10, 12, 0, 0, 1));
    expect(next).toEqual({ day: '2026-11-12', calls: [] });
    expect(sliceFor(next, 'planner')).toBe(1.5);
    expect(dayFor(undefined, new Date(2026, 10, 12, 9))).toEqual({ day: '2026-11-12', calls: [] });
  });
  it('unknown or prototype roles: slice 0, recordCall throws', () => {
    for (const r of ['constructor', 'toString', '__proto__', 'nobody']) {
      expect(sliceFor(empty(), r)).toBe(0);
      expect(() => recordCall(empty(), call(undefined, 'api', r))).toThrow(/unknown budget role/);
    }
  });
  it('float drift cannot leave a tiny slice at the cap', () => {
    let d = empty();
    for (let i = 0; i < 200; i++) d = recordCall(d, call(0.1, 'api', 'director'));
    expect(apiSpent(d)).toBe(20);
    expect(sliceFor(d, 'director')).toBe(0);
  });
});

describe('reserve then settle (R19)', () => {
  const at = '2026-11-12T03:00:00.000Z';
  const empty: SpendDay = { day: '2026-11-12', calls: [] };
  it('a reservation books the full slice, pending, and counts against the cap', () => {
    const d = reserveCall(empty, { run: 'r', role: 'implementer', billing: 'api', at });
    expect(d.calls).toEqual([{ run: 'r', role: 'implementer', billing: 'api', at, usd: SLICES.implementer, pending: true }]);
    expect(apiSpent(d)).toBe(SLICES.implementer);
  });
  it('settles the same entry with the real cost (no double count); unknown keeps the slice', () => {
    let d = reserveCall(empty, { run: 'r', role: 'planner', billing: 'api', at });
    d = settleCall(d, { run: 'r', role: 'planner', billing: 'api', at, usd: 0.25 });
    expect(d.calls).toEqual([{ run: 'r', role: 'planner', billing: 'api', at, usd: 0.25 }]);
    let u = reserveCall(empty, { run: 'r', role: 'planner', billing: 'api', at });
    u = settleCall(u, { run: 'r', role: 'planner', billing: 'api', at, usd: null });
    expect(u.calls).toEqual([{ run: 'r', role: 'planner', billing: 'api', at, usd: SLICES.planner }]);
  });
  it('settles only a matching pending entry (run, role, billing), newest first; appends when there is none', () => {
    let d = reserveCall(empty, { run: 'r', role: 'implementer', billing: 'subscription', at });
    d = reserveCall(d, { run: 'r', role: 'implementer', billing: 'api', at });
    d = settleCall(d, { run: 'r', role: 'implementer', billing: 'api', at, usd: 1 });
    expect(d.calls.map((c) => [c.billing, c.usd, c.pending ?? false])).toEqual([['subscription', 3, true], ['api', 1, false]]);
    const e = settleCall(empty, { run: 'other', role: 'director', billing: 'api', at, usd: 0.5 });
    expect(e.calls).toEqual([{ run: 'other', role: 'director', billing: 'api', at, usd: 0.5 }]);
  });
  it('a pending reservation left by a crash keeps the cap honest', () => {
    let d: SpendDay = { day: '2026-11-12', calls: [{ run: 'old', role: 'implementer', billing: 'api', usd: 18, at }] };
    d = reserveCall(d, { run: 'r', role: 'implementer', billing: 'api', at });
    expect(apiSpent(d)).toBe(DAILY_CAP_USD);
    expect(sliceFor(d, 'planner')).toBe(0);
  });
});
