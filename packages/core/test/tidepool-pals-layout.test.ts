import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../../games/tidepool-pals/index.html', import.meta.url), 'utf8');

describe('tidepool-pals play layout', () => {
  it('sizes the board from the free height (capped by width) and centres board + label in it', () => {
    const zone = html.match(/\.playzone\{([^}]*)\}/)![1];
    expect(zone).toMatch(/flex:1 1 0/);
    expect(zone).toContain('container-type:size');
    expect(zone).toContain('justify-content:center');
    const wrap = html.match(/\.boardwrap\{([^}]*)\}/)![1];
    expect(wrap).toContain('aspect-ratio:7/8');
    expect(wrap).toMatch(/width:min\(100cqw,calc\(\(100cqh/);
    expect(wrap).not.toContain('margin-top:auto');
    expect(html).toMatch(/<div class="playzone">[\s\S]*id="boardwrap"[\s\S]*id="hint"[\s\S]*<\/div>\s*<\/section>/);
  });
});
