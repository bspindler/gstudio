import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Static checks on Hyperline for rules the generic compliance scan cannot see.
const read = (f: string) => readFileSync(new URL(`../../../games/hyperline/${f}`, import.meta.url), 'utf8');
const html = read('index.html');

describe('hyperline: determinism and fairness', () => {
  it('course generation and physics never use Math.random (only the seeded rng)', () => {
    for (const f of ['lib/course.js', 'lib/sim.js', 'lib/world.js', 'lib/rng.js']) expect(read(f), f).not.toMatch(/Math\.random/);
  });

  it('the daily run is seeded from the UTC day', () => {
    expect(html).toMatch(/dailySeed\(today\(\)\)/);
    expect(html).toMatch(/const today = \(\) => utcDay\(Date\.now\(\)\)/);
  });

  it('is version 0.3.0 in game.yaml and createStudio', () => {
    expect(read('game.yaml')).toMatch(/^version: 0\.3\.0$/m);
    expect(html).toMatch(/createStudio\(\{[^}]*version: '0\.3\.0'/);
  });
});

describe('hyperline: no paid path to a random reward', () => {
  const catalog = html.slice(html.indexOf('const CATALOG = {'), html.indexOf('};', html.indexOf('const CATALOG = {')));

  it('the real-money catalog sells no crate', () => {
    expect(catalog).not.toMatch(/crate/i);
  });

  it('odds.roll is only reached by opening an earned crate, with odds on screen', () => {
    expect(html.match(/odds\.roll\(/g)).toHaveLength(1);
    expect(html).toMatch(/case 'crack': if \(!S\.crates\) break;/);
    const crateModal = html.slice(html.indexOf("case 'crate':"), html.indexOf("case 'crack':"));
    expect(crateModal).toContain('oddsTxt()');
  });

  it('trails are unlocked with credits for a specific item', () => {
    const unlock = html.slice(html.indexOf("case 'trail-unlock':"), html.indexOf("case 'reset':"));
    expect(unlock).toMatch(/S\.credits -= t\.cost; S\.trails\[id\] = 1;/);
    expect(unlock).not.toMatch(/odds|roll|random/i);
  });
});
