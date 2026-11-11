/// <reference lib="dom" />
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAll, launchBrowser, serveGames, type StaticServer } from './browser.js';

const idle = { fwd: 0, str: 0, turn: 0, pitch: 0, fire: false } as const;
type Hal = { start(l: number): void; state(): any; step(dt: number, i: object): any; render(): void };

let server: StaticServer, origin: string, browser: Browser;
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
  server = await serveGames();
  origin = server.origin;
  browser = await launchBrowser();
});
afterAll(() => closeAll(browser, server));

describe('gearhold ?hal hook', () => {
  it('is absent without ?hal and the rAF loop runs', async () => {
    const before = errors.length;
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => {
      (window as any).__frames = 0;
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => raf((t) => { (window as any).__frames++; cb(t); });
    });
    await page.goto(`${origin}/gearhold/index.html`);
    expect(await page.evaluate(() => (window as any).__hal)).toBeUndefined();
    await page.waitForFunction(() => (window as any).__frames > 10);
    await page.close();
    expect(errors.slice(before)).toEqual([]);
  });

  it('&live: the rAF loop runs update (state().time advances) and step() throws', async () => {
    const before = errors.length;
    const page = await open('?hal=1&live');
    await page.evaluate(() => (window as any).__hal.start(0));
    const t0 = await page.evaluate(() => (window as any).__hal.state().time);
    await page.waitForFunction((t0) => (window as any).__hal.state().time > t0 + 0.2, t0);
    expect(await page.evaluate(() => (window as any).__hal.state().mode)).toBe('play');
    const msg = await page.evaluate(() => { try { (window as any).__hal.step(1 / 60, {}); return ''; } catch (e) { return String(e); } });
    expect(msg).toMatch(/live mode/);
    // pauses stay suppressed: a blur and a visibility change leave the game running
    await page.evaluate(() => { window.dispatchEvent(new Event('blur')); document.dispatchEvent(new Event('visibilitychange')); });
    expect(await page.evaluate(() => (window as any).__hal.state().mode)).toBe('play');
    await page.close();
    expect(errors.slice(before)).toEqual([]);
  });

  it('grant("scatter") owns the scatter cannon with shells and rejects other items', async () => {
    const before = errors.length;
    const page = await open('?hal=1');
    const r = await page.evaluate(() => {
      const h = (window as any).__hal;
      h.start(0);
      const before = h.state().p;
      h.grant('scatter', 5);
      const after = h.state().p;
      let msg = '';
      try { h.grant('key'); } catch (e) { msg = String(e); }
      const st = h.step(1 / 60, { fwd: 0, str: 0, turn: 0, pitch: 0, fire: false, weapon: 1 });
      return { before, after, msg, weapon: st.p.weapon };
    });
    expect(r.before).toMatchObject({ shells: 0, weapon: 0 });
    expect(r.after).toMatchObject({ shells: 5, weapon: 0 });
    expect(r.weapon).toBe(1);
    expect(r.msg).toMatch(/cannot grant key/);
    await page.evaluate(() => (window as any).__hal.render()); // the HUD and the scatter gun model render cleanly
    await page.close();
    expect(errors.slice(before)).toEqual([]);
  });

  it('without &live, the rAF loop does not advance time', async () => {
    const page = await open('?hal=1');
    await page.evaluate(() => (window as any).__hal.start(0));
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as any).__hal.state().time)).toBe(0);
    await page.close();
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
    expect(Array.isArray(s.doors)).toBe(true);
    for (const d of s.doors) expect(d.open).toBeGreaterThanOrEqual(0);
    await page.close();
    expect(errors).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('sends nothing to any network: no fetch or beacon calls over ~5 s of play and pagehide', async () => {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => {
      const calls: string[] = [];
      (window as any).__calls = calls;
      window.fetch = ((u: any) => { calls.push(String(u)); return Promise.reject(new Error('stubbed')); }) as any;
      navigator.sendBeacon = ((u: any) => { calls.push(String(u)); return true; }) as any;
    });
    await page.goto(`${origin}/gearhold/index.html?hal`);
    const calls = await page.evaluate(() => {
      const h = (window as any).__hal as Hal;
      h.start(0);
      for (let i = 0; i < 300; i++) h.step(1 / 60, { fwd: 1, str: 0, turn: 0.01, pitch: 0, fire: i % 20 === 0 });
      window.dispatchEvent(new Event('pagehide'));
      document.dispatchEvent(new Event('visibilitychange'));
      return (window as any).__calls as string[];
    });
    await page.close();
    expect(calls).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('forward moves along the facing, turn changes the angle, fire counts shots', async () => {
    const page = await open('?hal');
    const r = await page.evaluate(() => {
      const h = (window as any).__hal as Hal;
      h.start(0);
      const a0 = h.state();
      const t = h.step(1 / 60, { fwd: 0, str: 0, turn: 0.25, pitch: 0, fire: false });
      let st = t;
      for (let i = 0; i < 30; i++) st = h.step(1 / 60, { fwd: 1, str: 0, turn: 0, pitch: 0, fire: false });
      return { a0, turned: t, moved: st };
    });
    expect(r.turned.p.a - r.a0.p.a).toBeCloseTo(0.25, 6);
    const dx = r.moved.p.x - r.turned.p.x, dy = r.moved.p.y - r.turned.p.y;
    expect(Math.hypot(dx, dy)).toBeGreaterThan(0.3);
    expect((dx * Math.cos(r.turned.p.a) + dy * Math.sin(r.turned.p.a)) / Math.hypot(dx, dy)).toBeGreaterThan(0.9);
    const s = await page.evaluate(() => {
      const h = (window as any).__hal as Hal;
      h.start(0);
      let st = h.state();
      for (let i = 0; i < 90; i++) st = h.step(1 / 60, { fwd: 1, str: 0, turn: 0, pitch: 0, fire: true });
      return st;
    });
    expect(s.shotsFired).toBeGreaterThan(0);
    expect(s.hits).toBeLessThanOrEqual(s.shotsFired);
    await page.close();
  });

  it('is deterministic per seed, even when render() is called, and step throws when not running', async () => {
    const run = async (query: string, renderToo: boolean) => {
      const page = await open(query);
      const st = await page.evaluate((renderToo) => {
        const h = (window as any).__hal as Hal;
        h.start(0);
        let st = h.state();
        for (let i = 0; i < 240; i++) {
          st = h.step(1 / 60, { fwd: 1, str: 0, turn: i % 50 === 0 ? 0.4 : 0, pitch: 0, fire: true });
          if (renderToo && i % 7 === 0) h.render();
        }
        return JSON.stringify(st);
      }, renderToo);
      await page.close();
      return st;
    };
    expect(await run('?hal=0', true)).toBe(await run('?hal=0', false));
    const page = await open('?hal');
    const msg = await page.evaluate(() => { try { (window as any).__hal.step(1 / 60, {}); return ''; } catch (e) { return String(e); } });
    expect(msg).toMatch(/game not running/);
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
