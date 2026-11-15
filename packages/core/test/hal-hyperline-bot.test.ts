import { describe, expect, it } from 'vitest';

import { createCourse, type Course, type Obj } from '../../../games/hyperline/lib/course.js';
import { createRunner, step } from '../../../games/hyperline/lib/sim.js';
import { sectorAt, STEP } from '../../../games/hyperline/lib/world.js';
import { casualRun, clearable, HYPERLINE_CASUAL, jumpWindow, SEARCH_BUDGET, TAP_BUFFER } from '../src/hal/hyperline-bot.js';

const seeds = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const bare = (objs: Obj[]): Course => { const c = createCourse(5); c.objs.length = 0; c.nextX = 1e9; c.objs.push(...objs.map((o) => ({ ...o }))); return c; };

describe('clearable', () => {
  it('has a 2M state budget', () => {
    expect(SEARCH_BUDGET).toBe(2_000_000);
  });

  it("returns 'unknown' when the budget runs out", () => {
    expect(clearable(createCourse(7), 1900, 50)).toBe('unknown');
  });

  it('a generous budget still clears a short course', () => {
    expect(clearable(createCourse(7), 100)).toBe(true);
  });
});

describe('jumpWindow', () => {
  // Brute force: tap (a 15-frame buffered press, as index.html) k frames from now, then no input; alive at x = 30?
  function tapClears(objs: Obj[], k: number): boolean {
    const c = bare(objs), r = createRunner();
    let tapped = false;
    for (let i = 0; !r.dead && r.x < 30; i++) {
      const ev = step(r, c, !tapped && i >= k && i < k + TAP_BUFFER);
      if (ev.some((e) => e.t === 'jump')) tapped = true;
    }
    return !r.dead;
  }

  it('the tap buffer is the 0.12 s index.html keeps a press for', () => {
    expect(TAP_BUFFER).toBe(Math.floor(0.12 / STEP) + 1);
  });

  for (const [name, objs] of [
    ['two spikes', [{ t: 'spike', x: 12, y: 0, inv: false }, { t: 'spike', x: 12.8, y: 0, inv: false }]],
    ['a pit', [{ t: 'pit', x: 12, w: 2.4 }]],
  ] as Array<[string, Obj[]]>) {
    it(`is the run of tap frames that clear ${name} (checked frame by frame)`, () => {
      const w = jumpWindow(createRunner(), bare(objs), 1.5);
      expect(w).not.toBeNull();
      const feasible = Array.from({ length: 200 }, (_, k) => k).filter((k) => tapClears(objs, k));
      expect(feasible.length).toBeGreaterThan(0);
      expect(w!.lo).toBe(feasible[0]);
      expect(w!.hi).toBe(feasible[feasible.length - 1]);
      expect(feasible.length).toBe(w!.hi - w!.lo + 1); // one contiguous run
      expect(w!.p).toBe('');
    });
  }

  it('is null when no-input survives the horizon', () => {
    expect(jumpWindow(createRunner(), bare([]), 1)).toBeNull();
  });

  it("names the killing object's pattern", () => {
    expect(jumpWindow(createRunner(), bare([{ t: 'spike', x: 12, y: 0, inv: false, p: 'spikes', g: 0 }]), 1.5)!.p).toBe('spikes');
  });
});

describe('casualRun', () => {
  it('sees 1 s ahead and taps with ~30 ms of timing noise plus a per-run reaction lag', () => {
    expect(HYPERLINE_CASUAL.horizon).toBe(1);
    expect(HYPERLINE_CASUAL.sigma).toBeGreaterThanOrEqual(0.02);
    expect(HYPERLINE_CASUAL.sigma).toBeLessThanOrEqual(0.04);
    expect(HYPERLINE_CASUAL.lag).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic per seed', () => {
    expect(casualRun(3, 1900)).toEqual(casualRun(3, 1900));
  });

  it('a noiseless player taps at the middle of every window it finds', () => {
    const r = casualRun(4, 1200, { horizon: 1, sigma: 0, lag: 0 });
    const found = r.windows.filter((w) => w.ms > 0);
    expect(found.length).toBeGreaterThan(20);
    for (const w of found) expect(Math.abs(w.off)).toBeLessThanOrEqual(STEP * 1000 / 2 + 1e-9);
  });

  it('a noisy player misses the middle by about sigma (plus its lag)', () => {
    const offs = seeds(10).flatMap((s) => casualRun(s, 800).windows.filter((w) => w.ms > 0).map((w) => w.off / 1000));
    const m = offs.reduce((a, b) => a + b, 0) / offs.length;
    const sd = Math.sqrt(offs.reduce((a, b) => a + (b - m) ** 2, 0) / offs.length);
    expect(sd).toBeGreaterThan(HYPERLINE_CASUAL.sigma * 0.8);
    expect(sd).toBeLessThan(HYPERLINE_CASUAL.sigma * 1.4 + HYPERLINE_CASUAL.lag);
    expect(m).toBeGreaterThanOrEqual(-0.005);
  });

  it('dies in more than one sector across seeds, never past until, and survivors have no cause', () => {
    const runs = seeds(20).map((s) => casualRun(s, 1900));
    expect(new Set(runs.map((r) => r.sector)).size).toBeGreaterThan(1);
    for (const r of runs) {
      expect(r.dist).toBeLessThanOrEqual(1900);
      expect(r.dist).toBeGreaterThan(0);
      if (r.dist >= 1900) expect(r.cause).toBe('');
      else {
        expect(r.cause).not.toBe('');
        expect(r.sector).toBe(sectorAt(r.dist));
      }
    }
  });

  it('a short target is reached with no cause', () => {
    const r = casualRun(1, 20);
    expect(r).toMatchObject({ dist: 20, cause: '' });
    expect(r.jumps).toBeGreaterThanOrEqual(0);
  });
});

describe('casualRun from a sector start (measurement v2, P3)', () => {
  it('runs createCourse(seed, from) from `from`, and from 0 is the plain run', () => {
    expect(casualRun(3, 600, HYPERLINE_CASUAL, 0)).toEqual(casualRun(3, 600));
    const r = casualRun(3, 1250, HYPERLINE_CASUAL, 1000);
    expect(r.dist).toBeGreaterThan(1000);
    expect(r.dist).toBeLessThanOrEqual(1250);
    expect(r.sector).toBe(4);
    expect(casualRun(3, 1250, HYPERLINE_CASUAL, 1000)).toEqual(r);
  });

  it("meets the sector's intro pattern first and counts the patterns it reached", () => {
    for (const s of seeds(5)) {
      const r = casualRun(s, 1000, HYPERLINE_CASUAL, 750); // TWIN FANGS opens with 'twin'
      expect(r.enc.twin).toBeGreaterThanOrEqual(1);
      expect(Object.values(r.enc).every((n) => Number.isInteger(n) && n > 0)).toBe(true);
    }
  });

  it('near misses and clears fire in real runs (planning no longer sets the flags they read)', () => {
    const runs = seeds(40).map((s) => casualRun(s, 250));
    const clears = runs.reduce((a, r) => a + r.clears, 0), nears = runs.reduce((a, r) => a + r.nears, 0);
    expect(clears).toBeGreaterThan(0);
    expect(nears).toBeGreaterThan(0);
    expect(nears).toBeLessThanOrEqual(clears);
  });

  it('clearable can start from a sector start too', () => {
    expect(clearable(createCourse(7, 500), 600, SEARCH_BUDGET, 500)).toBe(true);
  });
});
