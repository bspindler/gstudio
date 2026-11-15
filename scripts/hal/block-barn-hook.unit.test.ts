// Measurement v2, P0.4: a tap zone Block Barn routes but doesn't list in its ?hal hook is invisible to the scorer
// (the doors and the sky shipped that way). Statically: every `xxxBox()` that tapAt hit-tests must be listed in
// __hal.targets().
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../games/block-barn/index.html', import.meta.url), 'utf8');
const body = (start: RegExp, end: RegExp): string => {
  const i = html.search(start);
  if (i < 0) throw new Error(`not found: ${start}`);
  const rest = html.slice(i);
  const j = rest.search(end);
  return j < 0 ? rest : rest.slice(0, j);
};

describe('block barn hook lists every tap zone', () => {
  it('each box tapAt routes before the nearest-target search appears in __hal.targets()', () => {
    const tapAt = body(/function tapAt\(/, /\n}\n/);
    const routed = [...tapAt.matchAll(/(\w+Box)\(\)/g)].map((m) => m[1]!);
    expect(routed).toEqual(expect.arrayContaining(['doorBox', 'skyBox']));
    const hook = body(/targets: \(\) => \{/, /\n {4}\},\n/);
    for (const fn of new Set(routed)) expect(hook, `${fn}() is routed by tapAt but not listed in __hal.targets()`).toContain(`${fn}()`);
  });
});
