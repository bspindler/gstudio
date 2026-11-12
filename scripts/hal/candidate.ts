// One Hal candidate, end to end: implementer Claude edits a fresh worktree, then Hal's own code runs every check and,
// only if all pass, squash-merges onto refs/hal/main. Claude never runs a check itself and cannot skip one: each step
// below runs in Hal's process, in this order, and any failure discards. The worktree is always removed.
//
//   1. budget slice (0 -> skipped: budget)        5. npm test, npm run typecheck              } sandboxed child
//   2. implementer claude -p (fail/timeout/       6. scores + gate, screens, controls         } processes (R13)
//      blocked/unparsable/no edits -> discard)    7. before/after history shots (JPEG, checked)
//   3. tree from disk (private index, no          8. commit-tree of the verified tree, squashMerge onto refs/hal/main
//      filters) + checkTripwires on it            9. remove the worktree and branch (finally)
//   4. applyRelease (Hal's version + changelog), added to that tree and verified as the only extra paths
//
// What gets committed is a tree object built by Hal, never the worktree's index: T1 (Claude's edits, as hashed from
// disk) is what the tripwires judge, T2 = T1 + the three release files, T3 = T2 + the two history images. The disk is
// pruned to exactly T1 before any check runs, and must still hash to T2 after the checks.
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyRelease, bumpedTonight, checkTripwires, compareScores, formatTrailers, nightOf, planVersion, topEntry, TRIPWIRE_RULES,
  type Billing, type Diff, type FileChange, type ScoreReport, type Ticket,
} from '@studio/core/hal';
import { roleAllowedTools, type ClaudeCall, type ClaudeResult } from './claude.js';
import type { ControlCheck } from './controls.js';
import {
  blobText, changedPaths, collectTreeDiff, commitTree, extendTree, newCandidateWorktree, removeWorktree, runGit, snapshotTree, squashMerge, vitestCounts,
  type CollectDeps, type GitRunner,
} from './git.js';
import { loadPrompt, parseImplementerOutput, renderPrompt } from './prompts.js';
import { runIsolated, sandboxAvailable, sandboxEnv, type IsolatedResult, type SandboxPolicy } from './sandbox.js';
import type { ScreensResult } from './screens.js';

export const IMPLEMENTER_TIMEOUT_MS = 20 * 60_000;
export const CHECK_TIMEOUT_MS = 20 * 60_000;
export const RESULT_PREFIX = 'HAL-RESULT ';
const TAIL_CHARS = 1500;

/** The run's budget, owned by Task 7 under the run lock. `slice` is dollars this role may spend now (0 = stop). */
export type CandidateBudget = {
  slice(role: 'implementer'): number;
  /** Every Claude call is recorded, a fallback retry included. `usd` null = unknown (booked as the full slice). */
  record(role: 'implementer', billing: Billing, usd: number | null): void;
};

/**
 * The argv of each check, run with cwd = the tree being checked (a candidate worktree, or Hal's main worktree for the
 * before shot), always as an isolated child (sandboxed unless `unsandboxedForTests`). score/screens/controls/shoot print
 * `HAL-RESULT <json>` as their last line (scripts/hal/check-entry.ts); test/typecheck pass on exit 0.
 */
