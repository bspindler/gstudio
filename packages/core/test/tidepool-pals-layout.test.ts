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
    // a compact strip: sized by its content, not stretched to fill the band
    expect(panel).toContain('flex:0 0 auto');
    expect(panel).not.toContain('container-type');
    expect(html.match(/\.pp \.ppal\{([^}]*)\}/)![1]).toContain('width:40px');
    const fn = html.match(/function renderPoolPanel\(\)\s*\{([\s\S]*?)\n\}/)![1];
    expect(fn).toContain('poolProgress');
    expect(fn).toContain('levels cleaned up');
    expect(fn).not.toMatch(/setInterval|setTimeout|Date\.now|hurry|only \d|expires/i);
    // The panel is drawn as the board is built; the idle hint wakes once the player taps Let's go on the mission card.
    expect(html).toMatch(/startLevel[\s\S]*renderPoolPanel\(\);[\s\S]*beginLevel\(\);\s*return true;/);
    expect(html).toMatch(/function beginLevel\(\)\s*\{[\s\S]*?armIdle\(\);\s*\}/);
  });

  it('shows the favourite-pal line on its own second line so it is not cut off', () => {
    const fn = html.match(/function renderPoolPanel\(\)\s*\{([\s\S]*?)\n\}/)![1];
    expect(fn).toContain('class="psub ppline"');
    expect(fn).not.toMatch(/\$\{st\.name\}\$\{palLine/);
  });

  it('wiggles the strip pal once on a level win, in code, without growing the strip', () => {
    expect(html.match(/\.pp \.ppal svg\.happy\{([^}]*)\}/)![1]).toContain('palhappy');
    expect(html).toContain('@keyframes palhappy');
    expect(html.match(/function win\(\)\s*\{([\s\S]*?)\n\}/)![1]).toContain('wigglePal()');
    expect(html.match(/\.pp \.ppal\{([^}]*)\}/)![1]).toContain('width:40px');
  });

  it('bobs the strip pal up when a move advances the goal, without resizing the strip', () => {
    expect(html.match(/\.pp \.ppal svg\.peek\{([^}]*)\}/)![1]).toContain('palpeek');
    expect(html).toContain('@keyframes palpeek');
    expect(html).toContain('function peekPal(c)');
    expect(html.match(/function onTileTap\(el\)\s*\{([\s\S]*?)\n\}/)![1]).toMatch(/if \(gained\) peekPal\(c\)/);
    expect(html.match(/\.pp \.ppal\{([^}]*)\}/)![1]).toContain('width:40px');
  });

  it('turns the strip pal toward the side of the board that was tapped, without resizing the strip', () => {
    expect(html.match(/\.pp \.ppal svg\.glance\{([^}]*)\}/)![1]).toContain('palglance');
    expect(html).toContain('@keyframes palglance');
    expect(html).toContain('function glanceDeg(c)');
    expect(html.match(/function onTileTap\(el\)\s*\{([\s\S]*?)\n\}/)![1]).toMatch(/else glancePal\(c\)/);
    expect(html.match(/\.pp \.ppal\{([^}]*)\}/)![1]).toContain('width:40px');
  });

  it('reserves the measured height of the label and pool strip under the board, so the strip never runs onto the tabs', () => {
    const wrap = html.match(/\.boardwrap\{([^}]*)\}/)![1];
    expect(wrap).toMatch(/width:min\(100cqw,calc\(\(100cqh - var\(--below,\s*\d+px\)\) \* 7 \/ 8\)\)/);
    const fn = html.match(/function fitBelow\(\)\s*\{([\s\S]*?)\n\}/)![1];
    expect(fn).toContain("$('hint')");
    expect(fn).toContain("$('poolPanel')");
    expect(fn).toContain("'--below'");
    expect(html).toMatch(/new ResizeObserver\(fitBelow\)/);
  });
});
