import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  checkTripwires, protectedPath, halHook, network, dependency, payment, randomReward, darkPattern, assetSource, levelRemoved, testsRemoved, outsideScope,
  isProtectedPath, addedLines, secret, hostApi, testPrefixesFor, TRIPWIRE_RULES, type Diff, type FileChange,
} from '../src/hal/tripwires.js';

const M = (path: string, before: string, after: string): FileChange => ({ path, status: 'M', before, after, binary: false });
const A = (path: string, after: string): FileChange => ({ path, status: 'A', before: null, after, binary: false });
const D = (path: string, before: string): FileChange => ({ path, status: 'D', before, after: null, binary: false });
const BIN = (path: string): FileChange => ({ path, status: 'A', before: null, after: null, binary: true });
const diff = (files: FileChange[], over: Partial<Diff> = {}): Diff => ({ files, testCountBefore: 10, testCountAfter: 10, levelCounts: { before: { g: 3 }, after: { g: 3 } }, ...over });
const rules = (d: Diff) => checkTripwires(d).map((v) => v.rule);

describe('checkTripwires', () => {
  it('passes a clean game edit', () => {
    expect(checkTripwires(diff([M('games/tidepool-pals/board.js', 'let a = 1;\n', 'let a = 2;\n')]))).toEqual([]);
  });
  it('reports every rule that fires', () => {
    expect(rules(diff([M('package.json', '{}', '{"a":1}')]))).toEqual(['protected-path', 'dependency']);
  });
});

describe('addedLines', () => {
  it('counts only lines beyond what the before text had (moved or unchanged lines are not added)', () => {
    expect(addedLines(M('games/x/a.js', 'a\nb\nb\n', 'b\nb\na\nc\n'))).toEqual(['c']);
    expect(addedLines(A('games/x/a.js', 'a\nb'))).toEqual(['a', 'b']);
    expect(addedLines(BIN('games/x/a.png'))).toEqual([]);
  });
});

describe('protected-path', () => {
  it.each([
    'packages/core/src/hal/gate.ts', 'packages/core/src/hal/new.ts', 'packages/core/test/hal-gate.test.ts', 'scripts/hal.ts', 'scripts/hal/git.ts',
    'games/gearhold/levels.d.ts', '.data/hal/ledger.jsonl', '.hal.env', 'policy.yaml', 'markets.yaml', 'infra/main.bicep', '.github/workflows/ci.yml', 'CLAUDE.md',
    'packages/core/src/gateway/index.ts', 'packages/core/src/policy/rules.ts', 'packages/core/src/library/compliance-checks.ts', 'packages/core/src/x/gateway.ts', 'packages/core/src/policy.ts',
    'packages/core/test/compliance.test.ts', 'packages/core/test/games-compliance.test.ts', 'packages/core/test/no-external-fonts.test.ts', 'packages/core/test/game-versions.test.ts',
    'package.json', 'package-lock.json', 'docs/superpowers/plans/x.md',
    'POLICY.yaml', 'claude.md', './CLAUDE.md', 'scripts\\hal\\git.ts',
  ])('blocks %s', (p) => {
    expect(isProtectedPath(p)).toBe(true);
    expect(protectedPath(diff([M(p, 'a', 'b')])).map((v) => v.rule)).toEqual(['protected-path']);
  });
  it.each([
    'games/gearhold/levels.js', 'games/gearhold/index.html', 'packages/core/src/library/index.ts', 'packages/core/src/halo.ts', 'packages/core/test/halo.test.ts',
    'packages/core/test/library.test.ts', 'scripts/halt.ts', 'scripts/site/build.ts', 'docs/hal/history/x.md', 'games/tidepool-pals/CHANGELOG.md', 'infrastructure/x.ts',
  ])('allows %s', (p) => {
    expect(protectedPath(diff([M(p, 'a', 'b')]))).toEqual([]);
  });
  it('checks the old path of a rename and a delete', () => {
    expect(protectedPath(diff([{ path: 'games/x/policy-copy.yaml', oldPath: 'policy.yaml', status: 'R', before: 'a', after: 'a', binary: false }]))).toHaveLength(1);
    expect(protectedPath(diff([D('CLAUDE.md', 'x')]))).toHaveLength(1);
  });
});

describe('hal-hook', () => {
  const hook = '// ---- hal hook (test only)\nwindow.__hal = {};\n// ---- end hal hook ----';
  const html = (mid: string, h = hook) => `<script>\n${mid}\n${h}\n</script>\n`;
  const P = 'games/gearhold/index.html';
  it('flags a changed hook block', () => {
    expect(halHook(diff([M(P, html('a'), html('a', hook.replace('{}', '{x:1}')))])).map((v) => v.rule)).toEqual(['hal-hook']);
  });
  it('flags a removed hook block and a deleted file', () => {
    expect(halHook(diff([M(P, html('a'), '<script>a</script>')]))).toHaveLength(1);
    expect(halHook(diff([D(P, html('a'))]))).toHaveLength(1);
  });
  it('flags one extra byte (whitespace) inside the block', () => {
    expect(halHook(diff([M(P, html('a'), html('a', hook.replace('\nwindow', '\n window')))]))).toHaveLength(1);
  });
  it('near-miss: edits outside the block, or another file, are fine', () => {
    expect(halHook(diff([M(P, html('a'), html('b'))]))).toEqual([]);
    expect(halHook(diff([M('games/hyperline/index.html', hook, 'x')]))).toEqual([]);
  });
});

