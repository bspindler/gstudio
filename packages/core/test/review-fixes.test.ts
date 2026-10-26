// Regression tests for the Phase 1a final review findings.
import { describe, expect, it, vi } from 'vitest';
import {
  MemoryStore, checkHardRules, createGateway, createStageExecutors, evaluateGate, reserveBudget, settleBudget,
  type Action, type Executor, type Notification, type Policy,
} from '@studio/core';
import { game, metrics, policyWithBudgets, repoPolicy, seq } from './helpers.js';

const NOW = new Date('2026-11-01T12:00:00Z');
const meta = { title: 't', recommendation: 'r', keyNumbers: [] };
const budgeted: Policy = policyWithBudgets({
  per_game_default: { daily_usd: 50, total_usd: 200 }, overall: { daily_usd: 100, total_usd: 1000 },
});

function setup(opts: { policy?: Policy | (() => Promise<Policy>); exec?: Executor; notify?: (n: Notification) => Promise<void> } = {}) {
  const store = new MemoryStore(seq('a'));
  const exec = vi.fn<Executor>(opts.exec ?? (async () => ({ ok: true })));
  const stage = createStageExecutors(store, () => NOW);
  const gw = createGateway({
    store, policy: opts.policy ?? repoPolicy(), clock: () => NOW, ids: seq('i'),
    notify: opts.notify ?? (async () => {}),
    executors: { ...stage, spend: exec, 'web.publish': exec, 'account.create': exec, 'store.submit': exec },
  });
  return { store, gw, exec };
}
const pendingId = (r: { status: string; inboxItemId?: string }) => {
  if (r.status !== 'pending_approval' || !r.inboxItemId) throw new Error(`expected pending, got ${r.status}`);
  return r.inboxItemId;
};

describe('#1 stage actions are verified against the registry', () => {
  it('stage.kill with a false fromStage is blocked', async () => {
    const { store, gw } = setup();
    await store.putGame(game({ slug: 'g', stage: 4 }));
    const r = await gw.submit({ kind: 'stage.kill', gameSlug: 'g', fromStage: 2, toStage: 7, params: {}, requestedBy: 'system' }, meta);
    expect(r).toMatchObject({ status: 'blocked', reason: 'invalid_transition' });
    expect((await store.getGame('g'))?.stage).toBe(4);
  });

  it('stage.advance that skips stages is blocked', async () => {
    const { store, gw } = setup();
    await store.putGame(game({ slug: 'g', stage: 2 }));
    const r = await gw.submit({ kind: 'stage.advance', gameSlug: 'g', fromStage: 5, toStage: 6, params: {}, requestedBy: 'system' }, meta);
    expect(r).toMatchObject({ status: 'blocked', reason: 'invalid_transition' });
    const r2 = await gw.submit({ kind: 'stage.advance', gameSlug: 'g', fromStage: 2, toStage: 4, params: {}, requestedBy: 'system' }, meta);
    expect(r2).toMatchObject({ status: 'blocked', reason: 'invalid_transition' });
  });

  it('a stale approved promote cannot resurrect a killed game', async () => {
    const { store, gw } = setup();
    await store.putGame(game({ slug: 'g', stage: 3 }));
    const promote = pendingId(await gw.submit({ kind: 'stage.advance', gameSlug: 'g', fromStage: 3, toStage: 4, params: {}, requestedBy: 'system' }, meta));
    const kill = pendingId(await gw.submit({ kind: 'stage.kill', gameSlug: 'g', fromStage: 3, toStage: 7, params: {}, requestedBy: 'system' }, meta));
    await gw.decide(kill, { by: 'brian', choice: 'approve' });
    expect(await gw.decide(promote, { by: 'brian', choice: 'approve' })).toMatchObject({ status: 'blocked', reason: 'invalid_transition' });
    expect((await store.getGame('g'))?.stage).toBe(7);
  });

  it('stage executor refuses when the game moved underneath it', async () => {
    const store = new MemoryStore();
    await store.putGame(game({ slug: 'g', stage: 5 }));
    const exec = createStageExecutors(store, () => NOW)['stage.advance'];
    expect((await exec({ kind: 'stage.advance', gameSlug: 'g', fromStage: 2, toStage: 3, params: {}, requestedBy: 'system' })).ok).toBe(false);
  });
});

describe('#2 non-finite amounts never open the budget', () => {
  it('settleBudget rejects NaN actuals', async () => {
    const s = new MemoryStore();
    const r = await reserveBudget(s, budgeted, { gameSlug: 'g', amountUsd: 5, now: NOW });
    if (!r.ok) throw new Error('expected ok');
    await expect(settleBudget(s, r.reservationId, { actualUsd: Number.NaN }, NOW)).rejects.toThrow();
  });

  it('reserveBudget rejects NaN and negative amounts', async () => {
    await expect(reserveBudget(new MemoryStore(), budgeted, { gameSlug: 'g', amountUsd: Number.NaN, now: NOW })).rejects.toThrow();
    await expect(reserveBudget(new MemoryStore(), budgeted, { gameSlug: 'g', amountUsd: -1, now: NOW })).rejects.toThrow();
  });

  it('executor returning NaN actual records the estimate and caps still hold', async () => {
    const { store, gw } = setup({ policy: budgeted, exec: async () => ({ ok: true, actualUsd: Number.NaN }) });
    const id = pendingId(await gw.submit({ kind: 'spend', gameSlug: 'g', costUsd: 30, params: { via: 'official_api' }, requestedBy: 'system' }, meta));
    expect((await gw.decide(id, { by: 'brian', choice: 'approve' })).status).toBe('executed');
    expect((await reserveBudget(store, budgeted, { gameSlug: 'g', amountUsd: 1_000_000, now: NOW })).ok).toBe(false);
  });
});

