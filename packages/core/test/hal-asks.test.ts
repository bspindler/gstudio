// "Hal asks" (plan 2026-11-15 part B): what a protected-change request may touch. This is the boundary between Hal and
// its judge, so every refusal has a test: non-judge protected paths, Hal's own guard rails, oversized patches, deletes,
// renames, mode changes, symlinks, binaries, hook edits outside the block, and secrets.
import { describe, expect, it } from 'vitest';
import {
  ASKS_FILE, ASKS_MAX_BYTES, ASKS_MAX_FILES, asksPathRefusal, checkAsksChanges, checkAsksPatchText, checkTripwires, hookOnlyChange,
  type AsksChange, type Diff, type FileChange,
} from '../src/hal/index.js';

const KEY = 'sk-ant-api03-FAKEKEYFAKEKEYFAKEKEY0123456789';
/** A one-hunk git patch that changes line `a` to `b` in `path`. */
const patchFor = (path: string, from = 'a', to = 'b') =>
  `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1,3 +1,3 @@\n x\n-${from}\n+${to}\n y\n`;
const newFile = (path: string, mode = '100644') =>
  `diff --git a/${path} b/${path}\nnew file mode ${mode}\nindex 0000000..2222222\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+hello\n`;

describe('asks: the scratch file and caps', () => {
  it('names the patch file and caps its size and file count', () => {
    expect(ASKS_FILE).toBe('hal-asks.patch');
    expect(ASKS_MAX_BYTES).toBe(32 * 1024);
    expect(ASKS_MAX_FILES).toBe(8);
  });
});

