// "Hal asks" end to end through runCandidate, against a real temp repo (same harness as candidate.unit.test.ts): the
// implementer builds the game change and writes hal-asks.patch; Hal validates it, applies it next to the game change,
// runs every check on the combined tree and holds it at refs/hal/held/<pass>. Refusals discard with a clear reason.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASKS_MAX_BYTES, parseTrailers, type ScoreReport, type Ticket } from '@studio/core/hal';
import { runCandidate, type CandidateCtx, type CandidateResult, type CheckCommands } from './candidate.js';
import type { ClaudeCall, ClaudeResult } from './claude.js';
import { ensureMainWorktree, HAL_MAIN, listHeld } from './git.js';

const KEY = 'sk-ant-api03-FAKEKEYFAKEKEYFAKEKEY0123456789';
const gitIn = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const put = (root: string, rel: string, data: string) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), data); };
const report = (game: string, fitness: number, measures: Record<string, number>): ScoreReport<unknown> => ({ game, levels: [], measures, fitness, hardFailures: [] });
const ok = (text: string): ClaudeResult => ({ ok: true, text, costUsd: 0.4, subtype: 'success', limitHit: false, timedOut: false, stderrTail: '' });
const J = (v: unknown) => JSON.stringify(v);
const node = (code: string) => [process.execPath, '-e', code];
const result = (v: unknown, extra = '') => node(`${extra};console.log('HAL-RESULT ' + process.env.HAL_CHECK_NONCE + ' ' + ${J(J(v))})`);
const fakeJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46]), Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, 844 >> 8, 844 & 0xff, 390 >> 8, 390 & 0xff, 0x01, 0x01, 0x11, 0x00]), Buffer.from([0xff, 0xd9])]);
const writeJpeg = (out: string) => `const fs=require('fs'),p=require('path');fs.mkdirSync(p.dirname(${J(out)}),{recursive:true});fs.writeFileSync(${J(out)},Buffer.from(${J(fakeJpeg.toString('hex'))},'hex'))`;

const RUN = 'run-2026-11-16T03-00-00-000Z';
const JUDGE = 'packages/core/test/hal-hyperline-score.test.ts';
const HOOK = '// ---- hal hook (test)\nwindow.__hal = { targets() { return ["cow", "barn"]; } };\n// ---- end hal hook ----';
const GAME = (slug: string, version: string, extra = '') => ({
  [`games/${slug}/game.yaml`]: `slug: ${slug}\ntitle: ${slug}\nversion: ${version}\nageRating: null\n`,
  [`games/${slug}/index.html`]: `<!doctype html>\n<script type="module">\nimport { createStudio } from '../sdk/studio-sdk.js';\nconst studio = createStudio({ game: '${slug}', version: '${version}', endpoint: '' });\n${extra}\n</script>\n`,
  [`games/${slug}/CHANGELOG.md`]: `# ${slug} changelog\n\nNewest first.\n\n## ${version} (2026-11-10)\n- First release.\n`,
  [`games/${slug}/game.js`]: `export const levels = 3;\n`,
});
const patchFor = (path: string, from: string, to: string) =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,3 +1,3 @@\n import x;\n-${from}\n+${to}\n // end\n`;
const ASKS = 'Built.\n{"changelog": "A fourth sector.", "summary": "Added sector 4.", "asks": "hal-hyperline-score.test.ts pins 3 sectors; it should count the game\'s own list"}';
const PLAIN = 'Built.\n{"changelog": "A fourth sector.", "summary": "Added sector 4."}';
const BEFORE = { hyperline: report('hyperline', 60, { flow: 60 }), 'block-barn': report('block-barn', 90, { calm: 100 }) };
const ticket = (over: Partial<Ticket> = {}): Ticket => ({ id: 't1', game: 'hyperline', kind: 'feature', title: 'A fourth sector', why: 'Players finish all three.', ...over });

