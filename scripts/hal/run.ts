// The Hal run: one night (or a Run-now) of the polish loop, end to end. Every side effect is injected (RunDeps), so the
// whole run is unit-tested against a temp repo with fakes. The phases, in order:
//
//   1. lock      <halDir>/run.lock {pid, runId, startedAt, phase, trigger}; a live holder -> exit 2 "busy", a dead
//                pid's lock is taken over. The stop flag is cleared. SIGINT/SIGTERM/exit kill live Claude children
//                and remove the lock; the lock is always removed in finally.
//   2. preflight ensureMainWorktree (refs/hal/main, never Brian's branches), push checks (diverged -> report-only, R22; --dry-run),
//                last run's ci:local results, pending undos from feedback.json (same path as `hal undo`)
//   3. play      every scorer of every game in scope, screens and controls once, on Hal's main -> runs/<id>/play/
//   4. plan      planner Claude -> validateTickets -> --kind filter -> splitLiability (calls) -> --max-tickets
//   5. build     runCandidate per ticket; stop flag and budget checked before each; recordPass into the ledger.
//                After a merge the next baseline is the merged candidate's scoresAfter at the new refs/hal/main
//                (re-scored if that is not possible), so the next candidate is never a stale baseline.
//   6. note      director Claude -> runs/<id>/note.md, docs/hal/history/<game>/<night>/note.md committed onto
//                refs/hal/main (one commit, Hal-Run trailer, CAS), noteReplies merged into notes.json by id
//   7. push      ci:local on refs/hal/main's sha, then pushHalMain (fast-forward only); any failure keeps it local
//   8. report    runs/<id>/report.json + report.md, latest.json
//
// Money (R19, reserve then settle; R21): before every spawn, the retry after a usage limit included, a pending entry of
// the role's full slice is appended to spend.json and saved, synchronously, under the lock; after the call that same
// entry (by id, in the day it was reserved) is settled with the real cost. An unknown cost, a throw or a crash between
// the two leaves the whole slice booked. Slices are cut from DAILY_CAP_USD - CAP_MARGIN_USD ($19.50 of the $20 cap,
// since --max-budget-usd is only checked after a turn), and during the build loop the director's $1 is held back so
// the builds cannot starve the note. A zero slice stops the run cleanly (capReached).
// Secrets: the key is only in RunDeps.claude's own deps; every string written under .data, logged, or put in a prompt
// goes through the redactor first.
import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  apiSpent, DAILY_CAP_USD, emptyLedger, ledgerMarkdown, nextPassId, nightOf, parseLedger, recordPass, reserveCall, settleCall, sliceFor, SLICES, splitLiability, stagnated, validateTickets,
  type Billing, type Ledger, type Measures, type ScoreReport, type Ticket, type TicketKind,
} from '@studio/core/hal';
import { secretReadPaths } from './env.js';
import { runCandidate, scorersFor, type CandidateCtx, type CandidateResult } from './candidate.js';
import { killLiveClaudeChildren, roleAllowedTools, type ClaudeCall, type ClaudeResult } from './claude.js';
import type { ControlCheck } from './controls.js';
import {
  changedPaths, commitTree, ensureMainWorktree, extendTree, HAL_MAIN, mainWorktreeDir, pushHalMain, runGit, safeGit, type GitRunner,
} from './git.js';
import { loadPrompt, renderPrompt } from './prompts.js';
import { assertNoRepoFilters, errMsg, extractJson, redactor, type Redactor } from './run-util.js';
import { defaultAlive, defaultStartTime, lockLive } from './lock-live.js';
import { killLiveGroups } from './sandbox.js';
import type { ScreensResult } from './screens.js';
import type { RunLock } from './server.js';
import { createStore, writeJsonAtomic, type Note, type NoteStatus, type Store } from './store.js';
import { applyUndo, type UndoCtx } from './undo.js';

export const LOCK_FILE = 'run.lock';
export const STOP_FILE = 'stop';
export const PLANNER_TIMEOUT_MS = 15 * 60_000;
export const DIRECTOR_TIMEOUT_MS = 10 * 60_000;

export type RunTrigger = 'nightly' | 'manual';
export type RunOptions = {
  /** Games in scope (validated by the CLI). */
  games: string[];
  /** Ticket kinds to build; empty = all. */
  kinds: TicketKind[];
  /** Play and plan, build nothing. */
  reportOnly: boolean;
  maxTickets: number;
  trigger: RunTrigger;
  /** Billing the run starts with. A subscription limit switches the rest of the run to the API. */
  billing: Billing;
  push: boolean;
};

/** Hal's own checks of its main (not of a candidate): real ones run check-entry isolated and sandboxed in `dir`. */
export type PlayPort = {
  score(dir: string, scorer: string): Promise<ScoreReport<unknown>>;
  /** `outDir`: where the shots the planner may Read are kept (runs/<id>/play/screens/<game>). */
  screens(dir: string, game: string, outDir: string): Promise<ScreensResult>;
  controls(dir: string, game: string): Promise<ControlCheck[]>;
};
/** `npm run ci:local -- <sha>` (scripts/ci-local.ts); `detail` is shown in warnings. */
export type CiLocal = (sha: string) => Promise<{ ok: boolean; detail: string }>;
export type ClaudePort = CandidateCtx['claude'];
export type ProcLike = {
  on(ev: 'SIGINT' | 'SIGTERM' | 'exit', fn: () => void): unknown;
  off(ev: 'SIGINT' | 'SIGTERM' | 'exit', fn: () => void): unknown;
  exit(code: number): void;
};

export type RunDeps = {
  /** Brian's checkout (holds .git and .data/hal); never written except under .data. */
  repo: string;
  halDir: string;
  now: () => Date;
  /** Minutes east of UTC for nightOf; default from now(). */
  tzOffsetMinutes?: number;
  model: string;
  /** The real secret values (API key, HAL_TOKEN): redacted from everything Hal writes, logs or prompts. */
  secrets: string[];
  /** Whether .hal.env has an API key; API-billed calls are not attempted without one. */
  hasApiKey: boolean;
  /**
   * One `claude -p` call: runClaude bound to its deps (which alone hold the key). The run does the subscription -> API
   * fallback itself, so that every spawn, the retry included, is reserved in spend.json before it starts (R19).
   */
  claude: (call: ClaudeCall) => Promise<ClaudeResult>;
  play: PlayPort;
  ciLocal: CiLocal;
  git?: GitRunner;
  /** Default runCandidate. */
  candidate?: (t: Ticket, ctx: CandidateCtx) => Promise<CandidateResult>;
  /** Extra candidate ctx (tests: argv fakes, unsandboxedForTests, countTests). */
  candidateCtx?: Partial<Pick<CandidateCtx, 'commands' | 'unsandboxedForTests' | 'countTests' | 'checkTimeoutMs' | 'implementerTimeoutMs' | 'appendSystemPromptFile'>>;
  /** The undo's test run (sequence of argv); default package.json's test script with Hal's tools. Always isolated. */
  undoTest?: (dir: string) => string[][];
  /** TESTS ONLY: the undo's tests run without sandbox-exec. */
  unsandboxedForTests?: boolean;
  pid?: number;
  isAlive?: (pid: number) => boolean;
  /** A pid's process start time (pid-reuse guard for the lock); default `ps -o lstart=`. null = unknown. */
  startTimeOf?: (pid: number) => Date | null;
  /** `--append-system-prompt-file` for every role in both billings (R24): <repo>/CLAUDE.md in realRunDeps. */
  appendSystemPromptFile?: string;
  /** Signal source and exit; default process. */
  proc?: ProcLike;
  log?: (line: string) => void;
};

