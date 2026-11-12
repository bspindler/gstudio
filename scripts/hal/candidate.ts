// One Hal candidate, end to end: implementer Claude edits a fresh worktree, then Hal's own code runs every check and,
// only if all pass, squash-merges onto refs/hal/main. Claude never runs a check itself and cannot skip one: each step
// below runs in Hal's process, in this order, and any failure discards. The worktree is always removed.
//
//   1. budget slice (0 -> skipped: budget)        5. npm test, npm run typecheck              } sandboxed child
//   2. implementer claude -p (fail/timeout/       6. scores + gate, screens, controls         } processes (R13)
//      blocked/unparsable/no edits -> discard)    7. before/after history shots (JPEG, checked as committed)
//   3. tree from disk (private index, no          8. commit-tree of the verified tree, squashMerge onto refs/hal/main
//      filters) + checkTripwires on it            9. remove the worktree and branch (finally)
//   4. applyRelease (Hal's version + changelog), added to that tree and verified as the only extra paths
//
// What gets committed is a tree object built by Hal, never the worktree's index: T1 (Claude's edits, as hashed from
// disk) is what the tripwires judge, T2 = T1 + the three release files, T3 = T2 + the two history images. Before EVERY
// isolated check the disk is pruned and must hash to the expected tree (T1, then T2), and <wt>/node_modules is rebuilt
// and verified ("tampered between checks" otherwise); the checks cannot write node_modules, and the tools that run them
// (vitest, tsc, tsx) are resolved by Hal under <repo>/node_modules, never from the worktree.
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyRelease, bumpedTonight, checkTripwires, testPrefixesFor, compareScores, formatTrailers, halReleasedTonight, nightOf, planVersion, TRIPWIRE_RULES,
  type Billing, type Diff, type FileChange, type ScoreReport, type Ticket,
} from '@studio/core/hal';
import { secretReadPaths } from './env.js';
import { asFingerprint, firstChanged } from './focus.js';
import { roleAllowedTools, type ClaudeCall, type ClaudeResult } from './claude.js';
import type { ControlCheck } from './controls.js';
import {
  addFileToTree, blobBytes, blobText, changedPaths, collectTreeDiff, commitTree, extendTree, linkNodeModules, trustRootDigest, newCandidateWorktree, removeWorktree, runGit, snapshotTree,
  holdCandidate, squashMerge, verifyNodeModules, vitestCounts, type CollectDeps, type GitRunner,
} from './git.js';
import { loadPrompt, parseImplementerOutput, renderPrompt, type ImplementerOutput } from './prompts.js';
import { runIsolated, sandboxAvailable, sandboxEnv, type IsolatedResult, type SandboxPolicy } from './sandbox.js';
import type { ScreensResult } from './screens.js';
import { startScoreBroker } from './score-broker.js';

export const IMPLEMENTER_TIMEOUT_MS = 20 * 60_000;
export const CHECK_TIMEOUT_MS = 20 * 60_000;
export const RESULT_PREFIX = 'HAL-RESULT ';
export const NONCE_ENV = 'HAL_CHECK_NONCE';
/** Fix rounds after a failing npm test or typecheck: each a fresh implementer call with the failure (and its own slice). */
export const FIX_ROUNDS = 2;
const TAIL_CHARS = 1500;
/** Paths a mid-build score must find unchanged from the base: Hal scores only with main's scorer code. */
export const SCORER_PATHS = ['scripts/hal', 'scripts/hal.ts', 'package.json', 'packages/core/src/hal'];

/** The run's budget, owned by Task 7 under the run lock. `slice` is dollars this role may spend now (0 = stop). */
export type CandidateBudget = {
  slice(role: 'implementer'): number;
  /** Every Claude call is recorded, a fallback retry included. `usd` null = unknown (booked as the full slice). */
  record(role: 'implementer', billing: Billing, usd: number | null): void;
};

/**
 * The argv of each check, run with cwd = the tree being checked (a candidate worktree, or Hal's main worktree for the
 * before shot), always as an isolated child (sandboxed unless `unsandboxedForTests`). test/typecheck are a sequence of
 * argv that must all exit 0. score/screens/controls/shoot print exactly one `HAL-RESULT <nonce> <json>` line, with the
 * nonce from $HAL_CHECK_NONCE (scripts/hal/check-entry.ts).
 */
export type CheckCommands = {
  test: (dir: string) => string[][];
  typecheck: (dir: string) => string[][];
  score: (dir: string, scorer: string) => string[];
  screens: (dir: string, game: string) => string[];
  controls: (dir: string, game: string) => string[];
  /** `focus`: the 0-based level or sector to show (focus.ts); omitted, gameplay at the start. */
  shoot: (dir: string, game: string, outPath: string, focus?: number) => string[];
  /** Per-level fingerprints of the tree's game data (focus.ts), printed as the check's result. */
  fingerprint: (dir: string, game: string) => string[];
};

