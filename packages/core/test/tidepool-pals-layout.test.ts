import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../../games/tidepool-pals/index.html', import.meta.url), 'utf8');

describe('tidepool-pals play layout', () => {
  it('sizes the board wrap to the board and centres board + label in the leftover space', () => {
    const wrap = html.match(/\.boardwrap\{([^}]*)\}/)![1];
    expect(wrap).toContain('aspect-ratio:7/8');
    expect(wrap).toContain('margin-top:auto');
    expect(wrap).not.toMatch(/flex:1[;}]/);
    expect(html).toMatch(/#view-play \.hint\{margin-bottom:auto\}/);
  });
});
