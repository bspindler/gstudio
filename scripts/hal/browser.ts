// Shared headless browser for Hal's play runners: Chromium with WebGL 2 and a local static server for games/.
// Local builds only (hard rule 2): the server binds 127.0.0.1 on an ephemeral port and serves this checkout.
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';

export const repo = join(import.meta.dirname, '..', '..');
const GAMES = join(repo, 'games'), SDK = join(repo, 'packages', 'sdk');
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

export type StaticServer = { server: Server; origin: string; close(): Promise<void> };

/** Serves games/ at / and the SDK at /sdk/ (as `npm run dev` does) on 127.0.0.1 with a random port. */
export function serveGames(): Promise<StaticServer> {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]!));
    const file = path.startsWith('/sdk/') ? join(repo, 'packages', path) : join(GAMES, path);
    if (!file.startsWith(GAMES + sep) && !file.startsWith(SDK + sep)) { res.writeHead(403).end(); return; }
    try {
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({
      server,
      origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      close: () => new Promise<void>((r) => server.close(() => r())),
    }));
  });
}

async function hasWebGL2(browser: Browser): Promise<boolean> {
  const page = await browser.newPage();
  try {
    return await page.evaluate(() => !!(globalThis as any).document.createElement('canvas').getContext('webgl2'));
  } finally { await page.close(); }
}

/**
 * Launches headless Chromium with WebGL 2: the default GPU first, then software GL (swiftshader).
 * Throws an Error whose message starts with "browser unavailable:" when neither works; callers exit 1 on it
 * and never turn it into a score.
 */
export async function launchBrowser(): Promise<Browser> {
  const reasons: string[] = [];
  const tries: { name: string; args: string[] }[] = [
    { name: 'gpu', args: [] },
    { name: 'swiftshader', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  ];
  for (const t of tries) {
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ args: t.args });
      if (await hasWebGL2(browser)) return browser;
      reasons.push(`${t.name}: no WebGL 2`);
    } catch (e) {
      reasons.push(`${t.name}: ${String((e as Error)?.message ?? e).split('\n')[0]}`);
    }
    await browser?.close().catch(() => {});
  }
  throw new Error(`browser unavailable: ${reasons.join('; ')}`);
}

/** Closes a browser and server, ignoring errors from either (for finally blocks). */
export async function closeAll(browser?: Browser, server?: StaticServer): Promise<void> {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
}
