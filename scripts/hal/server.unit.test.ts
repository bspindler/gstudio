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

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; script-src 'self'; connect-src 'self'";
const get = (app: ReturnType<typeof mk>, path: string, cookie = '') =>
  app.request(`${H}${path}`, { headers: { cookie: `hal_token=${TOKEN}${cookie ? `; ${cookie}` : ''}` } });

describe('GET / with no report yet', () => {
  it('shows the Run Hal section only: idle, spend vs cap, games, headers, no token, no external requests', async () => {
    const r = await get(mk(), '/');
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('Run Hal');
    expect(html).toContain('Idle');
    expect(html).toContain('$0.00 of $20.00');
    expect(html).toContain('value="tidepool-pals"');
    expect(html).toContain('action="/run"');
    expect(html).toContain('action="/stop"');
    expect(html).not.toContain('Director');
    expect(html).not.toContain(TOKEN);
    expect(html).not.toMatch(/https?:\/\/(?!10\.0\.0\.5)/);
    expect(html.match(/<script/g)).toEqual(['<script']); // only Hal's own /hal.js
    expect(html).toContain('<script src="/hal.js" defer></script>');
    expect(r.headers.get('cache-control')).toBe('no-store');
    // same-origin, not no-referrer: no-referrer makes browsers send "Origin: null" on same-origin form POSTs, which we reject, so Run now/Stop would always 403.
    expect(r.headers.get('referrer-policy')).toBe('same-origin');
    expect(r.headers.get('content-security-policy')).toBe(CSP);
  });
  it('shows the phase when locked by a live pid, idle when the pid is dead', async () => {
    await lock();
    const page = async () => (await get(mk(), '/')).text();
    expect(await page()).toContain('<strong data-state>Running</strong> <span data-phase>scoring');
    alive = false;
    expect(await page()).toContain('Idle');
  });
  it('a latest.json pointing at a missing or corrupt report.json still renders Run Hal', async () => {
    await writeFile(join(halDir, 'latest.json'), JSON.stringify({ runId: RUN, endedAt: 'x', reportMd: 'x' }));
    expect(await (await get(mk(), '/')).text()).toContain('Run Hal');
    await mkdir(join(halDir, 'runs', RUN), { recursive: true });
    await writeFile(join(halDir, 'runs', RUN, 'report.json'), '{not json');
    const r = await get(mk(), '/');
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('Run Hal');
  });
});

// ---- the report ---------------------------------------------------------------------------------------------------

const RUN = 'run-2026-11-12T08-00-00-000Z';
const OLD = 'run-2026-11-11T08-00-00-000Z';
const SHA = 'a'.repeat(40);
const SHOT = (pass: string, which: string, game = 'gearhold') => `docs/hal/history/${game}/2026-11-11/${pass}-${which}.jpg`;
const sr = (fitness: number) => ({ game: 'g', levels: [], measures: {}, fitness, hardFailures: [] });
const ticket = (id: string, game: string, kind: string, title: string, extra: Record<string, unknown> = {}) => ({ id, game, kind, title, why: `why ${title}`, ...extra });
const change = (pass: string, t: ReturnType<typeof ticket>, verdict: string, extra: Record<string, unknown> = {}) => ({
  pass, ticket: t, verdict, reasons: [], scoresBefore: { [t.game]: sr(70) }, scoresAfter: { [t.game]: sr(80) }, costUsd: 0.5, ...extra,
});
const LIAB = 'network host api.leaders.test';
function reportJson(runId = RUN, over: Record<string, unknown> = {}) {
  return {
    runId, night: '2026-11-11', startedAt: '2026-11-12T08:00:00Z', endedAt: runId === RUN ? '2026-11-12T09:30:00Z' : '2026-11-11T09:30:00Z',
    trigger: 'nightly', billing: 'api', billingEnded: 'api', spend: { api: 1.25, subscription: 0 },
    games: { gearhold: { before: { gearhold: 80 }, after: { gearhold: 90 }, measures: {} } },
    changes: [
      change('HAL-003', ticket('T1', 'gearhold', 'tuning', 'Kiln Heart is fairer'), 'merged', {
        commit: SHA, version: '0.2.1', changelog: 'Kiln Heart is fairer.', shots: { before: SHOT('HAL-003', 'before'), after: SHOT('HAL-003', 'after') },
      }),
      // A merged change whose recorded shot paths are hostile: every one must 404.
      change('HAL-004', ticket('T2', 'gearhold', 'polish', 'Odd shots'), 'merged', {
        commit: SHA, shots: { before: '../../etc/passwd', after: SHOT('HAL-004', 'after', 'tidepool-pals') },
      }),
      change('HAL-006', ticket('T4', 'gearhold', 'tuning', 'Faster lanes'), 'discarded', {
        commit: SHA, reasons: ['fitness fell'], shots: { before: SHOT('HAL-006', 'before'), after: SHOT('HAL-006', 'after') },
      }),
    ],
    calls: [ticket('T9', 'gearhold', 'feature', 'Add a leaderboard', { liability: LIAB })],
    planned: [], notes: [], pushed: true, warnings: [],
    ...over,
  };
}
async function seed(runId = RUN, latest = true, over: Record<string, unknown> = {}) {
  const dir = join(halDir, 'runs', runId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'report.json'), JSON.stringify(reportJson(runId, over)));
  await writeFile(join(dir, 'note.md'), `# Hal, night of 2026-11-11 (${runId})\n\nOne pass merged in ${runId}.\n`);
  if (latest) await writeFile(join(halDir, 'latest.json'), JSON.stringify({ runId, endedAt: '2026-11-12T09:30:00Z', reportMd: join(dir, 'report.md') }));
}
const fb = async () => { try { return JSON.parse(await readFile(join(halDir, 'feedback.json'), 'utf8')) as { votes: Record<string, unknown>[]; undos: Record<string, unknown>[] }; } catch { return { votes: [], undos: [] }; } };
const json = async (f: string) => { try { return JSON.parse(await readFile(join(halDir, f), 'utf8')) as Record<string, unknown>[]; } catch { return []; } };
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
/** Follows a POST's 303 with its flash cookie, like the phone does. */
async function follow(app: ReturnType<typeof mk>, r: Response): Promise<string> {
  const flash = (r.headers.get('set-cookie') ?? '').match(/hal_flash=[^;]*/)?.[0] ?? '';
  return (await get(app, r.headers.get('location')!, flash)).text();
}

