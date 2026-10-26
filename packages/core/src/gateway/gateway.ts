import type { Action, ActionClass, ActionKind } from '../domain/actions.js';
import type { AuditEntry, InboxItem } from '../domain/types.js';
import { classifyAction } from '../policy/classify.js';
import type { Policy } from '../policy/schema.js';
import type { RegistryStore } from '../registry/store.js';
import { reserveBudget, settleBudget } from './budget.js';
import { checkHardRules } from './hard-rules.js';

export type Executor = (a: Action) => Promise<{ ok: boolean; detail?: string; actualUsd?: number }>;
export interface Notification { title: string; body: string; gameSlug?: string; urgent: boolean }

export interface GatewayDeps {
  store: RegistryStore;
  /** A throwing loader makes the gateway fail closed. */
  policy: Policy | (() => Promise<Policy>);
  executors: Partial<Record<ActionKind, Executor>>;
  notify: (n: Notification) => Promise<void>;
  /** Pause all campaigns and cancel scheduled posts. */
  onKillSwitch?: () => Promise<void>;
  clock: () => Date;
  ids: () => string;
}

export interface InboxMeta { title: string; recommendation: string; keyNumbers: { label: string; value: string }[] }

export type BlockReason = 'kill_switch' | 'hard_rule' | 'policy_unavailable' | 'unknown_action'
  | 'budget_cap' | 'no_executor' | 'already_decided' | 'not_found' | 'rejected';

export type GatewayResult =
  | { status: 'executed'; notified: boolean; detail?: string }
  | { status: 'pending_approval'; inboxItemId: string }
  | { status: 'blocked'; reason: BlockReason; detail?: string }
  | { status: 'failed'; detail?: string };

export type Decision = { by: string; choice: 'approve' | 'reject' | 'modify'; modifiedParams?: Record<string, unknown> };

const KILL_SWITCHED: ReadonlySet<ActionKind> = new Set(['spend', 'post.public']);