describe('network', () => {
  it('flags a new host, once per host', () => {
    const d = diff([M('games/g/index.html', 'let a;\n', 'let a;\nconst u = "https://evil.example.com/x"; const v = "https://evil.example.com/y";\n')]);
    expect(network(d)).toEqual([{ rule: 'network', path: 'games/g/index.html', detail: 'new host evil.example.com' }]);
  });
  it('flags protocol-relative hosts and scripts/site files', () => {
    expect(network(diff([A('games/g/a.js', 'x("//cdn.example.com/a.js")\n')]))).toHaveLength(1);
    expect(network(diff([A('scripts/site/a.ts', 'const u = "http://localhost:3000/x";\n')]))).toHaveLength(1);
  });
  it.each(['fetch("a.json")', 'new XMLHttpRequest()', 'new WebSocket(u)', 'new EventSource(u)', 'navigator.sendBeacon(u, d)', 'import("https://x.io/m.js")', 'import(name)'])('flags %s', (code) => {
    expect(network(diff([A('games/g/a.js', `${code}\n`)])).length).toBeGreaterThan(0);
  });
  it('flags external script and link tags, even across lines', () => {
    expect(network(diff([A('games/g/index.html', '<script src="https://cdn.x.com/a.js"></script>\n')])).length).toBeGreaterThan(0);
    expect(network(diff([A('games/g/index.html', '<link rel="stylesheet"\n  href="//f.x.com/a.css">\n')])).length).toBeGreaterThan(0);
    expect(network(diff([A('games/g/index.html', "<script\n src='https://x.com/a.js'></script>\n")])).length).toBeGreaterThan(0);
  });
  it('near-miss: a host already in that file does not trip (an existing host in the same file)', () => {
    const before = '<a href="https://example.org/about">about</a>\n';
    const after = before + '<a href="https://example.org/more">more</a>\n';
    expect(network(diff([M('games/g/index.html', before, after)]))).toEqual([]);
  });
  it('near-miss: the same host in a different file still trips', () => {
    expect(network(diff([M('games/g/b.js', '', 'u = "https://example.org/x"\n')]))).toHaveLength(1);
  });
  it('near-miss: relative refs, local imports, data links, SVG namespace, prose and comments', () => {
    const ok = [
      '<script src="./a.js"></script>', '<script src="lib/a.js"></script>', '<link rel="stylesheet" href="style.css">', '<link rel="icon" href="data:image/png;base64,AAA">',
      'import("./levels.js")', "import('../x.js')", '<svg xmlns="http://www.w3.org/2000/svg"></svg>', '// see //TODO later', 'const p = a // b', 'const x = "a//b";', 'const r = new Request("ok")',
    ].join('\n');
    expect(network(diff([A('games/g/index.html', ok)]))).toEqual([]);
    expect(network(diff([A('games/g/CHANGELOG.md', 'see https://example.com and fetch(x)\n')]))).toEqual([]);
  });
  it('near-miss: existing network code and non-game files are ignored', () => {
    expect(network(diff([M('games/g/a.js', 'fetch(u)\n', 'fetch(u)\nlet z;\n')]))).toEqual([]);
    expect(network(diff([A('packages/core/src/x.ts', 'fetch("https://x.com")\n')]))).toEqual([]);
  });
});

describe('dependency', () => {
  it('flags package manifests at any depth, and a non-relative script src in a game', () => {
    expect(dependency(diff([M('package-lock.json', 'a', 'b')]))).toHaveLength(1);
    expect(dependency(diff([M('packages/core/package.json', 'a', 'b')]))).toHaveLength(1);
    expect(dependency(diff([A('games/g/index.html', '<script src="https://unpkg.com/x"></script>\n')]))).toHaveLength(1);
    expect(dependency(diff([A('games/g/index.html', '<script src="//unpkg.com/x"></script>\n')]))).toHaveLength(1);
  });
  it('near-miss: relative scripts, a non-game html file, and package.json-like names', () => {
    expect(dependency(diff([A('games/g/index.html', '<script src="./a.js"></script><script type="module" src="levels.js"></script>\n')]))).toEqual([]);
    expect(dependency(diff([A('docs/x.html', '<script src="https://unpkg.com/x"></script>\n')]))).toEqual([]);
    expect(dependency(diff([M('games/g/my-package.json.js', 'a', 'b')]))).toEqual([]);
  });
});