describe('asksPathRefusal: only judge files', () => {
  it.each([
    'scripts/hal/hyperline-play.ts', 'scripts/hal/screens.ts', 'scripts/hal/__snapshots__/x.snap',
    'packages/core/src/hal/hyperline-score.ts', 'packages/core/src/hal/new-scorer.ts',
    'packages/core/test/hal-gearhold-play-score.test.ts', 'packages/core/test/hal-new.test.ts',
  ])('allows the judge file %s', (p) => {
    expect(asksPathRefusal(p, 'hyperline')).toBeNull();
  });

  it('allows a hook block file only for the ticket\'s own game', () => {
    expect(asksPathRefusal('games/block-barn/index.html', 'block-barn')).toBeNull();
    expect(asksPathRefusal('games/gearhold/index.html', 'gearhold')).toBeNull();
    expect(asksPathRefusal('games/lanternkeep/index.html', 'lanternkeep')).toBeNull();
    expect(asksPathRefusal('games/gearhold/index.html', 'block-barn')).toMatch(/not a judge file/);
    expect(asksPathRefusal('games/hyperline/index.html', 'hyperline')).toMatch(/not a judge file/); // no hook block there
  });

  it.each([
    'policy.yaml', 'markets.yaml', 'CLAUDE.md', 'claude.md', '.hal.env', '.data/hal/ledger.json', 'infra/main.bicep', '.github/workflows/ci.yml',
    'packages/sdk/vendor/three.module.js', 'scripts/vendor/three-entry.js', 'scripts/build-three.ts', 'package.json', 'package-lock.json',
    'packages/core/src/gateway/index.ts', 'packages/core/src/policy/loader.ts', 'packages/core/test/games-compliance.test.ts', 'packages/core/test/compliance.test.ts',
    'games/block-barn/audio/moo.ogg', 'games/block-barn/recorder.js', 'games/block-barn/SOURCES.md', 'games/block-barn/fonts/sources.md',
    'tsconfig.json', 'scripts/tsconfig.json', 'vitest.config.ts', '.gitattributes', 'docs/superpowers/plans/x.md', 'scripts/hal.ts',
    'games/gearhold/levels.d.ts', 'packages/core/test/hal-x/nested.test.ts',
  ])('refuses the non-judge protected path %s outright', (p) => {
    expect(asksPathRefusal(p, 'block-barn')).toMatch(/refused|not a judge file/);
  });

  it.each([
    'scripts/hal/vitest.config.ts', 'scripts/hal/tsconfig.json', 'scripts/hal/.gitattributes', 'packages/core/src/hal/policy-thing.ts', 'packages/core/src/hal/compliance.ts',
  ])('refuses config and policy-shaped files even inside a judge folder: %s', (p) => {
    expect(asksPathRefusal(p, 'hyperline')).toMatch(/refused/);
  });

  it.each([
    'packages/core/src/hal/tripwires.ts', 'packages/core/src/hal/gate.ts', 'packages/core/src/hal/asks.ts', 'packages/core/src/hal/budget.ts',
    'scripts/hal/candidate.ts', 'scripts/hal/claude.ts', 'scripts/hal/sandbox.ts', 'scripts/hal/git.ts', 'scripts/hal/git-read.ts', 'scripts/hal/env.ts',
    'scripts/hal/score-broker.ts', 'scripts/hal/check-nonce.ts', 'scripts/hal/check-entry.ts', 'scripts/hal/run.ts', 'scripts/hal/cli-ops.ts', 'scripts/hal/server.ts',
    'scripts/hal/prompts/implementer.md', 'scripts/hal/prompts/planner.md', 'scripts/hal/Candidate.ts', 'packages/core/src/hal/Gate.ts',
  ])('refuses Hal\'s own guard rails: %s', (p) => {
    expect(asksPathRefusal(p, 'hyperline')).toMatch(/refused/);
  });

  it('refuses game code (it belongs in the game change), other folders and bad paths', () => {
    expect(asksPathRefusal('games/hyperline/game.js', 'hyperline')).toMatch(/not a judge file/);
    expect(asksPathRefusal('packages/core/src/registry/x.ts', 'hyperline')).toMatch(/not a judge file/);
    expect(asksPathRefusal('packages/core/test/hyperline-x.test.ts', 'hyperline')).toMatch(/not a judge file/);
    for (const p of ['scripts/hal/../../policy.yaml', '/etc/passwd', 'scripts\\hal\\x.ts', 'scripts/hal/.git/config', 'scripts/hal/a\0b.ts', 'scripts/hal/a\nb.ts', '', 'Scripts/hal/x.ts', './scripts/hal/x.ts']) {
      expect(asksPathRefusal(p, 'hyperline'), p).not.toBeNull();
    }
  });
});

