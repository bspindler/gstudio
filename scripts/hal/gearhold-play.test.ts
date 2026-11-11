// Browser tests for the Gearhold play runner (HAL_BROWSER=1 npx vitest run --project hal-browser).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { networkInterfaces } from 'node:os';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LEVELS } from '../../games/gearhold/levels.js';
import { closeAll, launchBrowser, newHalContext, serveGames, type StaticServer } from './browser.js';
import { policyBundle, policySeed, runGearholdPlay } from './gearhold-play.js';

describe('runGearholdPlay', () => {
  it('is deterministic: the same level and seed twice give identical PlayRecords', async () => {
    const a = await runGearholdPlay({ levels: [0, 2], seeds: 2, seedBase: 3 });
    const b = await runGearholdPlay({ levels: [0, 2], seeds: 2, seedBase: 3 });
    expect(a.errors).toEqual([]);
    expect(a.records).toHaveLength(4);
    expect(b).toEqual(a);
    // Different seeds must give different runs (the page seed and policy seed both reach the run).
    const [s3, s4] = a.records.filter((r) => r.level === 2);
    expect({ ...s3, seed: 0 }).not.toEqual({ ...s4, seed: 0 });
    for (const r of a.records) {
      expect(['win', 'dead', 'timeout']).toContain(r.result);
      expect(r.cause).not.toBe('');
      expect(r.hits).toBeLessThanOrEqual(r.shotsFired);
    }
  }, 120_000);

  it('ends a run at the sim-time cap as a timeout with its cause', async () => {
    const { records, errors } = await runGearholdPlay({ levels: [1], seeds: 1, simCap: 3 });
    expect(errors).toEqual([]);
    expect(records[0]!.result).toBe('timeout');
    expect(records[0]!.time).toBeGreaterThanOrEqual(3 - 1e-6);
    expect(records[0]!.cause).toMatch(/^(stuck|wandering): 3 s sim cap at/);
  });

  it('reports a level that does not exist as a hard failure, not a record', async () => {
    const { records, errors } = await runGearholdPlay({ levels: [99], seeds: 1 });
    expect(records).toEqual([]);
    expect(errors).toEqual(['level 99 seed 0: no such level']);
  });

  // Fault injection: wrap __hal.step as soon as the hook installs it.
  const wrapStep = (body: string): string => `
    Object.defineProperty(window, '__hal', { configurable: true, set(v) {
      const step = v.step; let n = 0;
      v.step = (dt, i) => { n++; ${body}; return step(dt, i); };
      Object.defineProperty(window, '__hal', { value: v, writable: true, configurable: true });
    } });`;

  it('a page error is a hard failure, not a record', async () => {
    const { records, errors } = await runGearholdPlay({
      levels: [0], seeds: 1, initScript: wrapStep("if (n === 50) setTimeout(() => { throw new Error('injected boom'); })"),
    });
    expect(records).toEqual([]);
    expect(errors).toEqual([expect.stringMatching(/^level 0 seed 0: page error: .*injected boom/)]);
  });

  it('step() throwing is a hard failure, not a record', async () => {
    const { records, errors } = await runGearholdPlay({
      levels: [0], seeds: 1, initScript: wrapStep("if (n === 50) throw new Error('injected step failure')"),
    });
    expect(records).toEqual([]);
    expect(errors).toEqual([expect.stringMatching(/^level 0 seed 0: .*injected step failure/)]);
  });

  it('a batch that never returns is a hang, bounded by wall time', async () => {
    const t0 = performance.now();
    const { records, errors } = await runGearholdPlay({
      levels: [0], seeds: 1, batchTimeoutMs: 2000, initScript: wrapStep('if (n === 50) for (;;) {}'),
    });
    expect(records).toEqual([]);
    expect(errors).toEqual([expect.stringMatching(/^level 0 seed 0: hang: /)]);
    expect(performance.now() - t0).toBeLessThan(20_000);
  });

  it('rejects seeds that are not positive integers', async () => {
    await expect(runGearholdPlay({ levels: [0], seeds: 0 })).rejects.toThrow(/positive integer/);
  });

  it('policy seeds differ per seed and per level', () => {
    expect(new Set([policySeed(0, 0), policySeed(1, 0), policySeed(0, 1), policySeed(1, 1)]).size).toBe(4);
  });
});