describe('payment', () => {
  it.each(['purchase.buy(x)', 'mockBuy()', 'new PaymentRequest(a)', 'Stripe(key)', 'paypal', 'braintree', 'IAP.start()', 'const price = 3', 'label = "$5"', 'label = "€ 5"', '£9'])('flags %s', (code) => {
    expect(payment(diff([M('games/g/a.js', '', `${code}\n`)]))).toHaveLength(1);
  });
  it('near-miss: Hyperline already has a Shop with prices; adding earned-coin shop text does not trip', () => {
    const before = readFileSync(new URL('../../../games/hyperline/index.html', import.meta.url), 'utf8');
    expect(before).toMatch(/price\(/); // the existing file really does carry price code and a Shop
    const after = before.replace('/* shop */', '/* shop */\n.shop-note { color: var(--dim); }') + '\n<p class="fine">Spend your earned coins in the Shop.</p>\n';
    expect(payment(diff([M('games/hyperline/index.html', before, after)]))).toEqual([]);
  });
  it('flags a new price line added to that same Hyperline file', () => {
    const before = readFileSync(new URL('../../../games/hyperline/index.html', import.meta.url), 'utf8');
    expect(payment(diff([M('games/hyperline/index.html', before, before + '\nconst x = price(CATALOG.revive);\n')]))).toHaveLength(1);
  });
  it('near-miss: template placeholders, "prices", and non-game files', () => {
    expect(payment(diff([A('games/g/a.js', 'el.textContent = `${n} coins`; // prices fall\nconst priced = 1;\n')]))).toEqual([]);
    expect(payment(diff([A('packages/core/src/a.ts', 'const price = 3;\n')]))).toEqual([]);
    expect(payment(diff([A('games/g/CHANGELOG.md', 'Removed the price tag.\n')]))).toEqual([]);
  });
});

describe('random-reward', () => {
  it('flags randomness plus reward wording without odds', () => {
    const d = diff([A('games/g/a.js', 'const r = Math.random();\n'), A('games/g/b.js', 'const label = "Open the chest";\n')]);
    expect(randomReward(d)).toEqual([{ rule: 'random-reward', path: 'games/g/a.js', detail: expect.any(String) }]);
    expect(randomReward(diff([A('games/g/a.js', 'const x = rng();\nlootTable.pull(x);\n')]))).toHaveLength(1);
  });
  it('near-miss: with odds shown, or only one half present', () => {
    expect(randomReward(diff([A('games/g/a.js', 'const r = Math.random();\nshow("chest odds: 5%");\n')]))).toEqual([]);
    expect(randomReward(diff([A('games/g/a.js', 'const r = Math.random();\n// jitter the wave\n')]))).toEqual([]);
    expect(randomReward(diff([A('games/g/a.js', 'giveReward(coins);\n')]))).toEqual([]);
  });
  it('near-miss: existing randomness and reward words do not count', () => {
    const before = 'const r = Math.random();\nreward(1);\n';
    expect(randomReward(diff([M('games/g/a.js', before, before + 'let q;\n')]))).toEqual([]);
  });
});

describe('dark-pattern', () => {
  it.each(['Only 3 left!', 'Limited time deal', 'Hurry up', 'Expires in 5:00', 'Last chance', "Don't miss it", 'Are you sure you want to leave?'])('flags copy: %s', (t) => {
    expect(darkPattern(diff([A('games/g/index.html', `<p>${t}</p>\n`)]))).toHaveLength(1);
  });
  it('flags a timer within a few lines of an offer/sale/deal word', () => {
    expect(darkPattern(diff([A('games/g/a.js', 'el.textContent = "Weekend sale!";\nsetInterval(tick, 1000);\n')]))).toEqual([{ rule: 'dark-pattern', path: 'games/g/a.js', detail: 'timer near offer/sale/deal wording' }]);
    // The word may be existing visible text near a newly added timer.
    expect(darkPattern(diff([M('games/g/a.js', 'show(`Special offer`);\nx();\n', 'show(`Special offer`);\nsetTimeout(x, 5);\nx();\n')]))).toHaveLength(1);
    expect(darkPattern(diff([A('games/g/index.html', '<p>Great deal today</p>\n<script>setTimeout(x, 5)</script>\n')]))).toHaveLength(1);
  });
  it('near-miss: a timer far from any offer word, ordinary text, and an existing timer', () => {
    const filler = Array.from({ length: 10 }, (_, i) => `line${i}();`).join('\n');
    expect(darkPattern(diff([A('games/g/a.js', `showOffer();\n${filler}\nsetTimeout(x, 5);\n`)]))).toEqual([]);
    expect(darkPattern(diff([A('games/g/a.js', 'setInterval(tick, 16); // the dealt damage ticks\n')]))).toEqual([]);
    expect(darkPattern(diff([A('games/g/index.html', '<p>Are you sure you want to restart?</p><p>Time left: 5</p>\n')]))).toEqual([]);
    const before = 'sale();\nsetTimeout(x, 5);\n';
    expect(darkPattern(diff([M('games/g/a.js', before, before + 'ok();\n')]))).toEqual([]);
  });
});

describe('asset-source', () => {
  const src = (...rows: string[]) => A('games/g/img/SOURCES.md', `# Sources\n${rows.join('\n')}\n`);
  it('flags an asset with no SOURCES.md in the diff, or not named, or with a bad license', () => {
    expect(assetSource(diff([BIN('games/g/img/a.png')]))).toEqual([{ rule: 'asset-source', path: 'games/g/img/a.png', detail: expect.stringContaining('SOURCES.md') }]);
    expect(assetSource(diff([BIN('games/g/img/a.png'), src('| b.png | hal-generated |')]))[0]!.detail).toContain('not named');
    expect(assetSource(diff([BIN('games/g/img/a.png'), src('| a.png | CC-BY 4.0 |')]))[0]!.detail).toContain('license');
    expect(assetSource(diff([BIN('games/g/img/a.png'), A('games/g/SOURCES.md', 'a.png hal-generated\n')]))).toHaveLength(1); // SOURCES.md in the wrong directory
  });
  it('flags svg and unknown-extension binaries; an svg is an asset too', () => {
    expect(assetSource(diff([A('games/g/img/a.svg', '<svg/>')]))).toHaveLength(1);
    expect(assetSource(diff([BIN('games/g/img/a.dat')]))).toHaveLength(1);
  });
  it('flags an OFL font with no OFL*.txt beside it', () => {
    const d = diff([BIN('games/g/fonts/f.woff2'), A('games/g/fonts/SOURCES.md', '| f.woff2 | OFL 1.1 |\n')]);
    expect(assetSource(d)[0]!.detail).toContain('OFL');
    expect(assetSource({ ...d, repoFiles: ['games/g/OFL-F.txt'] })).toHaveLength(1); // wrong directory
  });
  it('near-miss: every allowed license, named with a path or among others on one row', () => {
    for (const lic of ['hal-generated', 'CC0', 'CC0 1.0', 'public domain', 'Public Domain']) {
      expect(assetSource(diff([BIN('games/g/img/a.png'), src(`| a.png | ${lic} |`)]))).toEqual([]);
    }
    expect(assetSource(diff([BIN('games/g/img/a.png'), BIN('games/g/img/b.png'), src('| a.png, b.png | hal-generated |')]))).toEqual([]);
    expect(assetSource(diff([BIN('games/g/img/a.png'), src('| img/a.png | CC0 |')]))).toEqual([]);
  });
  it('near-miss: an OFL font with its license file in the diff or already in the tree, SOURCES.md updated in place', () => {
    const font = BIN('games/g/fonts/f.woff2');
    const s = M('games/g/fonts/SOURCES.md', '| old.woff2 | OFL 1.1 |\n', '| old.woff2 | OFL 1.1 |\n| f.woff2 | OFL-1.1 |\n');
    expect(assetSource(diff([font, s, A('games/g/fonts/OFL-F.txt', 'license')]))).toEqual([]);
    expect(assetSource({ ...diff([font, s]), repoFiles: ['games/g/fonts/OFL-Old.txt'] })).toEqual([]);
  });
  it('near-miss: name boundaries (xa.png does not vouch for a.png), modified or deleted assets, and non-assets', () => {
    expect(assetSource(diff([BIN('games/g/img/a.png'), src('| xa.png | CC0 |')]))).toHaveLength(1);
    expect(assetSource(diff([D('games/g/img/b.png', '')]))).toEqual([]);
    expect(assetSource(diff([A('games/g/a.js', 'x'), A('games/g/a.html', 'x')]))).toEqual([]);
  });
});

describe('level-removed', () => {
  it('flags a lower count, including a game that vanished', () => {
    expect(levelRemoved(diff([], { levelCounts: { before: { a: 20, b: 5 }, after: { a: 19, b: 5 } } }))).toEqual([{ rule: 'level-removed', detail: 'a: 20 levels before, 19 after' }]);
    expect(levelRemoved(diff([], { levelCounts: { before: { a: 2 }, after: {} } }))).toHaveLength(1);
  });
  it('near-miss: equal, more, or a new game', () => {
    expect(levelRemoved(diff([], { levelCounts: { before: { a: 2 }, after: { a: 3, z: 1 } } }))).toEqual([]);
    expect(levelRemoved(diff([], { levelCounts: { before: { a: 2 }, after: { a: 2 } } }))).toEqual([]);
  });
});

describe('tests-removed', () => {
  it('flags a lower test count, a deleted test file, and a test renamed away', () => {
    expect(testsRemoved(diff([], { testCountBefore: 10, testCountAfter: 9 }))).toHaveLength(1);
    expect(testsRemoved(diff([D('packages/core/test/a.test.ts', 'x')]))).toEqual([{ rule: 'tests-removed', path: 'packages/core/test/a.test.ts', detail: 'test file deleted' }]);
    expect(testsRemoved(diff([{ path: 'scripts/a.ts', oldPath: 'scripts/a.test.ts', status: 'R', before: 'x', after: 'x', binary: false }]))).toHaveLength(1);
  });
  it('near-miss: more tests, a deleted non-test, a renamed test, a modified test', () => {
    expect(testsRemoved(diff([], { testCountBefore: 10, testCountAfter: 12 }))).toEqual([]);
    expect(testsRemoved(diff([D('packages/core/src/a.ts', 'x'), M('a.test.ts', 'a', 'b')]))).toEqual([]);
    expect(testsRemoved(diff([{ path: 'b.test.ts', oldPath: 'a.test.ts', status: 'R', before: 'x', after: 'x', binary: false }]))).toEqual([]);
  });
});

describe('outside-scope', () => {
  it.each(['../x.ts', 'a/../../x.ts', '/etc/passwd', 'C:\\x', '.git/hooks/pre-commit', 'a/.git/config'])('flags path %s', (p) => {
    expect(outsideScope(diff([A(p, 'x')]))).toHaveLength(1);
  });
  it('flags a symlink', () => {
    expect(outsideScope(diff([{ ...A('games/g/link', '/etc/passwd'), symlink: true }]))).toEqual([{ rule: 'outside-scope', path: 'games/g/link', detail: 'symlink' }]);
  });
  it('near-miss: ordinary paths, dots in names, and .github-like names are not scope violations', () => {
    expect(outsideScope(diff([A('games/g/a..b.js', 'x'), A('games/g/.gitkeep', 'x'), A('docs/x.md', 'x')]))).toEqual([]);
  });
  it('a symlink content is never scanned for added lines', () => {
    expect(addedLines({ ...A('games/g/link', 'https://x.com'), symlink: true })).toEqual([]);
  });
});

describe('fix round 1: binary blinding (critical 1) and R7 config protection', () => {
  it.each(['.gitattributes', 'games/g/.gitattributes', 'vitest.workspace.ts', 'vitest.config.ts', 'packages/core/vitest.config.mts', 'scripts/hal/vitest.config.ts', 'tsconfig.base.json', 'scripts/tsconfig.json', 'packages/core/tsconfig.build.json'])('protects %s', (p) => {
    expect(isProtectedPath(p)).toBe(true);
  });
  it('near-miss: similarly named files are not config', () => {
    for (const p of ['games/g/tsconfig.md', 'games/g/vitest-notes.ts', 'games/g/gitattributes.js']) expect(isProtectedPath(p)).toBe(false);
  });
  it('refuses a binary file of an unknown or missing type under games/ outright', () => {
    expect(assetSource(diff([BIN('games/g/blob.dat')]))).toEqual([{ rule: 'asset-source', path: 'games/g/blob.dat', detail: 'binary file of an unknown type under games/' }]);
    expect(assetSource(diff([BIN('games/g/Makefile')]))).toHaveLength(1);
    expect(assetSource(diff([BIN('tools/blob.dat')]))[0]!.detail).toContain('SOURCES.md'); // outside games/: the ordinary sourcing check
  });
  it('a modified binary asset must be listed in SOURCES.md in the same diff', () => {
    const png: FileChange = { ...BIN('games/g/img/a.png'), status: 'M' };
    expect(assetSource(diff([png]))).toHaveLength(1);
    expect(assetSource(diff([png, M('games/g/img/SOURCES.md', '', '| a.png | CC0 |\n')]))).toEqual([]);
  });
  it('hal-hook: null content for the present file never passes (null === null)', () => {
    const P = 'games/gearhold/index.html';
    expect(halHook(diff([{ path: P, status: 'M', before: null, after: null, binary: true }]))).toHaveLength(1);
    expect(halHook(diff([{ path: P, status: 'M', before: '// ---- hal hook\n// ---- end hal hook ----', after: null, binary: true }]))).toHaveLength(1);
  });
});

describe('fix round 1: hal hook tampering from outside the block (important 2)', () => {
  const P = 'games/gearhold/index.html';
  const hook = '// ---- hal hook (test only)\nwindow.__hal = {};\n// ---- end hal hook ----';
  const real = (n: number) => readFileSync(new URL('../../../games/gearhold/index.html', import.meta.url), 'utf8').split('\n').slice(0, n).join('\n');
  const wrap = (mid: string) => `${mid}\n${hook}\n`;
  it('rejects a duplicated block or a second end marker', () => {
    expect(halHook(diff([M(P, wrap('a'), wrap('a') + hook + '\n')])).length).toBeGreaterThan(0);
    expect(halHook(diff([M(P, wrap('a'), wrap('a') + '// ---- end hal hook ----\n')])).length).toBeGreaterThan(0);
  });
  it.each(['window.__hal.step = noop;', 'hal.shots = 0;', 'hal.hits += 5;', 'hal.dmg++;', '--hal.unseen;', 'const hal = {};', 'const HAL = true;', 'if (HAL) go();'])('rejects an added line outside the block: %s', (line) => {
    const v = halHook(diff([M(P, wrap('a'), wrap('a\n' + line))]));
    expect(v.map((x) => x.rule)).toEqual(['hal-hook']);
    expect(v[0]!.detail).toContain('added statement');
  });
  it('rejects a removed counter line, and added __hal in another gearhold file', () => {
    expect(halHook(diff([M(P, wrap('hal.shots++;\nb'), wrap('b'))])).some((x) => x.detail.startsWith('removed'))).toBe(true);
    expect(halHook(diff([A('games/gearhold/extra.js', 'window.__hal = 1;\n')]))).toHaveLength(1);
  });
  it('near-miss: unrelated gearhold edits, words like halt/shal, hal in prose, and the real file unchanged', () => {
    expect(halHook(diff([M(P, wrap('a'), wrap('a\nlet halo = 1; const shalt = 2; hal_ok(); // hal'))]))).toEqual([]);
    expect(halHook(diff([M('games/gearhold/models.js', 'a', 'a\nconst hall = 2;\nhall.x = 3;')]))).toEqual([]);
    expect(halHook(diff([M(P, wrap('x'), wrap('y'))]))).toEqual([]);
    const text = readFileSync(new URL('../../../games/gearhold/index.html', import.meta.url), 'utf8');
    expect(halHook(diff([M(P, text, text)]))).toEqual([]);
    expect(real(5).length).toBeGreaterThan(0);
  });
  it('the real file really contains the patterns this guards (so the rule is testing reality)', () => {
    const text = readFileSync(new URL('../../../games/gearhold/index.html', import.meta.url), 'utf8');
    const edited = text.replace('hal.shots++;', 'hal.shots += 2;');
    expect(halHook(diff([M(P, text, edited)])).length).toBeGreaterThan(0);
  });
});

describe('fix round 1: random-reward evidence and wording (important 3, 4, 5)', () => {
  const R = (...f: FileChange[]) => randomReward(diff(f));
  it('a comment with odds does not count; code is flagged', () => {
    expect(R(A('games/g/a.js', 'const x = Math.random(); // odds shown elsewhere\nopenChest();\n'))).toHaveLength(1);
    expect(R(A('games/g/a.js', '/* odds: 5% */\nconst x = Math.random();\nopenChest();\n'))).toHaveLength(1);
    expect(R(A('games/g/index.html', '<!-- odds -->\n<script>const x = rng(); openChest();</script>\n'))).toHaveLength(1);
  });
  it('accepts the SDK odds calls, oddsLine(), and odds inside a string, template or html text', () => {
    for (const ok of ['studio.odds.roll(T)', 'studio.odds.format(T)', 'oddsLine()', 'label = "Drop odds: 5%"', "t = 'odds'", 'm = `Odds ${n}`']) {
      expect(R(A('games/g/a.js', `const x = Math.random(); openChest();\n${ok}\n`)), ok).toEqual([]);
    }
    expect(R(A('games/g/index.html', '<p>Odds: 5%</p>\n<script>const x = Math.random(); openChest();</script>\n'))).toEqual([]);
  });
  it('odds in another file does not vouch for randomness in this one', () => {
    expect(R(A('games/g/a.js', 'const x = Math.random();\n'), A('games/g/b.js', 'openChest(); label = "odds 5%";\n'))).toEqual([{ rule: 'random-reward', path: 'games/g/a.js', detail: expect.any(String) }]);
  });
  it('Gearhold-style rand( and seeded( count as randomness; "random" in prose does not', () => {
    expect(R(A('games/g/a.js', 'const v = rand(1, 3);\nopenChest();\n'))).toHaveLength(1);
    expect(R(A('games/g/a.js', 'const v = seeded(7);\ngiveLoot();\n'))).toHaveLength(1);
    expect(R(A('games/g/a.js', 'label = "a random hat";\nopenChest();\n'))).toEqual([]);
    expect(R(A('games/g/a.js', 'const operand = 3; brand(x);\nopenChest();\n'))).toEqual([]);
  });
  it('near-miss: ordinary "pull" copy (tide pulls, trigger pulls) beside rng() is not a reward', () => {
    expect(R(M('games/tidepool-pals/levels.js', '', 'const k = rng();\nintro: "The arrow shows where the next tide pulls."\n'))).toEqual([]);
    expect(R(M('games/gearhold/index.html', '', 'const a = rand(1, 2); // hits = trigger pulls that landed\nhits++; pulls++;\n'))).toEqual([]);
  });
  it('gacha-style pulls still count', () => {
    expect(R(A('games/g/a.js', 'const x = rng();\nlabel = "Pull a prize"; // pulls a card\nmsg = "pulls the chest"\n'))).toHaveLength(1);
    expect(R(A('games/g/a.js', 'const x = rng();\nlabel = "gacha"\n'))).toHaveLength(1);
  });
});

describe('fix round 1: dark-pattern timer near-misses (important 6)', () => {
  const D1 = (code: string) => darkPattern(diff([A('games/g/a.js', code)]));
  it.each([
    'dealDamage(e, 2);\nsetTimeout(x, 5);',
    'label = "The shell deals 2 damage";\nsetTimeout(x, 5);',
    'label = "Deals damage to foes";\nsetInterval(x, 5);',
    'offerShell(pal);\nsetTimeout(x, 5);',
    'studio.purchase.offer({});\nsetTimeout(x, 5);',
    "document.querySelector('.offer').hidden = true;\nsetTimeout(x, 5);",
    '<div class="offer hero"></div><script>setTimeout(x,5)</script>',
    '.offer{display:flex}\n.offer .art{width:56px}\nsetTimeout(x, 5);',
    'const ideal = 1; // a great deal\nsetTimeout(x, 5);',
    'label = "dealt damage";\nsetTimeout(x, 5);',
  ])('no hit: %s', (code) => {
    expect(D1(code)).toEqual([]);
  });
  it('still hits sale, offer and deal wording shown to the player', () => {
    for (const t of ['"Big sale"', '"Today only deal"', "'A special offer'", '`Offer ends`']) expect(D1(`label = ${t};\nsetTimeout(x, 5);`), t).toHaveLength(1);
  });
});

describe('fix round 1: tests-removed per file (important 7)', () => {
  const by = (before: Record<string, number>, after: Record<string, number>) => diff([], { testCountsByFile: { before, after } });
  it('flags a base test file with fewer tests, or not collected at all', () => {
    expect(testsRemoved(by({ 'a.test.ts': 5 }, { 'a.test.ts': 4 }))).toEqual([{ rule: 'tests-removed', path: 'a.test.ts', detail: '5 tests before, 4 after' }]);
    expect(testsRemoved(by({ 'a.test.ts': 5 }, {}))[0]!.detail).toContain('no longer collected');
  });
  it('near-miss: same or more tests, new files, a rename, a deleted file reported once, an empty file', () => {
    expect(testsRemoved(by({ 'a.test.ts': 5 }, { 'a.test.ts': 6, 'b.test.ts': 1 }))).toEqual([]);
    expect(testsRemoved(by({ 'a.test.ts': 0 }, {}))).toEqual([]);
    const ren = diff([{ path: 'b.test.ts', oldPath: 'a.test.ts', status: 'R', before: 'x', after: 'x', binary: false }], { testCountsByFile: { before: { 'a.test.ts': 2 }, after: { 'b.test.ts': 2 } } });
    expect(testsRemoved(ren)).toEqual([]);
    const del = diff([D('a.test.ts', 'x')], { testCountsByFile: { before: { 'a.test.ts': 2 }, after: {} } });
    expect(testsRemoved(del)).toHaveLength(1);
  });
});

describe('fix round 1: minor items', () => {
  it('existing hosts are matched as hosts, not substrings', () => {
    expect(network(diff([M('games/g/a.js', 'u = "https://notevil.example.com/"\n', 'u = "https://notevil.example.com/"\nv = "https://evil.example.com/"\n')]))).toHaveLength(1);
    expect(network(diff([M('games/g/a.js', '// see evil.example.com in the docs\n', '// see evil.example.com in the docs\nv = "https://evil.example.com/"\n')]))).toHaveLength(1);
    expect(network(diff([M('games/g/a.js', 'u = "https://EXAMPLE.com/a"\n', 'u = "https://example.com/a"\nv = "https://example.com/b"\n')]))).toEqual([]);
  });
  it('flags a changed AUTHORED definition in Tidepool levels.js', () => {
    const f = (line: string) => M('games/tidepool-pals/levels.js', 'const RAW = [1];\nexport const AUTHORED = RAW.map((d) => d);\n', `const RAW = [1];\n${line}\n`);
    expect(levelRemoved(diff([f('export const AUTHORED = RAW.slice(0, 5).map((d) => d);')]))).toEqual([{ rule: 'level-removed', path: 'games/tidepool-pals/levels.js', detail: 'the line defining AUTHORED changed' }]);
    expect(levelRemoved(diff([f('export const AUTHORED = RAW.filter(Boolean);')]))).toHaveLength(1);
    expect(levelRemoved(diff([f('export const AUTHORED = RAW.map((d) => d);')]))).toEqual([]);
    expect(levelRemoved(diff([M('games/tidepool-pals/levels.js', 'AUTHORED = a;', 'AUTHORED = a;\nlet z;')]))).toEqual([]);
  });
  it('flags large embedded font/image data: URIs, not small ones', () => {
    const big = 'A'.repeat(300);
    expect(assetSource(diff([A('games/g/a.css', `@font-face{src:url(data:font/woff2;base64,${big})}\n`)]))).toHaveLength(1);
    expect(assetSource(diff([A('games/g/a.js', `img.src = "data:image/png;base64,${big}";\n`)]))).toHaveLength(1);
    expect(assetSource(diff([A('games/g/a.js', 'img.src = "data:image/png;base64,AAAA";\n')]))).toEqual([]);
    expect(assetSource(diff([A('games/g/a.js', `x = "data:text/plain;base64,${big}";\n`)]))).toEqual([]);
  });
  it('flags copied library headers under the dependency rule, not ordinary comments', () => {
    for (const h of ['/*! lib v1 */', '/** @license MIT */', '// Copyright 2020 Someone', '(c) 2019 X']) expect(dependency(diff([A('games/g/a.js', `${h}\n`)])), h).toHaveLength(1);
    expect(dependency(diff([A('games/g/a.js', '// the license is irrelevant here\nlet copy = 1; /* note */\n')]))).toEqual([]);
    expect(dependency(diff([A('docs/a.js', '/*! lib */\n')]))).toEqual([]);
  });
});

describe('fix round 2 (R8): secret', () => {
  const key = 'sk-ant-' + 'api03-abcDEF123_xyz'; // split so this file is not itself a hit
  it('flags an API-key shape in any added line, in any file, without echoing it', () => {
    const v = checkTripwires(diff([A('docs/notes.md', `key: ${key}\n`)]));
    expect(v).toEqual([{ rule: 'secret', path: 'docs/notes.md', detail: 'secret value added' }]);
    expect(JSON.stringify(v)).not.toContain('abcDEF');
    expect(secret(diff([A('games/g/a.js', `const k = "${key}";\n`)]))).toHaveLength(1);
  });
  it('flags a caller-supplied literal secret (argument or Diff field), without echoing it', () => {
    const val = 'hunter2-very-secret-value';
    const files = [M('games/g/a.js', 'a\n', `a\nconst t = "${val}";\n`)];
    for (const v of [checkTripwires(diff(files), [val]), checkTripwires(diff(files, { secrets: [val] }))]) {
      expect(v).toEqual([{ rule: 'secret', path: 'games/g/a.js', detail: 'secret value added' }]);
      expect(JSON.stringify(v)).not.toContain('hunter2');
    }
  });
  it('near-miss: "sk-ant" in prose, short suffix, existing lines, no secrets given, tiny secret values', () => {
    expect(secret(diff([A('docs/a.md', 'Keys start with sk-ant and live in .hal.env.\nsk-ant-\nsk-ant-abc\n')]))).toEqual([]);
    expect(secret(diff([M('a.js', `k = "${key}"\n`, `k = "${key}"\nlet z;\n`)]))).toEqual([]);
    expect(secret(diff([A('a.js', 'anything\n')], { secrets: ['abc', ''] }))).toEqual([]);
    expect(secret(diff([D('a.js', key)]))).toEqual([]);
  });
});

describe('fix round 2', () => {
  const R = (...f: FileChange[]) => randomReward(diff(f));
  it('a variable named odds is not evidence (inline script, or a string elsewhere on the line)', () => {
    expect(R(A('games/g/index.html', '<script>\nconst odds = 0.1;\nif (rng() < odds) openChest();\n</script>\n'))).toHaveLength(1);
    expect(R(A('games/g/a.js', "label = 'Open'; const odds = 0.1; if (Math.random() < odds) openChest();\n"))).toHaveLength(1);
    expect(R(A('games/g/a.js', 'const t = `${odds}`; if (Math.random() < odds) openChest();\n'))).toHaveLength(1);
    expect(R(A('games/g/index.html', "<style>.odds{color:red}</style><script>if (rng() < odds) openChest();</script>\n"))).toHaveLength(1);
  });
  it('real evidence still works: html text outside scripts, string in script, SDK call', () => {
    expect(R(A('games/g/index.html', '<script>\nif (rng() < p) openChest();\n</script>\n<p class="fine">Chest odds: 10%</p>\n'))).toEqual([]);
    expect(R(A('games/g/index.html', '<script>\nconst odds = 0.1; if (rng() < odds) openChest(); note = "Odds 10%";\n</script>\n'))).toEqual([]);
  });

  const P = 'games/gearhold/index.html';
  const hook = '// ---- hal hook (test only)\nwindow.__hal = {};\n// ---- end hal hook ----';
  const real = readFileSync(new URL('../../../games/gearhold/index.html', import.meta.url), 'utf8');
  const edit = (a: string, b: string) => { expect(real).toContain(a); return real.replace(a, b); };
  it('ordinary edits to the real hal-touching lines pass; hal statements changing still trips', () => {
    const l667 = 'const eff = Math.min(n, P.hp); hal.dmg += eff;';
    expect(halHook(diff([M(P, real, edit(l667, 'const eff = Math.min(n * 2, P.hp); hal.dmg += eff;'))]))).toEqual([]);
    expect(halHook(diff([M(P, real, edit(l667, '  const eff = Math.min(n, P.hp);\n    hal.dmg += eff;'))]))).toEqual([]); // re-indented and wrapped over lines
    expect(halHook(diff([M(P, real, edit(l667, '{ const eff = Math.min(n, P.hp); hal.dmg += eff; }'))]))).toEqual([]); // wrapped in a block
    expect(halHook(diff([M(P, real, edit('if (HAL) return;', '{ if (HAL) return; }'))]))).toEqual([]);
    expect(halHook(diff([M(P, real, edit('// test hook drives update(); see the hal hook block', '// drives update()'))]))).toEqual([]);
    expect(halHook(diff([M(P, real, edit(l667, 'const eff = Math.min(n, P.hp); hal.dmg += eff * 2;'))])).length).toBeGreaterThan(0);
    expect(halHook(diff([M(P, real, edit(l667, 'const eff = Math.min(n, P.hp);'))])).some((v) => v.detail.startsWith('removed'))).toBe(true);
    expect(halHook(diff([M(P, real, edit('if (HAL && !hal.live)', 'if (!hal.live)'))])).length).toBeGreaterThan(0);
  });
  it('a duplicated hal statement is still an added one (multiset)', () => {
    expect(halHook(diff([M(P, `${hook}\nhal.shots++;\n`, `${hook}\nhal.shots++;\nhal.shots++;\n`)])).length).toBeGreaterThan(0);
    expect(halHook(diff([M(P, `${hook}\nhal.shots++;\nx();\n`, `${hook}\nx();\nhal.shots++;\n`)]))).toEqual([]); // moved
  });

  it('flags a text file hiding behind a NUL byte or UTF-16 BOM', () => {
    expect(outsideScope(diff([{ ...A('games/g/a.js', 'x'), suspectEncoding: true }])).map((v) => v.rule)).toEqual(['outside-scope']);
    expect(outsideScope(diff([A('games/g/a.js', 'x\0y')]))).toHaveLength(1);
    expect(outsideScope(diff([A('games/g/a.js', 'plain')]))).toEqual([]);
    expect(outsideScope(diff([D('games/g/a.js', 'x\0')]))).toEqual([]);
  });

  it('only "deal(s) N damage" is stripped: a timer next to "Deal 50% off" still trips', () => {
    expect(darkPattern(diff([A('games/g/a.js', 'label = "Deal 50% off";\nsetTimeout(x, 5);\n')]))).toHaveLength(1);
    expect(darkPattern(diff([A('games/g/a.js', 'label = "Deals 2 fire damage";\nsetTimeout(x, 5);\n')]))).toEqual([]);
    expect(darkPattern(diff([A('games/g/a.js', 'label = "Deal 5 damage, 3 deals left";\nsetTimeout(x, 5);\n')]))).toHaveLength(1);
  });
});

describe('fix round 3', () => {
  const R = (...f: FileChange[]) => randomReward(diff(f));
  const page = (script: string, extra = '') => `<!doctype html>\n<body>\n${extra}<script>\nconst a = 1;\n${script}\nconst z = 2;\n</script>\n</body>\n`;
  const addIn = (script: string, extra = '') => M('games/g/index.html', page('', ''), page(script, extra));
  it('code added inside an existing script block is code: a variable named odds does not vouch', () => {
    expect(R(addIn('if (n > 0 && odds < 1 && rng() < odds) openChest();'))).toHaveLength(1);
    expect(R(addIn('const cfg = {"odds": 0.1}; if (rng() < cfg.odds) openChest();'))).toHaveLength(1);
    expect(R(addIn("const cfg = {'odds': 0.1}; if (rng() < cfg['odds']) openChest();"))).toHaveLength(1);
    expect(R(addIn('const o = cfg["odds"]; if (rng() < o) openChest();'))).toHaveLength(1);
    expect(R(addIn('if (rng() < p) openChest();', '<div class="odds"></div>\n'))).toHaveLength(1);
    expect(R(addIn('if (rng() < p) openChest();', '<div id="x" title="odds" data-odds="1"></div>\n'))).toHaveLength(1);
  });
  it('real visible odds still pass: string in the script, a text node outside it, a ternary string', () => {
    expect(R(addIn("if (rng() < p) openChest(); note = 'Odds 10%';"))).toEqual([]);
    expect(R(addIn('if (rng() < p) openChest();', '<p>Odds: 1 in 10</p>\n'))).toEqual([]);
    expect(R(addIn("if (rng() < p) openChest(); t = ok ? 'Odds 10%' : 'none';"))).toEqual([]);
    expect(R(A('games/g/a.js', 'if (rng() < p) openChest(); t = "Odds: 1 in 10";\n'))).toEqual([]);
  });
  it('odds text inside a style block or an html comment is not evidence', () => {
    expect(R(addIn('if (rng() < p) openChest();', '<style>\n.odds { color: red }\n</style>\n'))).toHaveLength(1);
    expect(R(addIn('if (rng() < p) openChest();', '<!-- <p>Odds 1</p> -->\n'))).toHaveLength(1);
  });

  it('a hal counter changed with a continuation line still trips (real line 667)', () => {
    const P = 'games/gearhold/index.html';
    const real = readFileSync(new URL('../../../games/gearhold/index.html', import.meta.url), 'utf8');
    const edited = real.replace('hal.dmg += eff;', 'hal.dmg += eff\n    * 0;');
    expect(edited).not.toBe(real);
    expect(halHook(diff([M(P, real, edited)])).length).toBeGreaterThan(0);
    expect(halHook(diff([M(P, real, real.replace('hal.dmg += eff;', 'hal.dmg\n  += eff;'))]))).toEqual([]); // same statement, only whitespace differs
  });
});

describe('host-api (R15: game code is browser code)', () => {
  const hits = (after: string, path = 'games/g/game.js', before = '') => hostApi(diff([before ? M(path, before, after) : A(path, after)])).map((v) => v.detail);
  it('is a registered rule', () => expect(TRIPWIRE_RULES['host-api']).toBe(hostApi));
  it.each([
    ['process.env', 'const k = process.env.KEY;'],
    ['process.stdout', 'process.stdout.write("HAL-RESULT x")'],
    ['require(', "const fs = require('fs');"],
    ['node: import', "import { writeFileSync } from 'node:fs';"],
    ['bare fs import', 'import fs from "fs";'],
    ['bare child_process import', "import { exec } from 'child_process';"],
    ['side-effect import', "import 'node:worker_threads';"],
    ['dynamic import', "const m = await import('node:net');"],
    ['bare path dynamic import', "import(\"path\").then(() => 1);"],
    ['export from', "export { request } from 'http';"],
    ['globalThis.process', 'globalThis.process.exit(0);'],
    ['globalThis["process"]', 'globalThis["process"].exit(0);'],
    ['Deno.', 'Deno.writeTextFile("x", "y");'],
    ['Bun.', 'Bun.write("x", "y");'],
    ['fs.', 'fs.writeFileSync("x", "y");'],
    ['writeSync', 'writeSync(1, "x");'],
    ['stdout', 'out = stdout;'],
    ['template expression', 'const s = `${process.env.KEY}`;'],
  ])('flags %s', (_name, line) => {
    expect(hits(`let a = 1;\n${line}\n`).length).toBeGreaterThan(0);
  });
  it.each([
    ['scripts/ static', "import { takeResultChannel } from '../../scripts/hal/check-nonce.js';"],
    ['check-entry', "import '../../scripts/hal/check-entry.ts';"],
    ['check-nonce without scripts/', "import * as n from './check-nonce.js';"],
    ['dynamic scripts/', "const m = await import('../../scripts/hal/candidate.js');"],
    ['core hal source', "import { compareScores } from '../../packages/core/src/hal/gate.js';"],
    ['export from scripts/', "export * from '../../scripts/site/x.js';"],
    ['template dynamic import', 'import(`../../scripts/hal/check-entry.ts`);'],
  ])('flags an import of Hal\'s own modules: %s', (_name, line) => {
    expect(hits(`${line}\n`).join(' ')).toMatch(/Hal module/);
  });
  it('does not flag game-local or SDK imports, or such paths in strings and comments', () => {
    expect(hits("import { createStudio } from '../sdk/studio-sdk.js';\nimport { L } from './levels.js';\nimport s from './scripts.js';\n")).toEqual([]);
    expect(hits("const note = 'see ../../scripts/hal/check-entry.ts'; // import '../../scripts/hal/x.js'\n")).toEqual([]);
  });
  it('flags it in a game html file too', () => {
    expect(hits('<script type="module">\nprocess.exit(1);\n</script>\n', 'games/g/index.html').length).toBeGreaterThan(0);
  });
  it.each([
    ['a string', 'const msg = "check process.env and stdout and fs.readFile and require(x)";'],
    ['a template text', 'const msg = `use require( and Deno.run`;'],
    ['a line comment', 'let a = 1; // process.env, require(fs), stdout'],
    ['a block comment', '/* import fs from "fs"; globalThis.process */ let b = 2;'],
    ['an html comment', '<!-- process.exit() -->'],
    ['similar names', 'const myprocess = 1; const subprocess_x = 2; const prefs = { a: 1 }; prefs.a = 3; const stdouts = 0; const requirement = 1;'],
    ['a browser import', "import { createStudio } from '../sdk/studio-sdk.js';"],
    ['a relative module named like a node one', "import path from './path.js'; import fsm from './fs.js';"],
    ['prose', 'The process. Then more.'],
  ])('does not flag %s', (_name, line) => {
    expect(hits(`${line}\n`)).toEqual([]);
  });
  it('ignores existing lines, prose files, deletions and paths outside games/', () => {
    expect(hits('const k = process.env.KEY;\nlet z = 1;\n', 'games/g/game.js', 'const k = process.env.KEY;\n')).toEqual([]);
    expect(hits('process.env is a Node thing\n', 'games/g/NOTES.md')).toEqual([]);
    expect(hostApi(diff([D('games/g/a.js', 'process.exit()\n')]))).toEqual([]);
    expect(hostApi(diff([A('scripts/x.ts', 'process.exit(0);\n')]))).toEqual([]);
  });
  it('names the rule and path', () => {
    expect(hostApi(diff([A('games/g/a.js', 'process.exit(0);\n')]))).toEqual([{ rule: 'host-api', path: 'games/g/a.js', detail: expect.stringContaining('process.') }]);
  });
});

describe('R18: candidate scope (outside-scope with scope)', () => {
  const scope = { game: 'tidepool-pals', testPrefixes: testPrefixesFor('tidepool-pals') };
  const scoped = (files: FileChange[]) => checkTripwires(diff(files), undefined, { scope }).filter((v) => v.rule === 'outside-scope');
  it('test prefixes: the slug and the game\'s existing prefix', () => {
    expect(testPrefixesFor('tidepool-pals')).toEqual(['tidepool-pals-', 'tidepool-']);
    expect(testPrefixesFor('hyperline')).toEqual(['hyperline-']);
    expect(testPrefixesFor('gearhold')).toEqual(['gearhold-']);
  });
  it.each([
    'games/hyperline/game.js', 'games/tidepool/x.js', 'games/tidepool-pals-x/a.js', 'packages/sdk/src/a.ts', 'adapters/local/a.ts', 'services/api/a.ts',
    'scripts/dev.ts', 'docs/notes.md', 'docs/hal/history/tidepool-pals/2026-11-11/note.md', 'packages/core/test/hyperline-sim.test.ts',
    'packages/core/test/hal-tidepool.test.ts', 'packages/core/src/tidepool.ts', 'README.md', 'games/sdk/studio-sdk.js',
  ])('flags %s for a tidepool-pals ticket', (p) => {
    expect(scoped([A(p, 'x')])).toEqual([{ rule: 'outside-scope', path: p, detail: 'outside the ticket\'s scope (games/tidepool-pals/** and its tests)' }]);
  });
  it.each(['games/tidepool-pals/board.js', 'games/tidepool-pals/lib/a.js', 'packages/core/test/tidepool-board.test.ts', 'packages/core/test/tidepool-pals-map.test.ts', 'packages/core/test/Tidepool-New.test.ts'])(
    'near-miss: %s is in scope', (p) => { expect(scoped([A(p, 'x')])).toEqual([]); },
  );
  it('a rename counts both ends; deleting a file outside scope is a hit', () => {
    expect(scoped([{ ...A('games/tidepool-pals/a.js', 'x'), status: 'R', oldPath: 'games/hyperline/a.js' }]).map((v) => v.path)).toEqual(['games/hyperline/a.js']);
    expect(scoped([D('games/gearhold/x.js', 'x')])).toHaveLength(1);
  });
  it('without a scope nothing changes (rule stays path-safety only)', () => {
    expect(outsideScope(diff([A('packages/sdk/src/a.ts', 'x')]))).toEqual([]);
  });
});
