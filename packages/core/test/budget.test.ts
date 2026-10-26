import { describe, expect, it } from 'vitest';
import { MemoryStore, budgetStatus, reserveBudget, settleBudget } from '@studio/core';
import { policyWithBudgets, repoPolicy } from './helpers.js';

const policy = policyWithBudgets({
  per_game_default: { daily_usd: 50, total_usd: 200 },
  overall: { daily_usd: 80, total_usd: 1000 },
});
const now = new Date('2026-11-01T12:00:00Z');
const r = (store: MemoryStore, gameSlug: string, amountUsd: number, at = now) =>
  reserveBudget(store, policy, { gameSlug, amountUsd, now: at });

describe('budget ledger', () => {
  it('reserves within caps', async () => {
    expect((await r(new MemoryStore(), 'a', 30)).ok).toBe(true);
  });

  it('blocks over game daily', async () => {
    const s = new MemoryStore();
    await r(s, 'a', 30);
    expect(await r(s, 'a', 25)).toEqual({ ok: false, cap: 'game_daily', capUsd: 50, committedUsd: 30 });
  });

  it('concurrent reservations cannot jointly exceed', async () => {
    const s = new MemoryStore();
    const results = await Promise.all([r(s, 'a', 30), r(s, 'a', 30)]);
    expect(results.filter((x) => x.ok)).toHaveLength(1);
  });

  it('overall cap across games', async () => {
    const s = new MemoryStore();
    expect((await r(s, 'a', 50)).ok).toBe(true);
    expect(await r(s, 'b', 40)).toMatchObject({ ok: false, cap: 'overall_daily' });
  });

  it('game total cap across days', async () => {
    const s = new MemoryStore();
    for (let d = 1; d <= 4; d++) expect((await r(s, 'a', 50, new Date(`2026-11-0${d}T12:00:00Z`))).ok).toBe(true);
    expect(await r(s, 'a', 1, new Date('2026-11-05T12:00:00Z'))).toMatchObject({ ok: false, cap: 'game_total' });
  });

  it('per-game override beats default', async () => {
    const p = policyWithBudgets({ ...policy.budgets, per_game: { a: { daily_usd: 10, total_usd: 10 } } });
    expect(await reserveBudget(new MemoryStore(), p, { gameSlug: 'a', amountUsd: 11, now })).toMatchObject({ ok: false, cap: 'game_daily' });
  });

  it('release frees budget', async () => {
    const s = new MemoryStore();
    const res = await r(s, 'a', 30);
    if (!res.ok) throw new Error('expected ok');
    await settleBudget(s, res.reservationId, { release: true }, now);
    expect((await r(s, 'a', 50)).ok).toBe(true);
  });

  it('actual replaces reservation', async () => {
    const s = new MemoryStore();
    const res = await r(s, 'a', 30);
    if (!res.ok) throw new Error('expected ok');
    await settleBudget(s, res.reservationId, { actualUsd: 10 }, now);
    expect((await r(s, 'a', 40)).ok).toBe(true);
    expect((await budgetStatus(s, policy, now)).perGame.a).toEqual({ dailyUsd: 50, totalUsd: 50 });
  });

  it('daily resets at UTC midnight', async () => {
    const s = new MemoryStore();
    expect((await r(s, 'a', 50, new Date('2026-11-01T23:59:00Z'))).ok).toBe(true);
    expect((await r(s, 'a', 50, new Date('2026-11-02T00:01:00Z'))).ok).toBe(true);
  });

  it('zero caps block everything', async () => {
    expect(await reserveBudget(new MemoryStore(), repoPolicy(), { gameSlug: 'a', amountUsd: 0.01, now }))
      .toMatchObject({ ok: false, cap: 'game_daily' });
  });

  it('budgetStatus sums overall', async () => {
    const s = new MemoryStore();
    await r(s, 'a', 20);
    await r(s, 'b', 15);
    expect((await budgetStatus(s, policy, now)).overall).toEqual({ dailyUsd: 35, totalUsd: 35 });
  });
});
