// Phone-size screenshots and console errors for all three games (390x844 @2x, touch).
// Gearhold uses the ?hal hook; Tidepool Pals and Hyperline are pressed through their own start buttons.
// Output: <outDir>/<game>/<n>.png (1-based) and <outDir>/<game>/errors.json. Local builds only (127.0.0.1).
//   A browser that can't launch throws "browser unavailable: ...".
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import { closeAll, launchBrowser, repo, serveGames, type StaticServer } from './browser.js';

export const DEFAULT_SCREENS_DIR = join(repo, '.data', 'hal', 'screens');
export type ScreensResult = { game: string; shots: string[]; errors: string[] };

type Shoot = (n?: number) => Promise<void>;
type Flow = (page: Page, origin: string, shoot: Shoot) => Promise<void>;
const wait = (page: Page, ms: number) => page.waitForTimeout(ms);
const tryClick = (page: Page, sel: string) => page.locator(sel).first().click({ timeout: 3000 }).then(() => true, () => false);

const FLOWS: Record<string, Flow> = {
  async gearhold(page, origin, shoot) {
    await page.goto(`${origin}/gearhold/index.html?hal=1`);
    await page.waitForFunction(() => !!(globalThis as any).__hal, null, { timeout: 15000 });
    await page.evaluate(() => (globalThis as any).__hal.render());
    await shoot(); // title
    await page.evaluate(() => (globalThis as any).__hal.start(0));
    await page.evaluate(() => { const h = (globalThis as any).__hal; for (let i = 0; i < 60; i++) h.step(1 / 60, {}); h.render(); });
    await shoot();
    await page.evaluate(() => { const h = (globalThis as any).__hal; for (let i = 0; i < 300; i++) h.step(1 / 60, {}); h.render(); });
    await shoot();
  },
  async 'tidepool-pals'(page, origin, shoot) {
    await page.goto(`${origin}/tidepool-pals/index.html`);
    await wait(page, 1200);
    await shoot(); // title / map
    await tryClick(page, '[data-act="play-next"], [data-act="resume"]');
    await wait(page, 500);
    await tryClick(page, '[data-act="start"]');
    await wait(page, 1200);
    await shoot(); // level start
    // tap a few tiles so the board changes
    const tiles = page.locator('#tiles .tile');
    const n = await tiles.count();
    for (let i = 0; i < Math.min(n, 4); i++) { await tiles.nth(i * 3 % Math.max(n, 1)).click({ timeout: 1500 }).catch(() => {}); await wait(page, 300); }
    await wait(page, 3000);
    await shoot();
  },
  async hyperline(page, origin, shoot) {
    await page.goto(`${origin}/hyperline/index.html`);
    await wait(page, 1200);
    await shoot(); // ready overlay
    const box = await page.locator('#stage').boundingBox();
    const x = box ? box.x + box.width / 2 : 195, y = box ? box.y + box.height / 2 : 400;
    await page.touchscreen.tap(x, y);
    await wait(page, 1200);
    await shoot();
    for (let i = 0; i < 3; i++) { await page.touchscreen.tap(x, y); await wait(page, 500); }
    await shoot();
  },
};

/** Runs every game's flow in a fresh phone-size page; returns the shots and console errors per game. */
export async function runScreens({ outDir = DEFAULT_SCREENS_DIR }: { outDir?: string } = {}): Promise<ScreensResult[]> {
  let server: StaticServer | undefined, browser: Browser | undefined;
  try {
    server = await serveGames();
    browser = await launchBrowser();
    const results: ScreensResult[] = [];
    for (const [game, flow] of Object.entries(FLOWS)) {
      const dir = join(outDir, game);
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
      const page = await ctx.newPage();
      const shots: string[] = [], errors: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
      page.on('crash', () => errors.push('page crashed'));
      const shoot: Shoot = async () => {
        const file = join(dir, `${shots.length + 1}.png`);
        await page.screenshot({ path: file });
        shots.push(file);
      };
      try {
        await flow(page, server.origin, shoot);
      } catch (e) {
        errors.push(`flow: ${String((e as Error)?.message ?? e).split('\n')[0]}`);
        if (shots.length < 2) await shoot().catch(() => {});
      } finally {
        await ctx.close().catch(() => {});
      }
      await writeFile(join(dir, 'errors.json'), JSON.stringify(errors, null, 2) + '\n');
      results.push({ game, shots, errors });
    }
    return results;
  } finally {
    await closeAll(browser, server);
  }
}
