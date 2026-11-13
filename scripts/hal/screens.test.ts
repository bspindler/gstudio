import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runScreens, shootGame } from './screens.js';
import { repo } from './browser.js';

describe('runScreens', () => {
  it('writes changing phone-size PNGs and an errors list for each game', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'hal-screens-'));
    const results = await runScreens({ outDir });
    expect(results.map((r) => r.game).sort()).toEqual(['gearhold', 'hyperline', 'lanternkeep', 'tidepool-pals']);
    // Fonts are bundled in each game folder, so no game should try to reach another host.
    for (const r of results) expect(r.blockedRequests, `${r.game} outbound requests`).toEqual([]);
    for (const r of results) {
      expect(r.errors.filter((e) => /ERR_FAILED|ERR_BLOCKED/.test(e)), `${r.game} blocked-request noise`).toEqual([]);
      expect(r.shots.length, r.game).toBeGreaterThanOrEqual(2);
      const bufs = await Promise.all(r.shots.map(async (f) => { expect((await stat(f)).size).toBeGreaterThan(0); return readFile(f); }));
      expect(new Set(bufs.map((b) => b.toString('base64'))).size, `${r.game} shots all identical`).toBeGreaterThan(1);
      expect(Array.isArray(r.errors)).toBe(true);
      expect(r.reached, `${r.game} reached gameplay: ${r.errors.join('; ')}`).toBe(true);
      expect(r.errors.filter((e) => e.startsWith('flow:')), r.game).toEqual([]);
      expect(Array.isArray(JSON.parse(await readFile(join(outDir, r.game, 'errors.json'), 'utf8')))).toBe(true);
    }
  }, 120_000);
});

describe('shootGame', () => {
  it('writes a 390x844 JPEG of each game in gameplay', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'hal-shoot-'));
    for (const game of ['gearhold', 'tidepool-pals', 'hyperline', 'lanternkeep']) {
      const out = join(outDir, game, 'after.jpg');
      await shootGame(repo, game, out);
      const buf = await readFile(out);
      expect(buf.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
      // JPEG SOF0 frame header carries height then width.
      const sof = buf.indexOf(Buffer.from([0xff, 0xc0]));
      expect(sof, game).toBeGreaterThan(0);
      expect([buf.readUInt16BE(sof + 5), buf.readUInt16BE(sof + 7)], game).toEqual([844, 390]);
    }
    await expect(shootGame(repo, 'nosuch', join(outDir, 'x.jpg'))).rejects.toThrow(/no screen flow/);
  }, 120_000);
});
