import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pagesIndexHtml } from '@studio/core';
import { formatTrailers, type HalTrailers } from '@studio/core/hal';
import { mountHistory } from './history-routes.js';

const git = (cwd: string, env: Record<string, string>, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } }).trim();
const put = (root: string, rel: string, data: string | Buffer) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), data); };
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

let root: string;
let site: Hono;
const commit = (date: string, msg: string) => {
  git(root, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, 'add', '-A');
  git(root, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, 'commit', '-q', '--allow-empty', '-m', msg);
};
const t = (o: Partial<HalTrailers>): HalTrailers => ({ pass: 'HAL-001', game: 'hyperline', kind: 'tuning', why: 'because', scoreBefore: 60, scoreAfter: 62, version: '1.0.1', run: 'r1', ...o });

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'hal-hist-'));
  git(root, {}, 'init', '-q', '-b', 'main');
  put(root, 'games/hyperline/a.js', '1');
  commit('2026-11-09T12:00:00Z', 'init');
  put(root, 'games/hyperline/a.js', '2');
  put(root, 'docs/hal/history/hyperline/2026-11-10/HAL-001-before.jpg', JPG);
  put(root, 'docs/hal/history/hyperline/2026-11-10/note.md', '# hyperline, night of Nov 10\n\n## Run r1\n\nFirst **night** note.\n');
  put(root, 'docs/hal/history/hyperline/2026-11-10/scores.json', JSON.stringify({ night: '2026-11-10', runs: [{ run: 'r1', at: '2026-11-10T08:00:00Z', scorers: { s: { fitness: 60, measures: { speed: 60 } } } }] }));
  commit('2026-11-10T12:00:00Z', `tuning(hyperline): Slower lap\n\n${formatTrailers(t({}))}`);
  put(root, 'games/hyperline/a.js', '3');
  commit('2026-11-11T12:00:00Z', `fix(hyperline): Bigger jump\n\n${formatTrailers(t({ pass: 'HAL-002', kind: 'fix', version: '1.0.2', run: 'r2' }))}`);
  put(root, 'games/hyperline/a.js', '4');
  put(root, 'docs/hal/history/hyperline/2026-11-11/scores.json', JSON.stringify({ night: '2026-11-11', runs: [{ run: 'r2', at: '2026-11-11T08:00:00Z', scorers: {} }, { run: 'r3', at: '2026-11-11T09:00:00Z', scorers: { s: { fitness: 65, measures: { speed: 66 } } } }] }));
  commit('2026-11-12T12:00:00Z', `undo(hyperline): Undo HAL-002\n\n${formatTrailers(t({ pass: 'HAL-U2', undo: 'HAL-002', reason: 'felt floaty', version: '1.0.3', run: 'r3', kind: 'fix' }))}`);
  put(root, 'games/hyperline/b.js', '5');
  commit('2026-11-12T13:00:00Z', 'brian <b>edit</b>');
  put(root, 'games/other/x.js', '1');
  put(root, 'docs/hal/history/other/2026-11-10/HAL-009-before.jpg', JPG);
  commit('2026-11-12T14:00:00Z', 'other game');
  symlinkSync('/etc/passwd', join(root, 'docs/hal/history/hyperline/2026-11-10/HAL-005-before.jpg'));
  commit('2026-11-12T15:00:00Z', 'sneaky symlink');
  site = new Hono();
  mountHistory(site, { repo: root, games: [{ slug: 'hyperline', title: 'Hyperline' }, { slug: 'other', title: 'Other' }] });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('history routes', () => {
  it('GET /_history/hyperline lists both nights', async () => {
    const res = await site.request('/_history/hyperline');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Slower lap');
    expect(html).toContain('Bigger jump');
    expect(html).toContain('Undone: felt floaty');
    expect(html).toContain('&lt;b&gt;edit&lt;/b&gt;');
    expect(html).toContain('First <strong>night</strong> note');
    expect(html).not.toContain('other game');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'");
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('?status=undone shows only the undone', async () => {
    const html = await (await site.request('/_history/hyperline?status=undone')).text();
    expect(html).toContain('Bigger jump');
    expect(html).not.toContain('Slower lap');
    expect(html).not.toContain('edit');
  });
  it('bad filter values are ignored, not errors', async () => {
    const res = await site.request('/_history/hyperline?kind=zzz&status=zzz&q=');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Slower lap');
  });
  it('/_history/hyperline/HAL-002 focuses', async () => {
    const res = await site.request('/_history/hyperline/HAL-002');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Bigger jump');
    expect(html).not.toContain('Slower lap');
    expect((await site.request('/_history/hyperline/HAL-777')).status).toBe(404);
    expect((await site.request('/_history/hyperline/nope')).status).toBe(404);
  });
  it('img route serves the committed bytes', async () => {
    const res = await site.request('/_history/hyperline/img/2026-11-10/HAL-001-before.jpg');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toContain('max-age=86400');
    expect(Buffer.from(await res.arrayBuffer()).equals(JPG)).toBe(true);
  });
  it('img traversal / bad names / other game / symlink / uncommitted 404', async () => {
    const paths = [
      '/_history/hyperline/img/2026-11-10/..%2F..%2Fnote.md', '/_history/hyperline/img/..%2F..%2Fother/HAL-009-before.jpg', '/_history/hyperline/img/2026-11-10/note.md',
      '/_history/hyperline/img/2026-11-10/HAL-001-before.png', '/_history/hyperline/img/2026-11-10/HAL-1-middle.jpg', '/_history/hyperline/img/2026-11-10/%2Fetc%2Fpasswd',
      '/_history/hyperline/img/2026-11-10/HAL-009-before.jpg', '/_history/hyperline/img/2026-11-10/HAL-005-before.jpg', '/_history/hyperline/img/2026-11-99/HAL-001-before.jpg',
      '/_history/hyperline/img/..%2Fother%2F2026-11-10/HAL-009-before.jpg', '/_history/hyperline/img/2026-11-10/HAL-001-after.jpg',
    ];
    for (const p of paths) expect((await site.request(p)).status, p).toBe(404);
  });
  it('unknown game 404', async () => {
    expect((await site.request('/_history/nope')).status).toBe(404);
    expect((await site.request('/_history/..%2Fx')).status).toBe(404);
    expect((await site.request('/_history/nope/HAL-001')).status).toBe(404);
    expect((await site.request('/_history/nope/img/2026-11-10/HAL-001-before.jpg')).status).toBe(404);
  });
  it('works with no refs/hal/main, and prefers it when it contains HEAD', async () => {
    expect(() => git(root, {}, 'rev-parse', '--verify', '-q', 'refs/hal/main')).toThrow();
    expect((await site.request('/_history/hyperline')).status).toBe(200);
    const sha = git(root, {}, 'rev-parse', 'HEAD');
    git(root, {}, 'update-ref', 'refs/hal/main', sha);
    try {
      expect((await site.request('/_history/hyperline')).status).toBe(200);
      expect((await site.request('/_history/hyperline/img/2026-11-10/HAL-001-before.jpg')).status).toBe(200);
    } finally {
      git(root, {}, 'update-ref', '-d', 'refs/hal/main');
    }
  });
});

describe('tip choice and git failures', () => {
  const mk = () => {
    const r = mkdtempSync(join(tmpdir(), 'hal-tip-'));
    const g = (...a: string[]) => git(r, {}, ...a);
    g('init', '-q', '-b', 'main');
    put(r, 'games/hyperline/a.js', '1');
    g('add', '-A'); g('commit', '-q', '-m', 'init');
    return { r, g };
  };
  const img = (r: string, n: string) => { const s = new Hono(); mountHistory(s, { repo: r, games: [{ slug: 'hyperline', title: 'H' }] }); return s.request(`/_history/hyperline/img/2026-11-10/${n}`); };
  const addImg = (r: string, g: (...a: string[]) => string, n: string) => { put(r, `docs/hal/history/hyperline/2026-11-10/${n}`, JPG); g('add', '-A'); g('commit', '-q', '-m', `img ${n}`); };
  it('ref ahead of HEAD: its tree is used', async () => {
    const { r, g } = mk();
    g('checkout', '-q', '-b', 'side'); addImg(r, g, 'HAL-001-before.jpg'); g('update-ref', 'refs/hal/main', 'HEAD'); g('checkout', '-q', 'main');
    expect((await img(r, 'HAL-001-before.jpg')).status).toBe(200);
    rmSync(r, { recursive: true, force: true });
  });
  it('ref behind HEAD: HEAD tree is used', async () => {
    const { r, g } = mk();
    g('update-ref', 'refs/hal/main', 'HEAD'); addImg(r, g, 'HAL-001-before.jpg');
    expect((await img(r, 'HAL-001-before.jpg')).status).toBe(200);
    rmSync(r, { recursive: true, force: true });
  });
  it('ref diverged: HEAD tree is used', async () => {
    const { r, g } = mk();
    g('checkout', '-q', '-b', 'side'); addImg(r, g, 'HAL-002-before.jpg'); g('update-ref', 'refs/hal/main', 'HEAD'); g('checkout', '-q', 'main');
    addImg(r, g, 'HAL-001-before.jpg');
    expect((await img(r, 'HAL-001-before.jpg')).status).toBe(200);
    expect((await img(r, 'HAL-002-before.jpg')).status).toBe(404);
    rmSync(r, { recursive: true, force: true });
  });
  it('a non-repo directory gives a small 500 with the CSP, not a crash', async () => {
    const r = mkdtempSync(join(tmpdir(), 'hal-nogit-'));
    const s = new Hono(); mountHistory(s, { repo: r, games: [{ slug: 'hyperline', title: 'H' }] });
    for (const p of ['/_history/hyperline', '/_history/hyperline/HAL-001', '/_history/hyperline/img/2026-11-10/HAL-001-before.jpg']) {
      const res = await s.request(p);
      expect(res.status, p).toBe(500);
      expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    rmSync(r, { recursive: true, force: true });
  });
});

describe('not part of the Pages build or a flagless shelf', () => {
  it('pagesIndexHtml output has no "_history"', () => {
    const html = pagesIndexHtml([{ slug: 'hyperline', title: 'Hyperline' } as never]);
    expect(html).not.toContain('_history');
    expect(html).not.toContain('History');
  });
  it('shelf html served without the flag has no History link', () => {
    const src = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
    expect(src).toContain('/*__HISTORY__*/false');
    const html = src.replace('/*__GAMES__*/[]', '[]');
    expect(html).toMatch(/const HISTORY = \/\*__HISTORY__\*\/false;/);
    expect(html).toContain('HISTORY ?');
  });
});
