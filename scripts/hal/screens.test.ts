import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runScreens } from './screens.js';

describe('runScreens', () => {
  it('writes changing phone-size PNGs and an errors list for each game', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'hal-screens-'));
    const results = await runScreens({ outDir });
    expect(results.map((r) => r.game).sort()).toEqual(['gearhold', 'hyperline', 'tidepool-pals']);
    for (const r of results) {
      expect(r.shots.length, r.game).toBeGreaterThanOrEqual(2);
      const bufs = await Promise.all(r.shots.map(async (f) => { expect((await stat(f)).size).toBeGreaterThan(0); return readFile(f); }));
      expect(new Set(bufs.map((b) => b.toString('base64'))).size, `${r.game} shots all identical`).toBeGreaterThan(1);
      expect(Array.isArray(r.errors)).toBe(true);
      expect(Array.isArray(JSON.parse(await readFile(join(outDir, r.game, 'errors.json'), 'utf8')))).toBe(true);
    }
  }, 120_000);
});
