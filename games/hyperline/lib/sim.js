// Runner physics in 2D world space (x along the track, y height). The game renders this in 3D,
// but every collision is decided here. Always stepped at STEP, so a run is deterministic.
// No DOM; exercised by the clearability bot in hyperline-course.test.ts.

import { bladeHit, extendCourse, lowerBound } from './course.js';
import { BAR_H, CEIL_Y, GRAV, JV, NEAR, P, PAD_V, PS, speedAt, STEP, VOID_Y } from './world.js';

export function createRunner() {
  return { x: P, y: 0, vy: 0, grounded: true, flip: false, rot: 0, air: 0, steps: 0, dead: '', landed: false };
}

/** Height of a moving platform; it moves with the runner's progress, so it is deterministic. */
export function moverH(o, x) {
  return o.base + o.amp * Math.sin(x * o.k + o.ph);
}

/**
 * Left edge of a block when the runner's left edge is at x0. A shuttle block (o.sl > 0) slides back toward the runner
 * at o.sl times the runner's own progress until the runner passes o.m; o.x is its resting (leftmost) place. A function
 * of x0 alone, so a run still replays exactly.
 */
export function blockX(o, x0) {
  return o.sl ? o.x + o.sl * Math.max(0, o.m - x0) : o.x;
}

/** Whether a pulse rail is lit when the runner's centre is at x: lit for half of every beat (o.per units). */
export function railLit(o, x) {
  const u = (x - o.x) / o.per + (o.ph || 0);
  return u - Math.floor(u) < 0.5;
}

/**
 * Advances the runner one STEP. `jump` is true when the player is holding or has a buffered tap.
 * Mutates the runner (and per-object flags like chip.got); returns the events that happened.
 */