describe('checkAsksPatchText: the raw patch, before git sees it', () => {
  const ok = (p: string, game = 'hyperline') => checkAsksPatchText(p, { game });

  it('accepts a plain judge-file patch and a new judge test file', () => {
    expect(ok(patchFor('packages/core/test/hal-hyperline-score.test.ts'))).toEqual([]);
    expect(ok(newFile('packages/core/test/hal-hyperline-more.test.ts'))).toEqual([]);
    expect(ok(patchFor('scripts/hal/screens.ts') + patchFor('packages/core/src/hal/hyperline-score.ts'))).toEqual([]);
  });

  it('refuses an empty patch, one with no file header, and an oversized one', () => {
    expect(ok('')).toEqual([expect.stringMatching(/empty/)]);
    expect(ok('just some text\n')).toEqual([expect.stringMatching(/no file/)]);
    const big = patchFor('scripts/hal/screens.ts', 'a', 'b'.repeat(ASKS_MAX_BYTES));
    expect(ok(big).join('\n')).toMatch(/bytes; the cap is 32768/);
  });

  it('refuses more files than the cap', () => {
    const many = Array.from({ length: ASKS_MAX_FILES + 1 }, (_, i) => patchFor(`scripts/hal/f${i}.ts`)).join('');
    expect(ok(many).join('\n')).toMatch(/9 files; the cap is 8/);
  });

  it('refuses a patch that also edits policy.yaml, naming it', () => {
    const r = ok(patchFor('packages/core/test/hal-hyperline-score.test.ts') + patchFor('policy.yaml'));
    expect(r.join('\n')).toMatch(/policy\.yaml/);
    expect(r.join('\n')).toMatch(/refused/);
  });

  it('refuses deletes, renames, copies, mode changes, symlinks, submodules and binaries', () => {
    const p = 'scripts/hal/screens.ts';
    const del = `diff --git a/${p} b/${p}\ndeleted file mode 100644\nindex 1111111..0000000\n--- a/${p}\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n`;
    expect(ok(del).join('\n')).toMatch(/delet/);
    expect(ok(`diff --git a/${p} b/scripts/hal/other.ts\nsimilarity index 90%\nrename from ${p}\nrename to scripts/hal/other.ts\n`).join('\n')).toMatch(/rename|copy|differ/);
    expect(ok(`diff --git a/${p} b/${p}\nold mode 100644\nnew mode 100755\n`).join('\n')).toMatch(/mode/);
    expect(ok(newFile('scripts/hal/link.ts', '120000')).join('\n')).toMatch(/mode/);
    expect(ok(newFile('scripts/hal/sub', '160000')).join('\n')).toMatch(/mode/);
    expect(ok(`diff --git a/${p} b/${p}\nindex 1111111..2222222 100644\nGIT binary patch\nliteral 3\nKcmZ?\n`).join('\n')).toMatch(/binary/);
    expect(ok(`diff --git a/${p} b/${p}\nindex 1111111..2222222 120000\n--- a/${p}\n+++ b/${p}\n@@ -1 +1 @@\n-a\n+b\n`).join('\n')).toMatch(/mode/);
  });

  it('refuses path tricks in headers: .., absolute, quoted, a/b mismatch, .git, a header outside a file section', () => {
    expect(ok(patchFor('scripts/hal/../../policy.yaml')).length).toBeGreaterThan(0);
    expect(ok('diff --git a//etc/x b//etc/x\n--- a//etc/x\n+++ b//etc/x\n@@ -1 +1 @@\n-a\n+b\n').length).toBeGreaterThan(0);
    expect(ok('diff --git "a/scripts/hal/x\\ty.ts" "b/scripts/hal/x\\ty.ts"\n--- "a/scripts/hal/x\\ty.ts"\n+++ "b/scripts/hal/x\\ty.ts"\n@@ -1 +1 @@\n-a\n+b\n').join('\n')).toMatch(/quoted/);
    expect(ok('diff --git a/scripts/hal/x.ts b/scripts/hal/x.ts\n--- a/scripts/hal/x.ts\n+++ b/policy.yaml\n@@ -1 +1 @@\n-a\n+b\n').join('\n')).toMatch(/policy\.yaml/);
    expect(ok(patchFor('scripts/hal/.git/config')).length).toBeGreaterThan(0);
    // A bare ---/+++ patch (no diff --git) would be applied by git too: refuse it so the parse and git agree.
    expect(ok('--- a/policy.yaml\n+++ b/policy.yaml\n@@ -1 +1 @@\n-a\n+b\n').join('\n')).toMatch(/outside a diff --git section|no file/);
  });

  it('a removed line that starts with "-- " inside a hunk is content, not a header', () => {
    const p = 'packages/core/test/hal-hyperline-score.test.ts';
    expect(ok(`diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -1,2 +1,2 @@\n x\n--- not a header\n+++ also content\n`)).toEqual([]);
  });

  it('refuses a secret without echoing it, and a NUL byte', () => {
    const r = checkAsksPatchText(patchFor('scripts/hal/screens.ts', 'a', `const k = '${KEY}';`), { game: 'hyperline' });
    expect(r.join('\n')).toMatch(/secret/);
    expect(r.join('\n')).not.toContain(KEY);
    const lit = checkAsksPatchText(patchFor('scripts/hal/screens.ts', 'a', 'value-abcdef'), { game: 'hyperline', secrets: ['value-abcdef'] });
    expect(lit.join('\n')).toMatch(/secret/);
    expect(ok(patchFor('scripts/hal/screens.ts', 'a', 'x\0y')).join('\n')).toMatch(/NUL/);
  });
});