export type GameSummary = {
  /** Fitness per scorer on Hal's main at the start and at the end of the run. */
  before: Record<string, number>;
  after: Record<string, number>;
  measures: Record<string, { before: Measures; after: Measures }>;
};
export type NoteReply = { id: string; status: Exclude<NoteStatus, 'open'>; reply: string };
/** runs/<runId>/report.json: plan 3's input. */
export type RunReport = {
  runId: string;
  night: string;
  /** The director's per-game text (absent when the director did not answer). */
  perGame?: Record<string, string>;
  startedAt: string;
  endedAt: string;
  trigger: RunTrigger;
  billing: Billing;
  /** The billing at the end (differs from `billing` after a subscription limit hit). */
  billingEnded: Billing;
  spend: { api: number; subscription: number };
  games: Record<string, GameSummary>;
  /** Every ticket tried or skipped, in order. Skipped ones have pass ''. `version` is set once the release step ran. */
  changes: CandidateResult[];
  /** Liability tickets awaiting Brian's approval (by `liability`). */
  calls: Ticket[];
  /** Tickets planned but not built: all of them on a report-only run, else the ones past --max-tickets. */
  planned: Ticket[];
  /** The director's replies applied to notes.json. */
  notes: NoteReply[];
  pushed: boolean;
  warnings: string[];
  pushSkippedReason?: string;
  capReached?: boolean;
};

// ---- the lock -----------------------------------------------------------------------------------------------------

export { defaultAlive, defaultStartTime, lockLive } from './lock-live.js';
export type HeldLock = { info: RunLock; setPhase(phase: string): void; release(): void };
const TAKEOVER_STALE_MS = 30_000;

function readLockFile(path: string): RunLock | 'missing' | 'corrupt' {
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch (e) { return (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'corrupt'; }
  try {
    const v = JSON.parse(text) as RunLock;
    return v && typeof v.pid === 'number' && typeof v.runId === 'string' ? v : 'corrupt';
  } catch { return 'corrupt'; }
}

/**
 * Takes <halDir>/run.lock. The file appears atomically and complete (written aside, then hard-linked into place, which
 * fails if it exists). A lock whose pid is dead (or that is unreadable) is replaced by rename under a short-lived
 * takeover directory, so two runs cannot both take over the same stale lock.
 */
export function acquireLock(halDir: string, info: RunLock, isAlive: (pid: number) => boolean = defaultAlive, startTimeOf: (pid: number) => Date | null = defaultStartTime): HeldLock | { busy: RunLock } {
  const live = (l: RunLock) => lockLive(l, isAlive, startTimeOf);
  mkdirSync(halDir, { recursive: true });
  const path = join(halDir, LOCK_FILE);
  const tmp = `${path}.${info.pid}.${Date.now()}.tmp`;
  const write = (p: string, v: RunLock) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n', { mode: 0o600 });
  const unknown: RunLock = { pid: 0, runId: 'unknown', startedAt: '' };
  const held = (): HeldLock => {
    const own = () => { const c = readLockFile(path); return typeof c === 'object' && c.pid === info.pid && c.runId === info.runId; };
    return {
      info,
      setPhase(phase) {
        if (!own()) return;
        const t = `${path}.${info.pid}.phase.tmp`;
        try { write(t, { ...info, phase }); renameSync(t, path); } catch { rmSync(t, { force: true }); }
      },
      release() { if (own()) rmSync(path, { force: true }); },
    };
  };
  write(tmp, info);
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      try { linkSync(tmp, path); return held(); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      const cur = readLockFile(path);
      if (cur === 'missing') continue; // released meanwhile
      if (typeof cur === 'object' && live(cur)) return { busy: cur };
      const mutex = `${path}.takeover`;
      try { mkdirSync(mutex); } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        let age = 0;
        try { age = Date.now() - statSync(mutex).mtimeMs; } catch { continue; }
        if (age > TAKEOVER_STALE_MS) { rmSync(mutex, { recursive: true, force: true }); continue; }
        return { busy: typeof cur === 'object' ? cur : unknown };
      }
      try {
        const again = readLockFile(path);
        if (typeof again === 'object' && live(again)) return { busy: again };
        renameSync(tmp, path); // atomic replace of the stale lock
        return held();
      } finally { rmSync(mutex, { recursive: true, force: true }); }
    }
    const cur = readLockFile(path);
    return { busy: typeof cur === 'object' ? cur : unknown };
  } finally { rmSync(tmp, { force: true }); }
}

/** Installs SIGINT/SIGTERM/exit handlers that kill live Claude children and remove the lock. Returns the uninstaller. */
function guard(proc: ProcLike, lock: HeldLock, log: (s: string) => void): () => void {
  const sig = (name: string, code: number) => () => {
    killLiveClaudeChildren();
    killLiveGroups(); // isolated checks, ci:local's npm ci
    lock.release();
    log(`${name}: Claude children and checks killed, lock removed`);
    proc.exit(code);
  };
  const onInt = sig('SIGINT', 130), onTerm = sig('SIGTERM', 143);
  const onExit = () => { killLiveClaudeChildren(); killLiveGroups(); lock.release(); };
  proc.on('SIGINT', onInt); proc.on('SIGTERM', onTerm); proc.on('exit', onExit);
  return () => { proc.off('SIGINT', onInt); proc.off('SIGTERM', onTerm); proc.off('exit', onExit); };
}

const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, '-');
const round = (n: number) => Math.round(n * 1e6) / 1e6;
const J = (v: unknown) => JSON.stringify(v, null, 2);
const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, ' ').trim();

type Common = { R: Redactor; log: (s: string) => void; store: Store; git: GitRunner; raw: GitRunner };
function common(d: RunDeps): Common {
  const R = redactor(d.secrets);
  const out = d.log ?? ((l: string) => console.log(l));
  const raw = d.git ?? runGit;
  return { R, log: (s) => out(R.str(s)), store: createStore({ halDir: d.halDir, now: d.now }), git: safeGit(raw), raw };
}

