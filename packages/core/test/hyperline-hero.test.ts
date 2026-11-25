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
    expect(html).toMatch(/createRenderer3d\(cv, src, \{ body: S\.body, tier: PHONE \? 1 : 0 \}\)/);
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

describe('hyperline hair and accessories (Brian, 2026-11-25: "get creative")', async () => {
  const { GEAR, HAIRS, hairFor, SKIN_TONES } = await import('../../../games/hyperline/gear3d.js');
  it('every outfit names real hairstyles and accessories, and each body gets brows', () => {
    for (const [id, o] of Object.entries(OUTFITS)) {
      for (const g of o.gear || []) expect(GEAR, `${id} gear`).toContain(g);
      for (const body of ['m', 'f'] as const) for (const h of hairFor(o, body)) expect(Object.keys(HAIRS), `${id} hair`).toContain(h);
    }
    expect(hairFor({ ...OUTFITS.volt }, 'm')).toEqual(['parted', 'beard', 'brows-m']);
    expect(hairFor({ ...OUTFITS.volt }, 'f')).toEqual(['buns', 'brows-f']); // no beard on F
    expect(hairFor(OUTFITS.ember, 'm')).toEqual([]); // a helmet: no hair
  });

  it('a few outfits show hair and skin tone, the rest keep helmets; there are five skin tones', () => {
    const withHair = Object.values(OUTFITS).filter((o) => o.hair).length;
    expect(withHair).toBeGreaterThanOrEqual(3);
    expect(withHair).toBeLessThan(Object.keys(OUTFITS).length);
    expect(SKIN_TONES).toHaveLength(5);
    expect(freshSave().tone).toBe(1);
    expect(migrateSave({ ...freshSave(), tone: 9 }).tone).toBe(1);
  });

  it('the Locker offers skin tones', () => {
    expect(html).toMatch(/data-act="tone" data-tone="\$\{i\}"/);
    expect(html).toMatch(/case 'tone':[^\n]*S\.tone = i; save\(\)/);
  });
});

describe('hyperline Large runner setting (Brian, 2026-11-25)', async () => {
  const T = await import('three');
  const { buildRig } = await import('../../../games/hyperline/lib/rig.js');
  const { tagParts } = await import('../../../games/hyperline/outfit3d.js');
  const { BAR_Y } = await import('../../../games/hyperline/lib/world.js');

  it('off by default; a settings switch; the hitbox never changes (it only scales the drawing)', () => {
    expect(freshSave().settings.bigRunner).toBe(false);
    expect(html).toContain("sw('bigRunner', 'Large runner'");
    expect(html).toMatch(/large: S\.settings\.bigRunner/);
    expect(r3d).toMatch(/k = st\.large \? HERO\.large \/ HERO\.height : 1/);
    expect(HERO.large).toBeGreaterThan(HERO.height);
  });

  it('a large runner ducks under low ceilings, and its crouch (hair included) fits under one', async () => {
    expect(r3d).toMatch(/const duck = st\.large && !r\.flip && objs\.some\(\(o\) => o\.t === 'bar'/);
    for (const k of ['m', 'f'] as const) {
      const data = (await BODIES[k]()).default;
      const rig = buildRig(T as never, data, () => new T.MeshBasicMaterial());
      const body = rig.meshes.find((m) => /superhero/i.test(m.name))! as unknown as { skeleton: { update(): void }; geometry: { attributes: { position: { count: number } } }; getVertexPosition(i: number, v: unknown): void; matrixWorld: unknown };
      const top = tagParts(T, body);
      rig.actions.crouch!.play();
      let maxY = 0;
      const v = new T.Vector3();
      for (let s = 0; s < 16; s++) {
        rig.mixer.update(0.06); rig.root.updateMatrixWorld(true); body.skeleton.update();
        for (let i = 0; i < body.geometry.attributes.position.count; i += 3) { body.getVertexPosition(i, v); v.applyMatrix4(body.matrixWorld as never); maxY = Math.max(maxY, v.y); }
      }
      const hairAllowance = 0.06;
      expect((maxY / top) * HERO.large + hairAllowance, `${k} crouch`).toBeLessThan(BAR_Y);
    }
  });
});
