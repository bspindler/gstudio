// npm run seed: registry records for every game in games/ (idempotent).
import { seedLibrary } from '@studio/api/jobs';
import { gamesDir, localEnv } from './local-env.js';

const { store } = localEnv();
const created = await seedLibrary(store, gamesDir, new Date());
console.log(created.length ? `Seeded: ${created.join(', ')}` : 'Nothing to seed; all games already registered.');
for (const g of await store.listGames()) console.log(`  ${g.slug}: stage ${g.stage}`);