describe('checkAsksChanges: what the patch did to the tree (authoritative)', () => {
  const hook = '// ---- hal hook\nwindow.__hal = { targets() { return ["cow"]; } };\n// ---- end hal hook ----';
  const html = (body: string, h = hook) => `<script>\n${body}\n${h}\n</script>\n`;
  const M = (path: string, before: string, after: string, over: Partial<AsksChange> = {}): AsksChange => ({ path, status: 'M', oldMode: '100644', newMode: '100644', before, after, ...over });

  it('accepts a judge-file change and a hook-block-only change for its own game', () => {
    expect(checkAsksChanges([M('scripts/hal/screens.ts', 'a', 'b')], 'block-barn')).toEqual([]);
    expect(checkAsksChanges([M('games/block-barn/index.html', html('game()'), html('game()', hook.replace('"cow"', '"cow", "vane"')))], 'block-barn')).toEqual([]);
    expect(checkAsksChanges([{ path: 'packages/core/test/hal-x.test.ts', status: 'A', oldMode: '000000', newMode: '100644', before: null, after: 'x' }], 'block-barn')).toEqual([]);
  });

  it('refuses an empty change set and more files than the cap', () => {
    expect(checkAsksChanges([], 'x').join('\n')).toMatch(/changes nothing/);
    const many = Array.from({ length: ASKS_MAX_FILES + 1 }, (_, i) => M(`scripts/hal/f${i}.ts`, 'a', 'b'));
    expect(checkAsksChanges(many, 'x').join('\n')).toMatch(/cap is 8/);
  });

  it('refuses a hook file change outside the block, or one that breaks the markers', () => {
    const p = 'games/block-barn/index.html';
    expect(checkAsksChanges([M(p, html('game()'), html('cheat()'))], 'block-barn').join('\n')).toMatch(/outside its hal hook block/);
    expect(checkAsksChanges([M(p, html('game()'), html('game()', hook.replace('// ---- end hal hook ----', '')))], 'block-barn').join('\n')).toMatch(/hal hook block/);
    expect(checkAsksChanges([M(p, html('game()'), html('game()', `${hook}\n${hook}`))], 'block-barn').join('\n')).toMatch(/hal hook block/);
  });

  it('refuses deletes, mode changes, symlinks and gitlinks', () => {
    expect(checkAsksChanges([{ ...M('scripts/hal/a.ts', 'a', ''), status: 'D', after: null, newMode: '000000' }], 'x').join('\n')).toMatch(/delet/);
    expect(checkAsksChanges([M('scripts/hal/a.ts', 'a', 'b', { newMode: '100755' })], 'x').join('\n')).toMatch(/mode/);
    expect(checkAsksChanges([{ path: 'scripts/hal/l', status: 'A', oldMode: '000000', newMode: '120000', before: null, after: '/etc/passwd' }], 'x').join('\n')).toMatch(/mode 120000/);
    expect(checkAsksChanges([{ path: 'scripts/hal/s', status: 'A', oldMode: '000000', newMode: '160000', before: null, after: null }], 'x').join('\n')).toMatch(/mode 160000/);
  });

  it('refuses a non-judge path even if it slipped past the text check', () => {
    expect(checkAsksChanges([M('policy.yaml', 'a', 'b')], 'x').join('\n')).toMatch(/policy\.yaml.*refused/);
    expect(checkAsksChanges([M('packages/core/src/hal/gate.ts', 'a', 'b')], 'x').join('\n')).toMatch(/refused/);
  });
});