/** The node scripts Hal runs checks with, resolved (real paths) under <repo>/node_modules: never the worktree's. */
export type HalTools = { node: string; vitest: string; tsc: string; tsx: string };
export function resolveTools(repo: string): HalTools {
  const nm = join(repo, 'node_modules');
  return {
    node: process.execPath,
    vitest: realpathSync(join(nm, 'vitest', 'vitest.mjs')),
    tsc: realpathSync(join(nm, 'typescript', 'bin', 'tsc')),
    tsx: realpathSync(join(nm, 'tsx', 'dist', 'cli.mjs')),
  };
}

/**
 * An npm script (`a && b`, each `<bin> args...`, bin one of vitest/tsc/tsx) as argv run with Hal's tools. Anything
 * shell-like (quotes, pipes, $, ;, redirects, a lone &) throws. `vitest run` gets --no-cache (its cache would live in
 * the read-only node_modules).
 */
export function scriptArgv(script: string, tools: HalTools): string[][] {
  if (/["'`|;$<>(){}\\]/.test(script) || script.replace(/&&/g, '').includes('&')) throw new Error(`npm script is not a plain command list: ${script}`);
  return script.split('&&').map((part) => {
    const [bin, ...args] = part.trim().split(/\s+/);
    const path = bin === 'vitest' ? tools.vitest : bin === 'tsc' ? tools.tsc : bin === 'tsx' ? tools.tsx : undefined;
    if (!path) throw new Error(`npm script uses ${bin}; Hal only runs vitest, tsc and tsx`);
    return [tools.node, path, ...args, ...(bin === 'vitest' && args[0] === 'run' ? ['--no-cache'] : [])];
  });
}

/** The real checks: package.json's test and typecheck scripts, and check-entry.ts in the tree, all with Hal's tools. */
export function defaultCommands(tools: HalTools, scripts: Record<string, string>): CheckCommands {
  const script = (name: string) => { const v = scripts[name]; if (typeof v !== 'string') throw new Error(`package.json has no ${name} script`); return scriptArgv(v, tools); };
  const entry = (dir: string) => [tools.node, tools.tsx, join(dir, 'scripts', 'hal', 'check-entry.ts')];
  return {
    test: () => script('test'),
    typecheck: () => script('typecheck'),
    score: (dir, scorer) => [...entry(dir), 'score', scorer],
    screens: (dir, game) => [...entry(dir), 'screens', game],
    controls: (dir, game) => [...entry(dir), 'controls', game],
    shoot: (dir, game, out, focus) => [...entry(dir), 'shoot', game, out, ...(focus === undefined ? [] : [String(focus)])],
    fingerprint: (dir, game) => [...entry(dir), 'fingerprint', game],
  };
}

export type CandidateCtx = {
  /** The repo root holding .data/hal and node_modules (Brian's checkout; never written to). */
  repo: string;
  /** Pass id, e.g. 'HAL-012': names the branch hal/<pass>, the worktree and the history images. */
  pass: string;
  /** Run id for the Hal-Run trailer. */
  run: string;
  now: () => Date;
  /** Minutes east of UTC for nightOf; default -now().getTimezoneOffset(). */
  tzOffsetMinutes?: number;
  model: string;
  billing: Billing;
  /** Default IMPLEMENTER_TIMEOUT_MS (20 min). */
  implementerTimeoutMs?: number;
  /** Default FIX_ROUNDS. */
  fixRounds?: number;
  /** Keep the verified commit at refs/hal/held/<pass> instead of merging it (new features wait for Brian). */
  hold?: boolean;
  appendSystemPromptFile?: string;
  /** Real secret values (the API key from .hal.env), kept out of every diff, env, reason and result (ruling R8). */
  secrets: string[];
  budget: CandidateBudget;
  /**
   * The run's Claude port (run.ts): one reserved spawn, and on a subscription usage limit one reserved retry on the API
   * with `apiSliceUsd`. Both results are returned so both get settled.
   */
  claude: (call: ClaudeCall, apiSliceUsd: number) => Promise<{ first: ClaudeResult; retry?: ClaudeResult }>;
  /** Hal's main worktree (ensureMainWorktree), at refs/hal/main: the before shot is taken here. */
  mainDir: string;
  /** Scores of refs/hal/main at `sha`, keyed by scorer name (scorersFor(game)). `sha` must be the candidate's base. */
  baseline: { sha: string; scores: Record<string, ScoreReport<unknown>> };
  /** Override check argv (tests). Whatever they are, they run isolated. */
  commands?: Partial<CheckCommands>;
  /** Per-check timeout; default CHECK_TIMEOUT_MS (20 min). */
  checkTimeoutMs?: number;
  /** TESTS ONLY: run the checks as plain child processes when sandbox-exec is unavailable (Linux CI). Never set by Hal. */
  unsandboxedForTests?: boolean;
  git?: GitRunner;
  /** TESTS ONLY (honoured only with unsandboxedForTests): a test counter for the tripwire diff. Default: vitest list, sandboxed. */
  countTests?: CollectDeps['countTests'];
};

export type CandidateResult = {
  pass: string;
  ticket: Ticket;
  /** `held`: a feature that passed every check, kept off refs/hal/main until Brian ships it (git.ts holdCandidate). */
  verdict: 'merged' | 'held' | 'discarded' | 'skipped';
  reasons: string[];
  scoresBefore: Record<string, ScoreReport<unknown>>;
  scoresAfter: Record<string, ScoreReport<unknown>>;
  /** Dollars spent on Claude by this pass (unknown API costs count as the whole slice). */
  costUsd: number;
  /** Scores Hal ran for the implementer while it worked (the score broker). */
  scoreRequests?: number;
  /** Fix rounds the implementer got after failing npm test / typecheck (absent: none were needed). */
  fixRounds?: number;
  /** The squash commit on refs/hal/main. */
  commit?: string;
  /** Repo-relative paths of the history images in the commit. */
  shots?: { before: string; after: string };
  /** What the shots show when it is not gameplay at the start: the level or sector the change touched (focus.ts). */
  shotsOf?: string;
  /** The game's version after this pass (set once the release step ran). */
  version?: string;
  /** The changelog bullet the implementer wrote. */
  changelog?: string;
  /** The implementer's one-line summary. */
  summary?: string;
  /** Things Brian must act on even though the pass just discarded (e.g. a modified trust root). */
  warnings?: string[];
};

/** The scorers that judge a game: Gearhold has a static and a browser-played one. */
export function scorersFor(game: string): string[] {
  return game === 'gearhold' ? ['gearhold', 'gearhold-play'] : [game];
}

/** Width and height from a JPEG's SOF header, or null if the bytes are not a JPEG (no SOI) or have no frame header. */
export function jpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1]!;
    if (m === 0xff) { i++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    if (m === 0xd9 || m === 0xda) return null; // end of image / start of scan before any frame header
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (i + 8 >= buf.length) return null;
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}
export const HISTORY_SIZE = { width: 390, height: 844 } as const;

/**
 * The JSON of the one `HAL-RESULT <nonce> ` line, or throws: none, more than one, or a wrong nonce. Defence in depth
 * against game code forging a result (the host-api tripwire, R15, is the primary guard).
 */
export function parseResult<T>(stdout: string, nonce: string): T {
  const lines = stdout.split('\n').filter((l) => l.startsWith(RESULT_PREFIX));
  if (lines.length === 0) throw new Error('no result printed');
  if (lines.length > 1) throw new Error(`${lines.length} result lines (forged output?)`);
  const want = `${RESULT_PREFIX}${nonce} `;
  if (!nonce || !lines[0]!.startsWith(want)) throw new Error('result line has the wrong nonce (forged output?)');
  return JSON.parse(lines[0]!.slice(want.length)) as T;
}

class Discard extends Error {
  constructor(readonly reasons: string[]) { super(reasons.join('; ')); }
}
const discard = (...reasons: string[]): never => { throw new Discard(reasons); };
const msg = (e: unknown) => String((e as Error)?.message ?? e).trim();
const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, ' ').trim();
const GAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const newNonce = () => randomBytes(16).toString('hex');
/** The bytes of <dir>/.git (a worktree's gitdir pointer), or a marker if it is not a readable file. */
const readGitPtr = (dir: string): string => { try { return readFileSync(join(dir, '.git'), 'utf8'); } catch (e) { return `\0unreadable ${(e as NodeJS.ErrnoException).code ?? ''}`; } };
function scriptsOf(packageJson: string): Record<string, string> {
  try { return (JSON.parse(packageJson) as { scripts?: Record<string, string> }).scripts ?? {}; } catch { return {}; }
}

