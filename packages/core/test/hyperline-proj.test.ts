import { describe, expect, it } from 'vitest';

import { clipToNear, faceVisible, makeCamera, MESHES, project, rotateXYZ, toView } from '../../../games/hyperline/lib/proj.js';

const cam = () => makeCamera([0, 2, 0], [10, 2, 0], 60, 400, 600);

describe('hyperline 3D projection', () => {
  it('the look-at target lands in the middle of the screen', () => {
    const p = project(cam(), 10, 2, 0)!;
    expect(p.x).toBeCloseTo(200);
    expect(p.y).toBeCloseTo(300);
  });

  it('things further away are deeper and smaller', () => {
    const c = cam();
    const near = project(c, 5, 3, 0)!, far = project(c, 20, 3, 0)!;
    expect(far.z).toBeGreaterThan(near.z);
    expect(Math.abs(far.y - 300)).toBeLessThan(Math.abs(near.y - 300));
  });

  it('up is up on screen and the vertical field of view is honoured', () => {
    const c = cam();
    const p = project(c, 10, 2 + 10 * Math.tan(Math.PI / 6), 0)!;
    expect(p.y).toBeCloseTo(0, 3);
  });

  it('points behind the camera are not projected; segments are clipped to the near plane', () => {
    const c = cam();
    expect(project(c, -1, 2, 0)).toBeNull();
    const seg = clipToNear(c, [-5, 0, 0], [5, 0, 0])!;
    expect(toView(c, ...seg[0])[2]).toBeCloseTo(c.near);
    expect(seg[1]).toEqual([5, 0, 0]);
    expect(clipToNear(c, [-5, 0, 0], [-1, 0, 0])).toBeNull();
  });

  it('faceVisible uses screen winding (back faces are culled)', () => {
    expect(faceVisible([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toBe(true);
    expect(faceVisible([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }])).toBe(false);
  });

  it('the game camera sits straight behind the lane: lane centre projects to screen centre x', async () => {
    const { cameraFor } = await import('../../../games/hyperline/render.js');
    const st = { rx: 10, lift: 0, flipT: 0, shakeX: 0, shakeY: 0 };
    const c = cameraFor(st, 400, 700);
    expect(c.eye[2]).toBe(0);
    expect(c.r[2]).toBeCloseTo(1, 5);
    for (const x of [14, 40, 120]) expect(project(c, x, 0, 0)!.x).toBeCloseTo(200, 3);
  });

  it('rotateXYZ preserves length', () => {
    const [x, y, z] = rotateXYZ([1, 2, 3], 0.3, 1.1, -0.7);
    expect(Math.hypot(x, y, z)).toBeCloseTo(Math.hypot(1, 2, 3));
  });

  it('every mesh face has outward-facing winding (normal points away from the centre)', () => {
    for (const [name, m] of Object.entries(MESHES)) {
      for (const f of m.faces) {
        const [a, b, c] = [m.verts[f[0]!]!, m.verts[f[1]!]!, m.verts[f[2]!]!];
        const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
        const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
        const ctr = f.reduce((s, i) => [s[0]! + m.verts[i]![0]! / f.length, s[1]! + m.verts[i]![1]! / f.length, s[2]! + m.verts[i]![2]! / f.length], [0, 0, 0]);
        expect(n[0]! * ctr[0]! + n[1]! * ctr[1]! + n[2]! * ctr[2]!, name).toBeGreaterThan(0);
      }
    }
  });
});
