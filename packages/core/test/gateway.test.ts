import { describe, expect, it, vi } from 'vitest';
import {
  MemoryStore, createGateway, reserveBudget, type Action, type Executor, type GatewayDeps, type Notification, type Policy,
} from '@studio/core';
import { policyWithBudgets, repoPolicy, seq } from './helpers.js';

const NOW = new Date('2026-11-01T12:00:00Z');
const meta = { title: 'Do the thing', recommendation: 'Approve', keyNumbers: [{ label: 'cost', value: '$1' }] };
const act = (a: Partial<Action> & Pick<Action, 'kind'>): Action => ({ requestedBy: 'system', params: {}, ...a });
const spend = (costUsd: number): Action =>
  act({ kind: 'spend', gameSlug: 'g', costUsd, params: { via: 'official_api' } });
const post = (): Action => act({ kind: 'post.public', channel: 'youtube', params: { via: 'official_api' } });

function setup(opts: { policy?: GatewayDeps['policy']; executor?: Executor } = {}) {
  const store = new MemoryStore(seq('a'));
  const exec = vi.fn<Executor>(opts.executor ?? (async () => ({ ok: true })));
  const notify = vi.fn<(n: Notification) => Promise<void>>(async () => {});
  const onKillSwitch = vi.fn(async () => {});
  const executors = Object.fromEntries(
    ['build', 'web.publish', 'store.submit', 'spend', 'post.public', 'iap.change', 'stage.kill'].map((k) => [k, exec]),
  );
  const gw = createGateway({
    store, policy: opts.policy ?? repoPolicy(), executors, notify, onKillSwitch, clock: () => NOW, ids: seq('i'),
  });
  return { store, gw, exec, notify, onKillSwitch };
}
const budgeted: Policy = policyWithBudgets({
  per_game_default: { daily_usd: 50, total_usd: 200 }, overall: { daily_usd: 100, total_usd: 1000 },
});