describe('report pages', () => {
  it("GET / without token is the bare 404; with cookie renders the report (contains \"Director's note\" and a card)", async () => {
    await seed();
    const app = mk();
    const bare = await app.request(`${H}/`);
    expect(bare.status).toBe(404);
    expect(await bare.text()).toBe('Not Found');
    const r = await get(app, '/');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-security-policy')).toBe(CSP);
    const html = await r.text();
    expect(html).toContain('Director&#39;s note');
    expect(html).toContain(`One pass merged in ${RUN}.`);
    expect(html).toContain('<article class="card change">');
    expect(html).toContain('Kiln Heart is fairer');
    expect(html).toContain(`/shot?run=${RUN}&amp;pass=HAL-003&amp;which=before`);
    expect(html).toContain('Run Hal');
    expect(html).not.toContain(TOKEN);
    expect(html.match(/<script/g)).toEqual(['<script']); // only Hal's own /hal.js
  });
  it('GET /runs/:id renders that run; Earlier reports lists both, newest first', async () => {
    await seed(OLD, false);
    await seed(RUN, true);
    const html = await (await get(mk(), `/runs/${OLD}`)).text();
    expect(html).toContain(`One pass merged in ${OLD}.`);
    expect(html.indexOf(`/runs/${RUN}`)).toBeGreaterThan(-1);
    expect(html.indexOf(`/runs/${RUN}`)).toBeLessThan(html.indexOf(`/runs/${OLD}`));
  });
  it('GET /runs/..%2f and bad ids 404', async () => {
    await seed();
    const app = mk();
    // (/runs/.., /runs/.%2e and /runs/%2e%2e are resolved to / by URL parsing before routing, so it is just the home page.)
    for (const p of ['/runs/..%2f', '/runs/.', '/runs/%2e%2e%2f', '/runs/a%20b', '/runs/nope', `/runs/${RUN}%2f..`, '/runs/..%2f..%2fetc']) {
      const r = await get(app, p);
      expect(r.status, p).toBe(404);
      expect(await r.text()).toBe('Not Found');
    }
  });
  it('fix 3: a report.json without calls, games or spend still opens, and votes on it work', async () => {
    const r = reportJson() as Record<string, unknown>;
    delete r.calls; delete r.games; delete r.spend; delete r.warnings;
    await mkdir(join(halDir, 'runs', RUN), { recursive: true });
    await writeFile(join(halDir, 'runs', RUN, 'report.json'), JSON.stringify(r));
    await writeFile(join(halDir, 'latest.json'), JSON.stringify({ runId: RUN, endedAt: 'x', reportMd: 'x' }));
    const app = mk();
    const page = await get(app, '/');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Kiln Heart is fairer');
    expect((await post(app, '/vote', form({ run: RUN, pass: 'HAL-003' }))).status).toBe(303);
    expect((await post(app, '/approve', form({ run: RUN, item: LIAB }))).status).toBe(400);
  });
  it('old reports still render (no perGame, no planned, votes without comment)', async () => {
    const r = reportJson() as Record<string, unknown>;
    delete r.planned;
    await mkdir(join(halDir, 'runs', RUN), { recursive: true });
    await writeFile(join(halDir, 'runs', RUN, 'report.json'), JSON.stringify(r));
    await writeFile(join(halDir, 'latest.json'), JSON.stringify({ runId: RUN, endedAt: 'x', reportMd: 'x' }));
    await writeFile(join(halDir, 'feedback.json'), JSON.stringify({ votes: [{ run: RUN, item: 'HAL-003', vote: 'up', at: 'x' }], undos: [] }));
    const html = await (await get(mk(), '/')).text();
    expect(html).toContain('Kept ✓');
  });
});

