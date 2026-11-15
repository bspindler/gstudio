import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyRelease, bumpKind, formatTrailers, halReleasedTonight, nightOf, parseTrailers, planVersion, bumpedTonight, runIdDate, undoEntry, type HalTrailers, type ReleaseFiles } from '../src/hal/release.js';

const gamesDir = fileURLToPath(new URL('../../../games/', import.meta.url));
const slugs = readdirSync(gamesDir).filter((d) => existsSync(join(gamesDir, d, 'game.yaml')));
const load = (slug: string): ReleaseFiles => {
  const r = (f: string) => readFileSync(join(gamesDir, slug, f), 'utf8');
  return { yaml: r('game.yaml'), html: r('index.html'), changelog: r('CHANGELOG.md') };
};

// The same three-way check game-versions.test.ts makes.
function check(slug: string, f: ReleaseFiles) {
  const yaml = f.yaml.match(/^version:\s*(\S+)\s*$/m)?.[1];
  expect(yaml).toMatch(/^\d+\.\d+\.\d+$/);
  const sdk = f.html.match(new RegExp(`createStudio\\(\\{[^}]*game: '${slug}', version: '([^']+)'`))?.[1];
  expect(sdk).toBe(yaml);
  const versions = [...f.changelog.matchAll(/^## (\d+\.\d+\.\d+)\b/gm)].map((m) => m[1]!);
  expect(versions[0]).toBe(yaml);
  const key = (v: string) => v.split('.').map(Number).reduce((a, n) => a * 1000 + n, 0);
  for (let i = 1; i < versions.length; i++) expect(key(versions[i - 1]!)).toBeGreaterThan(key(versions[i]!));
  expect(new Set(versions).size).toBe(versions.length);
}
const ver = (f: ReleaseFiles) => f.yaml.match(/^version:\s*(\S+)/m)![1]!;

describe('bumpKind / planVersion', () => {
  it('maps kinds', () => {
    expect(bumpKind('fix')).toBe('patch');
    expect(bumpKind('tuning')).toBe('patch');
    expect(bumpKind('polish')).toBe('patch');
    expect(bumpKind('feature')).toBe('minor');
  });
  const base = { current: '0.4.1', alreadyBumpedTonight: null } as const;
  it('bumps when Hal has not released this version tonight', () => {
    expect(planVersion({ ...base, kind: 'fix' })).toBe('0.4.2');
    expect(planVersion({ ...base, kind: 'feature' })).toBe('0.5.0');
    expect(planVersion({ ...base, kind: 'polish' })).toBe('0.4.2');
  });
  it('shares a version Hal already released tonight', () => {
    expect(planVersion({ ...base, kind: 'fix', alreadyBumpedTonight: 'patch' })).toBe('0.4.1');
    expect(planVersion({ ...base, kind: 'feature', alreadyBumpedTonight: 'minor' })).toBe('0.4.1');
  });
  it('a second feature after a minor tonight keeps the version (via bumpedTonight)', () => {
    const cl = '## 0.5.0 (2026-11-08)\n- a\n\n## 0.4.1 (2026-11-07)\n- b\n';
    const b = bumpedTonight(cl, '2026-11-08');
    expect(b).toBe('minor');
    expect(planVersion({ ...base, current: '0.5.0', kind: 'feature', alreadyBumpedTonight: b })).toBe('0.5.0');
    expect(bumpedTonight('## 0.4.2 (2026-11-08)\n- a\n\n## 0.4.1 (2026-11-07)\n', '2026-11-08')).toBe('patch');
    expect(bumpedTonight('## 0.1.0 (2026-11-08)\n- a\n', '2026-11-08')).toBe('minor');
  });
  it('upgrades to minor when a feature follows patch-only changes', () => {
    expect(planVersion({ ...base, kind: 'feature', alreadyBumpedTonight: 'patch' })).toBe('0.5.0');
  });
  it('rejects a bad version', () => {
    expect(() => planVersion({ ...base, current: '0.4', kind: 'fix' })).toThrow();
  });
});

describe('halReleasedTonight (R20)', () => {
  const night = '2026-11-11';
  const msg = (game: string, version: string, run: string) =>
    `fix(${game}): x\n\nwhy\n\n${formatTrailers({ pass: 'HAL-001', game, kind: 'fix', why: 'w', scoreBefore: 1, scoreAfter: 2, version, run })}`;
  const tonightRun = 'run-2026-11-12T03-00-00-000Z';
  it('runIdDate reads run and undo ids', () => {
    expect(runIdDate(tonightRun)?.toISOString()).toBe('2026-11-12T03:00:00.000Z');
    expect(runIdDate('undo-2026-11-12T03-00-00-000Z-2')?.toISOString()).toBe('2026-11-12T03:00:00.000Z');
    expect(runIdDate('run-x')).toBeNull();
  });
  it('true only for a Hal commit tonight naming this game and version', () => {
    const old = new Date('2026-11-01T03:00:00Z');
    expect(halReleasedTonight([{ message: msg('tidepool-pals', '0.4.2', tonightRun), date: old }], 'tidepool-pals', '0.4.2', night, 0)).toBe(true);
    // the commit date alone also counts
    expect(halReleasedTonight([{ message: msg('tidepool-pals', '0.4.2', 'run-x'), date: new Date('2026-11-11T22:00:00Z') }], 'tidepool-pals', '0.4.2', night, 0)).toBe(true);
    // near misses: another game, another version, another night, not a Hal commit
    expect(halReleasedTonight([{ message: msg('hyperline', '0.4.2', tonightRun), date: null }], 'tidepool-pals', '0.4.2', night, 0)).toBe(false);
    expect(halReleasedTonight([{ message: msg('tidepool-pals', '0.4.1', tonightRun), date: null }], 'tidepool-pals', '0.4.2', night, 0)).toBe(false);
    expect(halReleasedTonight([{ message: msg('tidepool-pals', '0.4.2', 'run-2026-11-10T03-00-00-000Z'), date: old }], 'tidepool-pals', '0.4.2', night, 0)).toBe(false);
    expect(halReleasedTonight([{ message: 'release 0.4.2\n\nby Brian', date: new Date('2026-11-11T22:00:00Z') }], 'tidepool-pals', '0.4.2', night, 0)).toBe(false);
    expect(halReleasedTonight([], 'tidepool-pals', '0.4.2', night, 0)).toBe(false);
  });
});

describe('a version Brian released tonight (R20)', () => {
  const night = '2026-11-11';
  const files: ReleaseFiles = {
    yaml: 'slug: tidepool-pals\nversion: 0.4.1\n',
    html: "createStudio({ game: 'tidepool-pals', version: '0.4.1', endpoint: '' })",
    changelog: `# Changelog\n\n## 0.4.1 (${night})\n- Brian's own fix.\n\n## 0.4.0 (2026-11-01)\n- Older.\n`,
  };
  it('is never shared: Hal bumps to a new heading above it, then shares its own', () => {
    // No Hal commit tonight: alreadyBumpedTonight is null even though the top heading is dated tonight.
    const v = planVersion({ current: '0.4.1', kind: 'fix', alreadyBumpedTonight: null });
    expect(v).toBe('0.4.2');
    const a = applyRelease(files, { slug: 'tidepool-pals', version: v, night, entry: { kind: 'fix', text: 'Hal one.' } });
    expect(a.changelog).toContain(`## 0.4.2 (${night})\n- Hal one.\n\n## 0.4.1 (${night})\n- Brian's own fix.\n`);
    // Hal's own release tonight now exists: patch from bumpedTonight, shared.
    const v2 = planVersion({ current: '0.4.2', kind: 'polish', alreadyBumpedTonight: bumpedTonight(a.changelog, night) });
    expect(v2).toBe('0.4.2');
    const b = applyRelease(a, { slug: 'tidepool-pals', version: v2, night, entry: { kind: 'polish', text: 'Hal two.' }, shareTonight: true });
    expect(b.changelog).toContain(`## 0.4.2 (${night})\n- Hal one.\n- Hal two.\n\n## 0.4.1 (${night})\n- Brian's own fix.\n`);
  });
  it('shareTonight with no heading dated tonight throws', () => {
    expect(() => applyRelease({ ...files, changelog: '## 0.4.1 (2026-11-01)\n- x\n' }, { slug: 'tidepool-pals', version: '0.4.1', night, entry: { kind: 'fix', text: 'y' }, shareTonight: true })).toThrow(/no heading dated/);
  });
});

describe.each(slugs)('applyRelease on %s', (slug) => {
  const files = load(slug);
  const cur = ver(files);
  const night = '2026-11-20';
  it('real files are consistent to start', () => check(slug, files));

  it('new night: new heading, three-way check passes', () => {
    const v = planVersion({ current: cur, kind: 'fix', alreadyBumpedTonight: null });
    const out = applyRelease(files, { slug, version: v, night, entry: { kind: 'fix', text: 'Fix: a thing.' } });
    check(slug, out);
    expect(out.changelog).toContain(`## ${v} (${night})\n- Fix: a thing.\n\n## ${cur}`);
    expect(out.changelog.startsWith(files.changelog.split('## ')[0]!)).toBe(true);
  });

  it('two fixes the same night share a version', () => {
    const v = planVersion({ current: cur, kind: 'fix', alreadyBumpedTonight: null });
    const a = applyRelease(files, { slug, version: v, night, entry: { kind: 'fix', text: 'one' } });
    const v2 = planVersion({ current: v, kind: 'tuning', alreadyBumpedTonight: 'patch' });
    expect(v2).toBe(v);
    const b = applyRelease(a, { slug, version: v2, night, entry: { kind: 'tuning', text: 'two' }, shareTonight: true });
    check(slug, b);
    expect(b.changelog).toContain(`## ${v} (${night})\n- one\n- two\n\n## ${cur}`);
    expect(b.changelog.match(new RegExp(`## ${v.replace(/\./g, '\\.')} `, 'g'))).toHaveLength(1);
  });

  it('a fix then a feature becomes a minor bump and renames the heading', () => {
    const v = planVersion({ current: cur, kind: 'fix', alreadyBumpedTonight: null });
    const a = applyRelease(files, { slug, version: v, night, entry: { kind: 'fix', text: 'one' } });
    const v2 = planVersion({ current: v, kind: 'feature', alreadyBumpedTonight: 'patch' });
    const b = applyRelease(a, { slug, version: v2, night, entry: { kind: 'feature', text: 'big' }, shareTonight: true });
    check(slug, b);
    expect(v2).toMatch(/^\d+\.\d+\.0$/);
    expect(b.changelog).toContain(`## ${v2} (${night})\n- one\n- big\n`);
    expect(b.changelog).not.toContain(`## ${v} (`);
  });

  it('undo adds an Undone bullet under a new patch version', () => {
    const out = undoEntry(files, { slug, current: cur, night, title: 'Bigger crabs', pass: 'HAL-012', reason: 'felt\nworse' });
    check(slug, out);
    expect(ver(out)).toBe(planVersion({ current: cur, kind: 'fix', alreadyBumpedTonight: null }));
    expect(out.changelog).toContain('- Undone: Bigger crabs (HAL-012): felt worse\n');
  });

  it('undo on a night that already has an entry still gets a new patch version', () => {
    const a = applyRelease(files, { slug, version: planVersion({ current: cur, kind: 'fix', alreadyBumpedTonight: null }), night, entry: { kind: 'fix', text: 'x' } });
    const b = undoEntry(a, { slug, current: ver(a), night, title: 't', pass: 'HAL-001', reason: 'r' });
    check(slug, b);
    const [x, y, z] = ver(a).split('.').map(Number);
    expect(ver(b)).toBe(`${x}.${y}.${z! + 1}`);
    expect(b.changelog).toContain(`## ${ver(b)} (${night})\n- Undone: t (HAL-001): r\n\n## ${ver(a)} (${night})`);
  });

  it('strips a leading "- " from the entry text', () => {
    const out = applyRelease(files, { slug, version: planVersion({ current: cur, kind: 'fix', alreadyBumpedTonight: null }), night, entry: { kind: 'fix', text: '- hello' } });
    expect(out.changelog).toContain('\n- hello\n');
    expect(out.changelog).not.toContain('- - hello');
  });

  it('bumpedTonight reads the real changelog', () => {
    const top = /^## \S+ \((\d{4}-\d{2}-\d{2})\)/m.exec(files.changelog)![1]!;
    expect(bumpedTonight(files.changelog, '2099-01-01')).toBeNull();
    // Derived from the file, not hardcoded per game: Hal's own releases change the top entry.
    const [v1, v2] = [...files.changelog.matchAll(/^## (\d+)\.(\d+)\.\d+ \(/gm)].map((m) => `${m[1]}.${m[2]}`);
    expect(bumpedTonight(files.changelog, top)).toBe(v2 === undefined || v1 !== v2 ? 'minor' : 'patch');
  });

  it('throws on malformed files', () => {
    const input = { slug, version: planVersion({ current: cur, kind: 'fix', alreadyBumpedTonight: null }), night, entry: { kind: 'fix' as const, text: 'x' } };
    expect(() => applyRelease({ ...files, yaml: 'name: x\n' }, input)).toThrow(/game\.yaml/);
    expect(() => applyRelease({ ...files, html: '<html></html>' }, input)).toThrow(/index\.html/);
    expect(() => applyRelease({ ...files, html: files.html.replace(`game: '${slug}'`, "game: 'other'") }, input)).toThrow(/index\.html/);
    expect(() => applyRelease({ ...files, changelog: '# Changelog\n\nnothing\n' }, input)).toThrow(/CHANGELOG/);
    expect(() => applyRelease(files, { ...input, version: 'x' })).toThrow();
    expect(() => applyRelease(files, { ...input, version: cur })).toThrow(/not newer/);
    expect(() => applyRelease(files, { ...input, entry: { kind: 'fix', text: '  ' } })).toThrow(/empty/);
  });
});

describe('trailers', () => {
  const t: HalTrailers = { pass: 'HAL-012', game: 'tidepool-pals', kind: 'tuning', why: 'Levels were too easy', scoreBefore: 61.5, scoreAfter: 64, version: '0.4.2', run: '2026-11-11-a' };
  it('round-trips, with a subject and body around it', () => {
    const msg = `hal: tune crabs\n\nBody text.\n\n${formatTrailers(t)}\n`;
    expect(formatTrailers(t)).toContain('Hal-Score-Before: 61.5');
    expect(parseTrailers(msg)).toEqual(t);
  });
  it('round-trips undo fields and flattens newlines', () => {
    const u = { ...t, undo: 'HAL-010', reason: 'two\nlines\r\nhere' };
    const out = formatTrailers(u);
    expect(out.split('\n')).toHaveLength(10);
    expect(parseTrailers(out)).toEqual({ ...u, reason: 'two lines here' });
  });
  it('round-trips a Hal-Asks trailer (a held protected-change request), flattened to one line', () => {
    const a = { ...t, asks: 'The hook lists the tap zones;\nthe vane needs one.' };
    expect(formatTrailers(a)).toContain('Hal-Asks: The hook lists the tap zones; the vane needs one.');
    expect(parseTrailers(formatTrailers(a))).toEqual({ ...a, asks: 'The hook lists the tap zones; the vane needs one.' });
    expect(parseTrailers(formatTrailers(t))).not.toHaveProperty('asks');
  });
  it('returns null for incomplete or invalid trailers', () => {
    expect(parseTrailers('just a message')).toBeNull();
    expect(parseTrailers(formatTrailers(t).replace('Hal-Run: 2026-11-11-a', ''))).toBeNull();
    expect(parseTrailers(formatTrailers(t).replace('tuning', 'bogus'))).toBeNull();
    expect(parseTrailers(formatTrailers(t).replace('64', 'abc'))).toBeNull();
  });
});

describe('trailer strictness', () => {
  const t: HalTrailers = { pass: 'HAL-012', game: 'g', kind: 'fix', why: 'w', scoreBefore: 1, scoreAfter: 2, version: '0.1.1', run: 'r' };
  it('formatTrailers throws on empty required values or non-finite scores', () => {
    expect(() => formatTrailers({ ...t, why: ' \n ' })).toThrow(/Hal-Why/);
    expect(() => formatTrailers({ ...t, scoreAfter: NaN })).toThrow(/finite/);
    expect(() => formatTrailers({ ...t, scoreBefore: Infinity })).toThrow(/finite/);
  });
  it('parseTrailers reads only the final paragraph and checks the version', () => {
    expect(parseTrailers(`subject\n\n${formatTrailers(t)}\n\nNot a trailer block.`)).toBeNull();
    expect(parseTrailers(`Hal-Why: quoted in body\n\n${formatTrailers(t)}\n`)).toEqual(t);
    expect(parseTrailers(formatTrailers({ ...t, version: 'v1' }))).toBeNull();
  });
});

describe('nightOf', () => {
  it('handles positive offsets and the year boundary', () => {
    expect(nightOf(new Date('2026-11-10T20:00:00Z'), 540)).toBe('2026-11-10'); // 05:00 Tokyo Nov 11
    expect(nightOf(new Date('2026-11-10T21:00:00Z'), 540)).toBe('2026-11-11'); // 06:00
    expect(nightOf(new Date('2027-01-01T09:00:00Z'), -360)).toBe('2026-12-31'); // 03:00 local Jan 1
  });
  it('belongs to the previous day before 6 a.m. local', () => {
    const cst = -360;
    expect(nightOf(new Date('2026-11-11T10:00:00Z'), cst)).toBe('2026-11-10'); // 04:00 local
    expect(nightOf(new Date('2026-11-11T11:59:00Z'), cst)).toBe('2026-11-10'); // 05:59
    expect(nightOf(new Date('2026-11-11T12:00:00Z'), cst)).toBe('2026-11-11'); // 06:00
    expect(nightOf(new Date('2026-11-12T05:00:00Z'), cst)).toBe('2026-11-11'); // 23:00
    expect(nightOf(new Date('2026-11-11T02:00:00Z'), 0)).toBe('2026-11-10');
  });
});
