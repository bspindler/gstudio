import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { cameraFor } from '../../../games/hyperline/render.js';
import { fovFor, kick, landPitch, magnetPull, nearChain, SLOWMO, springStep } from '../../../games/hyperline/lib/feel.js';
import { crateDue, runsToNextCrate } from '../../../games/hyperline/lib/meta.js';

const html = readFileSync(new URL('../../../games/hyperline/index.html', import.meta.url), 'utf8');
const E = (...ts: string[]) => ts.map((t) => ({ t }));

describe('hyperline feel: near-miss slow motion', () => {
  it('is 0.3x for 0.3 s, after three near-miss clears in a row', () => {
    expect(SLOWMO).toEqual({ chain: 3, scale: 0.3, dur: 0.3 });
    let s = { chain: 0, slow: false };
    s = nearChain(s.chain, E('clear', 'near')); expect(s).toEqual({ chain: 1, slow: false });
    s = nearChain(s.chain, E('clear', 'near')); expect(s.chain).toBe(2);
    s = nearChain(s.chain, E('clear', 'near')); expect(s).toEqual({ chain: 0, slow: true });
  });

  it('a clean (not near) clear breaks the chain; other events do not', () => {
    expect(nearChain(2, E('clear')).chain).toBe(0);
    expect(nearChain(2, E('chip', 'jump', 'land')).chain).toBe(2);
    expect(nearChain(1, E('clear', 'near', 'clear')).chain).toBe(0);
  });

  it('the game scales the sim accumulator (not the fixed step) while slowed', () => {
    expect(html).toMatch(/const slowK = G\.slow > 0 \? SLOWMO\.scale : 1, dt = rdt \* slowK/);
  });
});

describe('hyperline feel: camera', () => {
  it('a spring settles back to rest', () => {
    let s = kick({ y: 0, v: 0 }, 1);
    let peak = 0;
    for (let i = 0; i < 120; i++) { s = springStep(s, 1 / 60); peak = Math.max(peak, s.y); }
    expect(peak).toBeGreaterThan(0.03);
    expect(Math.abs(s.y)).toBeLessThan(0.005);
  });

  it('field of view widens up to 6 degrees with speed; base unchanged at start speed', () => {
    expect(fovFor(9, false)).toBe(64);
    expect(fovFor(9, true)).toBe(50);
    expect(fovFor(17.5, false)).toBeCloseTo(70);
    expect(fovFor(30, false)).toBeCloseTo(70);
  });

  it('cameraFor lifts eye and target with the kick, and keeps old callers unchanged', () => {
    const base = { rx: 10, lift: 0, flipT: 0, shakeX: 0, shakeY: 0 };
    const a = cameraFor(base, 400, 800), b = cameraFor({ ...base, kick: 0.3 }, 400, 800);
    expect(b.eye[1] - a.eye[1]).toBeCloseTo(0.3);
    const wide = cameraFor({ ...base, speed: 17.5 }, 400, 800);
    expect(wide.focal).toBeLessThan(a.focal);
  });
});

describe('hyperline feel: landing and chips', () => {
  it('the landing thud drops in pitch with fall height', () => {
    expect(landPitch(0.5)).toBeGreaterThan(landPitch(2));
    expect(landPitch(2)).toBeGreaterThan(landPitch(5));
    expect(landPitch(50)).toBe(landPitch(6));
  });

  it('chips ahead within reach are drawn pulled toward the runner; far or passed chips are not', () => {
    expect(magnetPull(3, 0)).toBe(0);
    expect(magnetPull(-0.5, 0)).toBe(0);
    expect(magnetPull(1, 0)).toBeGreaterThan(0);
    expect(magnetPull(0.3, 0)).toBeGreaterThan(magnetPull(1.2, 0));
    expect(magnetPull(0.01, 0)).toBeLessThanOrEqual(0.6);
  });

  it('the chip counter pops on pickup', () => {
    expect(html).toMatch(/\.pop\{/);
    expect(html).toMatch(/chipTxt'\)\.classList\.add\('pop'\)|popChip\(\)/);
  });
});

describe('hyperline: first reward by run 2', () => {
  it('a crate on run 2, then every 5th run', () => {
    expect([1, 2, 3, 4, 5, 6, 9, 10, 15].filter(crateDue)).toEqual([2, 5, 10, 15]);
    expect(runsToNextCrate(0)).toBe(2);
    expect(runsToNextCrate(1)).toBe(1);
    expect(runsToNextCrate(2)).toBe(3);
    expect(runsToNextCrate(5)).toBe(5);
    expect(runsToNextCrate(7)).toBe(3);
  });

  it('the game uses them instead of a bare modulo', () => {
    expect(html).not.toMatch(/S\.runs % CRATE_EVERY/);
    expect(html).toMatch(/crateDue\(S\.runs\)/);
  });
});