describe('votes and undo', () => {
  it('POST /vote records an up vote with comment; unknown pass or a discarded pass is 400 and records nothing', async () => {
    await seed();
    const app = mk();
    for (const body of <Record<string, string>[]>[{ run: RUN, pass: 'HAL-999' }, { run: RUN, pass: 'HAL-006' }, { run: RUN, pass: '' }, { run: 'nope', pass: 'HAL-003' }, { run: '../x', pass: 'HAL-003' }, { pass: 'HAL-003' }]) {
      expect((await post(app, '/vote', form(body))).status, JSON.stringify(body)).toBe(400);
    }
    expect(await fb()).toEqual({ votes: [], undos: [] });
    const r = await post(app, '/vote', form({ run: RUN, pass: 'HAL-003', comment: '  love it\nreally  ' }));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/');
    expect((await fb()).votes).toEqual([expect.objectContaining({ run: RUN, item: 'HAL-003', game: 'gearhold', vote: 'up', comment: 'love it really' })]);
    expect(await follow(app, r)).toContain('Kept ✓');
  });
  it('POST /undo when idle records pending undo and spawns exactly [\'undo\',\'HAL-003\',\'--reason=felt worse\']', async () => {
    await seed();
    alive = false;
    const app = mk();
    const r = await post(app, '/undo', form({ run: RUN, pass: 'HAL-003', reason: 'felt worse' }));
    expect(r.status).toBe(303);
    expect(spawned).toEqual([{ args: ['undo', 'HAL-003', '--reason=felt worse'], logPath: join(halDir, 'logs', 'undo-2026-11-11T09-00-00-000Z.log') }]);
    const f = await fb();
    expect(f.votes).toEqual([expect.objectContaining({ run: RUN, item: 'HAL-003', vote: 'down', comment: 'felt worse' })]);
    expect(f.undos).toEqual([expect.objectContaining({ run: RUN, pass: 'HAL-003', reason: 'felt worse', status: 'pending' })]);
    expect(r.headers.get('location')).toBe('/');
    expect(r.headers.get('location')).not.toMatch(/flash|Undo/i);
    const html = await follow(app, r);
    expect(html).toContain('Undo started');
    expect(html).toContain('Undo queued'); // the card's state
  });
  it('POST /undo with no reason records "no reason given" and still passes it as one --reason= element', async () => {
    await seed();
    alive = false;
    await post(mk(), '/undo', form({ run: RUN, pass: 'HAL-003' }));
    expect(spawned[0]!.args).toEqual(['undo', 'HAL-003', '--reason=no reason given']);
    expect((await fb()).undos[0]).toMatchObject({ reason: 'no reason given' });
  });
  it('POST /undo while a run is live records it, spawns nothing, flash says queued', async () => {
    await seed();
    await lock();
    const app = mk();
    const r = await post(app, '/undo', form({ run: RUN, pass: 'HAL-003', reason: 'felt worse' }));
    expect(r.status).toBe(303);
    expect(spawned).toEqual([]);
    expect((await fb()).undos).toEqual([expect.objectContaining({ pass: 'HAL-003', status: 'pending' })]);
    expect(await follow(app, r)).toContain('Undo queued: Hal is busy, so the next run applies it');
  });
  it('POST /undo twice: second records nothing and spawns nothing', async () => {
    await seed();
    alive = false;
    const app = mk();
    await post(app, '/undo', form({ run: RUN, pass: 'HAL-003', reason: 'a' }));
    const before = await fb();
    expect((await post(app, '/undo', form({ run: RUN, pass: 'HAL-003', reason: 'b' }))).status).toBe(303);
    expect(await fb()).toEqual(before);
    expect(spawned).toHaveLength(1);
    // A done undo also blocks a repeat.
    await writeFile(join(halDir, 'feedback.json'), JSON.stringify({ votes: [], undos: [{ run: RUN, pass: 'HAL-003', reason: 'a', status: 'done', at: 'x' }] }));
    await post(app, '/undo', form({ run: RUN, pass: 'HAL-003', reason: 'c' }));
    expect((await fb()).undos).toHaveLength(1);
    expect(spawned).toHaveLength(1);
  });
  it('POST /undo of an unknown or discarded pass is 400 with no change', async () => {
    await seed();
    alive = false;
    const app = mk();
    for (const pass of ['HAL-006', 'HAL-999', '--help', 'HAL-003 ']) expect((await post(app, '/undo', form({ run: RUN, pass }))).status, pass).toBe(400);
    expect(await fb()).toEqual({ votes: [], undos: [] });
    expect(spawned).toEqual([]);
  });
  it('a reason "--no-push" stays inside --reason=; a 10 kB reason is capped to 500; newlines flattened', async () => {
    await seed();
    alive = false;
    const app = mk();
    await post(app, '/undo', form({ run: RUN, pass: 'HAL-003', reason: '--no-push' }));
    expect(spawned[0]!.args).toEqual(['undo', 'HAL-003', '--reason=--no-push']);
    await seed(RUN, true, { changes: [...reportJson().changes, change('HAL-007', ticket('T7', 'gearhold', 'polish', 'x'), 'merged', { commit: SHA })] });
    await post(app, '/undo', form({ run: RUN, pass: 'HAL-007', reason: 'line one\r\nline\ttwo\n' + 'x'.repeat(10_000) }));
    const arg = spawned[1]!.args[2]!;
    expect(spawned[1]!.args).toHaveLength(3);
    expect(arg.startsWith('--reason=line one line two x')).toBe(true);
    expect(arg.length).toBe('--reason='.length + 500);
    expect(arg).not.toMatch(/[\r\n\t]/);
    const u = (await fb()).undos[1]!;
    expect((u.reason as string).length).toBe(500);
    // Comments are capped the same way.
    await post(app, '/vote', form({ run: RUN, pass: 'HAL-003', comment: 'y'.repeat(10_000) }));
    expect(((await fb()).votes.at(-1)!.comment as string).length).toBe(500);
  });
  it('fix 1: two overlapping /undo POSTs (a double tap) record one pending undo, one down vote, and spawn once', async () => {
    await seed();
    alive = false;
    const app = mk();
    const rs = await Promise.all([1, 2].map(() => post(app, '/undo', form({ run: RUN, pass: 'HAL-003', reason: 'felt worse' }))));
    expect(rs.map((r) => r.status)).toEqual([303, 303]);
    const f = await fb();
    expect(f.undos).toHaveLength(1);
    expect(f.votes).toHaveLength(1);
    expect(spawned).toHaveLength(1);
  });
  it('fix 1: overlapping writes of different kinds all land (votes, notes, approvals)', async () => {
    await seed();
    const app = mk();
    await Promise.all([
      post(app, '/vote', form({ run: RUN, pass: 'HAL-003' })), post(app, '/decline', form({ run: RUN, item: LIAB })),
      post(app, '/vote', form({ run: RUN, pass: 'HAL-004' })), post(app, '/tell', form({ game: '', text: 'a' })), post(app, '/tell', form({ game: '', text: 'b' })),
    ]);
    expect((await fb()).votes).toHaveLength(3);
    expect((await json('notes.json')).map((n) => n.id).sort()).toEqual(['N-001', 'N-002']);
  });
  it('fix 3: a pass undone by any run (e.g. a CLI hal undo) is done: no new undo, no spawn, and the card shows it', async () => {
    await seed();
    alive = false;
    await writeFile(join(halDir, 'feedback.json'), JSON.stringify({ votes: [], undos: [{ run: 'undo-2026-11-12T10-00-00-000Z', pass: 'HAL-003', reason: 'cli', status: 'done', version: '0.2.2', at: 'x' }] }));
    const app = mk();
    const r = await post(app, '/undo', form({ run: RUN, pass: 'HAL-003', reason: 'again' }));
    expect(r.status).toBe(303);
    expect((await fb()).undos).toHaveLength(1);
    expect((await fb()).votes).toEqual([]);
    expect(spawned).toEqual([]);
    expect(await follow(app, r)).toContain('Undone in v0.2.2');
  });
  it('fix 3: a POST body over 64 kB is 413 and changes nothing', async () => {
    await seed();
    const r = await post(mk(), '/tell', form({ game: '', text: 'x'.repeat(70 * 1024) }));
    expect(r.status).toBe(413);
    expect(await json('notes.json')).toEqual([]);
  });
  it('a POST for an earlier run redirects back to that run', async () => {
    await seed(OLD, false);
    await seed(RUN, true);
    const r = await post(mk(), '/vote', form({ run: OLD, pass: 'HAL-003' }));
    expect(r.headers.get('location')).toBe(`/runs/${OLD}`);
  });
});

