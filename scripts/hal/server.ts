// "Run now": a small token-gated Hono app for Brian's phone on home Wi-Fi. Every route, any method, answers a bare 404
// unless the request carries HAL_TOKEN (as ?t= or the cookie set from it). POSTs also need a same-origin Origin header.
// The token is never rendered, logged or put in an error. `/` is the morning report (latest.json's run), `/runs/<id>` an
// earlier one; every form POST is checked against that run's own report.json and redirects back with a one-shot flash.
import { execFile, spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { DAILY_CAP_USD, apiSpent } from '@studio/core/hal';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { defaultAlive, defaultStartTime, lockLive } from './lock-live.js';
import { LIST_HEAD, renderReport, renderRunHalOnly, renderRunsIndex } from './report-page.js';
import { phaseProgress, STATUS_JS, type StatusJson } from './status-client.js';
import type { SpendDay } from '@studio/core/hal';
import type { CandidateResult } from './candidate.js';
import type { RunReport } from './run.js';
import { GIT_TIMEOUT_MS, gitEnv } from './git.js';
import { createStore } from './store.js';

export const SERVER_PORT = 5180;
const COOKIE = 'hal_token';
const FLASH = 'hal_flash';
/** Scripts and fetches only from this server (/hal.js polling /status.json); nothing inline, nothing third party. */
const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; script-src 'self'; connect-src 'self'";
/** Reports on one page of /runs. */
export const RUNS_PER_PAGE = 25;
/** A history image Hal committed: the only paths /shot will read out of git. */
const SHOT_PATH = /^docs\/hal\/history\/([a-z0-9-]+)\/\d{4}-\d{2}-\d{2}\/(HAL-\d+)-(before|after)\.jpg$/;
const PASS = /^HAL-\d+$/;
const RUN_ID = /^run-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

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
  /** The lock pid's start time, for the pid-reuse guard (same as the CLI lock). Default `ps -o lstart=`; null = unknown. */
  startTimeOf?: (pid: number) => Date | null;
  spawnRun?: SpawnRun;
  /** The dev server's games URL when it is up, else null. */
  devUrl?: () => Promise<string | null>;
  /** `git <args>` in the repo, stdout as bytes (for /shot and Play's "behind" line). Default: none, so /shot 404s; `serve` passes realGit(repo). */
  git?: (args: string[]) => Promise<Buffer>;
};

export function tokenOk(given: string | undefined, token: string): boolean {
  if (!given || !token) return false;
  const a = Buffer.from(given), b = Buffer.from(token);
  if (a.length !== b.length) return false; // timingSafeEqual throws on unequal lengths
  return timingSafeEqual(a, b);
}


/** The real spawn: `node tsx/cli scripts/hal.ts run ...`, detached, output to a log file, unref'd. */
export function realSpawnRun(repo: string, spawnFn: typeof spawn = spawn): SpawnRun {
  return ({ args, logPath }) => {
    const tsx = createRequire(join(repo, 'package.json')).resolve('tsx/package.json').replace(/package\.json$/, 'dist/cli.mjs');
    mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 });
    const fd = openSync(logPath, 'a', 0o600);
    try {
      // TSX_DISABLE_CACHE: Hal never loads tsx's transform cache from the shared tmpdir (anything could have written it).
      const child = spawnFn(process.execPath, [tsx, 'scripts/hal.ts', ...args], { cwd: repo, detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, TSX_DISABLE_CACHE: '1' } });
      child.on('error', () => {});
      child.unref();
    } finally {
      closeSync(fd);
    }
  };
}

