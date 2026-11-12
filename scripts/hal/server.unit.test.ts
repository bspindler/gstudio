// The Run-now server through app.request(): no port, temp halDir, injected liveness and spawn.
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createServerApp, tokenOk, type SpawnRun } from './server.js';

const TOKEN = 'tok-' + 'a'.repeat(40);
let halDir: string, spawned: Parameters<SpawnRun>[0][], alive: boolean, startedAt: Date | null;
const mk = () => createServerApp({
  halDir, token: TOKEN, games: ['tidepool-pals', 'gearhold'], now: () => new Date('2026-11-11T09:00:00Z'),
  isAlive: () => alive, startTimeOf: () => startedAt, spawnRun: (o) => { spawned.push(o); }, devUrl: async () => 'http://10.0.0.5:5174/',
});
beforeEach(async () => { halDir = await mkdtemp(join(tmpdir(), 'hal-srv-')); spawned = []; alive = true; startedAt = null; });
const H = 'http://10.0.0.5:5180';
const post = (app: ReturnType<typeof mk>, path: string, body = '', headers: Record<string, string> = {}) =>
  app.request(`${H}${path}`, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `hal_token=${TOKEN}`, origin: H, ...headers } });
const lock = (pid = 99999) => writeFile(join(halDir, 'run.lock'), JSON.stringify({ pid, runId: 'r1', startedAt: '2026-11-11T08:00:00Z', phase: 'scoring' }));

describe('token gate', () => {
  it('404s every route and method without a token or with a wrong one, with a bare body', async () => {
    const app = mk();
    for (const path of ['/', '/run', '/stop', '/nope', '/?t=wrong', `/?t=${TOKEN}x`, '/?t=', '/?t=' + 'z'.repeat(1000)]) {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'HEAD']) {
        const r = await app.request(`${H}${path}`, { method, headers: { origin: H, cookie: 'hal_token=bad' } });
        expect(r.status, `${method} ${path}`).toBe(404);
        if (method !== 'HEAD') expect(await r.text()).toBe('Not Found');
        expect(Object.keys(Object.fromEntries(r.headers as unknown as Iterable<[string, string]>)).sort()).toEqual(['content-type']);
      }
    }
    expect(spawned).toEqual([]);
  });
  it('tokenOk does not throw on wrong lengths', () => {
    for (const g of [undefined, '', 'a', TOKEN.slice(1), TOKEN + 'x']) expect(tokenOk(g, TOKEN)).toBe(false);
    expect(tokenOk(TOKEN, TOKEN)).toBe(true);
  });
  it('first valid ?t= sets a strict HttpOnly cookie and redirects without the token', async () => {
    const r = await mk().request(`${H}/?t=${TOKEN}&x=1`);
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/?x=1');
    const c = r.headers.get('set-cookie')!;
    expect(c).toContain(`hal_token=${TOKEN}`);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Strict/i);
    expect(c).toMatch(/Path=\//);
    expect(c).not.toMatch(/Secure/i);
    expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(r.headers.get('referrer-policy')).toBe('same-origin');
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('the cookie alone is enough for GET /', async () => {
    const r = await mk().request(`${H}/`, { headers: { cookie: `hal_token=${TOKEN}` } });
    expect(r.status).toBe(200);
  });
});