describe('final fixes: repeat Keep and malformed bodies', () => {
  it('final fix 4: a repeat Keep with the same comment adds nothing; a new comment adds a vote; the flash says kept each time', async () => {
    await seed();
    const app = mk();
    for (let i = 0; i < 3; i++) {
      const r = await post(app, '/vote', form({ run: RUN, pass: 'HAL-003', comment: 'nice' }));
      expect(r.status).toBe(303);
      expect(await follow(app, r)).toContain('Kept');
    }
    expect((await fb()).votes).toHaveLength(1);
    await post(app, '/vote', form({ run: RUN, pass: 'HAL-003', comment: 'nicer' }));
    await post(app, '/vote', form({ run: RUN, pass: 'HAL-003', comment: 'nicer' }));
    expect((await fb()).votes.map((v) => v.comment)).toEqual(['nice', 'nicer']);
    // a Keep with no comment after one with a comment is a different vote; then a repeat of it is skipped
    await post(app, '/vote', form({ run: RUN, pass: 'HAL-003' }));
    await post(app, '/vote', form({ run: RUN, pass: 'HAL-003' }));
    expect((await fb()).votes).toHaveLength(3);
    // after an undo's down vote, Keep is newest-not-up, so it records again
    await writeFile(join(halDir, 'feedback.json'), JSON.stringify({ votes: [{ run: RUN, item: 'HAL-003', vote: 'down', at: 'x' }], undos: [] }));
    await post(app, '/vote', form({ run: RUN, pass: 'HAL-003' }));
    expect((await fb()).votes.map((v) => v.vote)).toEqual(['down', 'up']);
  });
  it('final fix 3: a malformed multipart or urlencoded body is 400 with no change on every POST, never a 500', async () => {
    await seed();
    alive = false;
    const app = mk();
    const before = { fb: await fb(), notes: await json('notes.json'), approvals: await json('approvals.json') };
    const bodies: Array<[string, string]> = [
      ['multipart/form-data; boundary=zz', '--zz\r\nContent-Disposition: form-data; name="run"\r\n\r\nx'],
      ['multipart/form-data', 'garbage'],
      ['multipart/form-data; boundary=zz', 'no boundary here at all'],
    ];
    let malformed = 0;
    for (const path of ['/vote', '/undo', '/approve', '/decline', '/tell', '/notes/clear', '/run']) {
      for (const [type, body] of bodies) {
        const r = await post(app, path, body, { 'content-type': type });
        expect(r.status, `${path} ${type}`).not.toBe(500);
        if (r.status === 400) malformed++;
        expect([400, 303], `${path} ${type}`).toContain(r.status);
      }
    }
    expect(malformed).toBeGreaterThan(0);
    expect(spawned).toEqual([]);
    expect({ fb: await fb(), notes: await json('notes.json'), approvals: await json('approvals.json') }).toEqual(before);
  });
});

