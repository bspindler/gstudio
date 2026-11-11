import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  checkTripwires, protectedPath, halHook, network, dependency, payment, randomReward, darkPattern, assetSource, levelRemoved, testsRemoved, outsideScope,
  isProtectedPath, addedLines, type Diff, type FileChange,
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
    expect(darkPattern(diff([A('games/g/a.js', 'const sale = on;\nsetInterval(tick, 1000);\n')]))).toEqual([{ rule: 'dark-pattern', path: 'games/g/a.js', detail: 'timer near offer/sale/deal wording' }]);
    // The word may be existing text near a newly added timer.
    expect(darkPattern(diff([M('games/g/a.js', 'showOffer();\nx();\n', 'showOffer();\nsetTimeout(x, 5);\nx();\n')]))).toHaveLength(1);
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
    expect(assetSource(diff([{ ...BIN('games/g/img/a.png'), status: 'M' }, D('games/g/img/b.png', '')]))).toEqual([]);
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