describe('#3 zero-cost spend is rejected', () => {
  it('spend with costUsd 0 violates hard rules', () => {
    expect(checkHardRules({ kind: 'spend', gameSlug: 'g', costUsd: 0, params: { via: 'official_api' }, requestedBy: 'system' }, NOW)).toMatch(/costUsd/);
  });
});

describe('#4 notify failures never lose the audit or escape', () => {
  it('executed action is audited even if notify throws', async () => {
    const { store, gw } = setup({ notify: async () => { throw new Error('push down'); } });
    expect((await gw.submit({ kind: 'web.publish', params: {}, requestedBy: 'system' }, meta)).status).toBe('executed');
    expect((await store.listAudit()).map((e) => e.type)).toContain('action.executed');
  });

  it('inbox creation is audited even if notify throws', async () => {
    const { store, gw } = setup({ notify: async () => { throw new Error('push down'); } });
    expect((await gw.submit({ kind: 'store.submit', params: {}, requestedBy: 'system' }, meta)).status).toBe('pending_approval');
    expect((await store.listAudit()).map((e) => e.type)).toContain('inbox.created');
  });
});

describe('#5 hard-rule clock comes from the caller, not the action', () => {
  it('a backdated params.now cannot sneak an expired drop through', () => {
    const a: Action = { kind: 'balance.tweak', params: { now: 0, limitedDrop: { cap: 5, endsAt: '2020-01-01T00:00:00Z' } }, requestedBy: 'system' };
    expect(checkHardRules(a, NOW)).toMatch(/^HR4/);
  });
});

describe('#6 a blocked decision leaves the item pending', () => {
  it('approval blocked by kill switch can be retried after release', async () => {
    const { store, gw, exec } = setup({ policy: budgeted });
    const id = pendingId(await gw.submit({ kind: 'spend', gameSlug: 'g', costUsd: 5, params: { via: 'official_api' }, requestedBy: 'system' }, meta));
    await gw.engageKillSwitch('brian');
    expect((await gw.decide(id, { by: 'brian', choice: 'approve' })).status).toBe('blocked');
    expect((await store.getInboxItem(id))?.status).toBe('pending');
    await gw.releaseKillSwitch('brian');
    expect((await gw.decide(id, { by: 'brian', choice: 'approve' })).status).toBe('executed');
    expect(exec).toHaveBeenCalledTimes(1);
  });
});

describe('#9/#10 kill switch covers late engagement and any costly action', () => {
  it('switch engaged after the precheck still stops the spend', async () => {
    let gwRef: ReturnType<typeof setup>['gw'] | undefined;
    let engage = false;
    const ctx = setup({
      policy: async () => {
        if (engage) await gwRef!.engageKillSwitch('brian');
        return budgeted;
      },
    });
    gwRef = ctx.gw;
    const id = pendingId(await ctx.gw.submit({ kind: 'spend', gameSlug: 'g', costUsd: 5, params: { via: 'official_api' }, requestedBy: 'system' }, meta));
    engage = true;
    expect(await ctx.gw.decide(id, { by: 'brian', choice: 'approve' })).toMatchObject({ status: 'blocked', reason: 'kill_switch' });
    expect(ctx.exec).not.toHaveBeenCalled();
  });

  it('any action with costUsd > 0 is stopped by the kill switch', async () => {
    const { gw } = setup({ policy: budgeted });
    await gw.engageKillSwitch('brian');
    expect(await gw.submit({ kind: 'account.create', costUsd: 99, params: {}, requestedBy: 'system' }, meta))
      .toMatchObject({ status: 'blocked', reason: 'kill_switch' });
  });
});

describe('#7 2->3 kill needs a decision-grade failing channel', () => {
  it('does not kill when no channel has enough players', () => {
    const e = evaluateGate(game(), [
      metrics({ channel: 'portal', d1: 0, players: 10 }),
      metrics({ channel: 'own_site', d1: 0.14, players: 190 }),
    ], repoPolicy(), { now: new Date('2026-11-01T00:00:00Z') });
    expect(e.decision).toBe('hold');
  });
});

describe('#8 3->4 requires fresh, sizeable crash data', () => {
  const now = new Date('2026-11-01T00:00:00Z');
  it('stale crash-free snapshot holds with insufficient data', () => {
    const e = evaluateGate(game({ stage: 3 }), [metrics({ channel: 'store', crashFreeRate: 0.999, asOf: '2026-08-01T00:00:00Z' })], repoPolicy(), { now, storeReadiness: true });
    expect(e).toMatchObject({ decision: 'hold', insufficientData: true });
  });
  it('tiny sample holds with insufficient data', () => {
    const e = evaluateGate(game({ stage: 3 }), [metrics({ channel: 'store', crashFreeRate: 0.999, players: 3 })], repoPolicy(), { now, storeReadiness: true });
    expect(e).toMatchObject({ decision: 'hold', insufficientData: true });
  });
});