export function createGateway(d: GatewayDeps) {
  const now = () => d.clock().toISOString();
  const blocked = (reason: BlockReason, detail?: string): GatewayResult =>
    detail === undefined ? { status: 'blocked', reason } : { status: 'blocked', reason, detail };

  const audit = (type: string, a: Action, cls: ActionClass | null, result: GatewayResult, summary: string,
    actor: AuditEntry['actor'] = 'system') =>
    d.store.appendAudit({
      at: now(), actor, type, summary, data: { action: a, class: cls, result },
      ...(a.gameSlug ? { gameSlug: a.gameSlug } : {}),
    });

  const loadPolicy = async (): Promise<Policy> => (typeof d.policy === 'function' ? d.policy() : d.policy);

  /** Kill switch and hard rules, applied at submit and again at decision time. */
  async function precheck(a: Action): Promise<GatewayResult | null> {
    if (KILL_SWITCHED.has(a.kind) && (await d.store.getSettings()).killSwitch.engaged) return blocked('kill_switch');
    const hr = checkHardRules(a);
    return hr ? blocked('hard_rule', hr) : null;
  }

  async function createInbox(a: Action, meta: InboxMeta, urgent: boolean): Promise<string> {
    const item: InboxItem = {
      id: d.ids(), createdAt: now(), status: 'pending', action: a,
      title: meta.title, recommendation: meta.recommendation, keyNumbers: meta.keyNumbers,
    };
    await d.store.putInboxItem(item);
    await d.notify({
      title: urgent ? meta.title : `Approval needed: ${meta.title}`, body: meta.recommendation, urgent,
      ...(a.gameSlug ? { gameSlug: a.gameSlug } : {}),
    });
    return item.id;
  }

  async function executeNow(a: Action, cls: ActionClass, policy: Policy, actor: AuditEntry['actor']): Promise<GatewayResult> {
    const exec = d.executors[a.kind];
    if (!exec) {
      const r = blocked('no_executor');
      await audit('action.blocked', a, cls, r, `No executor for ${a.kind}`, actor);
      return r;
    }
    let reservationId: string | undefined;
    if ((a.costUsd ?? 0) > 0) {
      const res = await reserveBudget(d.store, policy, { gameSlug: a.gameSlug ?? '_overall', amountUsd: a.costUsd!, now: d.clock() });
      if (!res.ok) {
        const r = blocked('budget_cap', `${res.cap}: committed $${res.committedUsd} of $${res.capUsd}`);
        await audit('budget.cap_hit', a, cls, r, `Budget cap ${res.cap} hit`, actor);
        await createInbox(a, {
          title: `Budget cap hit: ${res.cap}`,
          recommendation: 'Spend is paused. Raise the cap in policy.yaml, or reject.',
          keyNumbers: [
            { label: 'cap', value: `$${res.capUsd}` },
            { label: 'committed', value: `$${res.committedUsd}` },
            { label: 'requested', value: `$${a.costUsd}` },
          ],
        }, true);
        return r;
      }
      reservationId = res.reservationId;
    }
    let out: { ok: boolean; detail?: string; actualUsd?: number };
    try {
      out = await exec(a);
    } catch (e) {
      out = { ok: false, detail: (e as Error).message };
    }
    if (reservationId) {
      await settleBudget(d.store, reservationId, out.ok ? { actualUsd: out.actualUsd ?? a.costUsd! } : { release: true }, d.clock());
    }
    if (!out.ok) {
      const r: GatewayResult = out.detail === undefined ? { status: 'failed' } : { status: 'failed', detail: out.detail };
      await audit('action.failed', a, cls, r, `${a.kind} failed`, actor);
      return r;
    }
    const notified = cls === 'notify';
    if (notified) {
      await d.notify({ title: `Done: ${a.kind}`, body: a.rationale ?? out.detail ?? '', urgent: false, ...(a.gameSlug ? { gameSlug: a.gameSlug } : {}) });
    }
    const r: GatewayResult = out.detail === undefined ? { status: 'executed', notified } : { status: 'executed', notified, detail: out.detail };
    await audit('action.executed', a, cls, r, `${a.kind} executed`, actor);
    return r;
  }

  async function submit(a: Action, meta: InboxMeta): Promise<GatewayResult> {
    const pre = await precheck(a);
    if (pre) {
      await audit('action.blocked', a, null, pre, `${a.kind} blocked`);
      return pre;
    }
    let policy: Policy;
    try {
      policy = await loadPolicy();
    } catch (e) {
      const r = blocked('policy_unavailable', (e as Error).message);
      await audit('action.blocked', a, null, r, 'Policy unavailable; failing closed');
      return r;
    }
    let cls: ActionClass;
    try {
      cls = classifyAction(a, policy);
    } catch (e) {
      const r = blocked('unknown_action', (e as Error).message);
      await audit('action.blocked', a, null, r, `Unknown action ${String(a.kind)}`);
      return r;
    }
    if (cls === 'approve') {
      const inboxItemId = await createInbox(a, meta, false);
      const r: GatewayResult = { status: 'pending_approval', inboxItemId };
      await audit('inbox.created', a, cls, r, meta.title);
      return r;
    }
    return executeNow(a, cls, policy, 'system');
  }

  async function decide(itemId: string, dec: Decision): Promise<GatewayResult> {
    const item = await d.store.getInboxItem(itemId);
    if (!item) return blocked('not_found');
    const status = dec.choice === 'reject' ? 'rejected' : 'approved';
    const decision = { at: now(), by: dec.by, choice: dec.choice, ...(dec.modifiedParams ? { modifiedParams: dec.modifiedParams } : {}) };
    if (!(await d.store.transitionInboxItem(itemId, 'pending', { status, decision }))) return blocked('already_decided');

    const a: Action = dec.choice === 'modify' ? { ...item.action, params: { ...item.action.params, ...dec.modifiedParams } } : item.action;
    if (dec.choice === 'reject') {
      const r = blocked('rejected');
      await audit('action.rejected', a, 'approve', r, `${dec.by} rejected: ${item.title}`, 'operator');
      return r;
    }
    const pre = await precheck(a);
    if (pre) {
      await audit('action.blocked', a, 'approve', pre, `${a.kind} blocked at decision time`, 'operator');
      return pre;
    }
    let policy: Policy;
    try {
      policy = await loadPolicy();
    } catch (e) {
      const r = blocked('policy_unavailable', (e as Error).message);
      await audit('action.blocked', a, 'approve', r, 'Policy unavailable; failing closed', 'operator');
      return r;
    }
    return executeNow(a, 'approve', policy, 'operator');
  }

  async function setKillSwitch(engaged: boolean, by: string) {
    await d.store.putSettings({ killSwitch: { engaged, at: now(), by } });
    await d.store.appendAudit({
      at: now(), actor: 'operator', type: engaged ? 'killswitch.engaged' : 'killswitch.released',
      summary: `Kill switch ${engaged ? 'engaged' : 'released'} by ${by}`, data: {},
    });
  }

  return {
    submit,
    decide,
    async engageKillSwitch(by: string) {
      await setKillSwitch(true, by);
      await d.onKillSwitch?.();
      await d.notify({ title: 'Kill switch engaged', body: `All spend and posting stopped by ${by}.`, urgent: true });
    },
    async releaseKillSwitch(by: string) {
      await setKillSwitch(false, by);
    },
  };
}

export type Gateway = ReturnType<typeof createGateway>;
