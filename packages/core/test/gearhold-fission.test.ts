import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LEVELS } from '../../../games/gearhold/levels.js';

describe('gearhold fission drones', () => {
  it('only Press Gallery (level 4) has fission drones, and it has wisp drones to split', () => {
    const flagged = (LEVELS as { name: string; fission?: boolean; map: string[] }[]).map((l, i) => (l.fission ? i : -1)).filter((i) => i >= 0);
    expect(flagged).toEqual([3]);
    expect(LEVELS[3]!.map.join('').includes('d')).toBe(true);
  });
  it('the game splits flagged drones into two bigger, slower minis', () => {
    const html = readFileSync(new URL('../../../games/gearhold/index.html', import.meta.url), 'utf8');
    expect(html).toContain('LEVELS[i].fission');
    expect(html).toContain('function splitDrone');
    expect(html).toContain('for (const s of [-1, 1])');
    expect(html).toMatch(/const MINI = \{[^}]*speed: 1\.5[^}]*sc: 2\b/);
  });
});
