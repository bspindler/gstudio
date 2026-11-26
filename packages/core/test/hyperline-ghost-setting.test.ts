import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { freshSave, migrateSave } from '../../../games/hyperline/lib/meta.js';

const html = readFileSync(new URL('../../../games/hyperline/index.html', import.meta.url), 'utf8');
const r3d = readFileSync(new URL('../../../games/hyperline/render3d.js', import.meta.url), 'utf8');

describe('hyperline: the best-run ghost can be turned off (Brian, 2026-11-25: off by default)', () => {
  it('a Ghost setting, off by default; on only when the player turns it on', () => {
    expect(freshSave().settings.ghost).toBe(false);
    expect(migrateSave({ ...freshSave(), settings: { sound: true, music: true, haptics: true } }).settings.ghost).toBe(false);
    expect(migrateSave({ ...freshSave(), settings: { sound: true, music: true, haptics: true, ghost: true } }).settings.ghost).toBe(true);
  });

  it('settings has the switch, and a run with it off races no ghost', () => {
    expect(html).toContain("sw('ghost', 'Ghost'");
    expect(html).toMatch(/G\.ghost = !S\.settings\.ghost \|\| start > 1 \? null :/);
    expect(html).toMatch(/S\.settings\.ghost && GH\.endless \? 'Race your best-run ghost/);
  });
});

describe('hyperline 3D: nothing is drawn through the camera', () => {
  it('neon segments are trimmed against the tilted near plane, and boxes reaching behind it draw trimmed edges', () => {
    expect(r3d).toMatch(/function clipNear\(/);
    expect(r3d).toMatch(/pts = clipNear\(pts\)/);
    expect(r3d).toMatch(/if \(edgeW > 0\) segs\(boxEdgeSegs\(/); // every box edge is a trimmed, batched segment
    expect(r3d).toMatch(/F\[0\] = c2\.f\[0\]/);
  });

  it('trails and particles fade out before they reach the lens', () => {
    expect(r3d).toMatch(/const lensFade = \(x, y, z = 0\) =>/);
    expect(r3d).toMatch(/alpha \*= lensFade\(x, y, z\)/);
    expect(r3d).toMatch(/pts = pts\.filter\(\(p\) => lensFade\(p\.x, p\.y\) > 0\)/);
  });
});

describe('hyperline settings show the real version', () => {
  it('VERSION matches createStudio, and the settings text uses it', () => {
    // One literal only (Hal's release bump edits just the createStudio one); VERSION is read back from it.
    expect(html).not.toMatch(/const VERSION = '/);
    expect(html).toMatch(/createStudio\(\{ game: 'hyperline', version: '[^']+', get endpoint\(\) \{ VERSION = this\.version;/);
    expect(html).toContain('Hyperline ${VERSION} · Nothing');
  });
});
