// npm run demo:1b: synthetic players -> real ingest over HTTP -> rollup -> gate cycle, in .data/demo.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { runGateCycle, templateRationale } from '@studio/core';
import { createApp } from '@studio/api';
import { runRollup, seedLibrary, simulatePlayers } from '@studio/api/jobs';
import { gamesDir, localEnv, localGateway, repo } from './local-env.js';

const dataDir = join(repo, '.data', 'demo');
rmSync(dataDir, { recursive: true, force: true });
const { store, objects } = localEnv(dataDir);

const DAY = 86400_000;
const day0 = Date.now() - 2 * DAY;
let clock = new Date(day0);
let n = 0;
const app = createApp({
  objects, clock: () => clock, ids: () => `demo-${++n}`, allowedOrigins: [],
  isKnownGame: async (slug) => !!(await store.getGame(slug)),
});
const server = serve({ fetch: app.fetch, port: 0 });
await new Promise((r) => server.once('listening', r));
const port = (server.address() as { port: number }).port;

console.log('== Seed');
console.log(`  ${(await seedLibrary(store, gamesDir, clock)).join(', ')} at stage 2 (web test)`);

console.log(`\n== Ingest over HTTP (localhost:${port}), synthetic demo players`);
const plays = [
  { game: 'hyperline', players: 240, d1: 0.38, stars: [4, 5, 4], seed: 1 },
  { game: 'tidepool-pals', players: 230, d1: 0.22, stars: [4, 4, 3], seed: 2 },
];
for (const p of plays) {
  let events = 0;
  for (const b of simulatePlayers({ ...p, version: '0.2.0', ratingShare: 0.15, start: day0 })) {
    clock = new Date(b.events.at(-1)!.ts); // the server stamps receive time; replay at send time
    const res = await fetch(`http://localhost:${port}/v1/events`, { method: 'POST', body: JSON.stringify(b), headers: { 'content-type': 'application/json' } });
    if (res.status !== 202) throw new Error(`ingest ${res.status}: ${await res.text()}`);
    events += b.events.length;
  }
  console.log(`  ${p.game}: ${p.players} players, ${events} events`);
}
server.close();

clock = new Date(day0 + 2 * DAY);
console.log('\n== Rollup');
const pct = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
for (const s of await runRollup({ objects, store, asOf: clock, games: plays.map((p) => p.game) })) {
  console.log(`  ${s.gameSlug} [${s.channel}] players=${s.players} D1=${pct(s.d1)} session=${s.avgSessionSec?.toFixed(0)}s intent=${pct(s.purchaseIntentRate)} rating=${s.avgRating?.toFixed(2)} (${s.ratingCount})`);
}

console.log('\n== Gate cycle');
const { policy, gateway } = await localGateway(store, () => clock);
const evals = await runGateCycle({
  store, gateway, policy, rationale: templateRationale, now: clock,
  context: async () => ({ now: clock, qaPassed: false, botPlayable: false }),
});
for (const e of evals) {
  console.log(`  ${e.slug}: ${e.decision} (${e.fromStage}->${e.toStage ?? '-'})`);
  for (const c of e.checks) console.log(`      ${c.pass ? 'ok  ' : 'FAIL'} ${c.name}: ${c.actual} vs ${c.required}`);
}
console.log('\n== Games');
for (const g of await store.listGames()) console.log(`  ${g.slug}: stage ${g.stage}`);
console.log(`\nData in ${dataDir}`);