function undoCtx(d: RunDeps, runId: string): UndoCtx {
  return {
    repo: d.repo, runId, now: d.now, secrets: d.secrets,
    ...(d.tzOffsetMinutes !== undefined ? { tzOffsetMinutes: d.tzOffsetMinutes } : {}),
    ...(d.git ? { git: d.git } : {}),
    ...(d.undoTest ? { testCommand: d.undoTest } : {}),
    ...(d.unsandboxedForTests ? { unsandboxedForTests: true } : {}),
  };
}

/** ci:local on refs/hal/main's sha, then the fast-forward push. Returns the outcome; never throws. */
async function pushStep(d: RunDeps, c: Common): Promise<{ pushed: boolean; reason?: string; warning?: string }> {
  const head = (await c.git(['rev-parse', HAL_MAIN], d.repo)).trim();
  const remote = (await c.git(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'], d.repo).catch(() => '')).trim();
  if (remote === head) return { pushed: false, reason: 'nothing new to push' };
  let ci: { ok: boolean; detail: string };
  try { ci = await d.ciLocal(head); } catch (e) { ci = { ok: false, detail: errMsg(e) }; }
  if (!ci.ok) return { pushed: false, reason: 'ci:local failed', warning: `ci:local failed for ${head.slice(0, 12)}: ${ci.detail}; not pushed (the commits stay on ${HAL_MAIN}; no auto-undo)` };
  const p = await pushHalMain(d.repo, d.git ? { git: d.git } : {});
  if (!p.ok) return { pushed: false, reason: 'push failed', warning: `push failed: ${p.error}` };
  await c.git(['update-ref', 'refs/remotes/origin/main', head], d.repo).catch(() => {});
  return { pushed: true };
}

// ---- the run ------------------------------------------------------------------------------------------------------

/** One run. Returns the exit code: 0 done (warnings in the report), 1 a phase failed, 2 busy. */
export async function runNight(o: RunOptions, d: RunDeps): Promise<number> {
  const c = common(d);
  const startedAt = d.now();
  let runId = `run-${stamp(startedAt)}`;
  for (let i = 2; existsSync(c.store.runDir(runId)); i++) runId = `run-${stamp(startedAt)}-${i}`;
  const lock = acquireLock(d.halDir, { pid: d.pid ?? process.pid, runId, startedAt: startedAt.toISOString(), phase: 'lock', trigger: o.trigger }, d.isAlive, d.startTimeOf);
  if ('busy' in lock) {
    c.log(`busy: run ${lock.busy.runId} (pid ${lock.busy.pid}) is running since ${lock.busy.startedAt}`);
    return 2;
  }
  const unguard = guard(d.proc ?? process, lock, c.log);
  try {
    rmSync(join(d.halDir, STOP_FILE), { force: true });
    return await execute(o, d, c, lock, runId, startedAt);
  } finally {
    unguard();
    lock.release();
  }
}

async function execute(o: RunOptions, d: RunDeps, c: Common, lock: HeldLock, runId: string, startedAt: Date): Promise<number> {
  const { R, log, store, git, raw } = c;
  const repo = d.repo;
  const tz = d.tzOffsetMinutes ?? -startedAt.getTimezoneOffset();
  const night = nightOf(startedAt, tz);
  const runDir = store.runDir(runId);
  const stopPath = join(d.halDir, STOP_FILE);
  const ledgerPath = join(d.halDir, 'ledger.json');
  const warnings: string[] = [];
  const warn = (s: string) => { const r = R.str(s); warnings.push(r); log(`warning: ${r}`); };
  const st = {
    billing: o.billing, spend: { api: 0, subscription: 0 }, capReached: false, pushed: false,
    pushSkippedReason: undefined as string | undefined, noKeyWarned: false, spendBroken: false, trustRoot: false, spendSeq: 0,
    /** R21: during the build loop the director's slice is held back from the implementers. */
    holdDirector: false,
  };
  const changes: CandidateResult[] = [];
  let calls: Ticket[] = [];
  let planned: Ticket[] = [];
  const replies: NoteReply[] = [];
  let scores: Record<string, ScoreReport<unknown>> = {};
  let finalScores: Record<string, ScoreReport<unknown>> = {};
  let directorPerGame: Record<string, string> | undefined;
  let noteText = '';
  let phase = 'lock';
  const setPhase = (p: string) => { phase = p; lock.setPhase(p); log(`phase: ${p}`); };
  const writeData = async (rel: string, v: unknown) => writeJsonAtomic(join(runDir, rel), R.deep(v));
  const writeText = async (path: string, text: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, R.str(text)); };
  await mkdir(runDir, { recursive: true });

  // Budget (R19, reserve then settle): before every spawn a pending entry of the full slice is appended and saved,
  // synchronously, under the lock; afterwards that same entry is settled with the real cost (unknown/threw: the slice
  // stays). A crash between the two leaves the slice booked.
  const outstanding: { id: string; day: string; role: string; billing: Billing }[] = [];
  const budget = {
    slice(role: string): number {
      if (st.spendBroken) return 0;
      const held = st.holdDirector && role !== 'director' ? SLICES.director! : 0;
      try { return sliceFor(store.loadSpendTodaySync(), role, held); } catch (e) { st.spendBroken = true; warn(`spend.json unreadable, no more Claude calls: ${errMsg(e)}`); return 0; }
    },
    reserve(role: string, billing: Billing, slice: number): void {
      try {
        const today = store.loadSpendTodaySync();
        const id = `${runId}#${++st.spendSeq}`;
        store.saveSpendDaySync(reserveCall(today, { id, run: runId, role, billing, at: d.now().toISOString() }, slice)); // the call's own cap
        outstanding.push({ id, day: today.day, role, billing });
      } catch (e) {
        st.spendBroken = true;
        warn(`could not reserve spend, no more Claude calls: ${errMsg(e)}`);
        throw new Error('spend reservation failed'); // never spawn an unbooked call
      }
    },
    /**
     * Settles this run's newest outstanding reservation for the role and billing (calls are sequential; the candidate
     * port's `record` lands here), by its id, in the day it was reserved (a call may cross local midnight).
     */
    record(role: string, billing: Billing, usd: number | null): void {
      let i = -1;
      for (let j = outstanding.length - 1; j >= 0; j--) if (outstanding[j]!.role === role && outstanding[j]!.billing === billing) { i = j; break; }
      if (i < 0) { warn(`spend: no reservation to settle for ${role} (${billing})`); return; }
      const r = outstanding.splice(i, 1)[0]!;
      try {
        const next = settleCall(store.loadSpendDaySync(r.day), r.id, usd);
        store.saveSpendDaySync(next);
        st.spend[billing] = round(st.spend[billing] + next.calls.find((c) => c.id === r.id)!.usd);
      } catch (e) { st.spendBroken = true; warn(`could not record spend, no more Claude calls: ${errMsg(e)}`); }
    },
  };
  /** One reserved spawn. */
  const once = async (call: ClaudeCall): Promise<ClaudeResult> => {
    budget.reserve(call.role, call.billing, call.maxBudgetUsd);
    return d.claude(call);
  };
  /** The ClaudePort every role uses: a subscription limit hit switches the run to the API and retries there (if a key). */
  const claude: ClaudePort = async (call, apiSlice) => {
    const first = await once(call);
    if (call.billing !== 'subscription' || !first.limitHit) return { first };
    if (st.billing === 'subscription') { st.billing = 'api'; warn('subscription usage limit hit: the rest of this run uses API credits'); }
    if (!d.hasApiKey) return { first };
    try { return { first, retry: await once({ ...call, billing: 'api', maxBudgetUsd: apiSlice }) }; } catch (e) {
      return { first, retry: { ok: false, text: '', costUsd: null, subtype: 'retry_error', limitHit: false, timedOut: false, stderrTail: R.str(errMsg(e)) } };
    }
  };
  const canCall = () => {
    if (st.billing !== 'api' || d.hasApiKey) return true;
    if (!st.noKeyWarned) { st.noKeyWarned = true; warn('no API key in .hal.env: API-billed Claude calls were not made'); }
    return false;
  };
  const ask = async (role: 'planner' | 'director', prompt: string, cwd: string, timeoutMs: number, addDirs: string[] = []): Promise<string | null> => {
    if (!canCall()) return null;
    const slice = budget.slice(role);
    if (!(slice > 0)) { st.capReached = true; warn(`daily API cap reached: the ${role} did not run`); return null; }
    const call: ClaudeCall = {
      role, prompt: R.str(prompt), cwd, billing: st.billing, maxBudgetUsd: slice, model: d.model,
      allowedTools: roleAllowedTools(role), disallowedTools: [], timeoutMs,
      denyReadPaths: secretReadPaths(repo), // absolute deny rules for every role
      ...(addDirs.length ? { addDirs } : {}),
      ...(d.appendSystemPromptFile ? { appendSystemPromptFile: d.appendSystemPromptFile } : {}),
    };
    let out: Awaited<ReturnType<ClaudePort>>;
    try { out = await claude(call, slice); } catch (e) {
      budget.record(role, call.billing, null); // cannot know whether anything ran: the whole slice
      warn(`${role} call failed: ${errMsg(e)}`);
      return null;
    }
    budget.record(role, call.billing, out.first.costUsd);
    if (out.retry) budget.record(role, 'api', out.retry.costUsd);
    const final = out.retry ?? out.first;
    if (!final.ok) { warn(`${role} failed (${final.timedOut ? 'timed out' : final.limitHit ? 'usage limit' : final.subtype})`); return null; }
    return final.text;
  };

  let code = 0;
  let mainDir = '';
  let pushOff: string | undefined = o.reportOnly ? '--report-only' : o.push ? undefined : '--no-push';
  /** --report-only, or forced on by a diverged refs/hal/main (R22). */
  let reportOnly = o.reportOnly;
  try {
    // 2. Preflight.
    setPhase('preflight');
    // Fail closed before any git in Hal's trees: no filter driver / attributes file / include in the repo's config.
    await assertNoRepoFilters(repo, existsSync(mainWorktreeDir(repo)) ? mainWorktreeDir(repo) : repo, git);
    const main = await ensureMainWorktree(repo, { git: raw });
    mainDir = main.dir;
    if (main.diverged) {
      // R22: building on a diverged ref would only pile up commits that can never fast-forward. Report only.
      reportOnly = true;
      warn(`${HAL_MAIN} and origin/main have diverged: this run is report-only (nothing built, undone or pushed). To recover: `
        + `see what Hal has that origin lacks with \`git log origin/main..${HAL_MAIN}\` (save anything worth keeping), then reset Hal's ref `
        + `with \`git update-ref ${HAL_MAIN} origin/main\`. The next run starts from origin/main.`);
      pushOff ??= `${HAL_MAIN} and origin/main have diverged (origin moved while Hal had unpushed commits)`;
    }
    if (!pushOff) {
      try { await raw(['push', '--dry-run', '--porcelain', 'origin', `${HAL_MAIN}:refs/heads/main`], repo); } catch (e) {
        pushOff = 'push permission check failed';
        warn(`git push --dry-run failed, push is off for this run: ${errMsg(e)}`);
      }
    }
    await ciFollowUp(d, c, warn);
    for (const u of reportOnly ? [] : await store.pendingUndos()) { // report-only changes nothing
      const r = await applyUndo(u.pass, u.reason, undoCtx(d, runId));
      const reason = R.str(u.reason);
      if (r.ok) {
        await store.recordUndo({ pass: u.pass, run: runId, reason, status: 'done', commit: r.commit });
        warn(`undid ${u.pass} (${reason})${r.already ? ': it was already undone' : ` as ${r.game} ${r.version}`}`);
      } else {
        await store.recordUndo({ pass: u.pass, run: runId, reason, status: r.permanent ? 'rejected' : 'failed', error: R.str(r.error) });
        warn(`pending undo of ${u.pass} failed${r.permanent ? '' : ' (retried next run)'}: ${r.error}`);
      }
    }

    // 3. Play.
    setPhase('play');
    const screens: Record<string, ScreensResult> = {};
    const controls: ControlCheck[] = [];
    for (const game of o.games) {
      for (const s of scorersFor(game)) {
        try {
          const r = await d.play.score(mainDir, s);
          scores[s] = r;
          if (r.hardFailures.length) warn(`main's ${s} score has hard failures: ${r.hardFailures.join('; ')}`);
        } catch (e) { warn(`scoring ${s} on main failed: ${errMsg(e)}`); }
      }
      try { screens[game] = await d.play.screens(mainDir, game, join(runDir, 'play', 'screens', game)); } catch (e) { warn(`screens ${game} on main failed: ${errMsg(e)}`); }
      try { controls.push(...(await d.play.controls(mainDir, game)).filter((x) => x.game === game)); } catch (e) { warn(`controls ${game} on main failed: ${errMsg(e)}`); }
    }
    finalScores = { ...scores };
    await writeData('play/scores.json', scores);
    await writeData('play/screens.json', screens);
    await writeData('play/controls.json', controls);

    // 4. Plan.
    setPhase('plan');
    let ledger: Ledger | null;
    try { ledger = existsSync(ledgerPath) ? parseLedger(await readFile(ledgerPath, 'utf8')) : emptyLedger(); } catch (e) {
      ledger = null;
      warn(`${errMsg(e)}: nothing is built this run`);
    }
    // Every note still in notes.json (only `notes --clear` removes one), with its status and Hal's last reply.
    const open = notesInScope(await store.readNotes(), o.games);
    const shotsDir = join(runDir, 'play', 'screens');
    await mkdir(shotsDir, { recursive: true });
    const plannerText = await ask('planner', renderPrompt(loadPrompt('planner'), plannerVars(o, d, c, { scores, screens, controls, ledger, open, mainDir })), mainDir, PLANNER_TIMEOUT_MS, [shotsDir]);
    let tickets: Ticket[] = [];
    if (plannerText !== null) {
      const measures = Object.fromEntries(o.games.map((g) => [g, [...new Set(scorersFor(g).flatMap((s) => Object.keys(scores[s]?.measures ?? {})))]]));
      const v = validateTickets(extractJson(plannerText) ?? plannerText, o.games, measures);
      if (v.ok) {
        tickets = R.deep(v.tickets); // the tickets go into the implementer's prompt: never with a secret in them
        for (const x of v.rejected) warn(`planner ticket ${x.index}${x.id ? ` (${x.id}${x.title ? `: ${oneLine(x.title).slice(0, 80)}` : ''})` : ''} was rejected: ${x.reasons.join('; ')}`);
      } else warn(`the planner's tickets were rejected: ${v.errors.join('; ')}`);
    }
    if (o.kinds.length) tickets = tickets.filter((t) => o.kinds.includes(t.kind));
    const split = splitLiability(tickets, await store.readApprovals());
    calls = split.calls;
    const build = split.build.slice(0, o.maxTickets);
    planned = !reportOnly && ledger ? split.build.slice(build.length) : split.build;
    if (split.build.length > build.length) log(`--max-tickets ${o.maxTickets}: ${split.build.length - build.length} ticket(s) left for another run`);
    await writeData('tickets.json', { build, calls });

    // 5. Build.
    if (!reportOnly && ledger) {
      setPhase('build');
      let baseline = { sha: (await git(['rev-parse', HAL_MAIN], repo)).trim(), scores: { ...scores } };
      // Pass ids continue from the larger of the ledger and refs/hal/main's Hal-Pass trailers (a fresh .data/hal).
      const gitPass = await maxHalPass(git, repo);
      st.holdDirector = true;
      try {
        for (const [i, t] of build.entries()) {
          const skip = (why: string) => { changes.push({ pass: '', ticket: t, verdict: 'skipped', reasons: [why], scoresBefore: {}, scoresAfter: {}, costUsd: 0 }); };
          if (st.trustRoot) { skip('stopped: trust root modified'); continue; }
          if (existsSync(stopPath)) { skip('stopped'); continue; }
          if (!canCall()) { skip('no API key'); continue; }
          if (!(budget.slice('implementer') > 0)) { st.capReached = true; skip('budget'); continue; }
          const pass = nextPassId(ledger, gitPass);
          setPhase(`build ${pass} (${i + 1}/${build.length})`);
          const ctx: CandidateCtx = {
            repo, pass, run: runId, now: d.now, tzOffsetMinutes: tz, model: d.model, billing: st.billing, secrets: [...d.secrets],
            budget: { slice: () => budget.slice('implementer'), record: (_r, b, u) => budget.record('implementer', b, u) },
            claude, mainDir, baseline, ...(d.git ? { git: d.git } : {}),
            ...(d.appendSystemPromptFile ? { appendSystemPromptFile: d.appendSystemPromptFile } : {}), ...(d.candidateCtx ?? {}),
          };
          const r = R.deep(await (d.candidate ?? runCandidate)(t, ctx));
          log(`${pass} ${t.game}: ${r.verdict}${r.reasons.length ? ` (${r.reasons.join('; ')})` : ''}`);
          if (r.verdict === 'skipped') {
            if (r.reasons.includes('budget')) st.capReached = true;
            changes.push({ ...r, pass: '' });
            continue;
          }
          changes.push(r);
          for (const w of r.warnings ?? []) warn(`${pass}: ${w}`);
          if (r.reasons.includes('trust root modified')) {
            // <repo>/node_modules (Hal's tools) changed under us: nothing more is built or pushed until it is reinstalled.
            st.trustRoot = true;
            pushOff = 'trust root modified: run npm ci';
            warn(`trust root modified during ${pass}: <repo>/node_modules changed. The run stopped building and did not push. Run npm ci before the next run.`);
          }
          const primary = scorersFor(t.game).find((s) => t.target !== undefined && Object.hasOwn(r.scoresBefore[s]?.measures ?? {}, t.target)) ?? scorersFor(t.game)[0]!;
          const after = r.scoresAfter[primary], before = r.scoresBefore[primary];
          ledger = recordPass(ledger, {
            ts: d.now().toISOString(), game: t.game, change: t.title, ...(t.target !== undefined ? { target: t.target } : {}),
            fitness: Number.isFinite(after?.fitness) ? after!.fitness : Number.isFinite(before?.fitness) ? before!.fitness : 0,
            baseline: Number.isFinite(before?.fitness) ? before!.fitness : null, measures: after?.measures ?? {},
            kept: r.verdict === 'merged', reasons: r.reasons, costUsd: r.costUsd,
          }, pass);
          await writeJsonAtomic(ledgerPath, R.deep(ledger));
          if (r.verdict === 'merged') {
            const next = await afterMerge(r, baseline);
            baseline = next.baseline;
            mainDir = next.mainDir;
            finalScores = { ...finalScores, ...baseline.scores };
          }
        }
      } finally { st.holdDirector = false; }
    }

    /** The next baseline: the merged candidate's scoresAfter at the new refs/hal/main, else main re-scored. */
    async function afterMerge(r: CandidateResult, prev: CandidateCtx['baseline']): Promise<{ baseline: CandidateCtx['baseline']; mainDir: string }> {
      const head = (await git(['rev-parse', HAL_MAIN], repo)).trim();
      let dir = mainDir;
      if ((await git(['rev-parse', 'HEAD'], dir)).trim() !== head) dir = (await ensureMainWorktree(repo, { git: raw })).dir;
      const need = scorersFor(r.ticket.game);
      if (head === r.commit && need.every((s) => r.scoresAfter[s])) {
        return { baseline: { sha: head, scores: { ...prev.scores, ...Object.fromEntries(need.map((s) => [s, r.scoresAfter[s]!])) } }, mainDir: dir };
      }
      const s2 = { ...prev.scores };
      for (const s of need) {
        try { s2[s] = await d.play.score(dir, s); } catch (e) { delete s2[s]; warn(`re-scoring ${s} after ${r.pass} failed: ${errMsg(e)}`); }
      }
      return { baseline: { sha: head, scores: s2 }, mainDir: dir };
    }

    // 6. Note.
    setPhase('note');
    const notesNow = notesInScope(await store.readNotes(), o.games);
    const stagnation = stagnationText(o.games, ledger);
    const directorText = await ask('director', renderPrompt(loadPrompt('director'), {
      results: J(R.deep({
        ...(reportOnly ? { reportOnly: 'this run was report-only: it planned but built nothing, by design' } : {}),
        changes: changes.map(brief), planned: planned.map(plannedBrief), calls, warnings,
      })),
      notes: J(notesNow.map(noteForPrompt)),
      stagnation,
      feedback: feedbackVars(c).feedback,
    }), mainDir, DIRECTOR_TIMEOUT_MS);
    const dir = parseDirector(directorText);
    if (dir) directorPerGame = dir.perGame;
    if (directorText !== null && !dir) warn("the director's reply did not match its contract: Hal wrote the note");
    noteText = dir?.note ?? fallbackNote(st.capReached, changes);
    await writeText(join(runDir, 'note.md'), `# Hal, night of ${night} (${runId})\n\n${noteText.trim()}\n`);
    if (!reportOnly) {
      try {
        const files = historyFiles(o.games, mainDir, night, runId, dir?.perGame ?? {}, changes, finalScores, d.now().toISOString()).map((f) => ({ ...f, text: R.str(f.text) }));
        const commit = await commitHistory(files);
        if (commit) log(`history notes committed: ${commit.slice(0, 12)}`);
      } catch (e) { warn(`history notes not committed: ${errMsg(e)}`); }
    }
    const ids = new Set(notesNow.map((n) => n.id));
    for (const r of dir?.noteReplies ?? []) {
      if (!ids.has(r.id)) continue;
      ids.delete(r.id);
      const reply = R.str(oneLine(r.reply));
      if (await store.setNote(r.id, { status: r.status, reply })) replies.push({ id: r.id, status: r.status, reply });
    }

    // 7. Push.
    setPhase('push');
    if (pushOff) st.pushSkippedReason = pushOff;
    else {
      const p = await pushStep(d, c);
      st.pushed = p.pushed;
      if (p.reason) st.pushSkippedReason = p.reason;
      if (p.warning) warn(p.warning);
    }
  } catch (e) {
    code = 1;
    warn(`run failed in ${phase}: ${errMsg(e)}`);
  }

  /** Writes the night's notes into Hal's main worktree and commits them onto refs/hal/main by CAS (one commit). */
  async function commitHistory(files: { path: string; text: string }[]): Promise<string | null> {
    if (files.length === 0) return null;
    await assertNoRepoFilters(repo, mainDir, git); // checks ran: refuse git here if a filter could be configured
    const head = (await git(['rev-parse', HAL_MAIN], repo)).trim();
    if ((await git(['rev-parse', 'HEAD'], mainDir)).trim() !== head) throw new Error(`main worktree is not at ${HAL_MAIN}`);
    if ((await git(['status', '--porcelain', '--untracked-files=all'], mainDir)).trim() !== '') throw new Error('main worktree is not clean');
    try {
      for (const f of files) { await mkdir(dirname(join(mainDir, f.path)), { recursive: true }); await writeFile(join(mainDir, f.path), f.text); }
      const headTree = (await git(['rev-parse', `${head}^{tree}`], repo)).trim();
      const tree = await extendTree(mainDir, headTree, files.map((f) => f.path), { git: raw });
      if (tree === headTree) return null;
      const changed = await changedPaths(mainDir, headTree, tree, { git: raw });
      if (!changed.every((p) => files.some((f) => f.path === p))) throw new Error(`history commit would change ${changed.join(', ')}`);
      const message = `docs(hal): director's note, night of ${night}\n\nHal-Run: ${runId}\n`;
      const commit = await commitTree(repo, tree, head, message, { git: raw });
      await git(['update-ref', '-m', 'hal: history notes', HAL_MAIN, commit, head], repo);
      await git(['checkout', '--detach', '--force', '--quiet', commit], mainDir);
      return commit;
    } catch (e) {
      await git(['reset', '--hard', '--quiet', head], mainDir).catch(() => {});
      await git(['clean', '-fdq'], mainDir).catch(() => {});
      throw e;
    }
  }

  // 8. Report (always).
  setPhase('report');
  try {
    const endedAt = d.now().toISOString();
    const games: Record<string, GameSummary> = {};
    for (const g of o.games) {
      const s: GameSummary = { before: {}, after: {}, measures: {} };
      for (const name of scorersFor(g)) {
        const b = scores[name], a = finalScores[name];
        if (b) s.before[name] = b.fitness;
        if (a) s.after[name] = a.fitness;
        if (a || b) s.measures[name] = { before: b?.measures ?? {}, after: a?.measures ?? {} };
      }
      games[g] = s;
    }
    const report: RunReport = {
      runId, night, startedAt: startedAt.toISOString(), endedAt, trigger: o.trigger, billing: o.billing, billingEnded: st.billing, spend: st.spend, games,
      ...(directorPerGame ? { perGame: directorPerGame } : {}),
      changes, calls, planned, notes: replies, pushed: st.pushed, warnings,
      ...(st.pushSkippedReason ? { pushSkippedReason: st.pushSkippedReason } : {}),
      ...(st.capReached ? { capReached: true } : {}),
    };
    await writeData('report.json', report);
    const reportMd = join(runDir, 'report.md');
    await writeText(reportMd, reportMarkdown(report, noteText));
    await writeJsonAtomic(join(d.halDir, 'latest.json'), R.deep({ runId, endedAt, reportMd }));
    log(`report: ${reportMd}`);
  } catch (e) {
    code = 1;
    log(`report not written: ${errMsg(e)}`);
  }
  return code;
}

/** Last run's pushed Hal commits (Hal-Run trailer) against .data/ci/<sha>.json; failures are reported, never auto-undone. */
async function ciFollowUp(d: RunDeps, c: Common, warn: (s: string) => void): Promise<void> {
  let prev: string;
  try {
    const latest = JSON.parse(await readFile(join(d.halDir, 'latest.json'), 'utf8')) as { runId?: unknown };
    if (typeof latest.runId !== 'string') return;
    prev = latest.runId;
    const rep = JSON.parse(await readFile(join(c.store.runDir(prev), 'report.json'), 'utf8')) as { pushed?: unknown };
    if (rep.pushed !== true) return;
  } catch { return; }
  const out = await c.git(['log', '-n', '500', '--format=%H%x00%B%x1e', HAL_MAIN], d.repo);
  const shas: string[] = [];
  for (const rec of out.split('\x1e')) {
    const i = rec.indexOf('\0');
    if (i < 0) continue;
    const paras = rec.slice(i + 1).replace(/\s+$/, '').split(/\n[ \t]*\n/);
    if (new RegExp(`^Hal-Run:[ \\t]*${prev.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`, 'm').test(paras[paras.length - 1] ?? '')) shas.push(rec.slice(0, i).trim());
  }
  let found = 0;
  for (const sha of shas) {
    let r: { ok?: unknown; steps?: { step?: string; ok?: boolean }[] };
    try { r = JSON.parse(await readFile(join(d.repo, '.data', 'ci', `${sha}.json`), 'utf8')); } catch { continue; }
    found++;
    if (r.ok !== true) {
      const failed = (r.steps ?? []).filter((s) => s.ok === false).map((s) => s.step).join(', ');
      warn(`ci:local failed for ${sha.slice(0, 12)} (${prev})${failed ? `: ${failed}` : ''}; not undone automatically`);
    }
  }
  if (shas.length && !found) warn(`no ci:local result for the last run's pushed commits (${prev})`);
}

// ---- prompts, note and report text ---------------------------------------------------------------------------------

type PlanInputs = {
  scores: Record<string, ScoreReport<unknown>>; screens: Record<string, ScreensResult>; controls: ControlCheck[];
  ledger: Ledger | null; open: Note[]; mainDir: string;
};
function plannerVars(o: RunOptions, d: RunDeps, c: Common, p: PlanInputs): Record<string, string> {
  const left = (() => { try { return c.store.loadSpendTodaySync(); } catch { return null; } })();
  const fmt = (n: number) => `$${n.toFixed(2)}`;
  const changelog = (g: string) => {
    try {
      const t = readFileSync(join(p.mainDir, 'games', g, 'CHANGELOG.md'), 'utf8');
      return `#### ${g}\n${t.length > 2000 ? `${t.slice(0, 2000)}\n...` : t}`;
    } catch { return `#### ${g}\n(no CHANGELOG.md)`; }
  };
  const scoreView = Object.fromEntries(Object.entries(p.scores).map(([k, r]) => [k, { fitness: r.fitness, measures: r.measures, hardFailures: r.hardFailures }]));
  const shots = Object.values(p.screens).flatMap((s) => s.shots);
  const errors = Object.values(p.screens).flatMap((s) => [...s.errors.map((e) => `${s.game}: ${e}`), ...s.blockedRequests.map((u) => `${s.game}: blocked request ${u}`)]);
  return {
    games: o.games.join(', ') + (o.kinds.length ? ` (kinds in scope: ${o.kinds.join(', ')})` : ''),
    scores: '```json\n' + J(scoreView) + '\n```',
    ledger: p.ledger ? ledgerMarkdown(p.ledger, 20) : '(the ledger is unreadable)',
    screens: shots.length ? shots.map((s) => `- ${s}`).join('\n') : '(none)',
    controls: p.controls.length ? p.controls.map((x) => `- ${x.game} ${x.check}: ${x.skipped ? `skipped (${x.skipped})` : x.ok ? 'ok' : `FAIL ${x.detail}`}`).join('\n') : '(none)',
    consoleErrors: errors.length ? errors.map((e) => `- ${e}`).join('\n') : '(none)',
    changelogs: o.games.map(changelog).join('\n\n'),
    notes: J(p.open.map(noteForPrompt)),
    stagnation: stagnationText(o.games, p.ledger),
    budget: left
      ? `${fmt(Math.max(0, DAILY_CAP_USD - apiSpent(left)))} of API credits left today; each ticket's implementer gets up to ${fmt(sliceFor(left, 'implementer'))}. At most ${o.maxTickets} tickets will be built.`
      : `At most ${o.maxTickets} tickets will be built.`,
    ...feedbackVars(c),
  };
}
/** Recent votes and undo reasons, and Brian's approvals, for the planner. */
function feedbackVars(c: Common): { feedback: string; approvals: string } {
  const read = (f: string, fb: unknown) => { try { return JSON.parse(readFileSync(join(c.store.halDir, f), 'utf8')) as unknown; } catch { return fb; } };
  const fb = read('feedback.json', { votes: [], undos: [] }) as { votes?: unknown[]; undos?: unknown[] };
  return {
    feedback: J({ votes: (fb.votes ?? []).slice(-20), undos: (fb.undos ?? []).slice(-10) }),
    approvals: J(read('approvals.json', [])),
  };
}
/** Notes in scope, open ones first (then oldest first): Brian's direction is never dropped until he clears it. */
function notesInScope(notes: Note[], games: string[]): Note[] {
  const mine = notes.filter((n) => n.game === null || games.includes(n.game));
  return [...mine.filter((n) => n.status === 'open'), ...mine.filter((n) => n.status !== 'open')];
}
/** A note as the planner and director see it: its status, and Hal's last reply if it has one. */
const noteForPrompt = (n: Note) => ({ id: n.id, at: n.at, game: n.game, text: n.text, status: n.status, ...(n.reply ? { lastReply: n.reply } : {}) });
/** The highest Hal-Pass number in the trailers on refs/hal/main (0 if none). */
async function maxHalPass(git: GitRunner, repo: string): Promise<number> {
  const out = await git(['log', '-n', '2000', '--format=%B%x1e', HAL_MAIN], repo);
  let max = 0;
  for (const rec of out.split('\x1e')) {
    const paras = rec.replace(/\s+$/, '').split(/\n[ \t]*\n/);
    const m = /^Hal-Pass:[ \t]*HAL-(\d+)[ \t]*$/m.exec(paras[paras.length - 1] ?? '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}
function stagnationText(games: string[], l: Ledger | null): string {
  return games.map((g) => `- ${g}: ${l && stagnated(l, g) ? `STAGNATED (${l.streak[g]} attempts in a row kept nothing)` : 'not stagnated'}`).join('\n');
}
const brief = (r: CandidateResult) => ({
  pass: r.pass, game: r.ticket.game, kind: r.ticket.kind, title: r.ticket.title, why: r.ticket.why, verdict: r.verdict, reasons: r.reasons,
  version: r.version, changelog: r.changelog, summary: r.summary,
  fitness: Object.fromEntries(Object.keys({ ...r.scoresBefore, ...r.scoresAfter }).map((s) => [s, { before: r.scoresBefore[s]?.fitness ?? null, after: r.scoresAfter[s]?.fitness ?? null }])),
});

type Director = { note: string; perGame: Record<string, string>; noteReplies: NoteReply[] };
function parseDirector(text: string | null): Director | null {
  if (text === null) return null;
  const v = extractJson(text) as Record<string, unknown> | null;
  if (!v || typeof v.note !== 'string' || !v.note.trim()) return null;
  const perGame: Record<string, string> = {};
  if (v.perGame && typeof v.perGame === 'object' && !Array.isArray(v.perGame)) {
    for (const [k, x] of Object.entries(v.perGame)) if (typeof x === 'string' && x.trim()) perGame[k] = x;
  }
  const noteReplies: NoteReply[] = [];
  for (const r of Array.isArray(v.noteReplies) ? v.noteReplies : []) {
    const x = r as Record<string, unknown>;
    if (typeof x?.id === 'string' && ['acted', 'queued', 'asked'].includes(x.status as string) && typeof x.reply === 'string') {
      noteReplies.push({ id: x.id, status: x.status as NoteReply['status'], reply: x.reply });
    }
  }
  return { note: v.note, perGame, noteReplies };
}

const plannedBrief = (t: Ticket) => ({ id: t.id, game: t.game, kind: t.kind, title: t.title });

const line = (r: CandidateResult) =>
  `- ${r.pass || '(not built)'} ${r.ticket.kind}(${r.ticket.game}): ${oneLine(r.ticket.title)}: **${r.verdict}**${r.version ? ` (${r.version})` : ''}${r.reasons.length ? ` (${oneLine(r.reasons.join('; ')).slice(0, 300)})` : ''}`;

function fallbackNote(capReached: boolean, changes: CandidateResult[]): string {
  const why = capReached ? "the daily API cap was reached before the director's turn" : 'the director did not run';
  return [`Hal wrote this note itself: ${why}.`, '', changes.length ? changes.map(line).join('\n') : 'No changes were attempted.'].join('\n');
}

function historyFiles(games: string[], mainDir: string, night: string, runId: string, perGame: Record<string, string>, changes: CandidateResult[], finalScores: Record<string, ScoreReport<unknown>>, at: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const g of games) {
    const mine = changes.filter((c) => c.ticket.game === g && c.verdict !== 'skipped');
    const text = perGame[g]?.trim();
    const scoresPath = `docs/hal/history/${g}/${night}/scores.json`;
    let runs: unknown[] = [];
    try {
      const prevScores = JSON.parse(readFileSync(join(mainDir, scoresPath), 'utf8')) as { runs?: unknown };
      if (Array.isArray(prevScores.runs)) runs = prevScores.runs;
    } catch { /* first run tonight */ }
    const scorers = Object.fromEntries(scorersFor(g).flatMap((s) => (finalScores[s] ? [[s, { fitness: finalScores[s]!.fitness, measures: finalScores[s]!.measures }]] : [])));
    out.push({ path: scoresPath, text: JSON.stringify({ night, runs: [...runs, { run: runId, at, scorers }] }, null, 2) + '\n' });
    if (!text && mine.length === 0) continue;
    const path = `docs/hal/history/${g}/${night}/note.md`;
    const section = [`## Run ${runId}`, '', ...(text ? [text, ''] : []), ...(mine.length ? ['Changes:', ...mine.map(line)] : [])].join('\n').trimEnd();
    let prev = '';
    try { prev = readFileSync(join(mainDir, path), 'utf8'); } catch { /* first run tonight */ }
    out.push({ path, text: prev ? `${prev.trimEnd()}\n\n${section}\n` : `# ${g}, night of ${night}\n\n${section}\n` });
  }
  return out;
}

function reportMarkdown(r: RunReport, note: string): string {
  const usd = (n: number) => `$${n.toFixed(2)}`;
  const parts = [
    `# Hal report, night of ${r.night}`,
    '',
    `Run ${r.runId} (${r.trigger}, ${r.billing} billing), ${r.startedAt} to ${r.endedAt}.`,
    `Spend this run: API ${usd(r.spend.api)}, subscription ${usd(r.spend.subscription)} (the daily API cap is ${usd(DAILY_CAP_USD)})${r.capReached ? '. **The daily API cap was reached.**' : '.'}`,
    `Pushed: ${r.pushed ? 'yes' : `no${r.pushSkippedReason ? ` (${r.pushSkippedReason})` : ''}`}.`,
    '',
    '## Director\'s note',
    '',
    note.trim() || '(none)',
    '',
    '## Changes',
    '',
    r.changes.length ? r.changes.map(line).join('\n') : 'None.',
  ];
  if (r.planned.length) parts.push('', '## Planned, not built', '', ...r.planned.map((t) => `- ${t.id} ${t.kind}(${t.game}): ${oneLine(t.title)}. ${oneLine(t.why).slice(0, 300)}`));
  if (r.calls.length) parts.push('', '## Your calls', '', ...r.calls.map((t) => `- ${t.game}: ${oneLine(t.title)}. Needs your approval of: ${oneLine(t.liability ?? '')} (\`npm run hal -- approve "${oneLine(t.liability ?? '')}"\`)`));
  if (r.notes.length) parts.push('', '## Your notes', '', ...r.notes.map((n) => `- ${n.id} (${n.status}): ${n.reply}`));
  if (r.warnings.length) parts.push('', '## Warnings', '', ...r.warnings.map((w) => `- ${oneLine(w).slice(0, 500)}`));
  return parts.join('\n') + '\n';
}

// ---- undo -----------------------------------------------------------------------------------------------------------

/** `hal undo HAL-0xx --reason "..."`: lock, applyUndo, feedback, then ci:local and push unless --no-push. 0 ok, 1 failed, 2 busy. */
export async function undoCommand(pass: string, reason: string, o: { push: boolean }, d: RunDeps): Promise<number> {
  const c = common(d);
  const startedAt = d.now();
  const runId = `undo-${stamp(startedAt)}`;
  const lock = acquireLock(d.halDir, { pid: d.pid ?? process.pid, runId, startedAt: startedAt.toISOString(), phase: `undo ${pass}`, trigger: 'manual' }, d.isAlive, d.startTimeOf);
  if ('busy' in lock) {
    c.log(`busy: run ${lock.busy.runId} (pid ${lock.busy.pid}) is running since ${lock.busy.startedAt}`);
    return 2;
  }
  const unguard = guard(d.proc ?? process, lock, c.log);
  try {
    await assertNoRepoFilters(d.repo, existsSync(mainWorktreeDir(d.repo)) ? mainWorktreeDir(d.repo) : d.repo, c.git);
    const main = await ensureMainWorktree(d.repo, { git: c.raw });
    const r = await applyUndo(pass, reason, undoCtx(d, runId));
    const why = c.R.str(reason);
    if (!r.ok) {
      await c.store.recordUndo({ pass, run: runId, reason: why, status: r.permanent ? 'rejected' : 'failed', error: c.R.str(r.error) });
      c.log(`undo ${pass} failed${r.permanent ? ' (rejected: not retried)' : ' (saved; the next run retries it)'}: ${r.error}`);
      return 1;
    }
    await c.store.recordUndo({ pass, run: runId, reason: why, status: 'done', commit: r.commit });
    c.log(r.already ? `${pass} was already undone (${r.commit.slice(0, 12)})` : `undid ${pass}: ${r.commit.slice(0, 12)} on ${HAL_MAIN}, ${r.game} ${r.version}`);
    if (!o.push) { c.log('not pushed (--no-push)'); return 0; }
    if (main.diverged) { c.log(`not pushed: ${HAL_MAIN} and origin/main have diverged`); return 0; }
    const p = await pushStep(d, c);
    c.log(p.pushed ? 'pushed to origin main' : `not pushed: ${p.warning ?? p.reason}`);
    return 0;
  } catch (e) {
    c.log(`undo ${pass} failed: ${errMsg(e)}`);
    return 1;
  } finally {
    unguard();
    lock.release();
  }
}
