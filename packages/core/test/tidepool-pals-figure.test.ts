import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { figureCamera, figureParts } from '../../../games/tidepool-pals/figure.js';

const html = readFileSync(new URL('../../../games/tidepool-pals/index.html', import.meta.url), 'utf8');
const SHAPES = ['round', 'tall', 'wide'] as const;
const FEATS = ['shell', 'fins', 'claws', 'spikes', 'tentacles', 'lure', 'crown'] as const;

describe('tidepool-pals 3D prize figure', () => {
  for (const shape of SHAPES) for (const feat of FEATS) {
    it(`fits ${shape}/${feat} whole inside the card with margin on both sides`, () => {
      const parts = figureParts({ shape, feat, col: '#F4A259' });
      expect(parts.length).toBeGreaterThan(4);
      const cam = figureCamera(parts, 1, 30);
      // project every part's extent at the camera distance: it must stay inside +-1 with margin
      const t = Math.tan((cam.fov * Math.PI) / 360);
      for (const p of parts) {
        const r = Math.max(...p.s);
        const reachX = Math.hypot(p.p[0], p.p[2]) + r;
        const reachY = Math.max(p.p[1] + r - cam.centreY, cam.centreY - (p.p[1] - r));
        const nearZ = cam.distance - Math.hypot(p.p[0], p.p[2]);
        expect(reachX / (nearZ * t)).toBeLessThan(0.92);
        expect(reachY / (nearZ * t)).toBeLessThan(0.92);
      }
    });
  }

  it('hides the flat pal until the 3D figure has rendered', () => {
    expect(html).toMatch(/\.reveal\.fig \.flatpal\{display:none[;}]/);
    expect(html).toMatch(/\.reveal\.fig\.flat \.flatpal\{display:block[;}]/);
    expect(html).toMatch(/\.reveal\.fig canvas\{[^}]*visibility:hidden/);
    expect(html).toMatch(/\.reveal\.fig\.ready canvas\{[^}]*visibility:visible/);
  });
});
