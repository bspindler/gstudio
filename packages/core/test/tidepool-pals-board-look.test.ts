import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../../games/tidepool-pals/index.html', import.meta.url), 'utf8');

describe('tidepool-pals per-pool board look', () => {
  it('tints, textures and frames the board from the level pool, all drawn in code', () => {
    const fn = html.match(/function boardLook\(\)\s*\{([\s\S]*?)\n\}/)![1];
    expect(fn).toContain('poolOf(lvl.n)');
    expect(fn).toContain('--tex');
    expect(fn).toContain('boardFrame(');
    expect(html.match(/function drawSlots\(\)\s*\{\s*boardLook\(\);/)).not.toBeNull();
    expect(html).toContain('data:image/svg+xml');
    expect(html).toMatch(/\.slot\{[^}]*var\(--s1/);
    expect(html).toMatch(/\.bframe\{[^}]*pointer-events:none/);
  });
});
