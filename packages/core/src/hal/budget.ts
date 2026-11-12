// Hal's daily API spend ledger. Pure: no clock, no randomness, no I/O. Callers inject the date.
export type Billing = 'api' | 'subscription';
/**
 * One Claude call. `pending` marks a reservation made before the call started (usd = the full slice); it is settled
 * with the real cost afterwards (settleCall). A crash leaves it pending, so the whole slice stays booked.
 */
export type SpendCall = { run: string; role: string; billing: Billing; usd: number; at: string; pending?: boolean; id?: string };
/** `day` is YYYY-MM-DD in local time. */
export type SpendDay = { day: string; calls: SpendCall[] };

export const DAILY_CAP_USD = 20;
/**
 * Slices are cut from DAILY_CAP_USD minus this margin (ruling R21): `claude --max-budget-usd` is only checked after a
 * turn, so a call can overshoot its slice a little. The cap itself (what the report shows) stays DAILY_CAP_USD.
 */
export const CAP_MARGIN_USD = 0.5;
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

/**
 * Dollars this role may spend now: its slice, clipped to what is left of the cap less CAP_MARGIN_USD and less `heldUsd`
 * (money set aside for a later call, e.g. the director's slice during the build loop). 0 means stop.
 */
export function sliceFor(day: SpendDay, role: string, heldUsd = 0): number {
  const left = Math.max(0, Math.round((DAILY_CAP_USD - CAP_MARGIN_USD - apiSpent(day) - Math.max(0, heldUsd)) * 100) / 100);
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

/**
 * Reserve-then-settle, step 1: appends `{..., id, usd: slice, pending: true}` before the call starts. `id` is the
 * caller's. `slice` is the call's own --max-budget-usd when the caller cut it smaller (e.g. with money held back);
 * default, and never more than, sliceFor(day, role).
 */
export function reserveCall(day: SpendDay, call: Omit<SpendCall, 'usd' | 'pending'> & { id: string }, slice?: number): SpendDay {
  if (!Object.hasOwn(SLICES, call.role)) throw new Error(`unknown budget role: ${call.role}`);
  if (day.calls.some((c) => c.id === call.id)) throw new Error(`duplicate spend id: ${call.id}`);
  const max = sliceFor(day, call.role);
  const usd = typeof slice === 'number' && Number.isFinite(slice) && slice >= 0 ? Math.min(slice, max) : max;
  return { ...day, calls: [...day.calls, { ...call, usd, pending: true }] };
}

/**
 * Step 2: settles the pending entry `id` (in the day it was reserved; the caller loads that day) with the real cost.
 * An unknown cost (null, NaN, negative) keeps the reserved slice. Throws if `day` has no pending entry `id`.
 */
export function settleCall(day: SpendDay, id: string, usd: number | null | undefined): SpendDay {
  const i = day.calls.findIndex((c) => c.id === id && c.pending);
  if (i < 0) throw new Error(`no pending spend entry ${id} on ${day.day}`);
  const known = typeof usd === 'number' && Number.isFinite(usd) && usd >= 0;
  const calls = [...day.calls];
  const { pending: _p, ...rest } = calls[i]!;
  calls[i] = { ...rest, usd: known ? usd : rest.usd };
  return { ...day, calls };
}
