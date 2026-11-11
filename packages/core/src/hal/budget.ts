// Hal's daily API spend ledger. Pure: no clock, no randomness, no I/O. Callers inject the date.
export type Billing = 'api' | 'subscription';
export type SpendCall = { run: string; role: string; billing: Billing; usd: number; at: string };
/** `day` is YYYY-MM-DD in local time. */
export type SpendDay = { day: string; calls: SpendCall[] };

export const DAILY_CAP_USD = 20;
export const SLICES: Record<string, number> = { planner: 1.5, implementer: 3, director: 1 };

/** Local calendar date (YYYY-MM-DD) of an injected clock reading. */
export function dayOf(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function apiSpent(day: SpendDay): number {
  return day.calls.reduce((s, c) => (c.billing === 'api' ? s + c.usd : s), 0);
}

/** Dollars this role may spend now: its slice, clipped to what is left of the cap. 0 means stop. */
export function sliceFor(day: SpendDay, role: string): number {
  const left = Math.max(0, DAILY_CAP_USD - apiSpent(day));
  return Math.max(0, Math.min(SLICES[role] ?? 0, left));
}

/** Returns a new day with the call appended. An unknown cost (missing/NaN) is booked as the full slice given. */
export function recordCall(day: SpendDay, call: Omit<SpendCall, 'usd'> & { usd?: number }): SpendDay {
  const known = typeof call.usd === 'number' && Number.isFinite(call.usd) && call.usd >= 0;
  const usd = known ? (call.usd as number) : sliceFor(day, call.role);
  return { ...day, calls: [...day.calls, { ...call, usd }] };
}
