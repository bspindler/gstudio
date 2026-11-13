import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../../games/tidepool-pals/index.html', import.meta.url), 'utf8');

describe('tidepool-pals play layout', () => {
  it('sizes the board from the free height (capped by width) and centres board + label in it', () => {
    const zone = html.match(/\.playzone\{([^}]*)\}/)![1];
    expect(zone).toMatch(/flex:1 1 0/);
    expect(zone).toContain('container-type:size');
    expect(zone).toContain('justify-content:flex-start');
    expect(zone).not.toContain('justify-content:center');
    const wrap = html.match(/\.boardwrap\{([^}]*)\}/)![1];
    expect(wrap).toContain('aspect-ratio:7/8');
    expect(wrap).toMatch(/width:min\(100cqw,calc\(\(100cqh/);
    expect(wrap).not.toContain('margin-top:auto');
    expect(html).toMatch(/<div class="playzone">[\s\S]*id="boardwrap"[\s\S]*id="hint"[\s\S]*<\/div>\s*<\/section>/);
  });

  it('fills the band under the board with a calm pal-and-goal panel (no timers, no pressure)', () => {
    expect(html).toMatch(/id="hint"[\s\S]*id="poolPanel"[\s\S]*<\/div>\s*<\/section>/);
    const panel = html.match(/\.poolpanel\{([^}]*)\}/)![1];
    expect(panel).toContain('min-height:0');
    expect(panel).toContain('overflow:hidden');
    const fn = html.match(/function renderPoolPanel\(\)\s*\{([\s\S]*?)\n\}/)![1];
    expect(fn).toContain('poolProgress');
    expect(fn).toContain('levels cleaned up');
    expect(fn).not.toMatch(/setInterval|setTimeout|Date\.now|hurry|only \d|expires/i);
    expect(html).toMatch(/startLevel[\s\S]*renderPoolPanel\(\);[\s\S]*armIdle\(\);\s*return true;/);
  });
});
