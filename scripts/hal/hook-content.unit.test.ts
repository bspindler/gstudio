// Permission split A (2026-11-15): the frozen `// ---- hal hook` blocks hold machinery only (reading state, stepping,
// seeding). Game content (level lists, names, counts, tap zones, on-screen elements) lives in game code the hook reads,
// so growing the game never needs a hook edit (HAL-130's weathervane was discarded for exactly that).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { halHookBlock } from '../../packages/core/src/hal/tripwires.js';

const read = (slug: string) => readFileSync(new URL(`../../games/${slug}/index.html`, import.meta.url), 'utf8');
const GAMES = ['gearhold', 'lanternkeep', 'block-barn'] as const;

/** Array literals of two or more string literals in a hook block: a list of game things, which belongs in the game. */
function stringLists(hook: string): string[] {
  return [...hook.matchAll(/\[\s*(['"`])[^'"`]*\1(?:\s*,\s*(['"`])[^'"`]*\2)+\s*,?\s*\]/g)].map((m) => m[0]);
}
/** Number literals the hook compares a level, night, sector or count against (e.g. `level < 3`). */
function pinnedCounts(hook: string): string[] {
  return [...hook.matchAll(/\b(?:level|levels|night|nights|sector|sectors|n|i)\s*(?:[<>]=?|===?|!==?)\s*\d+/g)].map((m) => m[0]);
}

describe('hal hook blocks hold no game content', () => {
  it.each(GAMES)('%s: the hook block is present', (slug) => {
    expect(halHookBlock(read(slug))).not.toBeNull();
  });

  it.each(GAMES)('%s: no list of game things inside the hook', (slug) => {
    expect(stringLists(halHookBlock(read(slug))!)).toEqual([]);
  });

  it.each(GAMES)('%s: no level, night or sector count pinned inside the hook', (slug) => {
    expect(pinnedCounts(halHookBlock(read(slug))!)).toEqual([]);
  });

  it('gearhold: the hook reads its level count and its overlays from the game', () => {
    const src = read('gearhold'), hook = halHookBlock(src)!;
    expect(hook).toMatch(/levels\(\) \{ return LEVELS\.length; \}/);
    expect(hook).toMatch(/for \(const id of OVERLAY_IDS\)/);
    expect(src.replace(hook, '')).toMatch(/\nconst OVERLAY_IDS = \[/);
  });

  it('the checks catch content put back into a hook', () => {
    expect(stringLists("for (const id of ['hands', 'hud']) x(id);")).toHaveLength(1);
    expect(stringLists("grant(item) { if (item !== 'scatter') throw 1; }")).toEqual([]);
    expect(pinnedCounts('if (level >= 3) return;')).toEqual(['level >= 3']);
    expect(pinnedCounts('levels() { return LEVELS.length; }')).toEqual([]);
  });
});
