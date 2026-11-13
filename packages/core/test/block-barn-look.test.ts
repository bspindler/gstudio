import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../../../games/block-barn/index.html', import.meta.url)), 'utf8');

describe('block-barn: neighbours turn to look', () => {
  it('has a slow, gentle look animation with no flashing', () => {
    const m = html.match(/@keyframes look \{[^]*?\}\s*\}/);
    expect(m).toBeTruthy();
    expect(html).toMatch(/\.animal\.look \.art \{[^}]*animation: look (\d+(\.\d+)?)s/);
    const secs = Number(html.match(/animation: look (\d+(\.\d+)?)s/)![1]);
    expect(secs).toBeGreaterThanOrEqual(1.5);
    expect(m![0]).not.toMatch(/opacity|scale/);
  });
  it('stays still under reduced motion', () => {
    const rm = html.slice(html.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rm).toMatch(/\.animal\.look \.art \{ animation: none/);
  });
  it('is triggered when a block is named, only for revealed neighbours', () => {
    expect(html).toMatch(/function lookToward\(/);
    expect(html).toMatch(/named\.has\(/);
    expect(html).toMatch(/lookToward\(k\)/);
  });
});
