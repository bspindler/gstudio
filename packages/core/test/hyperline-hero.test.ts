import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { freshSave, migrateSave } from '../../../games/hyperline/lib/meta.js';
import { GARMENTS, OUTFITS, PARTS, partGarments, partOfBone, PATTERNS } from '../../../games/hyperline/outfit3d.js';
import { BODIES, HERO } from '../../../games/hyperline/render3d.js';

const html = readFileSync(new URL('../../../games/hyperline/index.html', import.meta.url), 'utf8');
const r3d = readFileSync(new URL('../../../games/hyperline/render3d.js', import.meta.url), 'utf8');
const skinIds = [...html.matchAll(/\{ id: '([a-z]+)', name: '[^']+', rar:/g)].map((m) => m[1]!);

describe('hyperline hero runner: the player picks M or F (Brian, 2026-11-25)', () => {
  it('a body setting, M by default; F is kept; anything else is M', () => {
    expect(freshSave().body).toBe('m');
    expect(migrateSave({ ...freshSave(), body: 'f' }).body).toBe('f');
    expect(migrateSave({ ...freshSave(), body: 'robot' }).body).toBe('m');
  });

  it('both bodies load on demand; the runner stands under a low ceiling', async () => {
    expect(Object.keys(BODIES)).toEqual(['m', 'f']);
    for (const k of ['m', 'f'] as const) expect((await BODIES[k]()).default.clips.map((c: { name: string }) => c.name)).toEqual(expect.arrayContaining(['run', 'jump', 'idle']));
    const { BAR_Y, PS } = await import('../../../games/hyperline/lib/world.js');
    expect(HERO.height).toBeLessThan(BAR_Y);
    expect(HERO.height).toBeGreaterThan(PS);
  });

  it('the Locker offers the choice, and switching rebuilds the runner and the thumbnails', () => {
    expect(html).toMatch(/data-act="body" data-body="m"/);
    expect(html).toMatch(/data-act="body" data-body="f"/);
    expect(html).toMatch(/case 'body':[^\n]*S\.body = [^\n]*r3d\.setBody\(S\.body\)/);
    expect(html).toMatch(/createRenderer3d\(cv, src, \{ body: S\.body \}\)/);
    expect(r3d).not.toContain('models/robot.js');
  });
});

describe('hyperline outfits: skins are clothes', () => {
  it('every skin has an outfit, every outfit dresses every garment, and patterns are known', () => {
    expect(skinIds.length).toBeGreaterThanOrEqual(9);
    for (const id of skinIds) {
      const o = OUTFITS[id as keyof typeof OUTFITS];
      expect(o, id).toBeDefined();
      for (const g of Object.keys(GARMENTS)) expect(o.g[g as keyof typeof o.g], `${id} ${g}`).toBeDefined();
      for (const g of partGarments(o)) expect(Object.keys(PATTERNS)).toContain(g.p);
    }
  });

  it('bones map onto body parts (Universal Base Characters names)', () => {
    const at = (b: string) => PARTS[partOfBone(b)];
    expect([at('Head'), at('spine_03'), at('pelvis'), at('upperarm_l'), at('lowerarm_r'), at('index_02_l'), at('thigh_r'), at('calf_l'), at('ball_r')])
      .toEqual(['head', 'torso', 'waist', 'upperArms', 'forearms', 'hands', 'thighs', 'shins', 'feet']);
  });

  it('an outfit can move a part to another garment (tall boots cover the shins)', () => {
    const gs = partGarments(OUTFITS.aurum);
    expect(gs[PARTS.indexOf('shins')]).toEqual(gs[PARTS.indexOf('feet')]);
  });
});
