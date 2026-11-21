import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../../games/tidepool-pals/index.html', import.meta.url), 'utf8');
const crabFn = () => html.slice(html.indexOf('function crabScuttle('), html.indexOf('function glowThenFinish'));

describe('tidepool-pals: a little crab scuttles along the rim after a chain of 3 or more', () => {
  it('is a code-drawn svg crab with a walk animation, no assets', () => {
    expect(html).toContain('@keyframes crabwalk');
    expect(html).toMatch(/const CRAB_SVG = '<svg/);
    expect(crabFn()).toContain('CRAB_SVG');
    expect(crabFn()).not.toMatch(/fetch|http|Audio|new Image/);
  });
  it('walks the way the tide pulls and is skipped for reduced motion', () => {
    expect(crabFn()).toContain('lvl.dir');
    expect(crabFn()).toContain('motion()');
  });
  it('fires once per swap, on the 3rd clear of a chain, from cascade, and touches no board state', () => {
    expect(html).toContain('const CRAB_CHAIN = 2;');
    expect(html).toMatch(/if \(step === CRAB_CHAIN\) crabScuttle\(\);/);
    expect(crabFn()).not.toMatch(/grid|rng|lvl\.moves|prog/);
  });
});
