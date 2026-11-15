// Permission split A (2026-11-15): Hal's Lanternkeep controls and screenshot checks plant on night 1. The tile is read
// from the served game's own night 1 (nearest free tile to 3,2), never pinned, so a night 1 whose path crosses the usual
// tile still passes those protected checks.
import { describe, expect, it } from 'vitest';
import { LEVELS } from '../../games/lanternkeep/lib/levels.js';
import * as sim from '../../games/lanternkeep/lib/sim.js';
import type { Level } from '../../games/lanternkeep/lib/sim.js';
import { LANTERNKEEP_PLANT_CELL, LANTERNKEEP_PLANT_CELL_FN } from './browser.js';

const plantCell = new Function(`return ${LANTERNKEEP_PLANT_CELL_FN}`)() as (level: Level, s: typeof sim) => [number, number];
const free = (l: Level, [c, r]: [number, number]) => sim.canBuild(sim.createGame(l), c, r);

describe('lanternkeep plant cell', () => {
  it('is a free tile on every night', () => {
    for (const l of LEVELS) expect(free(l, plantCell(l, sim)), l.name).toBe(true);
  });

  it('is 3,2 when that tile is free, else the nearest free tile', () => {
    const open: Level = { ...LEVELS[0]!, paths: [[[8, -1], [8, 12]]] };
    expect(plantCell(open, sim)).toEqual([3, 2]);
    const lane: Level = { ...LEVELS[0]!, paths: [[[3, -1], [3, 12]]] };
    expect(free(lane, [3, 2])).toBe(false);
    const [c, r] = plantCell(lane, sim);
    expect(free(lane, [c, r])).toBe(true);
    expect(Math.abs(c - 3) + Math.abs(r - 2)).toBe(1);
  });

  it('runs in the page against the served game, night 1', () => {
    expect(LANTERNKEEP_PLANT_CELL).toContain("import('/lanternkeep/lib/levels.js')");
    expect(LANTERNKEEP_PLANT_CELL).toContain("import('/lanternkeep/lib/sim.js')");
    expect(LANTERNKEEP_PLANT_CELL).toContain('LEVELS[0]');
  });
});