describe('runCandidate: "Hal asks" (temp git repo)', () => {
  let repo: string, mainDir: string, ran: string[];
  beforeEach(async () => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'hal-asks-cand-')));
    gitIn(repo, 'init', '-q', '-b', 'main');
    for (const [k, v] of [['user.name', 't'], ['user.email', 't@t'], ['commit.gpgsign', 'false'], ['core.hooksPath', join(repo, '.git/hooks')]]) gitIn(repo, 'config', k!, v!);
    put(repo, '.gitignore', 'node_modules/\n.data/\n');
    put(repo, 'package.json', '{"name":"x","type":"module","scripts":{"test":"vitest run games","typecheck":"tsc --version"}}\n');
    put(repo, 'policy.yaml', 'spend: approve\n');
    put(repo, JUDGE, 'import x;\nexpect(sectors).toBe(3);\n// end\n');
    for (const [p, t] of Object.entries({ ...GAME('hyperline', '0.3.1'), ...GAME('block-barn', '0.2.0', HOOK) })) put(repo, p, t);
    gitIn(repo, 'add', '-A');
    gitIn(repo, 'commit', '-q', '-m', 'base');
    mainDir = (await ensureMainWorktree(repo)).dir;
    ran = [];
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  const halHead = () => gitIn(repo, 'rev-parse', HAL_MAIN);
  const passing: CheckCommands = {
    test: (dir) => { ran.push(`test:${readFileSync(join(dir, JUDGE), 'utf8').includes('LEVELS.length') ? 'patched' : 'unpatched'}`); return [node('')]; },
    typecheck: () => [node('')],
    score: (_d, s) => { ran.push(`score:${s}`); return result(BEFORE[s as keyof typeof BEFORE]); },
    screens: (_d, game) => result({ game, shots: [], errors: [], reached: true, notes: [], blockedRequests: [] }),
    controls: (_d, game) => result([{ game, check: 'tap', ok: true, detail: '' }]),
    shoot: (_d, _g, out) => result({ ok: true }, writeJpeg(out)),
    fingerprint: () => result([{ key: 'same', label: 'level 1' }]),
  };
  const sectors = (cwd: string) => put(cwd, 'games/hyperline/game.js', 'export const levels = 4;\n');
  function ctx(edit: (cwd: string) => void, reply = ASKS, over: Partial<CandidateCtx> & { cmds?: Partial<CheckCommands> } = {}): CandidateCtx {
    const { cmds, ...rest } = over;
    return {
      repo, pass: 'HAL-1', run: RUN, now: () => new Date('2026-11-16T03:00:00Z'), tzOffsetMinutes: 0, model: 'm', billing: 'api', secrets: [KEY],
      budget: { slice: vi.fn(() => 3), record: vi.fn() },
      claude: async (call: ClaudeCall) => { edit(call.cwd); return { first: ok(reply) }; },
      mainDir, baseline: { sha: halHead(), scores: BEFORE }, commands: { ...passing, ...(cmds ?? {}) }, unsandboxedForTests: true,
      countTests: async () => ({ before: 3, after: 3 }),
      ...rest,
    };
  }
  const discarded = (r: CandidateResult, re: RegExp, old: string) => {
    expect(r.verdict).toBe('discarded');
    expect(r.reasons.join('\n')).toMatch(re);
    expect(r.reasons.join('\n')).not.toContain(KEY);
    expect(halHead()).toBe(old);
    expect(gitIn(repo, 'for-each-ref', 'refs/hal/held/')).toBe('');
    expect(existsSync(join(repo, '.data/hal/wt/HAL-1'))).toBe(false);
  };

  it('holds game change + patch together (a tuning ticket too), checked on the combined tree; refs/hal/main never moves', async () => {
    const old = halHead();
    const r = await runCandidate(ticket({ kind: 'tuning' }), ctx((cwd) => {
      sectors(cwd);
      put(cwd, 'hal-asks.patch', patchFor(JUDGE, 'expect(sectors).toBe(3);', 'expect(sectors).toBe(LEVELS.length);'));
    }));
    expect(r.reasons).toEqual([]);
    expect(r.verdict).toBe('held');
    expect(halHead()).toBe(old);
    expect(ran).toContain('test:patched'); // the checks saw the judge change
    expect(r.asks).toMatchObject({ why: expect.stringContaining('pins 3 sectors'), paths: [JUDGE], gameFiles: ['games/hyperline/game.js'] });
    expect(r.asks!.diff).toContain(`+++ b/${JUDGE}`);
    expect(r.asks!.diff).toContain('+expect(sectors).toBe(LEVELS.length);');
    const held = await listHeld(repo);
    expect(held.map((h) => h.pass)).toEqual(['HAL-1']);
    expect(held[0]!.asks).toContain('pins 3 sectors');
    const at = (p: string) => gitIn(repo, 'show', `refs/hal/held/HAL-1:${p}`);
    expect(at(JUDGE)).toContain('LEVELS.length');
    expect(at('games/hyperline/game.js')).toContain('levels = 4');
    expect(gitIn(repo, 'ls-tree', '-r', '--name-only', 'refs/hal/held/HAL-1')).not.toContain('hal-asks.patch');
    expect(parseTrailers(gitIn(repo, 'log', '-1', '--format=%B', 'refs/hal/held/HAL-1'))?.asks).toContain('pins 3 sectors');
  });

  it('Block Barn: a patch to its own hook block is held; one that edits outside the block is refused', async () => {
    const t = ticket({ game: 'block-barn', title: 'A weathervane' });
    const hb = 'games/block-barn/index.html';
    const vane = (cwd: string) => put(cwd, 'games/block-barn/game.js', 'export const levels = 3;\nexport const vane = true;\n');
    const hookPatch = `diff --git a/${hb} b/${hb}\n--- a/${hb}\n+++ b/${hb}\n@@ -5,3 +5,3 @@\n // ---- hal hook (test)\n-window.__hal = { targets() { return ["cow", "barn"]; } };\n+window.__hal = { targets() { return ["cow", "barn", "vane"]; } };\n // ---- end hal hook ----\n`;
    const r = await runCandidate(t, ctx((cwd) => { vane(cwd); put(cwd, 'hal-asks.patch', hookPatch); }, ASKS));
    expect(r.reasons).toEqual([]);
    expect(r.verdict).toBe('held');
    expect(gitIn(repo, 'show', `refs/hal/held/HAL-1:${hb}`)).toContain('"vane"');
    gitIn(repo, 'update-ref', '-d', 'refs/hal/held/HAL-1');

    const old = halHead();
    const outside = hookPatch.replace(' // ---- hal hook (test)\n', '-const studio = createStudio({ game: \'block-barn\', version: \'0.2.0\', endpoint: \'\' });\n+const studio = null;\n // ---- hal hook (test)\n').replace('@@ -5,3 +5,3 @@', '@@ -4,4 +4,4 @@');
    const r2 = await runCandidate(t, ctx((cwd) => { vane(cwd); put(cwd, 'hal-asks.patch', outside); }, ASKS));
    discarded(r2, /asks refused: games\/block-barn\/index\.html: the patch changes it outside its hal hook block/, old);
  });

  it('refuses a patch that also edits policy.yaml, naming it; nothing is held', async () => {
    const old = halHead();
    const r = await runCandidate(ticket(), ctx((cwd) => {
      sectors(cwd);
      put(cwd, 'hal-asks.patch', patchFor(JUDGE, 'expect(sectors).toBe(3);', 'expect(sectors).toBe(4);') + 'diff --git a/policy.yaml b/policy.yaml\n--- a/policy.yaml\n+++ b/policy.yaml\n@@ -1 +1 @@\n-spend: approve\n+spend: auto\n');
    }));
    discarded(r, /asks refused: policy\.yaml: protected but not a judge file.*refused/, old);
  });

  it('refuses an oversized patch, a symlinked patch file, a patch without asks and asks without a patch', async () => {
    const old = halHead();
    const big = patchFor(JUDGE, 'expect(sectors).toBe(3);', `expect(sectors).toBe(4); // ${'x'.repeat(ASKS_MAX_BYTES)}`);
    discarded(await runCandidate(ticket(), ctx((cwd) => { sectors(cwd); put(cwd, 'hal-asks.patch', big); })), /asks refused: patch is \d+ bytes; the cap is 32768/, old);
    discarded(await runCandidate(ticket(), ctx((cwd) => { sectors(cwd); symlinkSync(join(repo, 'policy.yaml'), join(cwd, 'hal-asks.patch')); })), /asks refused: hal-asks\.patch is not a regular file/, old);
    expect(readFileSync(join(repo, 'policy.yaml'), 'utf8')).toBe('spend: approve\n'); // the link was removed, not its target
    discarded(await runCandidate(ticket(), ctx((cwd) => { sectors(cwd); put(cwd, 'hal-asks.patch', patchFor(JUDGE, 'expect(sectors).toBe(3);', 'x')); }, PLAIN)), /hal-asks\.patch was written, but the reply has no "asks"/, old);
    discarded(await runCandidate(ticket(), ctx(sectors, ASKS)), /asks refused: the reply asks for a protected change but there is no hal-asks\.patch/, old);
  });

  it('refuses a patch that does not apply, one to a guard rail, and one with a secret (never echoed)', async () => {
    const old = halHead();
    discarded(await runCandidate(ticket(), ctx((cwd) => { sectors(cwd); put(cwd, 'hal-asks.patch', patchFor(JUDGE, 'no such line', 'x')); })), /asks refused: patch does not apply/, old);
    discarded(await runCandidate(ticket(), ctx((cwd) => { sectors(cwd); put(cwd, 'hal-asks.patch', patchFor('packages/core/src/hal/gate.ts', 'a', 'b')); })), /asks refused: packages\/core\/src\/hal\/gate\.ts: Hal's own guard rails/, old);
    discarded(await runCandidate(ticket(), ctx((cwd) => { sectors(cwd); put(cwd, 'hal-asks.patch', patchFor(JUDGE, 'expect(sectors).toBe(3);', `const k = '${KEY}';`)); })), /asks refused: patch contains a secret value/, old);
  });

  it('the tripwire on the game part stays: a protected file edited in the worktree discards even with a valid request', async () => {
    const old = halHead();
    const r = await runCandidate(ticket(), ctx((cwd) => {
      sectors(cwd);
      put(cwd, JUDGE, 'import x;\nexpect(sectors).toBe(4);\n// end\n');
      put(cwd, 'hal-asks.patch', patchFor(JUDGE, 'expect(sectors).toBe(3);', 'expect(sectors).toBe(LEVELS.length);'));
    }));
    discarded(r, /tripwire protected-path: packages\/core\/test\/hal-hyperline-score\.test\.ts/, old);
  });

  it('content rules still judge the patch\'s files on the combined tree (a payment line in a hook block)', async () => {
    const old = halHead();
    const hb = 'games/block-barn/index.html';
    const pay = `diff --git a/${hb} b/${hb}\n--- a/${hb}\n+++ b/${hb}\n@@ -5,3 +5,3 @@\n // ---- hal hook (test)\n-window.__hal = { targets() { return ["cow", "barn"]; } };\n+window.__hal = { targets() { mockBuy(); return ["cow", "barn"]; } };\n // ---- end hal hook ----\n`;
    const r = await runCandidate(ticket({ game: 'block-barn' }), ctx((cwd) => { put(cwd, 'games/block-barn/game.js', 'export const levels = 3;\nexport const vane = 1;\n'); put(cwd, 'hal-asks.patch', pay); }));
    discarded(r, /tripwire payment: games\/block-barn\/index\.html.*\(game change \+ asks patch\)/, old);
  });

  it('failing checks on the combined tree discard as today; a fix round that still asks keeps the first patch', async () => {
    const old = halHead();
    const failing = await runCandidate(ticket(), ctx((cwd) => { sectors(cwd); put(cwd, 'hal-asks.patch', patchFor(JUDGE, 'expect(sectors).toBe(3);', 'expect(sectors).toBe(9);')); }, ASKS, {
      fixRounds: 0, cmds: { test: () => [node('console.error("FAIL hal-hyperline-score.test.ts: expected 9"); process.exit(1)')] },
    }));
    discarded(failing, /npm test failed:[\s\S]*expected 9/, old);

    let n = 0;
    const r = await runCandidate(ticket(), ctx((cwd) => {
      n++;
      // A fix round starts from the implementer's own tree: the patch's file is back as it was.
      if (n === 2) expect(readFileSync(join(cwd, JUDGE), 'utf8')).toContain('toBe(3)');
      put(cwd, 'games/hyperline/game.js', n === 1 ? 'export const levels = 4;\n' : 'export const levels = 4; // fixed\n');
      if (n === 1) put(cwd, 'hal-asks.patch', patchFor(JUDGE, 'expect(sectors).toBe(3);', 'expect(sectors).toBe(LEVELS.length);'));
    }, ASKS, { cmds: { test: () => [node(`const s=require('fs').readFileSync('games/hyperline/game.js','utf8'); if(!s.includes('fixed')||!require('fs').readFileSync(${J(JUDGE)},'utf8').includes('LEVELS.length')) process.exit(1)`)] } }));
    expect(r.reasons).toEqual([]);
    expect(r.verdict).toBe('held');
    expect(r.fixRounds).toBe(1);
    expect(gitIn(repo, 'show', `refs/hal/held/HAL-1:${JUDGE}`)).toContain('LEVELS.length');
  });
});
