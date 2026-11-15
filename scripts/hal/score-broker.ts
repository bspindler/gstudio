// Score requests from the implementer to Hal (the "score broker").
//
// The implementer's Bash runs inside Claude Code's sandbox, which denies by default: Chromium cannot launch there, so the
// browser-played gearhold-play scorer could never run, and every play-fitness ticket was tuned blind. Instead, while the
// implementer works, Hal watches a private request dir (the only dir outside the worktree the implementer may write,
// passed as $HAL_SCORE_DIR). `npm run hal -- score --game <scorer>` inside a Hal build writes `req-<id>.json` there and
// waits; Hal scores a snapshot of the worktree as it is right now, with the same isolated check (sandbox-exec, scrubbed
// env, nonce-checked result) the gate uses after the build, and writes `res-<id>.json` back.
//
// What the implementer controls is only the scorer name, checked against the game's own scorers; the scores are always
// the gate's defaults. Whatever it writes in the dir (symlinks, junk, a forged response) only fools itself: Hal's gate
// scores the final tree again, independently. Hal never follows a link here: requests are lstat'ed regular files of
// at most REQ_MAX bytes, responses are written to a fresh exclusive file and renamed into place.
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const SCORE_DIR_ENV = 'HAL_SCORE_DIR';
/** Requests Hal serves per implementer call; more get an error response (each costs a ~30 s browser run). */
export const MAX_REQUESTS = 12;
/** The client gives up after this long: under the Bash tool's default 2-minute timeout. */
export const CLIENT_TIMEOUT_MS = 110_000;
const REQ_MAX = 1024;
const ID_RE = /^[a-z0-9]{8,32}$/;
const REQ_RE = /^req-([a-z0-9]{8,32})\.json$/;

export type ScoreRequest = { scorer: string };
/** `report` is the scorer's ScoreReport, as JSON; `error` says why there is none. */
export type ScoreResponse = { ok: true; report: unknown } | { ok: false; error: string };

export type BrokerOptions = {
  dir: string;
  /** Scorer names this build may ask for (scorersFor(game)). */
  scorers: string[];
  /** Scores the worktree as it is now. Never called concurrently. A throw becomes an error response. */
  score: (scorer: string) => Promise<unknown>;
  maxRequests?: number;
  pollMs?: number;
  /** Errors from the broker itself (never from a score), for Hal's log. */
  onError?: (e: unknown) => void;
};
export type Broker = { stop(): Promise<void>; served(): number };

const msg = (e: unknown) => String((e as Error)?.message ?? e).trim();

async function respond(dir: string, id: string, r: ScoreResponse): Promise<void> {
  const tmp = join(dir, `.res-${id}-${randomBytes(6).toString('hex')}.tmp`);
  // O_EXCL: never write through anything already at that name (a planted symlink).
  const fh = await open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try { await fh.writeFile(JSON.stringify(r)); } finally { await fh.close(); }
  await rename(tmp, join(dir, `res-${id}.json`)); // replaces a planted res- link itself, never its target
}

/** Reads a request: a regular file (not a link) of at most REQ_MAX bytes holding {"scorer": "<name>"}. */
async function readRequest(path: string): Promise<ScoreRequest> {
  const st = await lstat(path);
  if (!st.isFile()) throw new Error('request is not a regular file');
  if (st.size > REQ_MAX) throw new Error('request is too large');
  const v = JSON.parse(await readFile(path, 'utf8')) as unknown;
  const scorer = (v as { scorer?: unknown })?.scorer;
  if (typeof scorer !== 'string') throw new Error('request has no scorer');
  return { scorer };
}

/** Starts serving `dir`. Requests are handled one at a time, oldest name first. */
export function startScoreBroker(o: BrokerOptions): Broker {
  const max = o.maxRequests ?? MAX_REQUESTS;
  const pollMs = o.pollMs ?? 250;
  let served = 0, stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let busy: Promise<void> = Promise.resolve();

  const handle = async (id: string, path: string): Promise<void> => {
    let req: ScoreRequest;
    try { req = await readRequest(path); } catch (e) {
      await rm(path, { force: true });
      return respond(o.dir, id, { ok: false, error: `bad request: ${msg(e)}` });
    }
    await rm(path, { force: true });
    if (!o.scorers.includes(req.scorer)) {
      return respond(o.dir, id, { ok: false, error: `unknown scorer ${JSON.stringify(req.scorer).slice(0, 80)}; this build can score: ${o.scorers.join(', ')}` });
    }
    if (served >= max) return respond(o.dir, id, { ok: false, error: `Hal already scored ${max} times for this build; finish with what you have` });
    served++;
    let r: ScoreResponse;
    try { r = { ok: true, report: await o.score(req.scorer) }; } catch (e) { r = { ok: false, error: msg(e).slice(0, 4000) }; }
    if (!stopped) await respond(o.dir, id, r);
  };

  const tick = async (): Promise<void> => {
    let names: string[];
    try { names = await readdir(o.dir); } catch (e) { o.onError?.(e); return; }
    for (const name of names.sort()) {
      if (stopped) return;
      const m = REQ_RE.exec(name);
      if (!m) continue;
      try { await handle(m[1]!, join(o.dir, name)); } catch (e) { o.onError?.(e); }
    }
  };
  const loop = () => {
    if (stopped) return;
    busy = tick().finally(() => { if (!stopped) timer = setTimeout(loop, pollMs); });
  };
  loop();
  return {
    served: () => served,
    async stop() { stopped = true; clearTimeout(timer); await busy.catch(() => {}); },
  };
}

/** The implementer's side: asks Hal to score, waits for the answer. Throws on an error response or a timeout. */
// A retry after a timeout waits on the request it already sent (its id is kept in `wait-<scorer>` until the answer is
// read), instead of queueing a second score behind the one still running: a score longer than the client's wait
// (Lanternkeep's took ~164 s under load) would otherwise time out on every retry.
export async function askHalToScore(dir: string, scorer: string, o: { timeoutMs?: number; pollMs?: number } = {}): Promise<unknown> {
  const waitFile = /^[a-z0-9-]{1,64}$/.test(scorer) ? join(dir, `wait-${scorer}`) : undefined;
  let id = waitFile ? await readFile(waitFile, 'utf8').then((s) => s.trim(), () => '') : '';
  if (!ID_RE.test(id)) {
    id = randomBytes(8).toString('hex');
    if (!ID_RE.test(id)) throw new Error('bad request id');
    const tmp = join(dir, `.req-${id}.tmp`);
    await writeFile(tmp, JSON.stringify({ scorer } satisfies ScoreRequest), { flag: 'wx' });
    if (waitFile) await writeFile(waitFile, id);
    await rename(tmp, join(dir, `req-${id}.json`));
  }
  const res = join(dir, `res-${id}.json`);
  const deadline = Date.now() + (o.timeoutMs ?? CLIENT_TIMEOUT_MS);
  for (;;) {
    let text: string | undefined;
    try { text = await readFile(res, 'utf8'); } catch { /* not yet */ }
    if (text !== undefined) {
      await rm(res, { force: true });
      if (waitFile) await rm(waitFile, { force: true });
      const r = JSON.parse(text) as ScoreResponse;
      if (!r.ok) throw new Error(`Hal could not score ${scorer}: ${r.error}`);
      return r.report;
    }
    if (Date.now() > deadline) throw new Error(`Hal did not answer the ${scorer} score request in time (it is still scoring); run the same command again to keep waiting for the same score`);
    await new Promise((d) => setTimeout(d, o.pollMs ?? 250));
  }
}