/** `git -C <repo> <args>` through execFile (no shell), with the scrubbed env (no GIT_*, no secrets), stdout as a Buffer. */
export function realGit(repo: string): (args: string[]) => Promise<Buffer> {
  return (args) => new Promise((resolve, reject) => {
    execFile('git', ['-C', repo, ...args], { encoding: 'buffer', env: gitEnv(), maxBuffer: 16 * 1024 * 1024, timeout: GIT_TIMEOUT_MS }, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, '-');

function readLock(halDir: string): RunLock | null {
  try {
    const v = JSON.parse(readFileSync(join(halDir, 'run.lock'), 'utf8')) as RunLock;
    return typeof v?.pid === 'number' ? v : null;
  } catch { return null; }
}

/** latest.json's run id, or null. */
function latestRunId(halDir: string): string | null {
  try {
    const id = (JSON.parse(readFileSync(join(halDir, 'latest.json'), 'utf8')) as { runId?: unknown }).runId;
    return typeof id === 'string' ? id : null;
  } catch { return null; }
}

/** One line, at most `n` characters (votes' comments and undo reasons). */
const oneLine = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** One place for the response headers (pages are no-store; a handler that set Cache-Control keeps it). same-origin, not no-referrer: with no-referrer browsers send "Origin: null" on same-origin form POSTs (Fetch spec), which the Origin check would reject, breaking Run now and Stop. */
const secure = (c: Context) => {
  if (!c.res.headers.has('cache-control')) c.header('Cache-Control', 'no-store'); // /shot's images set their own
  c.header('Referrer-Policy', 'same-origin');
  if (!c.res.headers.has('content-security-policy')) c.header('Content-Security-Policy', CSP); // /preview sets its own
};

/**
 * The preview's policy: the held game's own files and inline scripts, its images and sounds, and nothing else: no
 * requests anywhere (connect-src 'none'), no form posts (so a game cannot press Hal's buttons), not framed.
 */
const PREVIEW_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'";
const PREVIEW_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
  json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8',
};
/** A path inside games/ for the preview: plain segments only (no dot files, no `..`), a known file type. */
const PREVIEW_PATH = /^(?:[a-z0-9][a-z0-9_-]*\/)*[a-zA-Z0-9][a-zA-Z0-9._-]*\.([a-z0-9]+)$/;

const notFound = () => new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });

/** Today's spend for the Run Hal card: API against the cap, settled subscription dollars, and the running run so far. */
export function spendOf(day: SpendDay, runId?: string): { spendToday: number; subscriptionToday: number; runSpend?: number } {
  const cents = (pick: (c: SpendDay['calls'][number]) => boolean) =>
    day.calls.reduce((t, c) => (pick(c) && Number.isFinite(c.usd) ? t + Math.round(c.usd * 100) : t), 0) / 100;
  return {
    spendToday: apiSpent(day),
    subscriptionToday: cents((c) => c.billing === 'subscription' && !c.pending),
    ...(runId ? { runSpend: cents((c) => c.run === runId && !c.pending) } : {}),
  };
}

