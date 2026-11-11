import { describe, expect, it } from 'vitest';
import { launchBrowser, newHalContext, serveGames } from './browser.js';

// The bundled fonts must actually load from each game's own folder (no Google Fonts).
const FONTS: Record<string, string[]> = {
  'tidepool-pals': ['400 32px "Bagel Fat One"', '800 16px "Nunito"'],
  hyperline: ['400 32px "Monoton"', '700 16px "Chakra Petch"'],
};

describe('bundled fonts', () => {
  it.each(Object.keys(FONTS))('%s loads its fonts locally', async (slug) => {
    const server = await serveGames();
    const browser = await launchBrowser();
    try {
      const { context, blockedRequests } = await newHalContext(browser);
      const page = await context.newPage();
      const fontResponses: number[] = [];
      page.on('response', (r) => { if (/\/fonts\/.+\.(woff2|ttf)$/.test(r.url())) fontResponses.push(r.status()); });
      await page.goto(`${server.origin}/${slug}/index.html`);
      const loaded = await page.evaluate(async (specs) => {
        const out: boolean[] = [];
        for (const s of specs) { await document.fonts.load(s, 'Aa'); out.push(document.fonts.check(s, 'Aa')); }
        return out;
      }, FONTS[slug]!);
      expect(loaded).toEqual(FONTS[slug]!.map(() => true));
      expect(fontResponses.length).toBeGreaterThan(0);
      expect(fontResponses.every((s) => s === 200)).toBe(true);
      expect(blockedRequests).toEqual([]);
      await context.close();
    } finally {
      await browser.close();
      await server.close();
    }
  }, 60_000);
});
