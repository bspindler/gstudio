// Phone-size screenshots and console errors for all three games (390x844 @2x, touch).
// Gearhold uses the ?hal hook; Tidepool Pals and Hyperline are pressed through their own start buttons.
// Output: <outDir>/<game>/<n>.png (1-based) and <outDir>/<game>/errors.json. Local builds only (127.0.0.1).
//   A browser that can't launch throws "browser unavailable: ...".
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Browser, Page } from 'playwright';
import { closeAll, launchBrowser, newHalContext, repo, serveGames, type HalContext, type StaticServer } from './browser.js';

export const DEFAULT_SCREENS_DIR = join(repo, '.data', 'hal', 'screens');
export type ScreensResult = { game: string; shots: string[]; errors: string[]; reached: boolean; notes: string[]; blockedRequests: string[] };

type Shoot = () => Promise<void>;
type Flow = { reached: boolean; notes: string[] };
type FlowFn = (page: Page, origin: string, shoot: Shoot, flow: Flow) => Promise<void>;
const SETTLE = 250; // short settle before a screenshot
const T = 10_000; // every must-succeed step waits at most this long
const settle = (page: Page) => page.waitForTimeout(SETTLE);

/** Runs a must-succeed step; on failure throws "flow: <name> failed" so the game is reported as not reached. */
async function step(name: string, fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); } catch (e) { throw new Error(`flow: ${name} failed (${String((e as Error)?.message ?? e).split('\n')[0]})`); }
}

const FLOWS: Record<string, FlowFn> = {
  async gearhold(page, origin, shoot, flow) {
    await step('load', async () => {
      await page.goto(`${origin}/gearhold/index.html?hal=1`);
      await page.waitForFunction(() => !!(globalThis as any).__hal, null, { timeout: T });
      await page.evaluate(() => (globalThis as any).__hal.render());
    });
    await shoot(); // title
    await step('start run', async () => {
      await page.evaluate(() => (globalThis as any).__hal.start(0));
      await page.waitForFunction(() => (globalThis as any).__hal.state().mode === 'play', null, { timeout: T });
    });
    await page.evaluate(() => { const h = (globalThis as any).__hal; for (let i = 0; i < 60; i++) h.step(1 / 60, {}); h.render(); });
    flow.reached = await page.evaluate(() => (globalThis as any).__hal.state().mode === 'play');
    await shoot();
    await page.evaluate(() => { const h = (globalThis as any).__hal; for (let i = 0; i < 300; i++) h.step(1 / 60, {}); h.render(); });
    await shoot();
  },
  async 'tidepool-pals'(page, origin, shoot, flow) {
    await step('load map', async () => {
      await page.goto(`${origin}/tidepool-pals/index.html`);
      await page.waitForSelector('#view-map [data-act="play-next"], #view-map [data-act="resume"]', { timeout: T });
    });
    await settle(page);
    await shoot(); // title / map
    // A new player's first level sheet opens by itself; otherwise press Play to open it.
    await step('open level sheet', async () => {
      await page.waitForTimeout(SETTLE);
      if (await page.locator('#modal').isHidden()) await page.locator('#view-map [data-act="play-next"], #view-map [data-act="resume"]').first().click({ timeout: T });
      await page.locator('#modal [data-act="start"]').waitFor({ state: 'visible', timeout: T });
    });
    await step('click start', async () => {
      const start = page.locator('[data-act="start"]');
      await start.waitFor({ state: 'visible', timeout: T });
      await start.click({ timeout: T });
    });
    await step('reach board', async () => {
      await page.waitForSelector('#view-play:not([hidden]) #tiles .tile', { state: 'visible', timeout: T });
      await page.waitForSelector('#view-map', { state: 'hidden', timeout: T });
      await page.waitForSelector('#modal', { state: 'hidden', timeout: T });
    });
    flow.reached = true;
    await settle(page);
    await shoot(); // level start
    const tiles = page.locator('#tiles .tile');
    const n = await tiles.count();
    const picks = [...new Set([0, 1, 7, 8, 15, 22].filter((i) => i < n))].slice(0, 4);
    let moves = await page.locator('#movesCount').textContent();
    for (const i of picks) {
      try { await tiles.nth(i).click({ timeout: 2000 }); } catch (e) { flow.notes.push(`tile ${i} tap failed`); }
      await settle(page);
    }
    if (await page.locator('#movesCount').textContent() === moves) flow.notes.push('tile taps did not change moves');
    await settle(page);
    await shoot();
  },
  async hyperline(page, origin, shoot, flow) {
    await step('load', async () => {
      await page.goto(`${origin}/hyperline/index.html`);
      await page.waitForSelector('#ready:not([hidden])', { timeout: T });
    });
    await settle(page);
    await shoot(); // ready overlay
    await step('start run', async () => {
      const box = await page.locator('#stage').boundingBox();
      if (!box) throw new Error('no stage');
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      // run state: ready overlay gone and the pause button shown
      await page.waitForSelector('#ready', { state: 'hidden', timeout: T });
      await page.waitForSelector('#pauseBtn:not([hidden])', { timeout: T });
    });
    flow.reached = true;
    await settle(page);
    await shoot();
    await page.waitForTimeout(1500); // fixed time into the run, no further taps
    if (await page.locator('#pauseBtn').isHidden()) flow.notes.push('game over before shot 3');
    await shoot();
  },
};

