// One Hal candidate, end to end: implementer Claude edits a fresh worktree, then Hal's own code runs every check and,
// only if all pass, squash-merges into Hal's worktree of main. Claude never runs a check itself and cannot skip one:
// each step below runs in Hal's process, in this order, and any failure discards. The worktree is always removed.
//
//   1. budget slice (0 -> skipped: budget)        5. npm test, npm run typecheck
//   2. implementer claude -p (fail/timeout/       6. scores + gate, screens, controls
//      blocked/unparsable/no edits -> discard)    7. before/after history shots
//   3. collectDiff + checkTripwires (Claude's     8. commit on hal/<pass>, squashMerge into main
//      edits only; any violation -> discard)      9. remove the worktree and branch (finally)
//   4. applyRelease (Hal's version + changelog)
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyRelease, bumpedTonight, checkTripwires, compareScores, formatTrailers, nightOf, planVersion, topEntry, TRIPWIRE_RULES,
  type Billing, type Diff, type FileChange, type ScoreReport, type Ticket,
} from '@studio/core/hal';
import { roleAllowedTools, type ClaudeCall, type ClaudeResult } from './claude.js';
import type { ControlCheck } from './controls.js';
import { collectDiff, newCandidateWorktree, removeWorktree, runGit, squashMerge, type CollectDeps, type GitRunner, type SquashResult } from './git.js';
import { loadPrompt, parseImplementerOutput, renderPrompt } from './prompts.js';
import type { ScreensResult } from './screens.js';

export const IMPLEMENTER_TIMEOUT_MS = 20 * 60_000;
const TAIL_CHARS = 1500;