/** Messages and committer dates of the newest 500 commits at `rev` (for R20's "Hal released this tonight" test). */
export async function halCommits(repo: string, rev: string, git: GitRunner = runGit): Promise<Array<{ message: string; date: Date | null }>> {
  const out = await git(['log', '-n', '500', '--format=%cI%x00%B%x1e', rev], repo);
  return out.split('\x1e').map((rec) => rec.replace(/^\s+/, '')).filter((rec) => rec.includes('\0')).map((rec) => {
    const i = rec.indexOf('\0');
    const d = new Date(rec.slice(0, i).trim());
    return { message: rec.slice(i + 1), date: Number.isFinite(d.getTime()) ? d : null };
  });
}

/** Runs one ticket through the whole pipeline. Never throws: every failure is a `discarded` result. */
export async function runCandidate(ticket: Ticket, ctx: CandidateCtx): Promise<CandidateResult> {
  const git = ctx.git ?? runGit;
  const secrets = ctx.secrets.filter((s) => s.length > 0);
  const redact = (s: string) => secrets.reduce((t, k) => t.split(k).join('[REDACTED]'), s);
  const tail = (s: string) => { const r = redact(s); return r.length > TAIL_CHARS ? `...${r.slice(-TAIL_CHARS)}` : r; };
  const res: CandidateResult = { pass: ctx.pass, ticket, verdict: 'discarded', reasons: [], scoresBefore: ctx.baseline.scores, scoresAfter: {}, costUsd: 0 };
  const finish = (verdict: CandidateResult['verdict'], reasons: string[]): CandidateResult => {
    res.verdict = verdict;
    res.reasons = reasons.map(redact);
    if (res.changelog !== undefined) res.changelog = redact(res.changelog);
    if (res.summary !== undefined) res.summary = redact(res.summary);
    return res;
  };

  // 1. Budget.
  const slice = ctx.budget.slice('implementer');
  if (!(slice > 0)) return finish('skipped', ['budget']);
  const game = ticket.game;
  if (!GAME_RE.test(game) || !existsSync(join(ctx.mainDir, 'games', game, 'game.yaml'))) return finish('discarded', [`bad game ${JSON.stringify(game)}`]);
  const unsandboxed = ctx.unsandboxedForTests === true;
  if (!unsandboxed && !sandboxAvailable()) return finish('discarded', ['no sandbox']);

  // Hal's private files (index files, the base export for test counting, the before shot): the checks cannot write here.
  const privDir = join(ctx.repo, '.data', 'hal', 'tmp', ctx.pass);
  const shotDir = join(privDir, 'shots');
  // Every piece of candidate code runs through here: isolated child, scrubbed env, sandboxed, group killed afterwards.
  const env = sandboxEnv(process.env, secrets);
  const denyRead = secretReadPaths(ctx.repo);
  const isolated = (argv: string[], cwd: string, writable: string[], o: { nonce?: string; denyWrite?: string[] } = {}) => {
    const policy: SandboxPolicy = { writable, denyRead, denyWrite: o.denyWrite ?? [] }; // + a private temp dir (runIsolated)
    const e = o.nonce ? { ...env, [NONCE_ENV]: o.nonce } : env;
    return runIsolated(argv, { cwd, env: e, timeoutMs: ctx.checkTimeoutMs ?? CHECK_TIMEOUT_MS, ...(unsandboxed ? { unsandboxed: true } : { policy }) });
  };
  /** A check in a tree: the tree writable (unless read-only), its node_modules never. */
  const inTree = (dir: string, argv: string[], writable: string[], nonce?: string) =>
    isolated(argv, dir, writable, { denyWrite: [join(dir, 'node_modules'), join(dir, '.git')], ...(nonce ? { nonce } : {}) });

  try {
    const wt = await newCandidateWorktree(ctx.repo, ctx.pass, { git });
    if (ctx.baseline.sha !== wt.base) discard(`stale baseline: scores are for ${ctx.baseline.sha.slice(0, 12)}, the candidate starts at ${wt.base.slice(0, 12)}`);
    const tz = ctx.tzOffsetMinutes ?? -ctx.now().getTimezoneOffset();
    const night = nightOf(ctx.now(), tz);
    const baseTree = (await git(['rev-parse', `${wt.base}^{tree}`], ctx.repo)).trim();
    const tree = { git, tmpRoot: privDir };

    // package.json is protected, so the base's scripts are the candidate's. Tools come from <repo>/node_modules.
    let defaults: CheckCommands | undefined;
    let packageJson: string | undefined;
    const cmd = async <K extends keyof CheckCommands>(k: K): Promise<CheckCommands[K]> => {
      const o = ctx.commands?.[k];
      if (o) return o;
      if (!defaults) {
        packageJson ??= await blobText(wt.dir, wt.base, 'package.json', { git });
        defaults = defaultCommands(resolveTools(ctx.repo), scriptsOf(packageJson));
      }
      return defaults[k];
    };

    // <repo>/node_modules is the trust root (Hal's tools, Brian's checkout): nothing in the pass may change it.
    const trustRoot = await trustRootDigest(ctx.repo);
    const checkTrustRoot = async () => {
      if ((await trustRootDigest(ctx.repo)) === trustRoot) return;
      (res.warnings ??= []).push(`trust root modified: ${join(ctx.repo, 'node_modules')} changed during ${ctx.pass}; reinstall it (npm ci) before the next run`);
      discard('trust root modified');
    };
    /** Before each isolated check: the trust root unchanged, the disk exactly `expected`, node_modules rebuilt and verified. */
    const guard = async (expected: string) => {
      await checkTrustRoot();
      if ((await snapshotTree(wt.dir, wt.base, { ...tree, prune: true })) !== expected) discard('tampered between checks');
      await linkNodeModules(wt.dir, ctx.repo);
      try { await verifyNodeModules(wt.dir, ctx.repo); } catch (e) { discard(`tampered between checks: ${msg(e)}`); }
    };
    const countTests: NonNullable<CollectDeps['countTests']> = unsandboxed && ctx.countTests ? ctx.countTests : (wtDir, base) => vitestCounts(wtDir, base, async (dir) => {
      const t = resolveTools(ctx.repo);
      const r = await inTree(dir, [t.node, t.vitest, 'list', '--json'], [dir]);
      if (r.code !== 0) throw new Error(`vitest list failed (${r.timedOut ? 'timed out' : `exit ${r.code}`}): ${tail(r.stderr || r.stdout)}`);
      return r.stdout;
    }, { tmpRoot: privDir, repo: ctx.repo });

    /** Runs a shot command (its nonce-checked result is required). */
    const shoot = async (dir: string, outPath: string, writable: string[], label: string, focus?: number) => {
      const nonce = newNonce();
      let r: IsolatedResult;
      try { r = await inTree(dir, (await cmd('shoot'))(dir, game, outPath, focus), writable, nonce); } catch (e) { return discard(`${label} shot failed: ${msg(e)}`); }
      try { if (r.code !== 0) throw new Error(r.timedOut ? 'timed out' : `exit ${r.code}: ${tail(r.stderr || r.stdout)}`); parseResult(r.stdout, nonce); } catch (e) { discard(`${label} shot failed: ${msg(e)}`); }
    };
    const checkJpeg = (buf: Buffer | null, label: string) => {
      const size = buf ? jpegSize(buf) : null;
      if (!size) discard(`${label} shot is not a JPEG`);
      if (size!.width !== HISTORY_SIZE.width || size!.height !== HISTORY_SIZE.height) discard(`${label} shot is ${size!.width}x${size!.height}, not ${HISTORY_SIZE.width}x${HISTORY_SIZE.height}`);
    };

    // Before shot: main as it is, before anything is built (checked now to fail early, and again as committed).
    await rm(shotDir, { recursive: true, force: true });
    await mkdir(shotDir, { recursive: true });
    const beforeTmp = join(shotDir, 'before.jpg');
    await shoot(ctx.mainDir, beforeTmp, [shotDir], 'before');
    checkJpeg(await readFile(beforeTmp).catch(() => null), 'before');

    // 2. Implementer. The ticket is data: rendered into the template, never anything from the env.
    const ticketData: Record<string, string> = { id: ticket.id, game, kind: ticket.kind, title: ticket.title, why: ticket.why };
    for (const k of ['target', 'liability', 'fromNote'] as const) if (ticket[k] !== undefined) ticketData[k] = ticket[k]!;
    const prompt = renderPrompt(loadPrompt('implementer'), { game, scorers: scorersFor(game).map((x) => `\`${x}\``).join(', '), ticket: JSON.stringify(ticketData, null, 2) });
    // The score broker (scripts/hal/score-broker.ts): the implementer's `npm run hal -- score` asks Hal, which scores a
    // snapshot of the worktree as it is at that moment, with the same isolated check the gate runs in step 6. The
    // request dir (one per implementer call, see `implement`) is a fresh one outside privDir: the only place outside the
    // worktree the implementer may write.
    const snapDir = join(privDir, 'snap');
    const treeEntry = (t: string, p: string) => git(['rev-parse', '--verify', '-q', `${t}:${p}`], ctx.repo).then((o) => o.trim(), () => '');
    const scoreNow = async (scorer: string): Promise<unknown> => {
      const snap = await snapshotTree(wt.dir, wt.base, tree); // no prune: the implementer's tree is left alone
      for (const p of SCORER_PATHS) {
        if ((await treeEntry(snap, p)) !== (await treeEntry(wt.base, p))) throw new Error(`${p} differs from main; Hal scores only with main's scorer code, so put it back first`);
      }
      await rm(snapDir, { recursive: true, force: true });
      await mkdir(snapDir, { recursive: true });
      try {
        const tar = join(privDir, 'snap.tar');
        await git(['archive', '--format=tar', '-o', tar, snap], ctx.repo);
        await promisify(execFile)('/usr/bin/tar', ['-xf', tar, '-C', snapDir]);
        await rm(tar, { force: true });
        await linkNodeModules(snapDir, ctx.repo);
        await verifyNodeModules(snapDir, ctx.repo);
        const nonce = newNonce();
        const r = await inTree(snapDir, (await cmd('score'))(snapDir, scorer), [snapDir], nonce);
        if (r.code !== 0) throw new Error(`score ${scorer} ${r.timedOut ? 'timed out' : r.error ?? `exited ${r.code}`}: ${tail(r.stderr || r.stdout)}`);
        return parseResult(r.stdout, nonce);
      } finally { await rm(snapDir, { recursive: true, force: true }); }
    };
    const book = (billing: Billing, usd: number | null, slice: number) => {
      ctx.budget.record('implementer', billing, usd);
      res.costUsd = Math.round((res.costUsd + (usd ?? (billing === 'api' ? slice : 0))) * 1e6) / 1e6;
    };
    // The worktree's .git is a gitdir pointer: an implementer that rewrote it would aim Hal's next git call in this
    // tree at a config of its own (a filter runs code). Compared, and restored before any git runs, right after the call.
    const gitPtr = readGitPtr(wt.dir);
    const checkGitPtr = () => {
      if (readGitPtr(wt.dir) === gitPtr) return;
      rmSync(join(wt.dir, '.git'), { recursive: true, force: true });
      writeFileSync(join(wt.dir, '.git'), gitPtr);
      discard('tampered .git');
    };
    /** One implementer call in the worktree (the first, or a fix round): its own budget slice and score broker. */
    const implement = async (text: string, slice: number): Promise<ImplementerOutput> => {
      const askDir = await mkdtemp(join(tmpdir(), 'hal-ask-'));
      const call: ClaudeCall = {
        role: 'implementer', prompt: text, cwd: wt.dir, scoreDir: askDir, billing: ctx.billing, maxBudgetUsd: slice, model: ctx.model,
        allowedTools: roleAllowedTools('implementer'), disallowedTools: [], timeoutMs: ctx.implementerTimeoutMs ?? IMPLEMENTER_TIMEOUT_MS,
        denyReadPaths: denyRead,
        ...(ctx.appendSystemPromptFile ? { appendSystemPromptFile: ctx.appendSystemPromptFile } : {}),
      };
      let out: Awaited<ReturnType<CandidateCtx['claude']>>;
      const broker = startScoreBroker({ dir: askDir, scorers: scorersFor(game), score: scoreNow });
      const stopBroker = async () => {
        await broker.stop();
        res.scoreRequests = (res.scoreRequests ?? 0) + broker.served();
        await rm(askDir, { recursive: true, force: true }).catch(() => {});
      };
      try { out = await ctx.claude(call, slice); await stopBroker(); } catch (e) {
        await stopBroker();
        // We cannot know whether anything was spawned, so book the call as unknown cost (the full slice on the API).
        book(call.billing, null, slice);
        checkGitPtr();
        return discard(`implementer call failed: ${msg(e)}`);
      }
      book(call.billing, out.first.costUsd, slice); // settle every reservation first: a tampered-.git discard must not leave one open
      if (out.retry) book('api', out.retry.costUsd, slice);
      checkGitPtr();
      const final = out.retry ?? out.first;
      if (!final.ok) discard(final.timedOut ? 'implementer timed out' : final.limitHit ? 'implementer hit a usage limit' : `implementer failed (${final.subtype})`);
      const parsed = parseImplementerOutput(final.text);
      if (!parsed) discard('implementer output does not match the contract');
      if (parsed!.blocked !== undefined) discard(`implementer blocked: ${parsed!.blocked}`);
      return parsed!;
    };

    const rel = (f: string) => `games/${game}/${f}`;
    const files = { yaml: rel('game.yaml'), html: rel('index.html'), changelog: rel('CHANGELOG.md') };
    const releasePaths = Object.values(files);
    const rounds = ctx.fixRounds ?? FIX_ROUNDS;
    let parsed = await implement(prompt, slice);
    let t2 = '';
    // Steps 3-5, once per attempt. A failing npm test or typecheck is the implementer's to fix, like any failed build:
    // up to `rounds` fix rounds, each a fresh implementer call in the same worktree with the failure output, and each
    // attempt goes through every step again (tree, tripwires, release, checks). Anything else still discards at once.
    for (let round = 0; ; round++) {
      res.changelog = parsed.changelog;
      res.summary = parsed.summary;
      await checkTrustRoot(); // the implementer's edit tools could have written through node_modules symlinks
      // 3. The candidate tree from the bytes on disk (index flags and filters cannot hide anything), disk pruned to it.
      const t1 = await snapshotTree(wt.dir, wt.base, { ...tree, prune: true });
      if (t1 === baseTree) discard('no edits');
      await guard(t1); // node_modules rebuilt before the test listing runs candidate code
      let diff: Diff;
      try { diff = await collectTreeDiff(wt.dir, wt.base, t1, { git, countTests }); } catch (e) { return discard(`diff collection failed: ${msg(e)}`); }
      if (diff.files.length === 0) discard('no edits');
      const hits = checkTripwires(diff, secrets, { scope: { game, testPrefixes: testPrefixesFor(game) } }); // R18: its game and its tests only
      if (hits.length) discard(...hits.map((v) => `tripwire ${v.rule}${v.path ? `: ${v.path}` : ''}: ${v.detail}`));
      await guard(t1);

      // 4. Release: Hal's own version bump and changelog entry, read from T1 and added to it.
      const cur = { yaml: '', html: '', changelog: '' };
      let next: typeof cur;
      try {
        for (const k of ['yaml', 'html', 'changelog'] as const) cur[k] = await blobText(wt.dir, t1, files[k], { git });
        const current = /^version:[ \t]*(\S+)[ \t]*$/m.exec(cur.yaml)?.[1];
        if (!current) throw new Error('game.yaml has no version');
        // R20: share tonight's version only with Hal's own release of it tonight (trailers on refs/hal/main), never with
        // a version Brian released himself tonight, even though its CHANGELOG heading is dated tonight.
        const shared = halReleasedTonight(await halCommits(ctx.repo, wt.base, git), game, current, night, tz) ? bumpedTonight(cur.changelog, night) : null;
        const version = planVersion({ current, kind: ticket.kind, alreadyBumpedTonight: shared });
        next = applyRelease(cur, { slug: game, version, night, entry: { kind: ticket.kind, text: parsed.changelog }, shareTonight: shared !== null });
        res.version = version;
      } catch (e) { return discard(`release failed: ${msg(e)}`); }
      for (const k of ['yaml', 'html', 'changelog'] as const) await writeFile(join(wt.dir, files[k]), next[k]);
      // The changelog text is Claude's, written after the tripwires: check what Hal wrote for secrets too.
      const releaseDiff: Diff = {
        files: (['yaml', 'html', 'changelog'] as const).map((k): FileChange => ({ path: files[k], status: 'M', before: cur[k], after: next[k], binary: false })),
        testCountBefore: 0, testCountAfter: 0, levelCounts: { before: {}, after: {} }, secrets,
      };
      const leaks = TRIPWIRE_RULES.secret!(releaseDiff);
      if (leaks.length) discard(...leaks.map((v) => `tripwire ${v.rule}: ${v.path}: ${v.detail} (in Hal's release edit)`));
      t2 = await extendTree(wt.dir, t1, releasePaths, tree);
      const extra = await changedPaths(wt.dir, t1, t2, tree);
      if (!extra.every((p) => releasePaths.includes(p))) discard(`release changed unexpected paths: ${extra.join(', ')}`);

      // 5. Tests and typecheck, isolated, each step guarded.
      let steps: Array<[string, string[]]>;
      try {
        steps = [
          ...(await cmd('test'))(wt.dir).map((a): [string, string[]] => ['npm test', a]),
          ...(await cmd('typecheck'))(wt.dir).map((a): [string, string[]] => ['npm run typecheck', a]),
        ];
      } catch (e) { return discard(`checks unavailable: ${msg(e)}`); }
      // Guard (prune ignored files, compare the tree) before each script, not between the `&&` parts of one: the
      // typecheck script is `tsc -b <packages> && tsc -p scripts`, and the second part needs the first part's dist/.
      let prev = '';
      let failure: string | null = null;
      for (const [name, argv] of steps) {
        if (name !== prev) await guard(t2);
        prev = name;
        const r = await inTree(wt.dir, argv, [wt.dir]);
        if (r.code === 0) continue;
        if (r.error) discard(`${name} failed to run: ${r.error}`); // not the candidate's code: no fix round
        failure = `${name} failed${r.timedOut ? ' (timed out)' : ''}:\n${tail(`${r.stdout}\n${r.stderr}`)}`;
        break;
      }
      if (failure === null) break;
      const after = round ? ` (after ${round} fix round${round > 1 ? 's' : ''})` : '';
      if (round >= rounds) discard(`${failure}${after}`);
      const fixSlice = ctx.budget.slice('implementer');
      if (!(fixSlice > 0)) discard(`${failure}${after}`, 'no budget left for a fix round');
      // Back to the implementer's own tree: Hal's release edits come out (the next attempt gets a fresh release).
      for (const k of ['yaml', 'html', 'changelog'] as const) await writeFile(join(wt.dir, files[k]), cur[k]);
      try { await guard(t1); } catch (e) { throw e instanceof Discard ? new Discard([...e.reasons, failure]) : e; } // keep what failed
      res.fixRounds = round + 1;
      parsed = await implement(`${prompt}\n${renderPrompt(loadPrompt('implementer-fix'), { round: String(round + 1), rounds: String(rounds), failure })}`, fixSlice);
    }

    // 6. Scores and gate, then screens and controls, isolated, each guarded, each result nonce-checked.
    const check = async <T>(label: string, argv: string[]): Promise<T> => {
      await guard(t2);
      const nonce = newNonce();
      const r = await inTree(wt.dir, argv, [wt.dir], nonce);
      if (r.code !== 0) throw new Error(`${r.timedOut ? 'timed out' : r.error ?? `exit ${r.code}`}: ${tail(r.stderr || r.stdout)}`);
      try { return parseResult<T>(r.stdout, nonce); } catch (e) { throw new Error(`${label}: ${msg(e)}`); }
    };
    const scorers = scorersFor(game);
    const before = ctx.baseline.scores;
    const reasons: string[] = [];
    const target = ticket.target;
    const hasTarget = (s: string) => target !== undefined && before[s] !== undefined && Object.hasOwn(before[s]!.measures, target);
    if (target !== undefined && !scorers.some(hasTarget)) reasons.push(`target measure "${target}" is not a measure of ${game}`);
    for (const s of scorers) {
      let after: ScoreReport<unknown>;
      try { after = await check<ScoreReport<unknown>>(`score ${s}`, (await cmd('score'))(wt.dir, s)); } catch (e) { if (e instanceof Discard) throw e; reasons.push(`score ${s} failed: ${msg(e)}`); continue; }
      res.scoresAfter[s] = after;
      const g = compareScores(before[s] ?? null, after, hasTarget(s) ? { mode: 'score', target } : { mode: 'polish' });
      reasons.push(...g.reasons.map((r) => `${s}: ${r}`));
    }
    if (reasons.length) discard(...reasons);
    let sc: ScreensResult;
    try { sc = await check<ScreensResult>('screens', (await cmd('screens'))(wt.dir, game)); } catch (e) { if (e instanceof Discard) throw e; return discard(`screens ${game} failed: ${msg(e)}`); }
    if (!sc.reached) reasons.push(`screens ${game}: did not reach gameplay`);
    reasons.push(...(sc.errors ?? []).map((e) => `screens ${game}: ${e}`), ...(sc.blockedRequests ?? []).map((u) => `screens ${game}: blocked request ${u}`));
    if (reasons.length) discard(...reasons);
    let all: ControlCheck[];
    try { all = await check<ControlCheck[]>('controls', (await cmd('controls'))(wt.dir, game)); } catch (e) { if (e instanceof Discard) throw e; return discard(`controls ${game} failed: ${msg(e)}`); }
    const checks = (Array.isArray(all) ? all : []).filter((c) => c.game === game);
    if (checks.length === 0) discard(`controls ${game}: no controls checks ran`);
    reasons.push(...checks.filter((c) => !c.ok && !c.skipped).map((c) => `controls ${game} ${c.check}: ${c.detail}`));
    if (reasons.length) discard(...reasons);

    // 7. History shots. The after shot is the last check; then the before shot is copied in, and the bytes committed
    // (read back from T3) are the ones validated. Nothing else may have changed.
    // Both shots show the level or sector the change touched (focus.ts): main's and the candidate's game data are
    // fingerprinted (each in its own isolated check) and the first one that differs is shot in both trees. No
    // difference, or a fingerprint that fails, keeps the default shot (gameplay at the start). Tampering still discards.
    let focus: { i: number; label: string } | null = null;
    const fingerprint = async (dir: string, writable: string[]) => {
      const nonce = newNonce();
      const r = await inTree(dir, (await cmd('fingerprint'))(dir, game), writable, nonce);
      if (r.code !== 0) throw new Error(r.timedOut ? 'timed out' : `exit ${r.code}`);
      return asFingerprint(parseResult(r.stdout, nonce));
    };
    try {
      const fb = await fingerprint(ctx.mainDir, [shotDir]);
      await guard(t2);
      const fa = await fingerprint(wt.dir, [wt.dir]);
      const i = fb && fa ? firstChanged(fb, fa) : null;
      if (i !== null) focus = { i, label: fa![i]!.label };
    } catch (e) { if (e instanceof Discard) throw e; focus = null; }
    if (focus) {
      await shoot(ctx.mainDir, beforeTmp, [shotDir], 'before', focus.i); // replaces the default before shot
      checkJpeg(await readFile(beforeTmp).catch(() => null), 'before');
      res.shotsOf = redact(focus.label);
    }
    await guard(t2);
    const hist = `docs/hal/history/${game}/${night}`;
    const shots = { before: `${hist}/${ctx.pass}-before.jpg`, after: `${hist}/${ctx.pass}-after.jpg` };
    await mkdir(join(wt.dir, hist), { recursive: true });
    await shoot(wt.dir, join(wt.dir, shots.after), [wt.dir], 'after', focus?.i);
    await checkTrustRoot();
    const afterTree = await extendTree(wt.dir, t2, [shots.after], tree);
    if ((await snapshotTree(wt.dir, wt.base, tree)) !== afterTree) discard('tampered between checks');
    // The before shot goes from Hal's private file straight into the object store, never through the worktree.
    const t3 = await addFileToTree(wt.dir, afterTree, shots.before, beforeTmp, tree);
    if ((await changedPaths(wt.dir, t2, t3, tree)).join('\n') !== [shots.after, shots.before].sort().join('\n')) discard('history images did not land as the only new paths');
    for (const [label, p] of [['before', shots.before], ['after', shots.after]] as const) checkJpeg(await blobBytes(wt.dir, t3, p).catch(() => null), label);

    // 8. Commit exactly T3 on the base, then squash onto refs/hal/main.
    const primary = scorers.find(hasTarget) ?? scorers[0]!;
    const pick = (r: ScoreReport<unknown> | undefined) => (r ? (target !== undefined && Object.hasOwn(r.measures, target) ? r.measures[target]! : r.fitness) : NaN);
    let trailers: string;
    try {
      trailers = formatTrailers({
        pass: ctx.pass, game, kind: ticket.kind, why: ticket.why, scoreBefore: pick(before[primary]), scoreAfter: pick(res.scoresAfter[primary]),
        version: res.version!, run: ctx.run,
      });
    } catch (e) { return discard(`commit trailers: ${msg(e)}`); }
    const message = `${ticket.kind}(${game}): ${oneLine(ticket.title)}\n\n${oneLine(ticket.why)}\n\n${trailers}`;
    if (secrets.some((k) => message.includes(k))) discard('commit message contains a secret');
    const verifiedCommit = await commitTree(ctx.repo, t3, wt.base, message, { git });
    if (ctx.hold) {
      const held = await holdCandidate(ctx.repo, ctx.pass, message, { commit: verifiedCommit, tree: t3 }, { git });
      if (!held.ok) discard(`hold failed: ${held.error}`);
      res.commit = (held as { commit: string }).commit;
      res.shots = shots;
      return finish('held', []);
    }
    const merged = await squashMerge(ctx.repo, ctx.pass, message, { commit: verifiedCommit, tree: t3 }, { git });
    if (!merged.ok) discard(`squash merge failed: ${merged.error}`);
    res.commit = (merged as { commit: string }).commit;
    res.shots = shots;
    return finish('merged', []);
  } catch (e) {
    return finish('discarded', e instanceof Discard ? e.reasons : [`error: ${msg(e)}`]);
  } finally {
    // 9. Always.
    await removeWorktree(ctx.repo, ctx.pass, { git }); // never throws; also clears a half-made worktree
    await rm(privDir, { recursive: true, force: true }).catch(() => {});
  }
}
