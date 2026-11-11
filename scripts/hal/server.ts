// "Run now": a small token-gated Hono app for Brian's phone on home Wi-Fi. Every route, any method, answers a bare 404
// unless the request carries HAL_TOKEN (as ?t= or the cookie set from it). POSTs also need a same-origin Origin header.
// The token is never rendered, logged or put in an error.
import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { DAILY_CAP_USD, apiSpent } from '@studio/core/hal';
import { Hono, type Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { createStore } from './store.js';

export const SERVER_PORT = 5180;
const COOKIE = 'hal_token';
const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'";

export type RunLock = { pid: number; runId: string; startedAt: string; phase?: string; trigger?: 'nightly' | 'manual' };
export type SpawnRun = (o: { args: string[]; logPath: string }) => void;
export type ServerDeps = {
  halDir: string;
  token: string;
  /** Known game slugs; `game` is validated against this and never passed through as free text. */
  games: string[];
  now?: () => Date;
  /** Liveness of the lock's pid. Default: process.kill(pid, 0). */
  isAlive?: (pid: number) => boolean;
  spawnRun?: SpawnRun;
  /** The dev server's games URL when it is up, else null. */
  devUrl?: () => Promise<string | null>;
};

export function tokenOk(given: string | undefined, token: string): boolean {
  if (!given || !token) return false;
  const a = Buffer.from(given), b = Buffer.from(token);
  if (a.length !== b.length) return false; // timingSafeEqual throws on unequal lengths
  return timingSafeEqual(a, b);
}

const defaultAlive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
};

/** The real spawn: `node tsx/cli scripts/hal.ts run ...`, detached, output to a log file, unref'd. */
export function realSpawnRun(repo: string): SpawnRun {
  return ({ args, logPath }) => {
    const tsx = createRequire(join(repo, 'package.json')).resolve('tsx/package.json').replace(/package\.json$/, 'dist/cli.mjs');
    mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 });
    const fd = openSync(logPath, 'a', 0o600);
    try {
      const child = spawn(process.execPath, [tsx, 'scripts/hal.ts', ...args], { cwd: repo, detached: true, stdio: ['ignore', fd, fd] });
      child.on('error', () => {});
      child.unref();
    } finally {
      closeSync(fd);
    }
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, '-');

function readLock(halDir: string): RunLock | null {
  try {
    const v = JSON.parse(readFileSync(join(halDir, 'run.lock'), 'utf8')) as RunLock;
    return typeof v?.pid === 'number' ? v : null;
  } catch { return null; }
}

function latestReport(halDir: string): { runId: string; endedAt: string; text: string } | null {
  try {
    const l = JSON.parse(readFileSync(join(halDir, 'latest.json'), 'utf8')) as { runId: string; endedAt: string; reportMd: string };
    return { runId: String(l.runId), endedAt: String(l.endedAt), text: readFileSync(l.reportMd, 'utf8') };
  } catch { return null; }
}

/** One place for the response headers. same-origin, not no-referrer: with no-referrer browsers send "Origin: null" on same-origin form POSTs (Fetch spec), which the Origin check would reject, breaking Run now and Stop. */
const secure = (c: Context) => {
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'same-origin');
  c.header('Content-Security-Policy', CSP);
};

const notFound = () => new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });

export function createServerApp(d: ServerDeps) {
  const now = d.now ?? (() => new Date());
  const alive = d.isAlive ?? defaultAlive;
  const spawnRun = d.spawnRun;
  const app = new Hono();
  const running = () => { const l = readLock(d.halDir); return l && alive(l.pid) ? l : null; };

  app.use('*', async (c, next) => {
    const url = new URL(c.req.url);
    const q = url.searchParams.get('t') ?? undefined;
    // ?t= is for the bookmark GET only; POSTs authenticate with the cookie.
    const viaQuery = c.req.method === 'GET' && tokenOk(q, d.token);
    if (!viaQuery && !tokenOk(getCookie(c, COOKIE), d.token)) return notFound();
    if (c.req.method === 'POST' && c.req.header('origin') !== url.origin) return c.text('Forbidden', 403);
    if (viaQuery && c.req.method === 'GET') {
      setCookie(c, COOKIE, d.token, { httpOnly: true, sameSite: 'Strict', path: '/', maxAge: 60 * 60 * 24 * 365 });
      url.searchParams.delete('t');
      secure(c);
      return c.redirect(url.pathname + url.search, 303);
    }
    await next();
    secure(c);
  });

  app.get('/', async (c) => {
    const lock = running();
    const store = createStore({ halDir: d.halDir, now });
    const spend = apiSpent(await store.loadSpendToday());
    const report = latestReport(d.halDir);
    const play = d.devUrl ? await d.devUrl().catch(() => null) : null;
    const status = lock
      ? `Running${lock.phase ? `: ${esc(lock.phase)}` : ''} (since ${esc(lock.startedAt)}${lock.trigger ? `, ${esc(lock.trigger)}` : ''})`
      : 'Idle';
    const opts = d.games.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
    return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hal</title><style>
body{font:16px/1.4 system-ui,-apple-system,sans-serif;margin:0;padding:16px;max-width:40rem;margin-inline:auto;background:#fff;color:#111}
@media(prefers-color-scheme:dark){body{background:#111;color:#eee}}
h1{font-size:1.4rem}.card{border:1px solid #8885;border-radius:12px;padding:12px;margin:12px 0}
button,select{font:inherit;padding:12px 16px;border-radius:10px;margin:4px 0}button{width:100%}
pre{white-space:pre-wrap;word-break:break-word;font-size:.85rem}label{display:block;margin:6px 0}
</style></head><body><h1>Hal</h1>
<div class="card"><strong>${status}</strong><br>API spend today: $${spend.toFixed(2)} of $${DAILY_CAP_USD.toFixed(2)}</div>
<form class="card" method="post" action="/run"><label>Game <select name="game"><option value="">all games</option>${opts}</select></label>
<label><input type="checkbox" name="reportOnly" value="1"> Report only</label><button type="submit">Run now</button></form>
<form class="card" method="post" action="/stop"><button type="submit">Stop</button></form>
${play ? `<div class="card"><a href="${esc(play)}">Play the games</a></div>` : ''}
<div class="card"><strong>Latest report${report ? ` (${esc(report.runId)}, ${esc(report.endedAt)})` : ''}</strong><pre>${report ? esc(report.text) : 'No report yet.'}</pre></div>
</body></html>`);
  });

  app.post('/run', async (c) => {
    if (running()) return c.text('busy', 409);
    const body = await c.req.parseBody();
    const game = typeof body.game === 'string' && body.game !== '' ? body.game : null;
    if (game !== null && !d.games.includes(game)) return c.text('unknown game', 400);
    const args = ['run', '--billing', 'subscription', ...(game ? ['--game', game] : []), ...(body.reportOnly ? ['--report-only'] : [])];
    if (!spawnRun) return c.text('cannot start runs here', 500);
    try {
      spawnRun({ args, logPath: join(d.halDir, 'logs', `run-${stamp(now())}.log`) });
    } catch {
      return c.text('could not start the run', 500);
    }
    return c.redirect('/', 303);
  });

  app.post('/stop', async (c) => {
    await writeFile(join(d.halDir, 'stop'), now().toISOString());
    return c.redirect('/', 303);
  });

  app.all('*', () => notFound()); // unknown routes and wrong methods, same bare 404 (token already checked above)
  return app;
}

/** Checks 127.0.0.1:5174 (the dev server) quickly; returns its URL for `host` or null. */
export function probeDevUrl(host: string): () => Promise<string | null> {
  return async () => {
    try {
      const r = await fetch('http://127.0.0.1:5174/', { signal: AbortSignal.timeout(300) });
      return r.ok ? `http://${host}:5174/` : null;
    } catch { return null; }
  };
}
