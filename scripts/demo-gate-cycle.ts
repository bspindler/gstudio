// Phase 1a demo: seed three games, run one gate cycle, print evaluations, Inbox and audit trail.
import {
  MemoryStore, createGateway, createStageExecutors, loadPolicy, runGateCycle, templateRationale, type Game,
} from '@studio/core';

const now = new Date('2026-11-01T00:00:00Z');
const base = (slug: string, title: string, genre: string, stage: Game['stage']): Game => ({
  slug, title, genre, targetSegment: 'casual 13+', stage, markets: [], versions: [], ageRating: null, storeIds: {},
  valueEstimate: null, failingCycles: 0, createdAt: now.toISOString(), updatedAt: now.toISOString(),
});
const web = (gameSlug: string, d1: number, players: number) => ({
  gameSlug, channel: 'portal' as const, asOf: '2026-10-31T12:00:00Z', players, d1, d7: null, d1Cohort: players, d7Cohort: 0, avgSessionSec: 140,
  purchaseIntentRate: 0.04, avgRating: 4.1, ratingCount: 31, crashFreeRate: null,
});

const store = new MemoryStore();
const policy = await loadPolicy(new URL('../policy.yaml', import.meta.url).pathname);
await store.putGame(base('tidepool-pals', 'Tidepool Pals', 'match-3 collection', 1));
await store.putGame(base('hyperline', 'Hyperline', 'endless runner', 2));
await store.putGame(base('dud', 'Dud (dummy)', 'test', 2));
await store.putMetrics(web('hyperline', 0.17, 260));
await store.putMetrics(web('dud', 0.04, 310));

const gateway = createGateway({
  store, policy, executors: createStageExecutors(store, () => now), clock: () => now, ids: () => crypto.randomUUID(),
  notify: async (n) => console.log(`  [notify${n.urgent ? ' URGENT' : ''}] ${n.title}`),
});
const evals = await runGateCycle({
  store, gateway, policy, rationale: templateRationale, now,
  context: async (g) => ({ now, qaPassed: g.slug === 'tidepool-pals', botPlayable: g.slug === 'tidepool-pals' }),
});

console.log('\n== Evaluations');
for (const e of evals) console.log(`  ${e.slug}: ${e.decision} (${e.fromStage}->${e.toStage ?? '-'})`);
console.log('\n== Games');
for (const g of await store.listGames()) console.log(`  ${g.slug}: stage ${g.stage}`);
console.log('\n== Inbox (pending)');
for (const i of await store.listInbox('pending')) {
  console.log(`  ${i.title}\n    ${i.keyNumbers.map((k) => `${k.label}=${k.value}`).join(' | ')}`);
}
console.log('\n== Audit trail');
for (const a of await store.listAudit()) console.log(`  ${a.at} ${a.gameSlug ?? '-'} ${a.type}: ${a.summary}`);
