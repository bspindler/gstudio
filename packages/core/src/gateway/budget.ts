import { randomUUID } from 'node:crypto';
import type { LedgerEntry } from '../domain/types.js';
import type { Policy } from '../policy/schema.js';
import type { RegistryStore } from '../registry/store.js';

export type CapName = 'game_daily' | 'game_total' | 'overall_daily' | 'overall_total';
type Totals = { dailyUsd: number; totalUsd: number };

const LOCK = 'budget';
const utcDayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
const cents = (n: number) => Math.round(n * 100) / 100;

/** Committed amount per reservation: the actual if recorded, else the reserve unless released. */
function committed(ledger: LedgerEntry[]) {
  const byRes = new Map<string, { gameSlug: string | null; at: string; reserve: number; actual?: number; released: boolean }>();
  for (const e of ledger) {
    const r = byRes.get(e.reservationId) ?? { gameSlug: e.gameSlug, at: e.at, reserve: 0, released: false };
    if (e.kind === 'reserve') { r.reserve += e.amountUsd; r.at = e.at; }
    if (e.kind === 'actual') r.actual = (r.actual ?? 0) + e.amountUsd;
    if (e.kind === 'release') r.released = true;
    byRes.set(e.reservationId, r);
  }
  return [...byRes.values()].map((r) => ({
    gameSlug: r.gameSlug, at: r.at, amountUsd: r.actual ?? (r.released ? 0 : r.reserve),
  }));
}

function totals(ledger: LedgerEntry[], now: Date) {
  const dayStart = utcDayStart(now);
  const overall: Totals = { dailyUsd: 0, totalUsd: 0 };
  const perGame: Record<string, Totals> = {};
  for (const c of committed(ledger)) {
    const daily = c.at >= dayStart ? c.amountUsd : 0;
    overall.dailyUsd = cents(overall.dailyUsd + daily);
    overall.totalUsd = cents(overall.totalUsd + c.amountUsd);
    if (c.gameSlug) {
      const g = (perGame[c.gameSlug] ??= { dailyUsd: 0, totalUsd: 0 });
      g.dailyUsd = cents(g.dailyUsd + daily);
      g.totalUsd = cents(g.totalUsd + c.amountUsd);
    }
  }
  return { overall, perGame };
}

const assertAmount = (n: number, what: string) => {
  if (!Number.isFinite(n) || n < 0) throw new Error(`${what} must be a finite amount >= 0 (got ${n})`);
};

export async function reserveBudget(
  store: RegistryStore,
  policy: Policy,
  req: { gameSlug: string; amountUsd: number; now: Date },
): Promise<{ ok: true; reservationId: string } | { ok: false; cap: CapName; capUsd: number; committedUsd: number }> {
  assertAmount(req.amountUsd, 'amountUsd');
  return store.withLock(LOCK, async () => {
    const t = totals(await store.listLedger(), req.now);
    const game = t.perGame[req.gameSlug] ?? { dailyUsd: 0, totalUsd: 0 };
    const gameCap = policy.budgets.per_game[req.gameSlug] ?? policy.budgets.per_game_default;
    const checks: [CapName, number, number][] = [
      ['game_daily', gameCap.daily_usd, game.dailyUsd],
      ['game_total', gameCap.total_usd, game.totalUsd],
      ['overall_daily', policy.budgets.overall.daily_usd, t.overall.dailyUsd],
      ['overall_total', policy.budgets.overall.total_usd, t.overall.totalUsd],
    ];
    for (const [cap, capUsd, committedUsd] of checks) {
      // Written as !(<=) so a NaN anywhere fails closed.
      if (!(cents(committedUsd + req.amountUsd) <= capUsd)) return { ok: false, cap, capUsd, committedUsd };
    }
    const reservationId = randomUUID();
    await store.appendLedger({
      at: req.now.toISOString(), gameSlug: req.gameSlug, amountUsd: req.amountUsd, kind: 'reserve', reservationId,
    });
    return { ok: true, reservationId };
  });
}

export async function settleBudget(
  store: RegistryStore,
  reservationId: string,
  outcome: { actualUsd: number } | { release: true },
  now: Date,
): Promise<void> {
  if ('actualUsd' in outcome) assertAmount(outcome.actualUsd, 'actualUsd');
  await store.withLock(LOCK, async () => {
    const reserve = (await store.listLedger()).find((e) => e.reservationId === reservationId && e.kind === 'reserve');
    if (!reserve) throw new Error(`unknown reservation ${reservationId}`);
    await store.appendLedger({
      at: now.toISOString(),
      gameSlug: reserve.gameSlug,
      amountUsd: 'actualUsd' in outcome ? outcome.actualUsd : 0,
      kind: 'actualUsd' in outcome ? 'actual' : 'release',
      reservationId,
    });
  });
}

export async function budgetStatus(store: RegistryStore, _policy: Policy, now: Date) {
  return totals(await store.listLedger(), now);
}
