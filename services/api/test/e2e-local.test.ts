import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFsObjectStore, createSqliteStore } from '@studio/adapters-local';
import { createGateway, createStageExecutors, loadPolicy, runGateCycle, templateRationale } from '@studio/core';
import { createApp } from '../src/app.js';
import { runRollup, seedLibrary, simulatePlayers } from '../src/jobs.js';

const repo = new URL('../../../', import.meta.url).pathname;
const DAY = 86400_000;
const day0 = Date.parse('2026-10-20T15:00:00Z');

describe('local end-to-end: play -> ingest -> rollup -> gate', () => {
  it('promotes a game that clears the web-test bar and holds one that does not', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-'));
    const objects = createFsObjectStore(join(dir, 'objects'));
    const store = createSqliteStore(':memory:');
    let clock = new Date(day0);
    let n = 0;
    const app = createApp({ objects, clock: () => clock, ids: () => `b${++n}`, allowedOrigins: [] });

    const seeded = await seedLibrary(store, join(repo, 'games'), clock);
    expect(seeded.sort()).toEqual(['hyperline', 'tidepool-pals']);
    expect(await seedLibrary(store, join(repo, 'games'), clock)).toEqual([]); // idempotent
    expect((await store.getGame('hyperline'))?.stage).toBe(2);

    const post = async (body: unknown) => {
      const res = await app.request('/v1/events', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
      expect(res.status).toBe(202);
    };
    // Hyperline: 240 players, 40% return on day 1, ratings ~4.3. Tidepool: 230 players, 22% D1.
    for (const b of simulatePlayers({ game: 'hyperline', version: '0.2.0', players: 240, d1: 0.4, ratingShare: 0.15, stars: [4, 5, 4], start: day0, seed: 1 })) await post(b);
    for (const b of simulatePlayers({ game: 'tidepool-pals', version: '0.2.0', players: 230, d1: 0.22, ratingShare: 0.15, stars: [4, 4, 3], start: day0, seed: 2 })) await post(b);

    clock = new Date(day0 + 2 * DAY);
    const snaps = await runRollup({ objects, store, asOf: clock, games: ['hyperline', 'tidepool-pals'] });
    const hyper = snaps.find((s) => s.gameSlug === 'hyperline')!;
    expect(hyper.channel).toBe('own_site');
    expect(hyper.players).toBe(240);
    expect(hyper.d1).toBeCloseTo(0.4, 1);
    expect(hyper.ratingCount).toBeGreaterThanOrEqual(20);

    const policy = await loadPolicy(join(repo, 'policy.yaml'));
    const gateway = createGateway({
      store, policy, executors: createStageExecutors(store, () => clock), clock: () => clock,
      ids: () => `a${++n}`, notify: async () => {},
    });
    const evals = await runGateCycle({
      store, gateway, policy, rationale: templateRationale, now: clock,
      context: async () => ({ now: clock, qaPassed: true, botPlayable: true }),
    });
    expect(evals.find((e) => e.slug === 'hyperline')?.decision).toBe('promote');
    expect(evals.find((e) => e.slug === 'tidepool-pals')?.decision).toBe('hold');
    expect((await store.getGame('hyperline'))?.stage).toBe(3);
    expect((await store.getGame('tidepool-pals'))?.stage).toBe(2);
  });
});
