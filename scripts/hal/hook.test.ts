import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repo = join(import.meta.dirname, '..', '..');
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

// Serves games/ and the SDK (at /sdk/), like `npm run dev` does, on a random localhost port.
function serve(): Promise<{ server: Server; origin: string }> {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]!));
    const file = path.startsWith('/sdk/') ? join(repo, 'packages', path) : join(repo, 'games', path);
    if (!file.startsWith(join(repo, 'games')) && !file.startsWith(join(repo, 'packages', 'sdk'))) { res.writeHead(403).end(); return; }
    try {
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

async function launch(): Promise<Browser> {
  try { return await chromium.launch(); } catch { /* try software GL */ }
  return chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
}

const idle = { fwd: 0, str: 0, turn: 0, pitch: 0, fire: false } as const;
type Hal = { start(l: number): void; state(): any; step(dt: number, i: object): any; render(): void };

let server: Server, origin: string, browser: Browser;
const errors: string[] = [];
const sent: string[] = [];

async function open(query: string): Promise<Page> {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith('data:')) sent.push(r.url()); });
  await page.goto(`${origin}/gearhold/index.html${query}`);
  return page;
}

beforeAll(async () => {
  ({ server, origin } = await serve());
  browser = await launch();
});
afterAll(async () => { await browser?.close(); server?.close(); });

describe('gearhold ?hal hook', () => {
  it('is absent without ?hal and the rAF loop runs', async () => {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      (window as any).__frames = 0;
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => raf((t) => { (window as any).__frames++; cb(t); });
    });
    await page.goto(`${origin}/gearhold/index.html`);
    expect(await page.evaluate(() => (window as any).__hal)).toBeUndefined();
    await page.waitForFunction(() => (window as any).__frames > 10);
    await page.close();
    expect(errors).toEqual([]);
  });

  it('start + 60 idle steps advances time by about 1 s', async () => {
    const page = await open('?hal');
    const s = await page.evaluate((idle) => {
      const h = (window as any).__hal as Hal;
      h.start(0);
      let st = h.state();
      for (let i = 0; i < 60; i++) st = h.step(1 / 60, idle);
      return st;
    }, idle);
    expect(s.mode).toBe('play');
    expect(s.level).toBe(0);
    expect(s.time).toBeGreaterThan(0.98);
    expect(s.time).toBeLessThan(1.02);
    expect(Number.isFinite(s.p.x) && Number.isFinite(s.p.y) && Number.isFinite(s.p.a)).toBe(true);
    expect(s.enemies.length).toBeGreaterThan(0);
    expect(s.result).toBe('');
    expect(s.shotsFired).toBe(0);
    await page.close();
    expect(errors).toEqual([]);
    expect(sent).toEqual([]); // no studio ingest or other outside requests
  });

  it('forward + fire increments shotsFired', async () => {
    const page = await open('?hal');
    const s = await page.evaluate(() => {
      const h = (window as any).__hal as Hal;
      h.start(0);
      let st = h.state();
      for (let i = 0; i < 90; i++) st = h.step(1 / 60, { fwd: 1, str: 0, turn: 0, pitch: 0, fire: true });
      return st;
    });
    expect(s.shotsFired).toBeGreaterThan(0);
    await page.close();
  });

  it('can render a frame on demand (WebGL available)', async () => {
    const page = await open('?hal');
    expect(await page.evaluate(() => document.getElementById('tag')?.textContent)).not.toBe('needs WebGL 2');
    await page.evaluate(() => { const h = (window as any).__hal as Hal; h.start(0); h.render(); });
    await page.close();
    expect(errors).toEqual([]);
  });
});