describe('final fix 1: Play and refs/hal/main', () => {
  const mkG = (git: (args: string[]) => Promise<Buffer>) => createServerApp({
    halDir, token: TOKEN, games: ['gearhold'], now: () => new Date('2026-11-11T09:00:00Z'), isAlive: () => false,
    devUrl: async () => 'http://10.0.0.5:5174/', git,
  });
  it('asks git how far HEAD is behind refs/hal/main and shows the line next to Play', async () => {
    await seed();
    const calls: string[][] = [];
    const html = await (await get(mkG(async (a) => { calls.push(a); return Buffer.from('4\n'); }), '/')).text();
    expect(calls).toEqual([['rev-list', '--count', 'HEAD..refs/hal/main']]);
    expect(html).toContain('Play shows your checkout, which is 4 Hal commits behind. Run <code>git pull</code> on the Mac');
  });
  it('shows nothing when not behind, on a git failure, on junk output, or with no git', async () => {
    await seed();
    for (const git of [async () => Buffer.from('0\n'), async () => { throw new Error('fatal: bad revision'); }, async () => Buffer.from('lots')]) {
      expect(await (await get(mkG(git), '/')).text()).not.toContain('Play shows your checkout');
    }
    expect(await (await get(mk(), '/')).text()).not.toContain('Play shows your checkout');
  });
  it('with the real git: N commits behind; no refs/hal/main shows nothing', async () => {
    const { execFileSync } = await import('node:child_process');
    const { realGit } = await import('./server.js');
    await seed();
    const repo = await mkdtemp(join(tmpdir(), 'hal-srv-behind-'));
    const g = (...a: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }).trim();
    g('init', '-q', '-b', 'main'); g('commit', '-q', '--allow-empty', '-m', 'one');
    expect(await (await get(mkG(realGit(repo)), '/')).text()).not.toContain('Play shows your checkout');
    g('checkout', '-q', '-b', 'hal'); g('commit', '-q', '--allow-empty', '-m', 'two'); g('commit', '-q', '--allow-empty', '-m', 'three');
    g('update-ref', 'refs/hal/main', 'HEAD'); g('checkout', '-q', 'main');
    expect(await (await get(mkG(realGit(repo)), '/')).text()).toContain('which is 2 Hal commits behind');
    g('merge', '-q', '--ff-only', 'refs/hal/main');
    expect(await (await get(mkG(realGit(repo)), '/')).text()).not.toContain('Play shows your checkout');
  });
});