/** Runs every game's flow in a fresh phone-size page; returns the shots and console errors per game. */
export async function runScreens({ outDir = DEFAULT_SCREENS_DIR }: { outDir?: string } = {}): Promise<ScreensResult[]> {
  // The per-game folders under outDir are deleted first, so never aim this at the repo root or the games' own sources.
  const inGames = relative(join(repo, 'games'), resolve(outDir));
  if (resolve(outDir) === resolve(repo) || (inGames !== '..' && !inGames.startsWith('..' + sep) && !isAbsolute(inGames)))
    throw new Error(`screens: refusing --out ${outDir}: it is the repo root or inside games/`);
  let server: StaticServer | undefined, browser: Browser | undefined;
  try {
    server = await serveGames();
    browser = await launchBrowser();
    const results: ScreensResult[] = [];
    for (const [game, flowFn] of Object.entries(FLOWS)) {
      const dir = join(outDir, game);
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      const shots: string[] = [], errors: string[] = [], flow: Flow = { reached: false, notes: [] };
      let hal: HalContext | undefined;
      try {
        hal = await newHalContext(browser, { contextOptions: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } });
        const page = await hal.context.newPage();
        page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
        page.on('crash', () => errors.push('page crashed'));
        const shoot: Shoot = async () => {
          const file = join(dir, `${shots.length + 1}.png`);
          await page.screenshot({ path: file });
          shots.push(file);
        };
        try {
          await flowFn(page, server.origin, shoot, flow);
        } catch (e) {
          flow.reached = false;
          errors.push(String((e as Error)?.message ?? e).split('\n')[0]!.replace(/^(?!flow:)/, 'flow: failed: '));
          if (shots.length < 2) await shoot().catch(() => {});
        }
      } catch (e) {
        errors.push(`flow: setup failed (${String((e as Error)?.message ?? e).split('\n')[0]})`);
      } finally {
        await hal?.context.close().catch(() => {});
        if (hal) errors.push(...hal.consoleErrors); // console.error minus blocked-request noise
        await writeFile(join(dir, 'errors.json'), JSON.stringify(errors, null, 2) + '\n');
      }
      results.push({ game, shots, errors, reached: flow.reached, notes: flow.notes, blockedRequests: hal?.blockedRequests ?? [] });
    }
    return results;
  } finally {
    await closeAll(browser, server);
  }
}

/** History-shot settings: phone portrait at device scale 1, JPEG quality 70, so a night's images stay small in git. */
export const HISTORY_SHOT = { width: 390, height: 844, deviceScaleFactor: 1, quality: 70 } as const;

/**
 * Hal's `shoot` port: one JPEG of `game` in gameplay (the flow's second shot, as in runScreens), served from the tree at
 * `rootDir` (a worktree), written to `outPath`. Throws when the game has no flow, the browser is unavailable, or the flow
 * fails before gameplay.
 */
export async function shootGame(rootDir: string, game: string, outPath: string): Promise<void> {
  const flowFn = Object.hasOwn(FLOWS, game) ? FLOWS[game]! : undefined;
  if (!flowFn) throw new Error(`shoot: no screen flow for ${game}`);
  let server: StaticServer | undefined, browser: Browser | undefined, hal: HalContext | undefined;
  try {
    server = await serveGames(rootDir);
    browser = await launchBrowser();
    hal = await newHalContext(browser, { contextOptions: { viewport: { width: HISTORY_SHOT.width, height: HISTORY_SHOT.height }, deviceScaleFactor: HISTORY_SHOT.deviceScaleFactor, hasTouch: true, isMobile: true } });
    const page = await hal.context.newPage();
    await mkdir(dirname(outPath), { recursive: true });
    let n = 0, done = false;
    const shoot: Shoot = async () => {
      if (++n !== 2) return;
      await page.screenshot({ path: outPath, type: 'jpeg', quality: HISTORY_SHOT.quality });
      done = true;
    };
    try { await flowFn(page, server.origin, shoot, { reached: false, notes: [] }); } catch (e) { if (!done) throw e; }
    if (!done) throw new Error(`shoot: ${game} flow ended before gameplay`);
  } finally {
    await hal?.context.close().catch(() => {});
    await closeAll(browser, server);
  }
}
