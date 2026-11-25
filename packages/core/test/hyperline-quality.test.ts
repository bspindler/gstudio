import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { createCourse, type Obj } from '../../../games/hyperline/lib/course.js';
import { freshSave, migrateSave, paidOffersOpen, PAID_MIN_PLAY_S, PAID_MIN_RUNS } from '../../../games/hyperline/lib/meta.js';
import { createRunner, step, type Runner } from '../../../games/hyperline/lib/sim.js';
import { COYOTE, STEP } from '../../../games/hyperline/lib/world.js';

const html = readFileSync(new URL('../../../games/hyperline/index.html', import.meta.url), 'utf8');

function only(objs: Obj[]) {
  const c = createCourse(1);
  c.objs.length = 0;
  c.nextX = 1e9;
  c.objs.push(...objs.sort((a, b) => a.x - b.x));
  return c;
}

// Run off the end of a tall block (a 0.3 s fall), then press jump `late` seconds after leaving it.
function offLedge(late: number) {
  const c = only([{ t: 'block', x: 1, w: 9, h: 3 } as Obj]);
  const r: Runner = createRunner();
  Object.assign(r, { y: 3 });
  let leftAt = -1, jumped = false;
  while (r.x < 16 && !r.dead) {
    const t = r.steps * STEP;
    if (leftAt < 0 && !r.grounded) leftAt = t;
    const press = leftAt >= 0 && t - leftAt >= late && t - leftAt < late + STEP;
    for (const e of step(r, c, press)) if (e.t === 'jump') jumped = true;
  }
  return jumped;
}

describe('hyperline coyote time', () => {
  it('is about 80 ms', () => {
    expect(COYOTE).toBeGreaterThanOrEqual(0.07);
    expect(COYOTE).toBeLessThanOrEqual(0.09);
  });

  it('a tap just after running off a ledge still jumps', () => {
    expect(offLedge(0.05)).toBe(true);
  });

  it('a tap well after leaving the ledge does not', () => {
    expect(offLedge(0.2)).toBe(false);
  });

  it('gives no second jump in the air after a real jump', () => {
    const c = only([]), r = createRunner();
    let jumps = 0;
    while (r.x < 12) for (const e of step(r, c, r.steps < 3 || (r.steps > 4 && r.steps < 12))) if (e.t === 'jump') jumps++;
    expect(jumps).toBe(1);
  });
});

describe('hyperline paid offers wait for an engaged player', () => {
  it('stay closed before run 4 or before 2 minutes of play', () => {
    expect(PAID_MIN_RUNS).toBe(4);
    expect(PAID_MIN_PLAY_S).toBe(120);
    expect(paidOffersOpen({ runs: 1, playS: 0 })).toBe(false);
    expect(paidOffersOpen({ runs: 3, playS: 600 })).toBe(false);
    expect(paidOffersOpen({ runs: 9, playS: 119 })).toBe(false);
    expect(paidOffersOpen({ runs: 4, playS: 120 })).toBe(true);
  });

  it('play time is saved and survives migration', () => {
    expect(freshSave().playS).toBe(0);
    expect(migrateSave({ ...freshSave(), playS: 321.5 }).playS).toBe(321);
    expect(migrateSave({ ...freshSave(), playS: -5 }).playS).toBe(0);
  });

  it('the death screen gates the paid revive and lists the credits revive first', () => {
    const cr = html.indexOf('data-act="revive-cr"'), buy = html.indexOf('data-act="revive-buy"');
    expect(cr).toBeGreaterThan(0);
    expect(buy).toBeGreaterThan(cr);
    expect(html).toMatch(/paidOffersOpen\(S\)[^\n]*data-act="revive-buy"/);
  });
});

describe('hyperline fast retry', () => {
  it('Retry is the first button on the death screen and starts a run straight away', () => {
    const dead = html.slice(html.indexOf('function deathScreen'), html.indexOf('function untilReset'));
    const modal = dead.slice(dead.indexOf('showModal('));
    const first = modal.indexOf('<button');
    expect(modal.slice(first, modal.indexOf('>', first))).toContain('data-act="retry"');
    expect(html).toMatch(/case 'retry':[^\n]*reset\(\);[^\n]*startRun\(\)/);
  });

  it('the summary sits in a details disclosure under the buttons', () => {
    const dead = html.slice(html.indexOf('function deathScreen'), html.indexOf('function untilReset'));
    expect(dead).toContain('<details');
    expect(dead.indexOf('<details')).toBeGreaterThan(dead.indexOf('data-act="retry"'));
  });
});

describe('hyperline hit-stop', () => {
  it('a crash freezes the world for 60-80 ms before the shatter plays', () => {
    const m = html.match(/const HITSTOP = ([\d.]+)/);
    expect(m).not.toBeNull();
    const v = Number(m![1]);
    expect(v).toBeGreaterThanOrEqual(0.06);
    expect(v).toBeLessThanOrEqual(0.08);
    expect(html).toMatch(/G\.hitstop = HITSTOP/);
  });
});
