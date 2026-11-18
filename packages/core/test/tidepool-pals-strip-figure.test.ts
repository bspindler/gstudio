import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../../games/tidepool-pals/index.html', import.meta.url), 'utf8');

describe('tidepool-pals pool strip figure', () => {
  it('shows the owned pal as the same 3D figure inside the strip svg, keeping the flat pal as fallback', () => {
    const panel = html.match(/function renderPoolPanel\(\)\s*\{([\s\S]*?)\n\}/)![1];
    expect(panel).toContain('creatureSVG(cr, !owned)');
    expect(panel).toContain('upgradeStripPal(cr)');
    const up = html.match(/async function upgradeStripPal\(cr\)\s*\{([\s\S]*?)\n\}/)![1];
    expect(up).toContain('renderFigure(T, cr');
    expect(up).toContain('<image href=');
    expect(up).toMatch(/catch/);
    expect(html).toContain("import('../sdk/vendor/three.module.js')");
  });
  it('the prize card and the strip use one figure renderer', () => {
    expect(html.match(/renderFigure\(/g)!.length).toBeGreaterThanOrEqual(3);
  });
});