export function createServerApp(d: ServerDeps) {
  const now = d.now ?? (() => new Date());
  const alive = d.isAlive ?? defaultAlive;
  const startTimeOf = d.startTimeOf ?? defaultStartTime;
  const spawnRun = d.spawnRun;
  const app = new Hono();
  // The same test as the run's own lock: a live pid that started after the lock was written is a reused pid.
  const running = () => { const l = readLock(d.halDir); return l && lockLive(l, alive, startTimeOf) ? l : null; };

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

  // Forms are a few short fields; anything bigger is refused before it is parsed.
  app.use('*', bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.text('too large', 413) }));
  const store = createStore({ halDir: d.halDir, now });

  /** That run's report.json, or null for a bad id or a missing/unreadable report. */
  const loadRun = async (id: unknown): Promise<RunReport | null> => {
    if (typeof id !== 'string' || !id) return null;
    let dir: string;
    try { dir = store.runDir(id); } catch { return null; }
    try {
      const r = JSON.parse(await readFile(join(dir, 'report.json'), 'utf8')) as Partial<RunReport>;
      if (!r || typeof r !== 'object' || r.runId !== id || !Array.isArray(r.changes)) return null;
      // Only `changes` is required; an older report without the rest opens with them empty.
      return {
        ...r, runId: id, night: String(r.night ?? ''), endedAt: String(r.endedAt ?? ''), changes: r.changes,
        calls: Array.isArray(r.calls) ? r.calls : [], warnings: Array.isArray(r.warnings) ? r.warnings : [],
        notes: Array.isArray(r.notes) ? r.notes : [], planned: Array.isArray(r.planned) ? r.planned : [],
        games: r.games && typeof r.games === 'object' ? r.games : {},
        spend: { api: Number(r.spend?.api ?? 0), subscription: Number(r.spend?.subscription ?? 0) },
      } as RunReport;
    } catch { return null; }
  };
  const readNote = async (id: string) => { try { return await readFile(join(store.runDir(id), 'note.md'), 'utf8'); } catch { return ''; } };
  /** Run dirs, newest first (run ids sort by their start stamp). */
  const runNames = async () => { try { return (await readdir(join(d.halDir, 'runs'))).sort().reverse(); } catch { return []; } };
  /** The panel's newest LIST_HEAD reports, newest first; /runs has the rest. */
  const recentRuns = async () => {
    const out: Array<{ runId: string; endedAt: string }> = [];
    for (const n of await runNames()) {
      if (out.length >= LIST_HEAD) break;
      const r = await loadRun(n);
      if (r) out.push({ runId: r.runId, endedAt: String(r.endedAt) });
    }
    return out.sort((x, y) => y.endedAt.localeCompare(x.endedAt));
  };
  /**
   * Every held feature still waiting for Brian, from any run: the passes under refs/hal/held/ (this report's own held
   * changes when git can't say), each with the newest report that holds it. A pass with a done decision is left out.
   */
  const waitingOf = async (r: RunReport): Promise<Array<{ run: string; change: CandidateResult }>> => {
    let passes: string[] | null = null;
    if (d.git) {
      try {
        const out = (await d.git(['for-each-ref', '--format=%(refname)', 'refs/hal/held/'])).toString('utf8');
        passes = out.split('\n').map((l) => l.trim().slice('refs/hal/held/'.length)).filter((x) => PASS.test(x));
      } catch { passes = null; }
    }
    const done = new Set(((await store.readFeedback()).held ?? []).filter((h) => h.status === 'done').map((h) => h.pass));
    if (passes === null) return r.changes.filter((c) => c.verdict === 'held' && !done.has(c.pass)).map((change) => ({ run: r.runId, change }));
    const want = new Set(passes.filter((x) => !done.has(x)));
    const found = new Map<string, { run: string; change: CandidateResult }>();
    for (const n of want.size ? await runNames() : []) {
      const run = n === r.runId ? r : await loadRun(n);
      for (const c of run?.changes ?? []) if (c.verdict === 'held' && want.has(c.pass) && !found.has(c.pass)) found.set(c.pass, { run: run!.runId, change: c });
      if (found.size === want.size) break;
    }
    return [...found.values()].sort((a, b) => Number(a.change.pass.slice(4)) - Number(b.change.pass.slice(4)));
  };
  /** This run's feedback, plus any done undo of one of its passes recorded under another run (e.g. a CLI `hal undo`). */
  const feedbackOf = async (r: RunReport, alsoPasses: string[] = []) => {
    const [own, all] = await Promise.all([store.feedbackFor(r.runId), store.readFeedback()]);
    const passes = new Set([...r.changes.map((x) => x.pass).filter(Boolean), ...alsoPasses]);
    const elsewhere = all.undos.filter((u) => u.run !== r.runId && u.status === 'done' && !!u.pass && passes.has(u.pass));
    const held = (all.held ?? []).filter((h) => passes.has(h.pass));
    return { votes: own.votes, undos: [...own.undos, ...elsewhere].sort((a, b) => String(a.at).localeCompare(String(b.at))), held };
  };
  /** One writer at a time (the server is one process): a check and the write it guards are atomic, so a double tap records once. */
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(f: () => Promise<T>): Promise<T> => { const p = chain.then(f, f); chain = p.catch(() => {}); return p; };
  /** The pass's change in this run if it merged or is held (votes, undos, shots and previews act on those). */
  const merged = (r: RunReport, pass: unknown) =>
    typeof pass === 'string' && PASS.test(pass) ? r.changes.find((x) => x.pass === pass && (x.verdict === 'merged' || x.verdict === 'held')) ?? null : null;
  /** Ship or drop a held feature: now when Hal is free (`hal ship|drop`), else the next run applies the saved decision. */
  const decideHeld = async (c: Context, r: RunReport, pass: string, decision: 'ship' | 'drop', to = r.runId) => {
    const done = ((await store.readFeedback()).held ?? []).some((h) => h.pass === pass && h.status === 'done');
    if (done) return back(c, to, 'Already decided');
    await store.recordHeld({ pass, run: r.runId, decision, status: 'pending' });
    if (running()) return back(c, to, `${decision === 'ship' ? 'Ship' : 'Drop'} queued: Hal is busy, so the next run applies it`);
    try {
      if (!spawnRun) throw new Error('no spawn');
      spawnRun({ args: [decision, pass], logPath: join(d.halDir, 'logs', `${decision}-${stamp(now())}.log`) });
    } catch { return back(c, to, `${decision === 'ship' ? 'Ship' : 'Drop'} queued: the next run applies it`); }
    return back(c, to, decision === 'ship' ? 'Shipping: Hal puts it on main, runs ci:local and pushes' : 'Dropped');
  };

  /** Commits on refs/hal/main that HEAD lacks (Play serves the checkout), or undefined: no ref, no git, or a failure. */
  const behindHal = async (): Promise<number | undefined> => {
    if (!d.git) return undefined;
    try {
      const out = (await d.git(['rev-list', '--count', 'HEAD..refs/hal/main'])).toString('utf8').trim();
      return /^\d+$/.test(out) ? Number(out) : undefined;
    } catch { return undefined; }
  };

  const page = async (c: Context, report: RunReport | null) => {
    const lock = running();
    const flash = getCookie(c, FLASH);
    if (flash !== undefined) deleteCookie(c, FLASH, { path: '/' });
    const base = {
      status: lock ? { running: true, phase: lock.phase, startedAt: lock.startedAt } : { running: false },
      ...spendOf(await store.loadSpendToday(), lock?.runId), capUsd: DAILY_CAP_USD,
      games: d.games, runs: await recentRuns(), latestRunId: latestRunId(d.halDir), ...(flash ? { flash: flash.slice(0, 300) } : {}),
    };
    if (!report) return c.html(renderRunHalOnly(base));
    const waiting = await waitingOf(report);
    const [note, feedback, notes, approvals, playUrl, behind, lessons] = await Promise.all([
      readNote(report.runId), feedbackOf(report, waiting.map((w) => w.change.pass)), store.readNotes(), store.readApprovals(),
      d.devUrl ? d.devUrl().catch(() => null) : Promise.resolve(null), behindHal(), store.readLessons(),
    ]);
    return c.html(renderReport({ ...base, report, note, feedback, notes, waiting, approvals: approvals.map((a) => a.item), playUrl, lessons, ...(behind ? { behindHal: behind } : {}) }));
  };

  app.get('/', async (c) => page(c, await loadRun(latestRunId(d.halDir))));
  /** Every report, RUNS_PER_PAGE to a page (only that page's report.json files are read). */
  app.get('/runs', async (c) => {
    const names = await runNames();
    const pages = Math.max(1, Math.ceil(names.length / RUNS_PER_PAGE));
    const asked = Number(c.req.query('page') ?? '1');
    const pageNo = Number.isInteger(asked) && asked >= 1 ? Math.min(asked, pages) : 1;
    const runs: Array<{ runId: string; endedAt: string; trigger?: string; merged: number; dropped: number }> = [];
    for (const n of names.slice((pageNo - 1) * RUNS_PER_PAGE, pageNo * RUNS_PER_PAGE)) {
      const r = await loadRun(n);
      if (!r) continue;
      const merged = r.changes.filter((x) => x.verdict === 'merged').length;
      runs.push({ runId: r.runId, endedAt: String(r.endedAt), ...(r.trigger ? { trigger: r.trigger } : {}), merged, dropped: r.changes.length - merged });
    }
    return c.html(renderRunsIndex({ runs, page: pageNo, pages }));
  });
  /** The Run Hal panel's live state, for /hal.js. */
  app.get('/status.json', async (c) => {
    const lock = running();
    const body: StatusJson = {
      running: !!lock, ...(lock?.phase ? { phase: lock.phase } : {}), ...(lock?.startedAt ? { startedAt: lock.startedAt } : {}),
      progress: lock ? phaseProgress(lock.phase) : null, latestRunId: latestRunId(d.halDir),
      ...spendOf(await store.loadSpendToday(), lock?.runId), capUsd: DAILY_CAP_USD,
    };
    return c.json(body, 200, { 'x-content-type-options': 'nosniff' });
  });
  app.get('/hal.js', (c) => c.body(STATUS_JS, 200, { 'content-type': 'text/javascript; charset=utf-8', 'x-content-type-options': 'nosniff' }));
  app.get('/runs/:id', async (c) => {
    const r = await loadRun(c.req.param('id'));
    return r ? page(c, r) : notFound();
  });

  app.get('/shot', async (c) => {
    const q = (k: string) => c.req.query(k);
    const which = q('which');
    if (which !== 'before' && which !== 'after' || !d.git) return notFound();
    const r = await loadRun(q('run'));
    const ch = r && merged(r, q('pass'));
    const path = ch?.shots?.[which];
    const m = typeof path === 'string' ? SHOT_PATH.exec(path) : null;
    if (!ch || !m || m[1] !== ch.ticket.game || m[2] !== ch.pass || m[3] !== which) return notFound();
    if (typeof ch.commit !== 'string' || !/^[0-9a-f]{7,64}$/.test(ch.commit)) return notFound();
    let bytes: Buffer;
    try { bytes = await d.git(['show', `${ch.commit}:${path}`]); } catch { return notFound(); }
    return c.body(new Uint8Array(bytes), 200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' });
  });

  /** A held (or shipped) feature's games, straight from its commit, to play before deciding. Read-only, from git. */
  app.get('/preview/:pass/*', async (c) => {
    const pass = c.req.param('pass');
    let rest: string;
    try { rest = decodeURIComponent(c.req.path.slice(`/preview/${pass}/`.length)); } catch { return notFound(); }
    const m = PREVIEW_PATH.exec(rest);
    if (!d.git || !PASS.test(pass) || !m || !PREVIEW_TYPES[m[1]!]) return notFound();
    let commit = '';
    for (const n of await runNames()) { // the newest report that has this pass held or merged names its commit
      const r = await loadRun(n);
      const ch = r && merged(r, pass);
      if (ch && typeof ch.commit === 'string' && /^[0-9a-f]{7,64}$/.test(ch.commit)) { commit = ch.commit; break; }
    }
    if (!commit) return notFound();
    let bytes: Buffer;
    // Laid out as the games are served (browser.ts serveGames): games/ at the root, packages/sdk/ at sdk/.
    const file = rest.startsWith('sdk/') ? `packages/${rest}` : `games/${rest}`;
    try { bytes = await d.git(['show', `${commit}:${file}`]); } catch { return notFound(); }
    return c.body(new Uint8Array(bytes), 200, { 'content-type': PREVIEW_TYPES[m[1]!]!, 'content-security-policy': PREVIEW_CSP, 'x-content-type-options': 'nosniff' });
  });

  /** 303 back to the run's page (`/` for the latest) with the flash in a short-lived cookie, never in the URL. */
  const back = (c: Context, run: string | null, flash: string) => {
    setCookie(c, FLASH, flash, { httpOnly: true, sameSite: 'Strict', path: '/', maxAge: 60 });
    return c.redirect(!run || run === latestRunId(d.halDir) ? '/' : `/runs/${encodeURIComponent(run)}`, 303);
  };
  const bad = (c: Context) => c.text('bad request', 400);
  /** The page a form came from (a held feature's card on a later report carries `from`), else the run it acts on. */
  const backTo = (b: Record<string, unknown>, r: RunReport) => (typeof b.from === 'string' && RUN_ID.test(b.from) ? b.from : r.runId);
  /** The parsed form, or null when the body is not a form we can read (a malformed multipart throws): the caller 400s. */
  const form = async (c: Context): Promise<Record<string, unknown> | null> => {
    try { return (await c.req.parseBody()) as Record<string, unknown>; } catch { return null; }
  };

  app.post('/vote', async (c) => {
    const b = await form(c);
    if (!b) return bad(c);
    return serial(async () => {
      const r = await loadRun(b.run);
      const ch = r && merged(r, b.pass);
      if (!r || !ch) return bad(c);
      const comment = oneLine(b.comment, 500);
      if (ch.verdict === 'held') {
        await store.addVote({ run: r.runId, item: ch.pass, game: ch.ticket.game, vote: 'up', ...(comment ? { comment } : {}) });
        return decideHeld(c, r, ch.pass, 'ship', backTo(b, r));
      }
      // A repeat tap of the same Keep records nothing new: the newest vote on this pass in this run already says it.
      const last = (await store.feedbackFor(r.runId)).votes.filter((v) => v.item === ch.pass).at(-1);
      if (last?.vote === 'up' && (last.comment ?? '') === comment) return back(c, r.runId, 'Kept');
      await store.addVote({ run: r.runId, item: ch.pass, game: ch.ticket.game, vote: 'up', ...(comment ? { comment } : {}) });
      return back(c, r.runId, 'Kept');
    });
  });

  app.post('/undo', async (c) => {
    const b = await form(c);
    if (!b) return bad(c);
    return serial(async () => {
      const r = await loadRun(b.run);
      const ch = r && merged(r, b.pass);
      if (!r || !ch) return bad(c);
      if (ch.verdict === 'held') {
        const given = oneLine(b.reason, 500);
        await store.addVote({ run: r.runId, item: ch.pass, game: ch.ticket.game, vote: 'down', ...(given ? { comment: given } : {}) });
        return decideHeld(c, r, ch.pass, 'drop', backTo(b, r));
      }
      // Already asked for on this run, or already undone by any run (a CLI `hal undo`, another report).
      const { undos } = await store.readFeedback();
      if (undos.some((u) => u.pass === ch.pass && u.status === 'done')) return back(c, r.runId, 'Already undone');
      if (undos.some((u) => u.pass === ch.pass && u.run === r.runId && u.status === 'pending')) return back(c, r.runId, 'Undo already asked for');
      const given = oneLine(b.reason, 500);
      const reason = given || 'no reason given';
      await store.addVote({ run: r.runId, item: ch.pass, game: ch.ticket.game, vote: 'down', ...(given ? { comment: given } : {}) });
      await store.addUndo({ run: r.runId, pass: ch.pass, reason, status: 'pending' });
      if (running()) return back(c, r.runId, 'Undo queued: Hal is busy, so the next run applies it');
      try {
        if (!spawnRun) throw new Error('no spawn');
        // One argv element each: the reason can never be read as a flag; the pass matched ^HAL-\d+$.
        spawnRun({ args: ['undo', ch.pass, `--reason=${reason}`], logPath: join(d.halDir, 'logs', `undo-${stamp(now())}.log`) });
      } catch {
        return back(c, r.runId, 'Undo queued: the next run applies it');
      }
      return back(c, r.runId, 'Undo started');
    });
  });

  const callItem = (r: RunReport, item: unknown) => (typeof item === 'string' && item ? r.calls.find((t) => t.liability === item) ?? null : null);
  app.post('/approve', async (c) => {
    const b = await form(c);
    if (!b) return bad(c);
    return serial(async () => {
      const r = await loadRun(b.run);
      const t = r && callItem(r, b.item);
      if (!r || !t) return bad(c);
      await store.addApproval(t.liability!);
      return back(c, r.runId, 'Approved; Hal builds it next run');
    });
  });
  app.post('/decline', async (c) => {
    const b = await form(c);
    if (!b) return bad(c);
    return serial(async () => {
      const r = await loadRun(b.run);
      const t = r && callItem(r, b.item);
      if (!r || !t) return bad(c);
      await store.addVote({ run: r.runId, item: t.liability!, game: t.game, vote: 'down' });
      return back(c, r.runId, 'Left it for now');
    });
  });

  /** The page to go back to: the form's run when it names a real report, else `/`. */
  const backRun = async (v: unknown) => (await loadRun(v))?.runId ?? null;
  app.post('/tell', async (c) => {
    const b = await form(c);
    if (!b) return bad(c);
    return serial(async () => {
      const game = str(b.game);
      if (game !== '' && !d.games.includes(game)) return bad(c);
      const text = str(b.text).trim().slice(0, 2000).trim();
      if (!text) return bad(c);
      // A reply to a report's Director's note: `ref` must name a real report (its night is shown to Hal).
      let ref: { run: string; night?: string } | undefined;
      if (str(b.ref) !== '') {
        const r = await loadRun(b.ref);
        if (!r) return bad(c);
        ref = { run: r.runId, ...(r.night ? { night: r.night } : {}) };
      }
      await store.addNote({ text, game: game || null, ...(ref ? { ref } : {}) });
      return back(c, await backRun(b.run), ref ? 'Sent to Hal; it answers in the next run' : 'Sent to Hal');
    });
  });
  /** Brian answers in a thread; Hal replies in the next run. */
  app.post('/notes/reply', async (c) => {
    const b = await form(c);
    if (!b) return bad(c);
    return serial(async () => {
      const id = str(b.id);
      const text = str(b.text).trim().slice(0, 2000).trim();
      if (!/^N-\d+$/.test(id) || !text || !(await store.addReply(id, text))) return bad(c);
      return back(c, await backRun(b.run), 'Reply sent; Hal answers in the next run');
    });
  });
  app.post('/notes/clear', async (c) => {
    const b = await form(c);
    if (!b) return bad(c);
    return serial(async () => {
      const id = str(b.id);
      if (!/^N-\d+$/.test(id) || !(await store.clearNote(id))) return bad(c);
      return back(c, await backRun(b.run), 'Note cleared');
    });
  });

  app.post('/run', async (c) => {
    if (running()) return back(c, null, 'Hal is busy; try again when this run finishes');
    const body = await form(c);
    if (!body) return bad(c);
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