export type CheckRun = { ok: boolean; output: string };
/** Writes one JPEG (quality 70, 390x844, device scale 1) of `game` as served from `worktreeDir` to `outPath`. */
export type ShootFn = (worktreeDir: string, game: string, outPath: string) => Promise<void>;
/** The run's budget, owned by Task 7 under the run lock. `slice` is dollars this role may spend now (0 = stop). */
export type CandidateBudget = {
  slice(role: 'implementer'): number;
  /** Every Claude call is recorded, a fallback retry included. `usd` null = unknown (booked as the full slice). */
  record(role: 'implementer', billing: Billing, usd: number | null): void;
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
  /** Real secret values (the API key from .hal.env), kept out of every diff, reason and result (ruling R8). */
  secrets: string[];
  budget: CandidateBudget;
  /** runClaudeWithFallback bound to its deps: `(call, apiSlice) => runClaudeWithFallback(call, deps, apiSlice)`. */
  claude: (call: ClaudeCall, apiSliceUsd: number) => Promise<{ first: ClaudeResult; retry?: ClaudeResult }>;
  /** Hal's main worktree (ensureMainWorktree), at main: the before shot is taken here. */
  mainDir: string;
  /** main's scores, keyed by scorer name (scorersFor(game)); Task 7 scores main once per run. */
  scoresBefore: Record<string, ScoreReport<unknown>>;
  /** Scores the tree at `dir` with one scorer. A throw is a discard. */
  score: (dir: string, scorer: string) => Promise<ScoreReport<unknown>>;
  /** `npm test` / `npm run typecheck` in `dir`. Must run with an env that holds no secret. A throw is a discard. */
  runTests: (dir: string) => Promise<CheckRun>;
  typecheck: (dir: string) => Promise<CheckRun>;
  /** Screens and real-input controls for the tree at `dir`; only `game`'s results are judged. */
  screens: (dir: string, game: string) => Promise<ScreensResult>;
  controls: (dir: string, game: string) => Promise<ControlCheck[]>;
  shoot: ShootFn;
  git?: GitRunner;
  /** Test counter for collectDiff (default vitestCounts). */
  countTests?: CollectDeps['countTests'];
  /** Seam for tests; default squashMerge. */
  squash?: (repo: string, passId: string, message: string) => Promise<SquashResult>;
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
  /** The squash commit on main. */
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

class Discard extends Error {
  constructor(readonly reasons: string[]) { super(reasons.join('; ')); }
}
const discard = (...reasons: string[]): never => { throw new Discard(reasons); };
const msg = (e: unknown) => String((e as Error)?.message ?? e).trim();
const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, ' ').trim();
const GAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Runs one ticket through the whole pipeline. Never throws: every failure is a `discarded` result. */
export async function runCandidate(ticket: Ticket, ctx: CandidateCtx): Promise<CandidateResult> {
  const git = ctx.git ?? runGit;
  const secrets = ctx.secrets.filter((s) => s.length > 0);
  const redact = (s: string) => secrets.reduce((t, k) => t.split(k).join('[REDACTED]'), s);
  const tail = (s: string) => { const r = redact(s); return r.length > TAIL_CHARS ? `...${r.slice(-TAIL_CHARS)}` : r; };
  const res: CandidateResult = { pass: ctx.pass, ticket, verdict: 'discarded', reasons: [], scoresBefore: ctx.scoresBefore, scoresAfter: {}, costUsd: 0 };
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

  let shotTmp: string | undefined;
  try {
    const wt = await newCandidateWorktree(ctx.repo, ctx.pass, { git });
    const night = nightOf(ctx.now(), ctx.tzOffsetMinutes ?? -ctx.now().getTimezoneOffset());

    // Before shot: main as it is, before anything is built.
    shotTmp = await mkdtemp(join(tmpdir(), 'hal-shot-'));
    const beforeTmp = join(shotTmp, 'before.jpg');
    try { await ctx.shoot(ctx.mainDir, game, beforeTmp); } catch (e) { discard(`before shot failed: ${msg(e)}`); }

    // 2. Implementer. The ticket is data: rendered into the template, never anything from the env.
    const ticketData: Record<string, string> = { id: ticket.id, game, kind: ticket.kind, title: ticket.title, why: ticket.why };
    for (const k of ['target', 'liability', 'fromNote'] as const) if (ticket[k] !== undefined) ticketData[k] = ticket[k]!;
    const prompt = renderPrompt(loadPrompt('implementer'), { game, ticket: JSON.stringify(ticketData, null, 2) });
    const call: ClaudeCall = {
      role: 'implementer', prompt, cwd: wt.dir, billing: ctx.billing, maxBudgetUsd: slice, model: ctx.model,
      allowedTools: roleAllowedTools('implementer'), disallowedTools: [], timeoutMs: ctx.implementerTimeoutMs ?? IMPLEMENTER_TIMEOUT_MS,
      ...(ctx.appendSystemPromptFile ? { appendSystemPromptFile: ctx.appendSystemPromptFile } : {}),
    };
    const book = (billing: Billing, r: ClaudeResult) => {
      ctx.budget.record('implementer', billing, r.costUsd);
      res.costUsd += r.costUsd ?? (billing === 'api' ? slice : 0);
    };
    const out = await ctx.claude(call, slice);
    book(call.billing, out.first);
    if (out.retry) book('api', out.retry);
    res.costUsd = Math.round(res.costUsd * 1e6) / 1e6;
    const final = out.retry ?? out.first;
    if (!final.ok) discard(final.timedOut ? 'implementer timed out' : final.limitHit ? 'implementer hit a usage limit' : `implementer failed (${final.subtype})`);
    const parsed = parseImplementerOutput(final.text);
    if (!parsed) discard('implementer output does not match the contract');
    if (parsed!.blocked !== undefined) discard(`implementer blocked: ${parsed!.blocked}`);
    res.changelog = parsed!.changelog;
    res.summary = parsed!.summary;
    const dirty = (await git(['status', '--porcelain', '--untracked-files=all'], wt.dir)).trim() !== '';
    const committed = (await git(['rev-parse', 'HEAD'], wt.dir)).trim() !== wt.base;
    if (!dirty && !committed) discard('no edits');

    // 3. Tripwires over Claude's edits only (fail closed: a collectDiff throw is a discard).
    const snapshot = async () => { await git(['add', '-A'], wt.dir); return (await git(['write-tree'], wt.dir)).trim(); };
    const checkedTree = await snapshot();
    let diff: Diff;
    try { diff = await collectDiff(wt.dir, wt.base, { git, ...(ctx.countTests ? { countTests: ctx.countTests } : {}) }); } catch (e) { return discard(`diff collection failed: ${msg(e)}`); }
    if (diff.files.length === 0) discard('no edits');
    const hits = checkTripwires(diff, secrets);
    if (hits.length) discard(...hits.map((v) => `tripwire ${v.rule}${v.path ? `: ${v.path}` : ''}: ${v.detail}`));
    if ((await snapshot()) !== checkedTree) discard('worktree changed while the tripwires ran');

    // 4. Release: Hal's own version bump and changelog entry, from tonight's state of main.
    const rel = (f: string) => `games/${game}/${f}`;
    const files = { yaml: rel('game.yaml'), html: rel('index.html'), changelog: rel('CHANGELOG.md') };
    const cur = { yaml: '', html: '', changelog: '' };
    let next: typeof cur;
    try {
      for (const k of ['yaml', 'html', 'changelog'] as const) cur[k] = await readFile(join(wt.dir, files[k]), 'utf8');
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
    const releasedTree = await snapshot();

    // 5. Tests and typecheck.
    for (const [name, run] of [['npm test', ctx.runTests], ['npm run typecheck', ctx.typecheck]] as const) {
      let r: CheckRun;
      try { r = await run(wt.dir); } catch (e) { return discard(`${name} failed to run: ${msg(e)}`); }
      if (!r.ok) discard(`${name} failed:\n${tail(r.output)}`);
    }

    // 6. Scores and gate, then screens and controls.
    const scorers = scorersFor(game);
    const reasons: string[] = [];
    const target = ticket.target;
    if (target !== undefined && !scorers.some((s) => ctx.scoresBefore[s] && Object.hasOwn(ctx.scoresBefore[s]!.measures, target))) {
      reasons.push(`target measure "${target}" is not a measure of ${game}`);
    }
    for (const s of scorers) {
      let after: ScoreReport<unknown>;
      try { after = await ctx.score(wt.dir, s); } catch (e) { reasons.push(`score ${s} failed: ${msg(e)}`); continue; }
      res.scoresAfter[s] = after;
      const before = ctx.scoresBefore[s] ?? null;
      const scoreMode = target !== undefined && before !== null && Object.hasOwn(before.measures, target);
      const g = compareScores(before, after, scoreMode ? { mode: 'score', target } : { mode: 'polish' });
      reasons.push(...g.reasons.map((r) => `${s}: ${r}`));
    }
    if (reasons.length) discard(...reasons);
    const sc = await ctx.screens(wt.dir, game);
    if (!sc.reached) reasons.push(`screens ${game}: did not reach gameplay`);
    reasons.push(...sc.errors.map((e) => `screens ${game}: ${e}`), ...sc.blockedRequests.map((u) => `screens ${game}: blocked request ${u}`));
    if (reasons.length) discard(...reasons);
    const checks = (await ctx.controls(wt.dir, game)).filter((c) => c.game === game);
    if (checks.length === 0) discard(`controls ${game}: no controls checks ran`);
    reasons.push(...checks.filter((c) => !c.ok && !c.skipped).map((c) => `controls ${game} ${c.check}: ${c.detail}`));
    if (reasons.length) discard(...reasons);
    // Tests and the game code they ran are Claude's: nothing they did to the tree may reach main.
    if ((await snapshot()) !== releasedTree) discard('worktree changed while the checks ran');

    // 7. History shots, committed with the change.
    const hist = `docs/hal/history/${game}/${night}`;
    const shots = { before: `${hist}/${ctx.pass}-before.jpg`, after: `${hist}/${ctx.pass}-after.jpg` };
    await mkdir(join(wt.dir, hist), { recursive: true });
    await copyFile(beforeTmp, join(wt.dir, shots.before));
    try { await ctx.shoot(wt.dir, game, join(wt.dir, shots.after)); } catch (e) { discard(`after shot failed: ${msg(e)}`); }
    for (const p of [shots.before, shots.after]) if (!((await stat(join(wt.dir, p)).catch(() => null))?.size)) discard(`history shot missing or empty: ${p}`);

    // 8. Commit on the candidate branch (only the verified index plus the two images), then squash into main.
    const primary = (target !== undefined ? scorers.find((s) => ctx.scoresBefore[s] && Object.hasOwn(ctx.scoresBefore[s]!.measures, target)) : undefined) ?? scorers[0]!;
    const pick = (r: ScoreReport<unknown> | undefined) => (r ? (target !== undefined && Object.hasOwn(r.measures, target) ? r.measures[target]! : r.fitness) : NaN);
    let trailers: string;
    try {
      trailers = formatTrailers({
        pass: ctx.pass, game, kind: ticket.kind, why: ticket.why, scoreBefore: pick(ctx.scoresBefore[primary]), scoreAfter: pick(res.scoresAfter[primary]),
        version: res.version!, run: ctx.run,
      });
    } catch (e) { return discard(`commit trailers: ${msg(e)}`); }
    const message = `${ticket.kind}(${game}): ${oneLine(ticket.title)}\n\n${oneLine(ticket.why)}\n\n${trailers}`;
    if (secrets.some((k) => message.includes(k))) discard('commit message contains a secret');
    await git(['add', '--', shots.before, shots.after], wt.dir);
    await git(['commit', '--quiet', '--no-verify', '--cleanup=whitespace', '-m', message], wt.dir);
    const added = (await git(['diff', '--name-only', releasedTree, 'HEAD'], wt.dir)).trim().split('\n').filter(Boolean).sort();
    if (added.join('\n') !== [shots.after, shots.before].sort().join('\n')) discard('candidate commit differs from the checked tree');
    const merged = await (ctx.squash ?? ((r, p, m) => squashMerge(r, p, m, { git })))(ctx.repo, ctx.pass, message);
    if (!merged.ok) discard(`squash merge failed: ${merged.error}`);
    res.commit = (merged as { commit: string }).commit;
    res.shots = shots;
    return finish('merged', []);
  } catch (e) {
    return finish('discarded', e instanceof Discard ? e.reasons : [`error: ${msg(e)}`]);
  } finally {
    // 9. Always.
    await removeWorktree(ctx.repo, ctx.pass, { git }); // never throws; also clears a half-made worktree
    if (shotTmp) await rm(shotTmp, { recursive: true, force: true }).catch(() => {});
  }
}

const SECRET_ENV = /^(?:ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|HAL_TOKEN)$/;
/** `base` without Claude credentials, Hal's token, or any variable whose value contains a secret. */
export function checkEnv(base: NodeJS.ProcessEnv, secrets: string[]): NodeJS.ProcessEnv {
  const keys = secrets.filter((s) => s.length > 0);
  return Object.fromEntries(Object.entries(base).filter(([k, v]) => !SECRET_ENV.test(k) && !(v !== undefined && keys.some((s) => v.includes(s)))));
}

/**
 * A real CheckRun for ctx.runTests / ctx.typecheck: `npm <args>` in `dir` with a secret-free env (the tests run Claude's
 * code), combined stdout+stderr, killed after `timeoutMs`. Never rejects: a spawn error or timeout is `ok: false`.
 */
export function runNpmCheck(dir: string, args: string[], o: { env?: NodeJS.ProcessEnv; secrets?: string[]; timeoutMs?: number; cmd?: string } = {}): Promise<CheckRun> {
  return new Promise((resolve) => {
    execFile(o.cmd ?? 'npm', args, { cwd: dir, env: { ...checkEnv(o.env ?? process.env, o.secrets ?? []), CI: '1' }, timeout: o.timeoutMs ?? 15 * 60_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const output = `${stdout ?? ''}${stderr ? `\n${stderr}` : ''}`;
        if (!err) return resolve({ ok: true, output });
        const why = (err as { killed?: boolean }).killed ? `timed out after ${o.timeoutMs ?? 15 * 60_000} ms` : err.message.split('\n')[0];
        resolve({ ok: false, output: `${output}\n${why}` });
      });
  });
}
