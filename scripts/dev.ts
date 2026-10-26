// npm run dev: API + ingest on :8787, games + SDK on :5174, bound to localhost.
// STUDIO_LAN=1 npm run dev also listens on the LAN so a phone can play (the ingest has no auth or rate limit).
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { relative } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { loadGameLibrary } from '@studio/core';
import { createApp } from '@studio/api';
import { gamesDir, localEnv, repo } from './local-env.js';

const onLan = process.env.STUDIO_LAN === '1';
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
const root = relative(process.cwd(), repo) || '.';
site.use('/sdk/*', serveStatic({ root: `${root}/packages`, rewriteRequestPath: (p) => p.replace(/^\/sdk/, '/sdk') }));
site.get('/', (c) => c.html(`<!doctype html><meta name="viewport" content="width=device-width"><title>Studio games (dev)</title>
<body style="font:16px system-ui;padding:16px"><h1>Studio games (local dev)</h1><ul>${games.map((g) =>
  `<li><a href="/${g.slug}/">${g.title}</a> (${g.genre}, v${g.version}) · <a href="/${g.slug}/?ch=portal">as portal</a></li>`).join('')}</ul>`));
site.use('/*', serveStatic({ root: `${root}/games` }));
serve({ fetch: site.fetch, port: 5174, hostname: bind });

console.log(`API + ingest  http://localhost:8787   (events -> ${dataDir}/objects/events)`);
for (const h of hosts) console.log(`Games         http://${h}:5174`);
console.log('Then: npm run rollup && npm run gates');