export type CheckCommands = {
  test: (dir: string) => string[];
  typecheck: (dir: string) => string[];
  score: (dir: string, scorer: string) => string[];
  screens: (dir: string, game: string) => string[];
  controls: (dir: string, game: string) => string[];
  shoot: (dir: string, game: string, outPath: string) => string[];
};
const entry = (dir: string) => [process.execPath, join(dir, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(dir, 'scripts', 'hal', 'check-entry.ts')];
export const DEFAULT_COMMANDS: CheckCommands = {
  test: () => ['npm', 'test'],
  typecheck: () => ['npm', 'run', 'typecheck'],
  score: (dir, scorer) => [...entry(dir), 'score', scorer],
  screens: (dir, game) => [...entry(dir), 'screens', game],
  controls: (dir, game) => [...entry(dir), 'controls', game],
  shoot: (dir, game, out) => [...entry(dir), 'shoot', game, out],
};

export type CandidateCtx = {
  /** The repo root holding .data/hal (Brian's checkout; never written to). */
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
  appendSystemPromptFile?: string;
  /** Real secret values (the API key from .hal.env), kept out of every diff, env, reason and result (ruling R8). */
  secrets: string[];
  budget: CandidateBudget;
  /** runClaudeWithFallback bound to its deps: `(call, apiSlice) => runClaudeWithFallback(call, deps, apiSlice)`. */
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
  verdict: 'merged' | 'discarded' | 'skipped';
  reasons: string[];
  scoresBefore: Record<string, ScoreReport<unknown>>;
  scoresAfter: Record<string, ScoreReport<unknown>>;
  /** Dollars spent on Claude by this pass (unknown API costs count as the whole slice). */
  costUsd: number;
  /** The squash commit on refs/hal/main. */
  commit?: string;
  /** Repo-relative paths of the history images in the commit. */
  shots?: { before: string; after: string };
  /** The game's version after this pass (set once the release step ran). */
  version?: string;
  /** The changelog bullet the implementer wrote. */
  changelog?: string;
  /** The implementer's one-line summary. */
  summary?: string;
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

class Discard extends Error {
  constructor(readonly reasons: string[]) { super(reasons.join('; ')); }
}
const discard = (...reasons: string[]): never => { throw new Discard(reasons); };
const msg = (e: unknown) => String((e as Error)?.message ?? e).trim();
const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, ' ').trim();
const GAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The JSON after the last `HAL-RESULT ` line, or throws. */
function parseResult<T>(r: IsolatedResult): T {
  const line = r.stdout.split('\n').reverse().find((l) => l.startsWith(RESULT_PREFIX));
  if (!line) throw new Error('no result printed');
  return JSON.parse(line.slice(RESULT_PREFIX.length)) as T;
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

  // Every piece of candidate code runs through here: isolated child, scrubbed env, sandboxed, group killed afterwards.
  const commands: CheckCommands = { ...DEFAULT_COMMANDS, ...(ctx.commands ?? {}) };
  const env = sandboxEnv(process.env, secrets);
  const denyRead = [join(ctx.repo, '.hal.env')];
  const isolated = (argv: string[], cwd: string, writable: string[]) => {
    const policy: SandboxPolicy = { writable: [...writable, tmpdir()], denyRead };
    return runIsolated(argv, { cwd, env, timeoutMs: ctx.checkTimeoutMs ?? CHECK_TIMEOUT_MS, ...(unsandboxed ? { unsandboxed: true } : { policy }) });
  };
  const countTests: NonNullable<CollectDeps['countTests']> = unsandboxed && ctx.countTests ? ctx.countTests : (wtDir, base) => vitestCounts(wtDir, base, async (dir) => {
    const r = await isolated(['npx', 'vitest', 'list', '--json'], dir, [dir]);
    if (r.code !== 0) throw new Error(`vitest list failed (${r.timedOut ? 'timed out' : `exit ${r.code}`}): ${tail(r.stderr || r.stdout)}`);
    return r.stdout;
  });

  const shotDir = join(ctx.repo, '.data', 'hal', 'tmp', ctx.pass); // not writable by the checks
  try {
    const wt = await newCandidateWorktree(ctx.repo, ctx.pass, { git });
    if (ctx.baseline.sha !== wt.base) discard(`stale baseline: scores are for ${ctx.baseline.sha.slice(0, 12)}, the candidate starts at ${wt.base.slice(0, 12)}`);
    const night = nightOf(ctx.now(), ctx.tzOffsetMinutes ?? -ctx.now().getTimezoneOffset());
    const baseTree = (await git(['rev-parse', `${wt.base}^{tree}`], ctx.repo)).trim();

    /** Runs a shot command and checks the file is a 390x844 JPEG. */
    const shoot = async (dir: string, outPath: string, writable: string[], label: string) => {
      const r = await isolated(commands.shoot(dir, game, outPath), dir, writable);
      try { if (r.code !== 0) throw new Error(r.timedOut ? 'timed out' : `exit ${r.code}: ${tail(r.stderr || r.stdout)}`); parseResult(r); } catch (e) { discard(`${label} shot failed: ${msg(e)}`); }
      let size: ReturnType<typeof jpegSize> = null;
      try { size = jpegSize(await readFile(outPath)); } catch { /* missing */ }
      if (!size) discard(`${label} shot is not a JPEG`);
      if (size!.width !== HISTORY_SIZE.width || size!.height !== HISTORY_SIZE.height) discard(`${label} shot is ${size!.width}x${size!.height}, not ${HISTORY_SIZE.width}x${HISTORY_SIZE.height}`);
    };

    // Before shot: main as it is, before anything is built.
    await rm(shotDir, { recursive: true, force: true });
    await mkdir(shotDir, { recursive: true });
    const beforeTmp = join(shotDir, 'before.jpg');
    await shoot(ctx.mainDir, beforeTmp, [shotDir], 'before');

    // 2. Implementer. The ticket is data: rendered into the template, never anything from the env.
    const ticketData: Record<string, string> = { id: ticket.id, game, kind: ticket.kind, title: ticket.title, why: ticket.why };
    for (const k of ['target', 'liability', 'fromNote'] as const) if (ticket[k] !== undefined) ticketData[k] = ticket[k]!;
    const prompt = renderPrompt(loadPrompt('implementer'), { game, ticket: JSON.stringify(ticketData, null, 2) });
    const call: ClaudeCall = {
      role: 'implementer', prompt, cwd: wt.dir, billing: ctx.billing, maxBudgetUsd: slice, model: ctx.model,
      allowedTools: roleAllowedTools('implementer'), disallowedTools: [], timeoutMs: ctx.implementerTimeoutMs ?? IMPLEMENTER_TIMEOUT_MS,
      denyReadPaths: denyRead,
      ...(ctx.appendSystemPromptFile ? { appendSystemPromptFile: ctx.appendSystemPromptFile } : {}),
    };
    const book = (billing: Billing, usd: number | null) => {
      ctx.budget.record('implementer', billing, usd);
      res.costUsd = Math.round((res.costUsd + (usd ?? (billing === 'api' ? slice : 0))) * 1e6) / 1e6;
    };
    let out: Awaited<ReturnType<CandidateCtx['claude']>>;
    try { out = await ctx.claude(call, slice); } catch (e) {
      // We cannot know whether anything was spawned, so book the call as unknown cost (the full slice on the API).
      book(call.billing, null);
      return discard(`implementer call failed: ${msg(e)}`);
    }
    book(call.billing, out.first.costUsd);
    if (out.retry) book('api', out.retry.costUsd);
    const final = out.retry ?? out.first;
    if (!final.ok) discard(final.timedOut ? 'implementer timed out' : final.limitHit ? 'implementer hit a usage limit' : `implementer failed (${final.subtype})`);
    const parsed = parseImplementerOutput(final.text);
    if (!parsed) discard('implementer output does not match the contract');
    if (parsed!.blocked !== undefined) discard(`implementer blocked: ${parsed!.blocked}`);
    res.changelog = parsed!.changelog;
    res.summary = parsed!.summary;

    // 3. The candidate tree from the bytes on disk (index flags and filters cannot hide anything), disk pruned to it.
    const t1 = await snapshotTree(wt.dir, wt.base, { git, prune: true });
    if (t1 === baseTree) discard('no edits');
    let diff: Diff;
    try { diff = await collectTreeDiff(wt.dir, wt.base, t1, { git, countTests }); } catch (e) { return discard(`diff collection failed: ${msg(e)}`); }
    if (diff.files.length === 0) discard('no edits');
    const hits = checkTripwires(diff, secrets);
    if (hits.length) discard(...hits.map((v) => `tripwire ${v.rule}${v.path ? `: ${v.path}` : ''}: ${v.detail}`));
    if ((await snapshotTree(wt.dir, wt.base, { git })) !== t1) discard('worktree changed while the tripwires ran');

    // 4. Release: Hal's own version bump and changelog entry, read from T1 and added to it.
    const rel = (f: string) => `games/${game}/${f}`;
    const files = { yaml: rel('game.yaml'), html: rel('index.html'), changelog: rel('CHANGELOG.md') };
    const cur = { yaml: '', html: '', changelog: '' };
    let next: typeof cur;
    try {
      for (const k of ['yaml', 'html', 'changelog'] as const) cur[k] = await blobText(wt.dir, t1, files[k], { git });
      const current = /^version:[ \t]*(\S+)[ \t]*$/m.exec(cur.yaml)?.[1];
      if (!current) throw new Error('game.yaml has no version');
      const top = topEntry(cur.changelog);
      const version = planVersion({ current, topEntryDate: top?.date ?? null, night, kind: ticket.kind, alreadyBumpedTonight: bumpedTonight(cur.changelog, night) });
      next = applyRelease(cur, { slug: game, version, night, entry: { kind: ticket.kind, text: parsed!.changelog } });
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
    const releasePaths = Object.values(files);
    const t2 = await extendTree(wt.dir, t1, releasePaths, { git });
    const extra = await changedPaths(wt.dir, t1, t2, { git });
    if (!extra.every((p) => releasePaths.includes(p))) discard(`release changed unexpected paths: ${extra.join(', ')}`);

    // 5. Tests and typecheck, isolated.
    for (const [name, argv] of [['npm test', commands.test(wt.dir)], ['npm run typecheck', commands.typecheck(wt.dir)]] as const) {
      const r = await isolated(argv, wt.dir, [wt.dir]);
      if (r.code !== 0) discard(`${name} failed${r.timedOut ? ' (timed out)' : r.error ? ` to run: ${r.error}` : ''}:\n${tail(`${r.stdout}\n${r.stderr}`)}`);
    }

    // 6. Scores and gate, then screens and controls, isolated.
    const check = async <T>(label: string, argv: string[]): Promise<T> => {
      const r = await isolated(argv, wt.dir, [wt.dir]);
      if (r.code !== 0) throw new Error(`${r.timedOut ? 'timed out' : r.error ?? `exit ${r.code}`}: ${tail(r.stderr || r.stdout)}`);
      try { return parseResult<T>(r); } catch (e) { throw new Error(`${label}: ${msg(e)}`); }
    };
    const scorers = scorersFor(game);
    const before = ctx.baseline.scores;
    const reasons: string[] = [];
    const target = ticket.target;
    const hasTarget = (s: string) => target !== undefined && before[s] !== undefined && Object.hasOwn(before[s]!.measures, target);
    if (target !== undefined && !scorers.some(hasTarget)) reasons.push(`target measure "${target}" is not a measure of ${game}`);
    for (const s of scorers) {
      let after: ScoreReport<unknown>;
      try { after = await check<ScoreReport<unknown>>(`score ${s}`, commands.score(wt.dir, s)); } catch (e) { reasons.push(`score ${s} failed: ${msg(e)}`); continue; }
      res.scoresAfter[s] = after;
      const g = compareScores(before[s] ?? null, after, hasTarget(s) ? { mode: 'score', target } : { mode: 'polish' });
      reasons.push(...g.reasons.map((r) => `${s}: ${r}`));
    }
    if (reasons.length) discard(...reasons);
    let sc: ScreensResult;
    try { sc = await check<ScreensResult>('screens', commands.screens(wt.dir, game)); } catch (e) { return discard(`screens ${game} failed: ${msg(e)}`); }
    if (!sc.reached) reasons.push(`screens ${game}: did not reach gameplay`);
    reasons.push(...(sc.errors ?? []).map((e) => `screens ${game}: ${e}`), ...(sc.blockedRequests ?? []).map((u) => `screens ${game}: blocked request ${u}`));
    if (reasons.length) discard(...reasons);
    let all: ControlCheck[];
    try { all = await check<ControlCheck[]>('controls', commands.controls(wt.dir, game)); } catch (e) { return discard(`controls ${game} failed: ${msg(e)}`); }
    const checks = (Array.isArray(all) ? all : []).filter((c) => c.game === game);
    if (checks.length === 0) discard(`controls ${game}: no controls checks ran`);
    reasons.push(...checks.filter((c) => !c.ok && !c.skipped).map((c) => `controls ${game} ${c.check}: ${c.detail}`));
    if (reasons.length) discard(...reasons);
    // The checks ran Claude's code: nothing they did to the tree may reach main.
    if ((await snapshotTree(wt.dir, wt.base, { git })) !== t2) discard('worktree changed while the checks ran');

    // 7. History shots, added to the tree.
    const hist = `docs/hal/history/${game}/${night}`;
    const shots = { before: `${hist}/${ctx.pass}-before.jpg`, after: `${hist}/${ctx.pass}-after.jpg` };
    await mkdir(join(wt.dir, hist), { recursive: true });
    await copyFile(beforeTmp, join(wt.dir, shots.before));
    await shoot(wt.dir, join(wt.dir, shots.after), [wt.dir], 'after');
    const t3 = await extendTree(wt.dir, t2, [shots.before, shots.after], { git });
    if ((await changedPaths(wt.dir, t2, t3, { git })).join('\n') !== [shots.after, shots.before].sort().join('\n')) discard('history images did not land as the only new paths');

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
    await rm(shotDir, { recursive: true, force: true }).catch(() => {});
  }
}