describe('GET /', () => {
  it('shows idle, spend vs cap, headers, no token, no external requests', async () => {
    const r = await mk().request(`${H}/`, { headers: { cookie: `hal_token=${TOKEN}` } });
    const html = await r.text();
    expect(html).toContain('Idle');
    expect(html).toContain('$0.00 of $20.00');
    expect(html).toContain('tidepool-pals');
    expect(html).toContain('http://10.0.0.5:5174/');
    expect(html).not.toContain(TOKEN);
    expect(html).not.toMatch(/<script|https?:\/\/(?!10\.0\.0\.5)/);
    expect(r.headers.get('cache-control')).toBe('no-store');
    // same-origin, not no-referrer: no-referrer makes browsers send "Origin: null" on same-origin form POSTs, which we reject, so Run now/Stop would always 403.
    expect(r.headers.get('referrer-policy')).toBe('same-origin');
    expect(r.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");
  });
  it('shows the phase when locked by a live pid, idle when the pid is dead', async () => {
    await lock();
    const get = async () => (await mk().request(`${H}/`, { headers: { cookie: `hal_token=${TOKEN}` } })).text();
    expect(await get()).toContain('Running: scoring');
    alive = false;
    expect(await get()).toContain('Idle');
  });
  it('renders latest report.md escaped', async () => {
    const md = join(halDir, 'report.md');
    await writeFile(md, '# Hi <script>alert(1)</script> & "q"');
    await writeFile(join(halDir, 'latest.json'), JSON.stringify({ runId: 'r1', endedAt: '2026-11-11T08:30:00Z', reportMd: md }));
    const html = await (await mk().request(`${H}/`, { headers: { cookie: `hal_token=${TOKEN}` } })).text();
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;');
    expect(html).not.toContain('<script>');
  });
});

describe('POST', () => {
  it('rejects a missing or foreign Origin even with a valid token', async () => {
    const app = mk();
    expect((await post(app, '/run', '', { origin: '' })).status).toBe(403);
    expect((await post(app, '/run', '', { origin: 'http://evil.example' })).status).toBe(403);
    expect((await post(app, '/stop', '', { origin: 'http://10.0.0.5:9999' })).status).toBe(403);
    expect((await app.request(`${H}/run`, { method: 'POST', headers: { cookie: `hal_token=${TOKEN}` } })).status).toBe(403);
    expect(spawned).toEqual([]);
  });
  it('/run spawns a subscription run with validated game and report-only', async () => {
    const r = await post(mk(), '/run', 'game=gearhold&reportOnly=1');
    expect(r.status).toBe(303);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.args).toEqual(['run', '--billing', 'subscription', '--game', 'gearhold', '--report-only']);
    expect(spawned[0]!.logPath).toBe(join(halDir, 'logs', 'run-2026-11-11T09-00-00-000Z.log'));
  });
  it('/run with no scope runs everything', async () => {
    const r = await post(mk(), '/run');
    expect(r.status).toBe(303);
    expect(spawned[0]!.args).toEqual(['run', '--billing', 'subscription']);
  });
  it('?t= does not authenticate a POST; only the cookie does', async () => {
    const r = await mk().request(`${H}/run?t=${TOKEN}`, { method: 'POST', body: '', headers: { origin: H } });
    expect(r.status).toBe(404);
    expect(spawned).toEqual([]);
  });
  it('rejects Origin: null', async () => {
    expect((await post(mk(), '/run', '', { origin: 'null' })).status).toBe(403);
  });
  it('/run rejects an unknown game without spawning', async () => {
    expect((await post(mk(), '/run', 'game=../../etc;rm')).status).toBe(400);
    expect(spawned).toEqual([]);
  });
  it('/run while locked by a live pid returns 409; a dead lock is idle', async () => {
    await lock();
    const r = await post(mk(), '/run');
    expect(r.status).toBe(409);
    expect(await r.text()).toBe('busy');
    expect(spawned).toEqual([]);
    alive = false;
    expect((await post(mk(), '/run')).status).toBe(303);
  });
  it('pid reuse: a live pid that started after the lock was written is not the run (same guard as the CLI lock)', async () => {
    await lock(); // startedAt 2026-11-11T08:00:00Z
    const get = async () => (await mk().request(`${H}/`, { headers: { cookie: `hal_token=${TOKEN}` } })).text();
    startedAt = new Date('2026-11-11T07:59:59Z'); // the run itself
    expect(await get()).toContain('Running: scoring');
    expect((await post(mk(), '/run')).status).toBe(409);
    startedAt = new Date('2026-11-11T08:30:00Z'); // another process reusing the pid
    expect(await get()).toContain('Idle');
    expect((await post(mk(), '/run')).status).toBe(303);
  });
  it('a spawn failure is a plain 500 that does not leak the token', async () => {
    const app = createServerApp({ halDir, token: TOKEN, games: [], spawnRun: () => { throw new Error(`boom ${TOKEN}`); } });
    const r = await post(app, '/run');
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain(TOKEN);
  });
  it('/stop writes the stop flag', async () => {
    await mkdir(halDir, { recursive: true });
    expect((await post(mk(), '/stop')).status).toBe(303);
    expect(await readFile(join(halDir, 'stop'), 'utf8')).toBe('2026-11-11T09:00:00.000Z');
  });
});

describe('realSpawnRun (fix round 3)', () => {
  it('starts the run with TSX_DISABLE_CACHE=1, detached, output to the log', async () => {
    const { realSpawnRun } = await import('./server.js');
    const { fileURLToPath } = await import('node:url');
    const seen: { args: string[]; opts: { env?: NodeJS.ProcessEnv; detached?: boolean } }[] = [];
    const fakeSpawn = ((_cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv; detached?: boolean }) => {
      seen.push({ args, opts });
      return { on: () => {}, unref: () => {} };
    }) as unknown as typeof import('node:child_process').spawn;
    realSpawnRun(fileURLToPath(new URL('../../', import.meta.url)), fakeSpawn)({ args: ['run', '--report-only'], logPath: join(halDir, 'logs', 'x.log') });
    expect(seen[0]!.opts.env!.TSX_DISABLE_CACHE).toBe('1');
    expect(seen[0]!.opts.detached).toBe(true);
    expect(seen[0]!.args.slice(-3)).toEqual(['scripts/hal.ts', 'run', '--report-only']);
  });
});
