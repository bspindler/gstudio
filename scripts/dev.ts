// npm run dev: API + ingest on :8787, games + SDK on :5174, bound to localhost.
// npm run dev:lan (or STUDIO_LAN=1) also listens on the LAN so a phone can play (the ingest has no auth or rate limit).
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { loadGameLibrary } from '@studio/core';
import { createApp } from '@studio/api';
import { mountSiteFonts } from './site-routes.js';
import { mountHistory } from './hal/history-routes.js';
import { gamesDir, localEnv, repo } from './local-env.js';

const onLan = process.env.STUDIO_LAN === '1' || process.argv.includes('--lan');
const bind = onLan ? '0.0.0.0' : '127.0.0.1';
const lan = onLan ? Object.values(networkInterfaces()).flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i!.address) : [];
const hosts = ['localhost', '127.0.0.1', ...lan];
const { objects, dataDir } = localEnv();
const games = await loadGameLibrary(gamesDir);

const api = createApp({
  objects, clock: () => new Date(), ids: randomUUID,
  allowedOrigins: hosts.map((h) => `http://${h}:5174`),
  isKnownGame: async (slug) => games.some((g) => g.slug === slug),
});
serve({ fetch: api.fetch, port: 8787, hostname: bind });

const site = new Hono();
// Dev only: make browsers revalidate every file (304 when unchanged). Without it iPhone Safari kept serving stale game
// modules after a change, so a fix looked like it had done nothing on the phone.
site.use('*', async (c, next) => { await next(); c.header('Cache-Control', 'no-cache'); });
const root = relative(process.cwd(), repo).split(sep).join('/') || '.';
site.use('/sdk/*', serveStatic({ root: `${root}/packages`, rewriteRequestPath: (p) => p.replace(/^\/sdk/, '/sdk') }));
// The GStudio shelf page; read per request so edits show on refresh. `<` is escaped so a title can't close the script tag.
const shelf = JSON.stringify(games.map(({ slug, title, genre, version, targetSegment }) =>
  ({ slug, title, genre, version, targetSegment }))).replace(/</g, '\\u003c');
site.get('/', (c) => c.html(readFileSync(join(repo, 'scripts/site/index.html'), 'utf8').replace('/*__GAMES__*/[]', shelf).replace('/*__HISTORY__*/false', 'true')));
mountSiteFonts(site, `${root}/scripts`);
mountHistory(site, { repo, games: games.map(({ slug, title }) => ({ slug, title })) }); // before the static /* below
site.use('/*', serveStatic({ root: `${root}/games` }));
serve({ fetch: site.fetch, port: 5174, hostname: bind });

console.log(`API + ingest  http://localhost:8787   (events -> ${dataDir}/objects/events)`);
for (const h of hosts) console.log(`Games         http://${h}:5174`);
console.log('Then, in another terminal, run these one at a time:\n  npm run rollup\n  npm run gates');