describe('hookOnlyChange', () => {
  const hook = '// ---- hal hook\nx\n// ---- end hal hook ----';
  it('is true only when everything outside one intact block is byte for byte the same', () => {
    expect(hookOnlyChange(`a\n${hook}\nb`, `a\n${hook.replace('x', 'y')}\nb`)).toBe(true);
    expect(hookOnlyChange(`a\n${hook}\nb`, `a!\n${hook}\nb`)).toBe(false);
    expect(hookOnlyChange(`a\n${hook}\nb`, 'a\nb')).toBe(false);
    expect(hookOnlyChange(null, `a\n${hook}`)).toBe(false);
  });
});

describe('checkTripwires with an asks exemption', () => {
  const M = (path: string, before: string, after: string): FileChange => ({ path, status: 'M', before, after, binary: false });
  const diff = (files: FileChange[]): Diff => ({ files, testCountBefore: 10, testCountAfter: 10, levelCounts: { before: {}, after: {} } });
  const scope = { game: 'block-barn', testPrefixes: ['block-barn-'] };
  const hook = '// ---- hal hook\nwindow.__hal = { targets() { return ["cow"]; } };\n// ---- end hal hook ----';
  const html = (h = hook) => `<script>\ngame();\n${h}\n</script>\n`;

  it('exempts the patch\'s files from protected-path and the scope check only', () => {
    const d = diff([M('packages/core/test/hal-block-barn-score.test.ts', 'a\n', 'b\n')]);
    expect(checkTripwires(d, [], { scope }).map((v) => v.rule).sort()).toEqual(['outside-scope', 'protected-path']);
    expect(checkTripwires(d, [], { scope, asks: { paths: ['packages/core/test/hal-block-barn-score.test.ts'] } })).toEqual([]);
  });

  it('never exempts a path that is not in the patch', () => {
    const d = diff([M('packages/core/test/hal-block-barn-score.test.ts', 'a\n', 'b\n'), M('policy.yaml', 'a\n', 'b\n')]);
    const hits = checkTripwires(d, [], { scope, asks: { paths: ['packages/core/test/hal-block-barn-score.test.ts'] } });
    expect(hits.map((v) => `${v.rule} ${v.path}`).sort()).toEqual(['outside-scope policy.yaml', 'protected-path policy.yaml']);
  });

  it('never exempts the patch\'s files from secret or content rules', () => {
    const p = 'packages/core/test/hal-block-barn-score.test.ts';
    const hits = checkTripwires(diff([M(p, 'a\n', `const k = '${KEY}';\n`)]), [], { scope, asks: { paths: [p] } });
    expect(hits.map((v) => v.rule)).toEqual(['secret']);
    const hb = 'games/block-barn/index.html';
    const payment = checkTripwires(diff([M(hb, html(), html(hook.replace('["cow"]', '["cow"]; mockBuy()')))]), [], { scope, asks: { paths: [hb] } });
    expect(payment.map((v) => v.rule)).toContain('payment');
  });

  it('lets the patch change the hook block, but the markers must stay intact and outside-block statements are still judged', () => {
    const hb = 'games/block-barn/index.html';
    const changed = html(hook.replace('"cow"', '"cow", "vane"'));
    expect(checkTripwires(diff([M(hb, html(), changed)]), [], { scope }).map((v) => v.rule)).toEqual(['hal-hook']);
    expect(checkTripwires(diff([M(hb, html(), changed)]), [], { scope, asks: { paths: [hb] } })).toEqual([]);
    expect(checkTripwires(diff([M(hb, html(), '<script>game();</script>')]), [], { scope, asks: { paths: [hb] } }).map((v) => v.rule)).toEqual(['hal-hook']);
    const outside = changed.replace('game();', 'game(); window.__hal.x = 1;');
    expect(checkTripwires(diff([M(hb, html(), outside)]), [], { scope, asks: { paths: [hb] } }).map((v) => v.rule)).toContain('hal-hook');
  });
});
