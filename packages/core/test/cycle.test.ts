import { describe, expect, it } from 'vitest';
import {
  MemoryStore, createGateway, createStageExecutors, runGateCycle, templateRationale, type GateContext, type Game,
} from '@studio/core';
import { game, metrics, repoPolicy, seq } from './helpers.js';

const now = new Date('2026-11-01T00:00:00Z');

async function setup(games: Game[], ctx: Partial<GateContext> = {}) {
  const store = new MemoryStore(seq('a'));
  for (const g of games) await store.putGame(g);
  const policy = repoPolicy();
  const gateway = createGateway({
    store, policy, executors: createStageExecutors(store, () => now), notify: async () => {}, clock: () => now, ids: seq('i'),
  });
  const run = () => runGateCycle({ store, gateway, policy, rationale: templateRationale, context: async () => ({ now, ...ctx }), now });
  return { store, run };
}

describe('runGateCycle', () => {
  it('auto-advances 0->1 and audits', async () => {
    const { store, run } = await setup([game({ slug: 'c', stage: 0 })], { conceptScore: 0.8 });
    await run();
    expect((await store.getGame('c'))?.stage).toBe(1);
    const types = (await store.listAudit()).map((e) => e.type);
    expect(types).toContain('gate.evaluated');
    expect(types).toContain('action.executed');
  });

  it('routes 1->2 to inbox', async () => {
    const { store, run } = await setup([game({ slug: 'p', stage: 1 })], { qaPassed: true, botPlayable: true });
    await run();
    const pending = await store.listInbox('pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.keyNumbers.map((k) => k.label)).toContain('qa_passed');
    expect((await store.getGame('p'))?.stage).toBe(1);
  });

  it('does not duplicate pending items', async () => {
    const { store, run } = await setup([game({ slug: 'p', stage: 1 })], { qaPassed: true, botPlayable: true });
    await run();
    await run();
    expect(await store.listInbox('pending')).toHaveLength(1);
  });

  it('auto-kills stage-2 clear failure with rationale', async () => {
    const { store, run } = await setup([game({ slug: 'k', stage: 2 })]);
    await store.putMetrics(metrics({ gameSlug: 'k', d1: 0.05, players: 300 }));
    await run();
    expect((await store.getGame('k'))?.stage).toBe(7);
    const executed = (await store.listAudit({ gameSlug: 'k' })).find((e) => e.type === 'action.executed');
    expect(JSON.stringify(executed?.data)).toContain('kill');
    expect((executed?.data.action as { rationale?: string }).rationale).toMatch(/d1_portal/);
  });

  it('failingCycles increments on failed hold, resets on insufficient data', async () => {
    const { store, run } = await setup([game({ slug: 'h', stage: 2 })]);
    await store.putMetrics(metrics({ gameSlug: 'h', d1: 0.1, players: 300 }));
    await run();
    await run();
    expect((await store.getGame('h'))?.failingCycles).toBe(2);
    await store.putMetrics(metrics({ gameSlug: 'h', asOf: '2026-10-31T18:00:00Z', players: 50 }));
    await run();
    expect((await store.getGame('h'))?.failingCycles).toBe(0);
  });

  it('returns one evaluation per game', async () => {
    const { run } = await setup([game({ slug: 'a', stage: 6 }), game({ slug: 'b', stage: 6 })]);
    expect((await run()).map((e) => e.slug).sort()).toEqual(['a', 'b']);
  });
});
