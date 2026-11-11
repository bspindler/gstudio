// Browser-free: the dev server's /_site/fonts route serves the bundled shelf fonts and refuses traversal.
import { relative } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { mountSiteFonts } from '../site-routes.js';
import { repo } from './browser.js';

const site = new Hono();
mountSiteFonts(site, `${relative(process.cwd(), repo) || '.'}/scripts`);

describe('/_site/fonts', () => {
  it('serves a bundled woff2', async () => {
    const res = await site.request('/_site/fonts/bungee-latin.woff2');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('font/woff2');
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });
  it('404s a missing font and refuses traversal', async () => {
    expect((await site.request('/_site/fonts/nope.woff2')).status).toBe(404);
    for (const p of ['/_site/fonts/..%2Findex.html', '/_site/fonts/../index.html', '/_site/fonts/%2e%2e/index.html'])
      expect((await site.request(p)).status, p).not.toBe(200);
  });
});