describe('ActionGateway', () => {
  it('auto action executes and audits', async () => {
    const { gw, exec, store } = setup();
    expect(await gw.submit(act({ kind: 'build' }), meta)).toEqual({ status: 'executed', notified: false });
    expect(exec).toHaveBeenCalledTimes(1);
    expect((await store.listAudit()).map((e) => e.type)).toEqual(['action.executed']);
  });

  it('notify action executes then notifies', async () => {
    const { gw, notify } = setup();
    expect(await gw.submit(act({ kind: 'web.publish' }), meta)).toMatchObject({ status: 'executed', notified: true });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('approve action creates inbox item and does not execute', async () => {
    const { gw, exec, store, notify } = setup();
    const res = await gw.submit(act({ kind: 'store.submit' }), meta);
    expect(res.status).toBe('pending_approval');
    expect(await store.listInbox('pending')).toHaveLength(1);
    expect(exec).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ urgent: false }));
  });

  it('approving executes once', async () => {
    const { gw, exec } = setup();
    const res = await gw.submit(act({ kind: 'store.submit' }), meta);
    if (res.status !== 'pending_approval') throw new Error(res.status);
    expect(await gw.decide(res.inboxItemId, { by: 'brian', choice: 'approve' })).toMatchObject({ status: 'executed' });
    expect(await gw.decide(res.inboxItemId, { by: 'brian', choice: 'approve' }))
      .toEqual({ status: 'blocked', reason: 'already_decided' });
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('concurrent double approval executes once', async () => {
    const { gw, exec } = setup();
    const res = await gw.submit(act({ kind: 'store.submit' }), meta);
    if (res.status !== 'pending_approval') throw new Error(res.status);
    await Promise.all([1, 2].map(() => gw.decide(res.inboxItemId, { by: 'brian', choice: 'approve' })));
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('deciding an unknown item is not_found', async () => {
    const { gw } = setup();
    expect(await gw.decide('nope', { by: 'brian', choice: 'approve' })).toEqual({ status: 'blocked', reason: 'not_found' });
  });

  it('reject never executes', async () => {
    const { gw, exec, store } = setup();
    const res = await gw.submit(act({ kind: 'store.submit' }), meta);
    if (res.status !== 'pending_approval') throw new Error(res.status);
    expect(await gw.decide(res.inboxItemId, { by: 'brian', choice: 'reject' })).toEqual({ status: 'blocked', reason: 'rejected' });
    expect(exec).not.toHaveBeenCalled();
    expect((await store.getInboxItem(res.inboxItemId))?.status).toBe('rejected');
  });

  it('modify re-checks hard rules', async () => {
    const { gw, exec } = setup();
    const res = await gw.submit(act({ kind: 'iap.change' }), meta);
    if (res.status !== 'pending_approval') throw new Error(res.status);
    expect(await gw.decide(res.inboxItemId, { by: 'brian', choice: 'modify', modifiedParams: { randomReward: true } }))
      .toMatchObject({ status: 'blocked', reason: 'hard_rule' });
    expect(exec).not.toHaveBeenCalled();
  });

  it('modify merges params before executing', async () => {
    const { gw, exec } = setup();
    const res = await gw.submit(act({ kind: 'iap.change', params: { price: 0.99 } }), meta);
    if (res.status !== 'pending_approval') throw new Error(res.status);
    await gw.decide(res.inboxItemId, { by: 'brian', choice: 'modify', modifiedParams: { price: 1.99 } });
    expect(exec.mock.calls[0]![0].params).toEqual({ price: 1.99 });
  });

  it('kill switch blocks spend and posting', async () => {
    const { gw, exec, onKillSwitch, store } = setup({ policy: budgeted });
    await gw.engageKillSwitch('brian');
    expect(await gw.submit(spend(5), meta)).toEqual({ status: 'blocked', reason: 'kill_switch' });
    expect(await gw.submit(post(), meta)).toEqual({ status: 'blocked', reason: 'kill_switch' });
    expect(await gw.submit(act({ kind: 'build' }), meta)).toMatchObject({ status: 'executed' });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(onKillSwitch).toHaveBeenCalledTimes(1);
    expect((await store.getSettings()).killSwitch).toMatchObject({ engaged: true, by: 'brian' });
  });

  it('kill switch blocks a pending approval decided later', async () => {
    const { gw, exec } = setup({ policy: budgeted });
    const res = await gw.submit(spend(5), meta);
    if (res.status !== 'pending_approval') throw new Error(res.status);
    await gw.engageKillSwitch('brian');
    expect(await gw.decide(res.inboxItemId, { by: 'brian', choice: 'approve' }))
      .toEqual({ status: 'blocked', reason: 'kill_switch' });
    expect(exec).not.toHaveBeenCalled();
  });

  it('releasing the kill switch allows spend again', async () => {
    const { gw } = setup({ policy: budgeted });
    await gw.engageKillSwitch('brian');
    await gw.releaseKillSwitch('brian');
    expect((await gw.submit(spend(5), meta)).status).toBe('pending_approval');
  });

  it('policy loader failure fails closed', async () => {
    const { gw, exec } = setup({ policy: async () => { throw new Error('bad yaml'); } });
    expect(await gw.submit(act({ kind: 'build' }), meta)).toMatchObject({ status: 'blocked', reason: 'policy_unavailable' });
    expect(exec).not.toHaveBeenCalled();
  });

  it('unknown action kind', async () => {
    const { gw } = setup();
    expect(await gw.submit(act({ kind: 'nuke' as Action['kind'] }), meta)).toMatchObject({ status: 'blocked', reason: 'unknown_action' });
  });

  it('missing executor is no_executor', async () => {
    const { gw } = setup();
    expect(await gw.submit(act({ kind: 'qa.run' }), meta)).toMatchObject({ status: 'blocked', reason: 'no_executor' });
  });

  it('hard rule violation is blocked at submit', async () => {
    const { gw, store } = setup();
    expect(await gw.submit(act({ kind: 'web.publish', params: { realPayments: true } }), meta))
      .toMatchObject({ status: 'blocked', reason: 'hard_rule' });
    expect((await store.listAudit()).at(-1)?.type).toBe('action.blocked');
  });

  it('budget cap creates urgent inbox item', async () => {
    const { gw, exec, store, notify } = setup({ policy: budgeted });
    const res = await gw.submit(spend(60), meta);
    if (res.status !== 'pending_approval') throw new Error(res.status);
    expect(await gw.decide(res.inboxItemId, { by: 'brian', choice: 'approve' }))
      .toMatchObject({ status: 'blocked', reason: 'budget_cap' });
    expect(exec).not.toHaveBeenCalled();
    expect((await store.listInbox('pending')).map((i) => i.title)).toEqual([expect.stringMatching(/^Budget cap hit/)]);
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ urgent: true }));
  });

  it('executor failure releases budget', async () => {
    const { gw, store } = setup({ policy: budgeted, executor: async () => ({ ok: false, detail: 'api down' }) });
    const res = await gw.submit(spend(30), meta);
    if (res.status !== 'pending_approval') throw new Error(res.status);
    expect(await gw.decide(res.inboxItemId, { by: 'brian', choice: 'approve' })).toMatchObject({ status: 'failed' });
    expect((await reserveBudget(store, budgeted, { gameSlug: 'g', amountUsd: 50, now: NOW })).ok).toBe(true);
  });

  it('executor throwing is a failure that releases budget', async () => {
    const { gw, store } = setup({ policy: budgeted, executor: async () => { throw new Error('boom'); } });
    const res = await gw.submit(spend(30), meta);
    if (res.status !== 'pending_approval') throw new Error(res.status);
    expect(await gw.decide(res.inboxItemId, { by: 'brian', choice: 'approve' })).toMatchObject({ status: 'failed', detail: 'boom' });
    expect((await reserveBudget(store, budgeted, { gameSlug: 'g', amountUsd: 50, now: NOW })).ok).toBe(true);
  });

  it('stage.kill at stage 3 needs approval', async () => {
    const { gw } = setup();
    expect((await gw.submit(act({ kind: 'stage.kill', fromStage: 3 }), meta)).status).toBe('pending_approval');
  });

  it('every terminal path writes an audit entry with action, class and result', async () => {
    const { gw, store } = setup();
    await gw.submit(act({ kind: 'build' }), meta);
    const e = (await store.listAudit()).at(-1)!;
    expect(e.data).toMatchObject({ action: { kind: 'build' }, class: 'auto', result: { status: 'executed' } });
  });
});
