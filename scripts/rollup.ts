// npm run rollup: raw events in .data/objects -> metrics snapshots in the registry.
import { runRollup } from '@studio/api/jobs';
import { localEnv } from './local-env.js';

const { store, objects } = localEnv();
const games = (await store.listGames()).map((g) => g.slug);
const snaps = await runRollup({ objects, store, asOf: new Date(), games });
if (!snaps.length) console.log('No events yet. Run npm run dev and play a game.');
for (const s of snaps) {
  const pct = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
  console.log(`${s.gameSlug} [${s.channel}] players=${s.players} D1=${pct(s.d1)} D7=${pct(s.d7)} session=${s.avgSessionSec?.toFixed(0)}s intent=${pct(s.purchaseIntentRate)} rating=${s.avgRating?.toFixed(2) ?? 'n/a'} (${s.ratingCount})`);
}
