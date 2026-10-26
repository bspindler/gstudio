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
  | 'budget_cap' | 'no_executor' | 'already_decided' | 'not_found' | 'rejected' | 'invalid_transition';

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
  const slugOf = (a: Action) => (a.gameSlug ? { gameSlug: a.gameSlug } : {});

  const audit = (type: string, a: Action, cls: ActionClass | null, result: GatewayResult, summary: string,
    actor: AuditEntry['actor'] = 'system') =>
    d.store.appendAudit({ at: now(), actor, type, summary, data: { action: a, class: cls, result }, ...slugOf(a) });

  /** Notification failures are audited and never escape: the action has already happened. */
  async function safeNotify(n: Notification) {
    try {
      await d.notify(n);
    } catch (e) {
      await d.store.appendAudit({
        at: now(), actor: 'system', type: 'notify.failed', summary: n.title,
        data: { notification: n, error: (e as Error).message }, ...(n.gameSlug ? { gameSlug: n.gameSlug } : {}),
      });
    }
  }

  const loadPolicy = async (): Promise<Policy> => (typeof d.policy === 'function' ? d.policy() : d.policy);
  const killSwitched = (a: Action) => KILL_SWITCHED.has(a.kind) || (a.costUsd ?? 0) > 0;
  const killSwitchOn = async () => (await d.store.getSettings()).killSwitch.engaged;

  /** Stage actions must match the game's real current stage, and advances move exactly one stage. */
  async function checkTransition(a: Action): Promise<string | null> {
    if (a.kind !== 'stage.advance' && a.kind !== 'stage.kill') return null;
    const g = a.gameSlug ? await d.store.getGame(a.gameSlug) : undefined;
    if (!g) return `unknown game ${a.gameSlug ?? '(none)'}`;
    if (a.fromStage !== g.stage) return `${g.slug} is at stage ${g.stage}, not ${String(a.fromStage)}`;
    if (a.kind === 'stage.advance' && a.toStage !== g.stage + 1) return `advance must go ${g.stage}->${g.stage + 1}`;
    if (a.kind === 'stage.kill' && g.stage === 7) return `${g.slug} is already sunset`;
    return null;
  }

  /** Kill switch, hard rules and stage verification, applied at submit and again at decision time. */
  async function precheck(a: Action): Promise<GatewayResult | null> {
    if (killSwitched(a) && (await killSwitchOn())) return blocked('kill_switch');
    const hr = checkHardRules(a, d.clock());
    if (hr) return blocked('hard_rule', hr);
    const tr = await checkTransition(a);
    return tr ? blocked('invalid_transition', tr) : null;
  }

  async function putInbox(a: Action, meta: InboxMeta): Promise<string> {
    const item: InboxItem = {
      id: d.ids(), createdAt: now(), status: 'pending', action: a,
      title: meta.title, recommendation: meta.recommendation, keyNumbers: meta.keyNumbers,
    };
    await d.store.putInboxItem(item);
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
        const title = `Budget cap hit: ${res.cap}`;
        await putInbox(a, {
          title,
          recommendation: 'Spend is paused. Raise the cap in policy.yaml, or reject.',
          keyNumbers: [
            { label: 'cap', value: `$${res.capUsd}` },
            { label: 'committed', value: `$${res.committedUsd}` },
            { label: 'requested', value: `$${a.costUsd}` },
          ],
        });
        await safeNotify({ title, body: `Requested $${a.costUsd} for ${a.gameSlug ?? 'overall'}`, urgent: true, ...slugOf(a) });
        return r;
      }
      reservationId = res.reservationId;
    }
    // Last-moment kill switch check: the switch may have been engaged after the precheck.
    if (killSwitched(a) && (await killSwitchOn())) {
      if (reservationId) await settleBudget(d.store, reservationId, { release: true }, d.clock());
      const r = blocked('kill_switch');
      await audit('action.blocked', a, cls, r, `${a.kind} stopped by kill switch`, actor);
      return r;
    }
    let out: { ok: boolean; detail?: string; actualUsd?: number };
    try {
      out = await exec(a);
    } catch (e) {
      out = { ok: false, detail: (e as Error).message };
    }
    if (reservationId) {
      // An unusable actual from an executor falls back to the (already reserved) estimate.
      const actual = out.actualUsd !== undefined && Number.isFinite(out.actualUsd) && out.actualUsd >= 0 ? out.actualUsd : a.costUsd!;
      await settleBudget(d.store, reservationId, out.ok ? { actualUsd: actual } : { release: true }, d.clock());
    }
    if (!out.ok) {
      const r: GatewayResult = out.detail === undefined ? { status: 'failed' } : { status: 'failed', detail: out.detail };
      await audit('action.failed', a, cls, r, `${a.kind} failed`, actor);
      return r;
    }
    const notified = cls === 'notify';
    const r: GatewayResult = out.detail === undefined ? { status: 'executed', notified } : { status: 'executed', notified, detail: out.detail };
    await audit('action.executed', a, cls, r, `${a.kind} executed`, actor);
    if (notified) await safeNotify({ title: `Done: ${a.kind}`, body: a.rationale ?? out.detail ?? '', urgent: false, ...slugOf(a) });
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
      const inboxItemId = await putInbox(a, meta);
      const r: GatewayResult = { status: 'pending_approval', inboxItemId };
      await audit('inbox.created', a, cls, r, meta.title);
      await safeNotify({ title: `Approval needed: ${meta.title}`, body: meta.recommendation, urgent: false, ...slugOf(a) });
      return r;
    }
    return executeNow(a, cls, policy, 'system');
  }

  async function decide(itemId: string, dec: Decision): Promise<GatewayResult> {
    const item = await d.store.getInboxItem(itemId);
    if (!item) return blocked('not_found');
    if (item.status !== 'pending') return blocked('already_decided');
    const decision = { at: now(), by: dec.by, choice: dec.choice, ...(dec.modifiedParams ? { modifiedParams: dec.modifiedParams } : {}) };

    if (dec.choice === 'reject') {
      if (!(await d.store.transitionInboxItem(itemId, 'pending', { status: 'rejected', decision }))) return blocked('already_decided');
      const r = blocked('rejected');
      await audit('action.rejected', item.action, 'approve', r, `${dec.by} rejected: ${item.title}`, 'operator');
      return r;
    }

    const a: Action = dec.choice === 'modify' ? { ...item.action, params: { ...item.action.params, ...dec.modifiedParams } } : item.action;
    // Checks run before the item is consumed, so a blocked approval stays pending and can be retried.
    const pre = await precheck(a);
    if (pre) {
      await audit('action.blocked', a, 'approve', pre, `${a.kind} blocked at decision time; item left pending`, 'operator');
      return pre;
    }
    let policy: Policy;
    try {
      policy = await loadPolicy();
    } catch (e) {
      const r = blocked('policy_unavailable', (e as Error).message);
      await audit('action.blocked', a, 'approve', r, 'Policy unavailable; failing closed; item left pending', 'operator');
      return r;
    }
    if (!(await d.store.transitionInboxItem(itemId, 'pending', { status: 'approved', decision }))) return blocked('already_decided');
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
      await safeNotify({ title: 'Kill switch engaged', body: `All spend and posting stopped by ${by}.`, urgent: true });
    },
    async releaseKillSwitch(by: string) {
      await setKillSwitch(false, by);
    },
  };
}

export type Gateway = ReturnType<typeof createGateway>;
