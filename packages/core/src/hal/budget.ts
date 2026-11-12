// Hal's daily API spend ledger. Pure: no clock, no randomness, no I/O. Callers inject the date.
export type Billing = 'api' | 'subscription';
/**
 * One Claude call. `pending` marks a reservation made before the call started (usd = the full slice); it is settled
 * with the real cost afterwards (settleCall). A crash leaves it pending, so the whole slice stays booked.
 */
export type SpendCall = { run: string; role: string; billing: Billing; usd: number; at: string; pending?: boolean };
/** `day` is YYYY-MM-DD in local time. */
export type SpendDay = { day: string; calls: SpendCall[] };

export const DAILY_CAP_USD = 20;
export const SLICES: Record<string, number> = { planner: 1.5, implementer: 3, director: 1 };

/** Local calendar date (YYYY-MM-DD) of an injected clock reading. */
export function dayOf(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** Dollars booked against the cap: every API call, pending reservations at their full slice. */
export function apiSpent(day: SpendDay): number {
  const cents = day.calls.reduce((s, c) => (c.billing === 'api' ? s + Math.round(c.usd * 100) : s), 0);
  return cents / 100;
}

/** Dollars this role may spend now: its slice, clipped to what is left of the cap. 0 means stop. */
export function sliceFor(day: SpendDay, role: string): number {
  const left = Math.max(0, DAILY_CAP_USD - apiSpent(day));
  if (!Object.hasOwn(SLICES, role)) return 0;
  const slice = Math.min(SLICES[role]!, left);
  return slice < 0.01 ? 0 : slice;
}

/** Returns a new day with the call appended. An unknown cost (missing/NaN) is booked as the full slice given. */
export function recordCall(day: SpendDay, call: Omit<SpendCall, 'usd'> & { usd?: number }): SpendDay {
  if (!Object.hasOwn(SLICES, call.role)) throw new Error(`unknown budget role: ${call.role}`);
  const known = typeof call.usd === 'number' && Number.isFinite(call.usd) && call.usd >= 0;
  const usd = known ? (call.usd as number) : sliceFor(day, call.role);
  return { ...day, calls: [...day.calls, { ...call, usd }] };
}

/** The ledger for `now`'s local day: `prev` if it is the same day, otherwise a fresh empty day. */
export function dayFor(prev: SpendDay | undefined, now: Date): SpendDay {
  const day = dayOf(now);
  return prev && prev.day === day ? prev : { day, calls: [] };
}

/** Reserve-then-settle, step 1: appends `{..., usd: slice, pending: true}` before the call starts. */
export function reserveCall(day: SpendDay, call: Omit<SpendCall, 'usd' | 'pending'>): SpendDay {
  if (!Object.hasOwn(SLICES, call.role)) throw new Error(`unknown budget role: ${call.role}`);
  return { ...day, calls: [...day.calls, { ...call, usd: sliceFor(day, call.role), pending: true }] };
}

/**
 * Step 2: settles the newest pending entry of this run, role and billing with the real cost. An unknown cost (null,
 * NaN, negative) keeps the reserved slice. With no pending entry to settle, the call is appended (recordCall).
 */
export function settleCall(day: SpendDay, call: Omit<SpendCall, 'usd' | 'pending'> & { usd?: number | null }): SpendDay {
  const known = typeof call.usd === 'number' && Number.isFinite(call.usd) && call.usd >= 0;
  for (let i = day.calls.length - 1; i >= 0; i--) {
    const c = day.calls[i]!;
    if (c.pending && c.run === call.run && c.role === call.role && c.billing === call.billing) {
      const calls = [...day.calls];
      const { pending: _p, ...rest } = c;
      calls[i] = { ...rest, usd: known ? (call.usd as number) : c.usd, at: call.at };
      return { ...day, calls };
    }
  }
  return recordCall(day, { run: call.run, role: call.role, billing: call.billing, at: call.at, ...(known ? { usd: call.usd as number } : {}) });
}
