// Browser tests for the Gearhold play runner (HAL_BROWSER=1 npx vitest run --project hal-browser).
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LEVELS } from '../../games/gearhold/levels.js';
import { closeAll, launchBrowser, serveGames, type StaticServer } from './browser.js';
import { policyBundle, policySeed, runGearholdPlay } from './gearhold-play.js';

describe('runGearholdPlay', () => {
  it('is deterministic: the same level and seed twice give identical PlayRecords', async () => {
    const a = await runGearholdPlay({ levels: [0, 2], seeds: 2, seedBase: 3 });
    const b = await runGearholdPlay({ levels: [0, 2], seeds: 2, seedBase: 3 });
    expect(a.errors).toEqual([]);
    expect(a.records).toHaveLength(4);
    expect(b).toEqual(a);
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

  it('policy seeds differ per seed and per level', () => {
    expect(new Set([policySeed(0, 0), policySeed(1, 0), policySeed(0, 1), policySeed(1, 1)]).size).toBe(4);
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
