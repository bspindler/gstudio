import type { Action } from '../domain/actions.js';
import type { Game } from '../domain/types.js';
import type { Executor, Gateway } from '../gateway/gateway.js';
import type { Policy } from '../policy/schema.js';
import type { RegistryStore } from '../registry/store.js';
import { evaluateGate, type GateContext, type GateEvaluation } from './evaluate.js';

/** Writes the human-readable rationale for a gate decision. The Claude-backed writer lands in Plan 1c. */
export type RationaleWriter = (e: GateEvaluation, g: Game) => Promise<string>;

export const templateRationale: RationaleWriter = async (e, g) => {
  const lines = e.checks.map((c) => `${c.pass ? '✓' : '✗'} ${c.name}: ${c.actual} (needs ${c.required})`);
  const gate = e.toStage === null ? `stage ${e.fromStage}` : `gate ${e.fromStage}->${e.toStage}`;
  const note = e.insufficientData ? ' Not enough fresh data to decide.' : '';
  return `${g.title}: ${e.decision} at ${gate}.${note}\n${lines.join('\n')}`;
};

/** Default executors that move a game between stages in the registry. */
export function createStageExecutors(store: RegistryStore, clock: () => Date): Record<'stage.advance' | 'stage.kill', Executor> {
  const setStage = (toStage: (a: Action) => Game['stage'] | undefined): Executor => async (a) => {
    const g = a.gameSlug ? await store.getGame(a.gameSlug) : undefined;
    const to = toStage(a);
    if (!g || to === undefined) return { ok: false, detail: `cannot move ${a.gameSlug ?? '?'}` };
    if (g.stage !== a.fromStage) return { ok: false, detail: `${g.slug} moved to stage ${g.stage}; expected ${String(a.fromStage)}` };
    await store.putGame({ ...g, stage: to, failingCycles: 0, updatedAt: clock().toISOString() });
    return { ok: true, detail: `${g.slug} -> stage ${to}` };
  };
  return { 'stage.advance': setStage((a) => a.toStage), 'stage.kill': setStage(() => 7) };
}

const sameTransition = (a: Action, b: Action) =>
  a.kind === b.kind && a.gameSlug === b.gameSlug && a.fromStage === b.fromStage && a.toStage === b.toStage;

export async function runGateCycle(d: {
  store: RegistryStore;
  gateway: Gateway;
  policy: Policy;
  rationale: RationaleWriter;
  context: (g: Game) => Promise<GateContext>;
  now: Date;
}): Promise<GateEvaluation[]> {
  const out: GateEvaluation[] = [];
  for (const g of await d.store.listGames()) {
    const e = evaluateGate(g, await d.store.latestMetrics(g.slug), d.policy, await d.context(g));
    out.push(e);
    const rationale = await d.rationale(e, g);
    await d.store.appendAudit({
      at: d.now.toISOString(), actor: 'system', gameSlug: g.slug, type: 'gate.evaluated',
      summary: `${e.decision} at stage ${e.fromStage}`, data: { evaluation: e, rationale },
    });

    const failingCycles = e.decision !== 'hold' || e.insufficientData ? 0 : g.failingCycles + 1;
    await d.store.putGame({ ...g, failingCycles, updatedAt: d.now.toISOString() });
    if (e.decision === 'hold' || e.toStage === null) continue;

    const action: Action = e.decision === 'promote'
      ? { kind: 'stage.advance', gameSlug: g.slug, fromStage: e.fromStage, toStage: e.toStage, params: {}, requestedBy: 'system', rationale }
      : { kind: 'stage.kill', gameSlug: g.slug, fromStage: e.fromStage, toStage: 7, params: {}, requestedBy: 'system', rationale };
    const pending = await d.store.listInbox('pending');
    if (pending.some((i) => sameTransition(i.action, action))) continue;

    await d.gateway.submit(action, {
      title: e.decision === 'promote' ? `Promote ${g.title} to stage ${e.toStage}` : `Kill ${g.title}`,
      recommendation: rationale,
      keyNumbers: e.checks.map((c) => ({ label: c.name, value: `${c.actual} vs ${c.required}` })),
    });
  }
  return out;
}