describe('newHalContext', () => {
  let server: StaticServer, browser: Browser;
  beforeAll(async () => { server = await serveGames(); browser = await launchBrowser(); });
  afterAll(() => closeAll(browser, server));

  it('blocks and records non-local requests; nothing leaves the machine; local pages load', async () => {
    const { context, blockedRequests, consoleErrors } = await newHalContext(browser);
    const page = await context.newPage();
    const external: string[] = [];
    page.on('response', (r) => { if (!r.url().startsWith(server.origin)) external.push(r.url()); });
    page.on('requestfinished', (r) => { if (!r.url().startsWith(server.origin)) external.push(r.url()); });
    await page.goto(`${server.origin}/gearhold/index.html?hal=1`);
    const fetched = await page.evaluate(() => fetch('https://example.com/').then(() => 'ok', (e) => `rejected: ${e}`));
    await page.evaluate(() => new Promise<void>((r) => {
      const img = (globalThis as any).document.createElement('img');
      img.onerror = () => r(); img.onload = () => r();
      img.src = 'https://example.com/pixel.png';
    }));
    await context.close();
    expect(fetched).toMatch(/^rejected/);
    expect(blockedRequests).toEqual(['https://example.com/', 'https://example.com/pixel.png']);
    expect(external).toEqual([]);
    expect(consoleErrors.filter((m) => /ERR_BLOCKED|ERR_FAILED/.test(m))).toEqual([]);
  });

  // A plain local server: counts WebSocket upgrades and serves a page plus a service worker.
  const SW = `self.addEventListener('install', () => self.skipWaiting());
    self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
    self.addEventListener('message', (e) => {
      fetch('https://example.com/from-sw').then(() => 'ok', (err) => 'rejected: ' + err).then((r) => e.source.postMessage(r));
    });`;
  async function listen(host: string): Promise<{ srv: Server; port: number; upgrades: string[] }> {
    const upgrades: string[] = [];
    const srv = createServer((req, res) => {
      if (req.url === '/sw.js') res.writeHead(200, { 'content-type': 'text/javascript' }).end(SW);
      else res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>t</title>');
    });
    srv.on('upgrade', (req, sock) => { upgrades.push(req.url ?? ''); sock.destroy(); });
    await new Promise<void>((r) => srv.listen(0, host, () => r()));
    return { srv, port: (srv.address() as AddressInfo).port, upgrades };
  }
  const lanIp = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  const openWs = (url: string) => new Promise<string>((resolve) => {
    const ws = new (globalThis as any).WebSocket(url);
    ws.onopen = () => resolve('open');
    ws.onerror = () => resolve('error');
    ws.onclose = () => resolve('closed');
    setTimeout(() => resolve('timeout'), 3000);
  });

  it('closes non-allowed WebSockets before they connect and lets allowed ones through', async () => {
    const lan = lanIp ? await listen(lanIp) : null;
    const local = await listen('127.0.0.1');
    const { context, blockedRequests } = await newHalContext(browser, { allowHosts: [`127.0.0.1:${local.port}`] });
    try {
      const page = await context.newPage();
      await page.goto(`${server.origin}/gearhold/index.html?hal=1`);
      const far = lan ? `ws://${lanIp}:${lan.port}/far` : 'ws://10.255.255.1:9/far';
      const farState = await page.evaluate(openWs, far);
      await page.evaluate(openWs, `ws://127.0.0.1:${local.port}/near`);
      expect(farState).not.toBe('open');
      expect(blockedRequests).toContain(far);
      if (lan) expect(lan.upgrades).toEqual([]); // nothing reached the LAN listener
      expect(local.upgrades).toEqual(['/near']); // the allowed socket did connect through
      expect(blockedRequests.some((u) => u.includes('/near'))).toBe(false);
    } finally {
      await context.close();
      lan?.srv.close(); local.srv.close();
    }
  });

  it('refuses other loopback ports unless allowed as host:port', async () => {
    const other = await listen('127.0.0.1');
    const { context, blockedRequests } = await newHalContext(browser);
    try {
      const page = await context.newPage();
      await page.goto(`${server.origin}/gearhold/index.html?hal=1`);
      const url = `http://127.0.0.1:${other.port}/x`;
      expect(await page.evaluate((u) => fetch(u).then(() => 'ok', () => 'rejected'), url)).toBe('rejected');
      expect(blockedRequests).toEqual([url]);
    } finally { await context.close(); other.srv.close(); }
  });

  it("blocks a service worker's fetch", async () => {
    const local = await listen('127.0.0.1');
    const { context, blockedRequests } = await newHalContext(browser, { allowHosts: [`127.0.0.1:${local.port}`] });
    try {
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${local.port}/`);
      const r = await page.evaluate(async () => {
        const nav = (globalThis as any).navigator;
        await nav.serviceWorker.register('/sw.js');
        const reg = await nav.serviceWorker.ready;
        return new Promise<string>((resolve) => {
          nav.serviceWorker.addEventListener('message', (e: any) => resolve(String(e.data)));
          reg.active.postMessage('go');
          setTimeout(() => resolve('timeout'), 5000);
        });
      });
      expect(r).toMatch(/^rejected/);
      expect(blockedRequests).toContain('https://example.com/from-sw');
    } finally { await context.close(); local.srv.close(); }
  });
});

describe('in-page driver hard failures', () => {
  let server: StaticServer, browser: Browser;
  beforeAll(async () => { server = await serveGames(); browser = await launchBrowser(); });
  afterAll(() => closeAll(browser, server));

  it('a non-finite state is an error, never a result', async () => {
    const page = await browser.newPage();
    await page.goto(`${server.origin}/gearhold/index.html?hal=1`);
    await page.addScriptTag({ content: await policyBundle() });
    const out = await page.evaluate((map) => {
      const g = globalThis as any;
      g.__halPlay.begin(0, map, 1, 240);
      const step = g.__hal.step;
      g.__hal.step = (dt: number, i: object) => { const s = step(dt, i); s.p.x = NaN; return s; };
      return g.__halPlay.batch(10);
    }, LEVELS[0]!.map as string[]);
    await page.close();
    expect(out).toEqual({ done: true, ok: false, error: expect.stringMatching(/^non-finite value state\.p\.x at t=/) });
  });
});