export function step(r, c, jump) {
  const ev = [];
  r.x += speedAt(r.x) * STEP;
  r.steps++;
  extendCourse(c, r.x + 70);
  const objs = c.objs, x0 = r.x, x1 = x0 + PS, cx = x0 + PS / 2;
  const i0 = lowerBound(objs, x0 - 24);
  let iEnd = i0;
  while (iEnd < objs.length && objs[iEnd].x <= x1 + 1) iEnd++;

  let fz = false, pit = false;
  for (let i = i0; i < iEnd; i++) {
    const o = objs[i];
    if (o.t === 'flip' && cx >= o.x && cx < o.x + o.w) fz = true;
    else if (o.t === 'pit' && cx > o.x && cx < o.x + o.w) pit = true;
  }
  if (fz !== r.flip) { r.flip = fz; r.grounded = false; ev.push({ t: fz ? 'flipIn' : 'flipOut' }); }

  if (jump && r.grounded) {
    r.vy = r.flip ? -JV : JV; r.grounded = false; r.air = 0;
    ev.push({ t: 'jump' });
  }
  const prevY = r.y;
  r.vy += (r.flip ? 1 : -1) * GRAV * STEP;
  r.y += r.vy * STEP;

  let die = '';
  if (!r.flip) {
    let sup = -Infinity, snap = 0;
    if (!pit) {
      if (prevY >= -0.12) sup = 0;
      else if (r.y < 0 && r.y + PS > -0.2) die = 'wall';
    }
    for (let i = i0; i < iEnd; i++) {
      const o = objs[i];
      if (o.t === 'block') {
        if (o.f !== undefined && x0 < o.f) continue; // a falling pillar is not on the track until the runner reaches o.f
        const bx = blockX(o, x0);
        if (x1 > bx + 0.06 && x0 < bx + o.w - 0.06) {
          if (prevY >= o.h - 0.14) sup = Math.max(sup, o.h);
          else if (r.y < o.h - 0.14 && r.y + PS > 0) die = 'block';
        }
      } else if (o.t === 'mover') {
        if (x1 > o.x + 0.06 && x0 < o.x + o.w - 0.06) {
          const h = moverH(o, r.x);
          if (prevY >= h - 0.3 && h > sup) { sup = h; snap = 0.12; }
        }
      }
    }
    if (sup > -Infinity && r.y <= sup + snap && r.vy <= 0) {
      r.y = sup; r.vy = 0;
      if (!r.grounded) { ev.push({ t: 'land', spikes: r.air }); r.air = 0; r.rot = Math.round(r.rot / (Math.PI / 2)) * (Math.PI / 2); }
      r.grounded = true;
      if (sup === 0) {
        for (let i = i0; i < iEnd; i++) {
          const o = objs[i];
          if (o.t === 'pad' && cx >= o.x && cx < o.x + o.w) {
            r.vy = PAD_V; r.grounded = false; r.air = 0; ev.push({ t: 'pad' });
            break;
          }
        }
      }
    } else if (r.y > sup + 0.001) r.grounded = false;
    if (r.y < VOID_Y) die = die || 'fall';
  } else {
    const top = CEIL_Y - PS;
    if (r.y >= top && r.vy >= 0) {
      r.y = top; r.vy = 0;
      if (!r.grounded) { ev.push({ t: 'land', spikes: r.air }); r.air = 0; r.rot = Math.round(r.rot / (Math.PI / 2)) * (Math.PI / 2); }
      r.grounded = true;
    } else if (r.y < top - 0.001) r.grounded = false;
  }
  if (!r.grounded) r.rot += STEP * 5.6 * (r.flip ? -1 : 1);

  for (let i = i0; i < iEnd; i++) {
    const o = objs[i];
    if (o.t === 'spike') {
      if (o.f !== undefined && x0 < o.f) continue; // a spring spike is flush with the track until the runner reaches o.f
      if (x1 - 0.16 > o.x + 0.2 && x0 + 0.16 < o.x + 0.6) {
        const clear = o.inv ? (o.y - 0.58) - (r.y + PS - 0.08) : (r.y + 0.08) - (o.y + 0.58);
        if (clear < 0) die = die || 'spike';
        else o.mc = Math.min(o.mc ?? 9, clear);
      }
      if (!o.done && x0 + 0.16 >= o.x + 0.6) {
        o.done = true;
        if (o.mc !== undefined && !die) {
          r.air++;
          ev.push({ t: 'clear' });
          if (o.mc < NEAR) ev.push({ t: 'near', margin: o.mc, x: o.x + 0.4, y: o.inv ? o.y - 0.6 : o.y + 0.6 });
        }
      }
    } else if (o.t === 'bar') {
      if (x1 - 0.08 > o.x && x0 + 0.08 < o.x + o.w && r.y + PS > o.y && r.y < o.y + BAR_H) die = die || 'bar';
      if (!o.done && x0 > o.x + o.w) { o.done = true; if (!die) ev.push({ t: 'bar' }); }
    } else if (o.t === 'rail') {
      if (!r.flip && cx >= o.x && cx < o.x + o.w && r.y < 0.25 && railLit(o, cx)) die = die || 'rail';
      if (!o.done && x0 > o.x + o.w) { o.done = true; if (!die) ev.push({ t: 'rail' }); }
    } else if (o.t === 'gate') {
      if (x1 - 0.08 > o.x && x0 + 0.08 < o.x + o.w && (r.y < o.y - 0.04 || r.y + PS > o.h + 0.04)) die = die || 'gate';
      if (!o.done && x0 > o.x + o.w) { o.done = true; if (!die) ev.push({ t: 'gate' }); }
    } else if (o.t === 'blade') {
      if (!r.flip && bladeHit(o, x0, r.y)) die = die || 'blade';
    } else if (o.t === 'chip') {
      if (!o.got && !o.miss) {
        if (Math.abs(cx - o.x) < 0.6 && Math.abs(r.y + PS / 2 - o.y) < 0.6) { o.got = true; ev.push({ t: 'chip', x: o.x, y: o.y }); }
        else if (o.x < x0 - 0.6) { o.miss = true; ev.push({ t: 'chipMiss' }); }
      }
    }
  }
  if (die) { r.dead = die; ev.push({ t: 'die', cause: die }); }
  return ev;
}
