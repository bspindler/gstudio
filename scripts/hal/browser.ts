// Shared headless browser for Hal's play runners: Chromium with WebGL 2 and a local static server for games/.
// Local builds only (hard rule 2): the server binds 127.0.0.1 on an ephemeral port and serves this checkout.
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, join, posix, relative, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type ConsoleMessage } from 'playwright';

export const repo = join(import.meta.dirname, '..', '..');
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain', '.md': 'text/markdown',
};

/** Ports of the static servers serveGames() has open in this process; newHalContext allows only these on loopback. */
const HAL_SERVER_PORTS = new Set<number>();

export type StaticServer = { server: Server; origin: string; close(): Promise<void> };

/**
 * Serves <root>/games/ at / and <root>/packages/sdk/ at /sdk/ (as `npm run dev` does) on 127.0.0.1 with a random port.
 * `root` defaults to this checkout; Hal passes a worktree to see that tree's games.
 */
export function serveGames(root: string = repo): Promise<StaticServer> {
  const GAMES = join(root, 'games'), SDK = join(root, 'packages', 'sdk');
  // Never throws: a bad escape is 400, anything unreadable (missing, a directory, outside the roots) 404/403.
  const server = createServer(async (req, res) => {
    try {
      let path: string;
      // URL paths are always '/'-separated, so normalize them as posix; only the joined file path is OS-specific.
      try { path = posix.normalize(decodeURIComponent((req.url ?? '/').split('?')[0]!)); } catch { res.writeHead(400).end(); return; }
      const file = path.startsWith('/sdk/') ? join(root, 'packages', ...path.split('/')) : join(GAMES, ...path.split('/'));
      const inside = (root: string): boolean => { const r = relative(root, file); return r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r); };
      if (!inside(GAMES) && !inside(SDK)) { res.writeHead(403).end(); return; }
      let body: Buffer;
      try { body = await readFile(file); } catch { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      HAL_SERVER_PORTS.add(port);
      resolve({
        server,
        origin: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => { HAL_SERVER_PORTS.delete(port); server.close(() => r()); }),
      });
    });
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
 * and never turn it into a score. `args` are extra Chromium switches added to every try (for example Block Barn's
 * recorder test passes the fake-microphone switches); without them the launch is unchanged.
 */
export async function launchBrowser(opts: { args?: string[] } = {}): Promise<Browser> {
  const reasons: string[] = [];
  const tries: { name: string; args: string[] }[] = [
    { name: 'gpu', args: [] },
    { name: 'swiftshader', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  ];
  for (const t of tries) {
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ args: [...t.args, ...(opts.args ?? [])] });
      if (await hasWebGL2(browser)) return browser;
      reasons.push(`${t.name}: no WebGL 2`);
    } catch (e) {
      reasons.push(`${t.name}: ${String((e as Error)?.message ?? e).split('\n')[0]}`);
    }
    await browser?.close().catch(() => {});
  }
  throw new Error(`browser unavailable: ${reasons.join('; ')}`);
}

const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];
const DEFAULT_PORT: Record<string, string> = { 'http:': '80', 'https:': '443', 'ws:': '80', 'wss:': '443' };

export type HalContext = {
  context: BrowserContext;
  /** URLs of requests and WebSockets refused because they are not allowed (live; read it after the page work). */
  blockedRequests: string[];
  /** console.error messages from pages in this context, minus the load failures of blocked requests. */
  consoleErrors: string[];
};

/** True for a console message that only reports a request this context blocked (ERR_FAILED / ERR_BLOCKED*). */
export function isBlockedNoise(msg: Pick<ConsoleMessage, 'text' | 'location'>, blockedRequests: readonly string[]): boolean {
  const text = msg.text();
  if (!/ERR_FAILED|ERR_BLOCKED/.test(text)) return false;
  const url = msg.location()?.url ?? '';
  return blockedRequests.some((b) => b === url || text.includes(b));
}

/** host:port for a URL (IPv6 hosts bracketed, default ports filled in), or '' when it has no network host. */
function hostPort(url: string): string {
  try {
    const u = new URL(url);
    if (!u.hostname) return '';
    return `${u.hostname}:${u.port || DEFAULT_PORT[u.protocol] || ''}`;
  } catch { return ''; }
}

/**
 * A fresh browser context for Hal page work. Allowed: loopback (127.0.0.1, localhost, [::1]) on the port of
 * a static server serveGames() has open in this process, and each `allowHosts` entry given as "host:port"
 * (for example "localhost:5173" for `npm run dev`). Everything else is refused and its URL recorded in
 * `blockedRequests`: HTTP(S) requests, including those a service worker makes, are aborted via context.route,
 * and WebSockets are closed via context.routeWebSocket before they connect. Other local ports are refused too.
 * data:/blob: URLs never touch the network and are not routed. Console errors caused by the aborts are left
 * out of `consoleErrors`. Close it with `context.close()`.
 */
export async function newHalContext(browser: Browser, opts: { allowHosts?: string[]; contextOptions?: BrowserContextOptions } = {}): Promise<HalContext> {
  const extra = new Set(opts.allowHosts ?? []);
  const allowed = (url: string): boolean => {
    const hp = hostPort(url);
    if (!hp) return false;
    if (extra.has(hp)) return true;
    const i = hp.lastIndexOf(':');
    return LOOPBACK.includes(hp.slice(0, i)) && HAL_SERVER_PORTS.has(Number(hp.slice(i + 1)));
  };
  const context = await browser.newContext(opts.contextOptions);
  const blockedRequests: string[] = [], consoleErrors: string[] = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (allowed(url)) return route.continue();
    blockedRequests.push(url);
    return route.abort('blockedbyclient');
  });
  await context.routeWebSocket(/.*/, (ws) => {
    if (allowed(ws.url())) { ws.connectToServer(); return; }
    blockedRequests.push(ws.url());
    void ws.close().catch(() => {});
  });
  context.on('console', (msg) => {
    if (msg.type() === 'error' && !isBlockedNoise(msg, blockedRequests)) consoleErrors.push(msg.text());
  });
  return { context, blockedRequests, consoleErrors };
}

/** Closes a browser and server, ignoring errors from either (for finally blocks). */
export async function closeAll(browser?: Browser, server?: StaticServer): Promise<void> {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
}

/**
 * Lanternkeep: a free tile to plant on at the start of a night, 3,2 when it is free, else the nearest free one (ties:
 * reading order), by the game's own rules (sim.canBuild). Source text, so it runs in the page against whichever tree
 * is served; the controls and screenshot checks tap it on night 1 (LANTERNKEEP_PLANT_CELL), never a pinned tile.
 */
export const LANTERNKEEP_PLANT_CELL_FN = `(level, sim) => {
  const g = sim.createGame(level);
  let best = null, bestD = Infinity;
  for (let r = 0; r < sim.ROWS; r++) for (let c = 0; c < sim.COLS; c++) {
    if (!sim.canBuild(g, c, r)) continue;
    const d = Math.abs(c - 3) + Math.abs(r - 2);
    if (d < bestD) { best = [c, r]; bestD = d; }
  }
  if (!best) throw new Error('lanternkeep: no free tile on ' + level.name);
  return best;
}`;
/** In the page (served at /): night 1's plant cell, as [col, row]. */
export const LANTERNKEEP_PLANT_CELL = `Promise.all([import('/lanternkeep/lib/levels.js'), import('/lanternkeep/lib/sim.js')]).then(([{ LEVELS }, sim]) => (${LANTERNKEEP_PLANT_CELL_FN})(LEVELS[0], sim))`;
