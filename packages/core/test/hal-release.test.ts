import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyRelease, bumpKind, formatTrailers, nightOf, parseTrailers, planVersion, undoEntry, type HalTrailers, type ReleaseFiles } from '../src/hal/release.js';

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
  const base = { current: '0.4.1', topEntryDate: '2026-11-07', night: '2026-11-08', alreadyBumpedTonight: null } as const;
  it('bumps on a new night', () => {
    expect(planVersion({ ...base, kind: 'fix' })).toBe('0.4.2');
    expect(planVersion({ ...base, kind: 'feature' })).toBe('0.5.0');
    expect(planVersion({ ...base, topEntryDate: null, kind: 'polish' })).toBe('0.4.2');
  });
  it('shares a version on the same night', () => {
    expect(planVersion({ ...base, topEntryDate: '2026-11-08', kind: 'fix', alreadyBumpedTonight: 'patch' })).toBe('0.4.1');
    expect(planVersion({ ...base, topEntryDate: '2026-11-08', kind: 'feature', alreadyBumpedTonight: 'minor' })).toBe('0.4.1');
  });
  it('upgrades to minor when a feature follows patch-only changes', () => {
    expect(planVersion({ ...base, topEntryDate: '2026-11-08', kind: 'feature', alreadyBumpedTonight: 'patch' })).toBe('0.5.0');
  });
  it('rejects a bad version', () => {
    expect(() => planVersion({ ...base, current: '0.4', kind: 'fix' })).toThrow();
  });
});

describe.each(slugs)('applyRelease on %s', (slug) => {
  const files = load(slug);
  const cur = ver(files);
  const night = '2026-11-20';
  it('real files are consistent to start', () => check(slug, files));

  it('new night: new heading, three-way check passes', () => {
    const v = planVersion({ current: cur, topEntryDate: '2026-11-11', night, kind: 'fix', alreadyBumpedTonight: null });
    const out = applyRelease(files, { slug, version: v, night, entry: { kind: 'fix', text: 'Fix: a thing.' } });
    check(slug, out);
    expect(out.changelog).toContain(`## ${v} (${night})\n- Fix: a thing.\n\n## ${cur}`);
    expect(out.changelog.startsWith(files.changelog.split('## ')[0]!)).toBe(true);
  });

  it('two fixes the same night share a version', () => {
    const v = planVersion({ current: cur, topEntryDate: '2026-11-11', night, kind: 'fix', alreadyBumpedTonight: null });
    const a = applyRelease(files, { slug, version: v, night, entry: { kind: 'fix', text: 'one' } });
    const v2 = planVersion({ current: v, topEntryDate: night, night, kind: 'tuning', alreadyBumpedTonight: 'patch' });
    expect(v2).toBe(v);
    const b = applyRelease(a, { slug, version: v2, night, entry: { kind: 'tuning', text: 'two' } });
    check(slug, b);
    expect(b.changelog).toContain(`## ${v} (${night})\n- one\n- two\n\n## ${cur}`);
    expect(b.changelog.match(new RegExp(`## ${v.replace(/\./g, '\\.')} `, 'g'))).toHaveLength(1);
  });

  it('a fix then a feature becomes a minor bump and renames the heading', () => {
    const v = planVersion({ current: cur, topEntryDate: '2026-11-11', night, kind: 'fix', alreadyBumpedTonight: null });
    const a = applyRelease(files, { slug, version: v, night, entry: { kind: 'fix', text: 'one' } });
    const v2 = planVersion({ current: v, topEntryDate: night, night, kind: 'feature', alreadyBumpedTonight: 'patch' });
    const b = applyRelease(a, { slug, version: v2, night, entry: { kind: 'feature', text: 'big' } });
    check(slug, b);
    expect(v2).toMatch(/^\d+\.\d+\.0$/);
    expect(b.changelog).toContain(`## ${v2} (${night})\n- one\n- big\n`);
    expect(b.changelog).not.toContain(`## ${v} (`);
  });

  it('undo adds an Undone bullet under a new patch version', () => {
    const out = undoEntry(files, { slug, current: cur, night, title: 'Bigger crabs', pass: 'HAL-012', reason: 'felt\nworse' });
    check(slug, out);
    expect(ver(out)).toBe(planVersion({ current: cur, topEntryDate: null, night, kind: 'fix', alreadyBumpedTonight: null }));
    expect(out.changelog).toContain('- Undone: Bigger crabs (HAL-012): felt worse\n');
  });

  it('undo on a night that already has an entry shares its version', () => {
    const a = applyRelease(files, { slug, version: planVersion({ current: cur, topEntryDate: null, night, kind: 'fix', alreadyBumpedTonight: null }), night, entry: { kind: 'fix', text: 'x' } });
    const b = undoEntry(a, { slug, current: ver(a), night, title: 't', pass: 'HAL-001', reason: 'r' });
    check(slug, b);
    expect(ver(b)).toBe(ver(a));
  });

  it('throws on malformed files', () => {
    const input = { slug, version: planVersion({ current: cur, topEntryDate: null, night, kind: 'fix', alreadyBumpedTonight: null }), night, entry: { kind: 'fix' as const, text: 'x' } };
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
  it('returns null for incomplete or invalid trailers', () => {
    expect(parseTrailers('just a message')).toBeNull();
    expect(parseTrailers(formatTrailers(t).replace('Hal-Run: 2026-11-11-a', ''))).toBeNull();
    expect(parseTrailers(formatTrailers(t).replace('tuning', 'bogus'))).toBeNull();
    expect(parseTrailers(formatTrailers(t).replace('64', 'abc'))).toBeNull();
  });
});

describe('nightOf', () => {
  it('belongs to the previous day before 6 a.m. local', () => {
    const cst = -360;
    expect(nightOf(new Date('2026-11-11T10:00:00Z'), cst)).toBe('2026-11-10'); // 04:00 local
    expect(nightOf(new Date('2026-11-11T11:59:00Z'), cst)).toBe('2026-11-10'); // 05:59
    expect(nightOf(new Date('2026-11-11T12:00:00Z'), cst)).toBe('2026-11-11'); // 06:00
    expect(nightOf(new Date('2026-11-12T05:00:00Z'), cst)).toBe('2026-11-11'); // 23:00
    expect(nightOf(new Date('2026-11-11T02:00:00Z'), 0)).toBe('2026-11-10');
  });
});
