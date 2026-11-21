import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../../games/tidepool-pals/index.html', import.meta.url), 'utf8');

describe('tidepool-pals: freed pal swims up into the goal counter', () => {
  it('has a code-drawn arc keyframe aimed at the rescue chip', () => {
    expect(html).toContain('@keyframes swimgoal');
    expect(html).toContain('.swimmer.togoal');
    expect(html).toContain("findIndex((g) => g.t === 'rescue')");
    expect(html).toContain("querySelector('.gi')");
  });
  it('ticks the counter (and so its bounce) only after the swim lands', () => {
    expect(html).toContain('const wait = saved.length && motion() ? GOAL_SWIM_MS : 0');
    const w = html.indexOf('const wait = saved.length');
    const t = html.indexOf('setTimeout(() => {', w);
    const j = html.indexOf('addProgress(lvl.prog, { rescue: saved.length })', w);
    const i = html.indexOf('}, wait);', w);
    expect(j).toBeGreaterThan(t);
    expect(j).toBeLessThan(i);
  });
  it('keeps the old exit-edge swim as the fallback', () => {
    expect(html).toContain('@keyframes swimoff');
  });
});
