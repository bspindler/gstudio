// Browser-free (runs in npm test): a browser that cannot launch is an error, never a score.
import { describe, expect, it, vi } from 'vitest';

vi.mock('playwright', () => ({
  chromium: { launch: vi.fn(async () => { throw new Error("Executable doesn't exist at /nowhere\nmore detail"); }) },
}));

const { launchBrowser, serveGames } = await import('./browser.js');
const { request } = await import('node:http');
const { runGearholdPlay } = await import('./gearhold-play.js');

describe('browser unavailable', () => {
  it('launchBrowser tries gpu then swiftshader and throws "browser unavailable: ..."', async () => {
    await expect(launchBrowser()).rejects.toThrow(/^browser unavailable: gpu: Executable doesn't exist at \/nowhere; swiftshader: /);
  });

  it('runGearholdPlay rejects instead of returning records', async () => {
    await expect(runGearholdPlay({ levels: [0], seeds: 1 })).rejects.toThrow(/^browser unavailable:/);
  });
});

describe('static server', () => {
  const get = (origin: string, path: string): Promise<number> => new Promise((resolve, reject) => {
    const u = new URL(origin);
    request({ host: u.hostname, port: u.port, path }, (res) => { res.resume(); resolve(res.statusCode ?? 0); }).on('error', reject).end();
  });

  it('answers missing paths, directories and malformed escapes with a status and stays up', async () => {
    const server = await serveGames();
    try {
      expect(await get(server.origin, '/nope/missing.js')).toBe(404);
      expect(await get(server.origin, '/')).toBe(404); // a directory
      expect(await get(server.origin, '/favicon.ico')).toBe(404);
      expect(await get(server.origin, '/%E0%A4%A')).toBe(400);
      expect(await get(server.origin, '/../package.json')).not.toBe(200);
      expect(await get(server.origin, '/gearhold/index.html')).toBe(200); // still alive
      expect(server.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    } finally { await server.close(); }
  });

  it('serves another tree (a worktree) when given its root', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = mkdtempSync(join(tmpdir(), 'hal-serve-'));
    mkdirSync(join(root, 'games', 'only-here'), { recursive: true });
    writeFileSync(join(root, 'games', 'only-here', 'index.html'), 'hi');
    const server = await serveGames(root);
    try {
      expect(await get(server.origin, '/only-here/index.html')).toBe(200);
      expect(await get(server.origin, '/gearhold/index.html')).toBe(404); // not this checkout's games
    } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
