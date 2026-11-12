import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { asFingerprint, fingerprintGame, firstChanged } from './focus.js';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const f = (...keys: string[]) => keys.map((key) => ({ key, label: key }));

describe('firstChanged', () => {
  it('the first level whose data differs, a new one included; null when none does', () => {
    expect(firstChanged(f('a', 'b', 'c'), f('a', 'X', 'c'))).toBe(1);
    expect(firstChanged(f('a', 'b'), f('a', 'b', 'c'))).toBe(2);
    expect(firstChanged(f('a', 'b'), f('a', 'b'))).toBeNull();
    expect(firstChanged(f('a', 'b', 'c'), f('a', 'b'))).toBeNull(); // removal is the level-removed tripwire's business
  });
});

describe('asFingerprint', () => {
  it('accepts {key,label}[] and clips them; anything else is null', () => {
    expect(asFingerprint([{ key: 'k', label: 'level 1,\n Hall' }])).toEqual([{ key: 'k', label: 'level 1, Hall' }]);
    for (const v of [null, {}, [{ key: 1, label: 'x' }], [{ key: 'k' }], Array(501).fill({ key: 'k', label: 'l' })]) expect(asFingerprint(v)).toBeNull();
  });
});

describe('fingerprintGame (this tree)', () => {
  it('one entry per Gearhold level, Tidepool level (at least 30) and Hyperline sector, stable across calls', async () => {
    const g = await fingerprintGame(repo, 'gearhold');
    expect(g.length).toBeGreaterThanOrEqual(3);
    expect(g[0]!.label).toMatch(/^level 1, .+, from above$/);
    expect((await fingerprintGame(repo, 'tidepool-pals')).length).toBeGreaterThanOrEqual(30);
    const h = await fingerprintGame(repo, 'hyperline');
    expect(h.length).toBeGreaterThanOrEqual(8);
    expect(h[0]!.label).toMatch(/^sector 1, /);
    expect(await fingerprintGame(repo, 'hyperline')).toEqual(h);
    expect(new Set(g.map((x) => x.key)).size).toBe(g.length);
    await expect(fingerprintGame(repo, 'pong')).rejects.toThrow(/no level data/);
  });
});