describe('calls and Tell Hal', () => {
  it('POST /approve with an item not in calls is 400; with the exact item adds the approval', async () => {
    await seed();
    const app = mk();
    for (const item of ['network host evil.test', LIAB.toUpperCase(), ` ${LIAB}`, '']) expect((await post(app, '/approve', form({ run: RUN, item }))).status, item).toBe(400);
    expect(await json('approvals.json')).toEqual([]);
    const r = await post(app, '/approve', form({ run: RUN, item: LIAB }));
    expect(r.status).toBe(303);
    expect(await json('approvals.json')).toEqual([expect.objectContaining({ item: LIAB, by: 'brian' })]);
    expect(await follow(app, r)).toContain('Approved; Hal builds it next run');
  });
  it('POST /decline records a down vote with the item; an unknown item is 400', async () => {
    await seed();
    const app = mk();
    expect((await post(app, '/decline', form({ run: RUN, item: 'nope' }))).status).toBe(400);
    expect(await fb()).toEqual({ votes: [], undos: [] });
    expect((await post(app, '/decline', form({ run: RUN, item: LIAB }))).status).toBe(303);
    expect((await fb()).votes).toEqual([expect.objectContaining({ run: RUN, item: LIAB, game: 'gearhold', vote: 'down' })]);
    expect(await json('approvals.json')).toEqual([]);
  });
  it('POST /notes/reply adds Brian\'s message to the thread and reopens it; bad id or empty text is 400', async () => {
    await seed();
    const app = mk();
    await writeFile(join(halDir, 'notes.json'), JSON.stringify([{ id: 'N-001', at: '2026-11-11T08:00:00Z', game: null, text: 'louder?', status: 'asked', reply: 'How loud?' }]));
    for (const b of [{ id: 'N-001', text: '  ' }, { id: 'N-9', text: 'x' }, { id: 'nope', text: 'x' }]) expect((await post(app, '/notes/reply', form({ run: RUN, ...b }))).status, JSON.stringify(b)).toBe(400);
    const r = await post(app, '/notes/reply', form({ run: RUN, id: 'N-001', text: 'Twice as loud' }));
    expect(r.status).toBe(303);
    const [n] = JSON.parse(await readFile(join(halDir, 'notes.json'), 'utf8'));
    expect(n.status).toBe('open');
    expect(n.thread.map((m: { from: string; text: string }) => `${m.from}:${m.text}`)).toEqual(['brian:louder?', 'hal:How loud?', 'brian:Twice as loud']);
  });
  it('POST /tell with ref (a reply to the Director\'s note) ties the new thread to that report; an unknown ref is 400', async () => {
    await seed();
    const app = mk();
    expect((await post(app, '/tell', form({ run: RUN, ref: 'run-nope', text: 'x' }))).status).toBe(400);
    expect((await post(app, '/tell', form({ run: RUN, ref: RUN, text: 'Judge by band, yes' }))).status).toBe(303);
    const [n] = JSON.parse(await readFile(join(halDir, 'notes.json'), 'utf8'));
    expect(n).toMatchObject({ text: 'Judge by band, yes', game: null, status: 'open', ref: { run: RUN } });
  });
  it('POST /tell with unknown game is 400; empty text 400; ok adds a note; /notes/clear removes it', async () => {
    await seed();
    const app = mk();
    expect((await post(app, '/tell', form({ run: RUN, game: 'nope', text: 'hi' }))).status).toBe(400);
    expect((await post(app, '/tell', form({ run: RUN, game: '', text: '  \n ' }))).status).toBe(400);
    expect(await json('notes.json')).toEqual([]);
    const r = await post(app, '/tell', form({ run: RUN, game: 'gearhold', text: '  louder cannon\nplease  ' }));
    expect(r.status).toBe(303);
    expect(await json('notes.json')).toEqual([expect.objectContaining({ id: 'N-001', game: 'gearhold', text: 'louder cannon\nplease', status: 'open' })]);
    expect(await follow(app, r)).toContain('louder cannon');
    await post(app, '/tell', form({ game: '', text: 'z'.repeat(10_000) }));
    const notes = await json('notes.json');
    expect(notes[1]).toMatchObject({ game: null });
    expect((notes[1]!.text as string).length).toBe(2000);
    expect((await post(app, '/notes/clear', form({ run: RUN, id: 'N-404' }))).status).toBe(400);
    expect((await post(app, '/notes/clear', form({ run: RUN, id: '../x' }))).status).toBe(400);
    expect((await post(app, '/notes/clear', form({ run: RUN, id: 'N-001' }))).status).toBe(303);
    expect((await json('notes.json')).map((n) => n.id)).toEqual(['N-002']);
  });
});

describe('GET /shot', () => {
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  let gitCalls: string[][];
  const mkGit = () => createServerApp({
    halDir, token: TOKEN, games: ['tidepool-pals', 'gearhold'], now: () => new Date('2026-11-11T09:00:00Z'),
    isAlive: () => alive, startTimeOf: () => startedAt, spawnRun: (o) => { spawned.push(o); },
    git: async (args) => { gitCalls.push(args); return JPEG; },
  });
  beforeEach(() => { gitCalls = []; });
  it('serves the jpeg bytes from the injected git; ../, other game, wrong pattern, discarded pass all 404', async () => {
    await seed();
    const app = mkGit();
    const r = await get(app, `/shot?run=${RUN}&pass=HAL-003&which=after`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/jpeg');
    expect(r.headers.get('cache-control')).toBe('private, max-age=86400');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff'); // final fix 6
    expect(Buffer.from(await r.arrayBuffer())).toEqual(JPEG);
    expect(gitCalls).toEqual([['show', `${SHA}:${SHOT('HAL-003', 'after')}`]]);
    gitCalls = [];
    for (const q of [
      `run=${RUN}&pass=HAL-004&which=before`, // ../ path
      `run=${RUN}&pass=HAL-004&which=after`, // another game's folder
      `run=${RUN}&pass=HAL-006&which=before`, // discarded
      `run=${RUN}&pass=HAL-003&which=middle`, `run=${RUN}&pass=HAL-003`, `run=${RUN}&pass=HAL-999&which=before`,
      `run=..%2f&pass=HAL-003&which=before`, `run=nope&pass=HAL-003&which=before`, `pass=HAL-003&which=before`,
    ]) {
      const x = await get(app, `/shot?${q}`);
      expect(x.status, q).toBe(404);
      expect(await x.text()).toBe('Not Found');
    }
    expect(gitCalls).toEqual([]);
    expect((await (await mkGit()).request(`${H}/shot?run=${RUN}&pass=HAL-003&which=after`)).status).toBe(404); // no token
  });
  it('a bad commit, a wrong-pattern path, or a git failure is a 404', async () => {
    await seed(RUN, true, { changes: [
      change('HAL-003', ticket('T1', 'gearhold', 'tuning', 'a'), 'merged', { commit: '--output=/tmp/x', shots: { before: SHOT('HAL-003', 'before'), after: SHOT('HAL-003', 'after') } }),
      change('HAL-008', ticket('T8', 'gearhold', 'tuning', 'b'), 'merged', { commit: SHA, shots: { before: 'docs/hal/history/gearhold/2026-11-11/HAL-008-before.png', after: SHOT('HAL-009', 'after') } }),
    ] });
    const app = mkGit();
    for (const q of ['pass=HAL-003&which=before', 'pass=HAL-008&which=before']) expect((await get(app, `/shot?run=${RUN}&${q}`)).status, q).toBe(404);
    expect(gitCalls).toEqual([]);
    // HAL-008's after shot names another pass: still the pattern, but not this change's picture.
    expect((await get(app, `/shot?run=${RUN}&pass=HAL-008&which=after`)).status).toBe(404);
    const failing = createServerApp({ halDir, token: TOKEN, games: ['gearhold'], git: async () => { throw new Error('fatal: bad object'); } });
    await seed();
    expect((await get(failing, `/shot?run=${RUN}&pass=HAL-003&which=before`)).status).toBe(404);
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
  it('final fix 9: /run while locked by a live pid redirects to / with a busy flash; a dead lock is idle', async () => {
    await lock();
    const app = mk();
    const r = await post(app, '/run');
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/');
    expect(r.headers.get('set-cookie')).toMatch(/hal_flash=[^;]+; Max-Age=60; Path=\/; HttpOnly; SameSite=Strict/);
    expect(await follow(app, r)).toContain('Hal is busy; try again when this run finishes');
    expect(spawned).toEqual([]);
    alive = false;
    expect((await post(mk(), '/run')).status).toBe(303);
  });
  it('pid reuse: a live pid that started after the lock was written is not the run (same guard as the CLI lock)', async () => {
    await lock(); // startedAt 2026-11-11T08:00:00Z
    const get = async () => (await mk().request(`${H}/`, { headers: { cookie: `hal_token=${TOKEN}` } })).text();
    startedAt = new Date('2026-11-11T07:59:59Z'); // the run itself
    expect(await get()).toContain('<strong data-state>Running</strong> <span data-phase>scoring');
    expect((await post(mk(), '/run')).status).toBe(303);
    expect(spawned).toEqual([]);
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

describe('realGit', () => {
  it('runs git -C <repo> with no shell and returns stdout as bytes; a bad object rejects', async () => {
    const { execFileSync } = await import('node:child_process');
    const { realGit } = await import('./server.js');
    const repo = await mkdtemp(join(tmpdir(), 'hal-srv-git-'));
    const bytes = Buffer.from([0xff, 0xd8, 0x00, 0x0a, 0xff, 0xd9]);
    await writeFile(join(repo, 'a.jpg'), bytes);
    const g = (...a: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
    g('init', '-q'); g('add', 'a.jpg'); g('commit', '-q', '-m', 'x');
    expect(await realGit(repo)(['show', 'HEAD:a.jpg'])).toEqual(bytes);
    await expect(realGit(repo)(['show', 'HEAD:nope.jpg'])).rejects.toThrow();
  });
});

describe('live status and all reports', () => {
  it('GET /status.json: idle, then running with phase and progress; latestRunId; token required', async () => {
    await seed();
    const app = mk();
    expect((await app.request(`${H}/status.json`)).status).toBe(404); // no token, same bare 404 as every route
    const idle = await get(app, '/status.json');
    expect(idle.headers.get('content-type')).toMatch(/^application\/json/);
    expect(idle.headers.get('cache-control')).toBe('no-store');
    expect(await idle.json()).toEqual({ running: false, progress: null, latestRunId: RUN, spendToday: 0, capUsd: 20 });
    await writeFile(join(halDir, 'run.lock'), JSON.stringify({ pid: 99999, runId: 'r1', startedAt: '2026-11-11T08:00:00Z', phase: 'build HAL-004 (3/4)' }));
    const s = await (await get(app, '/status.json')).json() as Record<string, unknown>;
    expect(s).toMatchObject({ running: true, phase: 'build HAL-004 (3/4)', startedAt: '2026-11-11T08:00:00Z', latestRunId: RUN });
    expect(s.progress).toBeCloseTo(0.2 + 0.7 * 2 / 4);
    alive = false; // a dead pid is not a run
    expect(await (await get(app, '/status.json')).json()).toMatchObject({ running: false, progress: null });
  });
  it('GET /hal.js: Hal\'s status script, as JavaScript, token required; the page loads it under script-src \'self\'', async () => {
    const app = mk();
    expect((await app.request(`${H}/hal.js`)).status).toBe(404);
    const r = await get(app, '/hal.js');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('content-security-policy')).toContain("script-src 'self'");
    const js = await r.text();
    expect(js).toContain("fetch('/status.json'");
    expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function|document\.write/); // text only, never HTML
  });
  it('GET /runs: every report, newest first, 25 to a page, with Newer/Older links; a bad page number clamps', async () => {
    for (let i = 1; i <= 30; i++) {
      const id = `run-2026-10-${String(i).padStart(2, '0')}T08-00-00-000Z`;
      await seed(id, i === 30, { endedAt: `2026-10-${String(i).padStart(2, '0')}T09:00:00Z` });
    }
    const app = mk();
    const one = await (await get(app, '/runs')).text();
    const ids = (html: string) => [...html.matchAll(/href="\/runs\/(run-[^"]+)"/g)].map((m) => m[1]);
    expect(ids(one)).toHaveLength(25);
    expect(ids(one)[0]).toBe('run-2026-10-30T08-00-00-000Z');
    expect(one).toContain('Page 1 of 2');
    expect(one).toContain('href="/runs?page=2">Older</a>');
    expect(one).not.toContain('Newer');
    const two = await (await get(app, '/runs?page=2')).text();
    expect(ids(two)).toEqual(['05', '04', '03', '02', '01'].map((d) => `run-2026-10-${d}T08-00-00-000Z`));
    expect(two).toContain('href="/runs?page=1">Newer</a>');
    for (const bad of ['0', '-1', 'x', '99', '1.5']) expect((await get(app, `/runs?page=${bad}`)).status, bad).toBe(200);
    expect(await (await get(app, '/runs?page=99')).text()).toContain('Page 2 of 2');
    expect(one.match(/<script/g)).toBeNull(); // the index needs no script
  });
});
