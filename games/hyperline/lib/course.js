// Data-driven course generator. A course is a sorted list of world objects built from a library
// of patterns; the only randomness is the seeded rng, so a seed always builds the same course
// (the daily run seeds it from the UTC date). No DOM; tested in hyperline-course.test.ts.
//
// Object kinds (x = start along the track, all in units):
//   spike {x, y, inv}     0.8 wide; inv hangs from a ceiling at y
//   block {x, w, h}       solid; stand on top, crash into the side
//   pit   {x, w}          no track; fall and the run ends
//   chip  {x, y}          pickup
//   bar   {x, w, y}       low ceiling from y up BAR_H; any jump under it crashes
//   pad   {x, w}          launches the runner at PAD_V
//   mover {x, w, base, amp, k, ph}  platform bobbing at base + amp*sin(runnerX*k + ph)
//   flip  {x, w}          gravity points up; the runner rides the ceiling track at CEIL_Y
//   gate  {x, w, y, h}    slot gate: solid below y and above h; pass through the gap between
//   pit with c: 1         a crumbling panel: glows `glow` units ahead, drops `drop` units ahead; a plain pit to the sim
//   rail  {x, w, per, ph} blinking floor rail: lit for half of every `per` units; lethal to the grounded runner while lit

import { mulberry32 } from './rng.js';
import { AIR, BAR_Y, CEIL_Y, GATE_HI, GATE_LO, GATE_W, GRAV, JV, PAD_AIR, PAD_V, PS, sectorAt, speedAt, STEP } from './world.js';

const SW = 0.8; // spike width
const range = (x) => speedAt(x) * AIR;

// Times when a normal jump is above a ground spike's hitbox (top 0.58 plus 0.08 slack).
const H0 = 0.66;
const T1 = (JV - Math.sqrt(JV * JV - 2 * GRAV * H0)) / GRAV;
const T2 = (JV + Math.sqrt(JV * JV - 2 * GRAV * H0)) / GRAV;

function spikes(o, x, n, y = 0, inv = false) {
  for (let i = 0; i < n; i++) o.push({ t: 'spike', x: x + i * SW, y, inv });
  return n * SW;
}

/** Jump-start window (runner left edge) that clears a ground spike cluster at sx of n spikes. */
function spikeWindow(sx, n, v) {
  const a = sx + 0.2, b = sx + (n - 1) * SW + 0.6;
  return [b - 0.16 - T2 * v, a - 0.64 - T1 * v];
}

/**
 * The pattern library. sector: first sector it can appear in. weight(s): how often, by sector.
 * build(x, d, rng) returns { o: objects, len }, where d in [0, 1] is the difficulty at x.
 */
export const PATTERNS = [
  { id: 'spikes', sector: 0, weight: () => 3.4,
    build(x, d, r) {
      const o = [], n = 1 + Math.floor(r() * (d > 0.25 ? 3 : 2));
      const len = spikes(o, x, n);
      o.push({ t: 'chip', x: x + len / 2, y: 2.7 });
      return { o, len };
    } },
  { id: 'block', sector: 0, weight: () => 2,
    build(x, d, r) {
      const o = [], w = 2 + Math.floor(r() * 3);
      o.push({ t: 'block', x, w, h: 1 });
      if (d > 0.35 && w >= 3 && r() < 0.55) o.push({ t: 'spike', x: x + w / 2 - 0.4, y: 1, inv: false });
      else o.push({ t: 'chip', x: x + w / 2, y: 1.6 });
      return { o, len: w };
    } },
  { id: 'steps', sector: 0, weight: () => 1.4,
    build(x) {
      return { o: [{ t: 'block', x, w: 2, h: 1 }, { t: 'block', x: x + 2, w: 2, h: 2 }, { t: 'chip', x: x + 3, y: 2.6 }], len: 4 };
    } },
  { id: 'pit', sector: 0, weight: () => 1.7,
    build(x, d, r) {
      const w = Math.min(range(x) * 0.66, 1.8 + r() * (0.5 + d * 0.7));
      return { o: [{ t: 'pit', x, w }, { t: 'chip', x: x + w / 2, y: 2.3 }], len: w };
    } },
  { id: 'blockSpike', sector: 0, weight: () => 1.5,
    build(x) {
      return { o: [{ t: 'block', x, w: 2, h: 1 }, { t: 'spike', x: x + 2, y: 0, inv: false }], len: 2.8 };
    } },

  // Sector 1: low ceilings. Stay grounded; chips run along the floor underneath.
  { id: 'bar', sector: 1, weight: (s) => (s === 1 ? 3 : 1.6),
    build(x, d, r) {
      const lead = range(x) * 0.5, w = 2.5 + r() * (2 + d * 1.5), bx = x + lead;
      const o = [{ t: 'bar', x: bx, w, y: BAR_Y }];
      for (let k = 0.6; k < w - 0.3; k += 1.1) o.push({ t: 'chip', x: bx + k, y: 0.45 });
      return { o, len: lead + w };
    } },
  { id: 'spikeBar', sector: 1, weight: (s) => (s === 1 ? 1.4 : 1),
    build(x, d, r) {
      const o = [];
      spikes(o, x, 1);
      const bx = x + range(x) + 1.2, w = 2 + r() * 2;
      o.push({ t: 'chip', x: x + 0.4, y: 2.7 }, { t: 'bar', x: bx, w, y: BAR_Y });
      return { o, len: bx - x + w };
    } },

  // Sector 2: jump pads, over a long pit or up a wall too tall to jump.
  { id: 'padPit', sector: 2, weight: (s) => (s === 2 ? 2.6 : 1.1),
    build(x, d, r) {
      const v = speedAt(x), rp = v * PAD_AIR, px = x + 0.5;
      const pw = rp * (0.48 + r() * 0.1), pitX = px + 2.2;
      const o = [{ t: 'pad', x: px, w: 1.6 }, { t: 'pit', x: pitX, w: pw }];
      for (const f of [0.3, 0.5, 0.7]) {
        const t = f * PAD_AIR;
        o.push({ t: 'chip', x: px + f * rp, y: PAD_V * t - (GRAV / 2) * t * t + PS / 2 });
      }
      return { o, len: Math.max(pitX + pw, px + rp + 1.5) - x };
    } },
  { id: 'padWall', sector: 2, weight: (s) => (s === 2 ? 1.6 : 0.9),
    build(x, d, r) {
      const v = speedAt(x), px = x + 0.5, wx = px + Math.max(3, 0.9 + v * 0.16), ww = 3 + r() * 2;
      const o = [{ t: 'pad', x: px, w: 1.4 }, { t: 'block', x: wx, w: ww, h: 3 }, { t: 'chip', x: wx + ww / 2, y: 3.5 }];
      return { o, len: Math.max(wx + ww + 0.32 * v + 1, px + PAD_AIR * v + 1.5) - x };
    } },

  // Sector 3: double spikes. The second cluster sits where a held jump re-launches on landing.
  { id: 'twin', sector: 3, weight: (s) => (s === 3 ? 2.8 : 1.4),
    build(x, d, r, intro) {
      const v = speedAt(x + 4), nA = intro ? 8 : 2, nB = (intro ? 4 : 1) + Math.floor(r() * 2);
      const o = [], ax = x + 1;
      spikes(o, ax, nA);
      const [lo, hi] = spikeWindow(ax, nA, v);
      const land = (lo + hi) / 2 + AIR * v;
      const next = land + v * STEP;
      const [blo, bhi] = spikeWindow(0, nB, v);
      const bx = next - (blo + bhi) / 2;
      spikes(o, bx, nB);
      o.push({ t: 'chip', x: ax + nA * SW / 2, y: 2.7 }, { t: 'chip', x: bx + nB * SW / 2, y: 2.7 });
      return { o, len: bx + nB * SW - x + 0.5 };
    } },

  // Sector 4: a bobbing platform across a pit too long to jump in one go.
  { id: 'mover', sector: 4, weight: (s) => (s === 4 ? 2.6 : 1.3),
    build(x, d, r) {
      const g = Math.min(range(x) * 0.45, 3.2), pw = 2.6, pitX = x + 0.5;
      const o = [
        { t: 'pit', x: pitX, w: g + pw + g },
        { t: 'mover', x: pitX + g, w: pw, base: 0.75, amp: 0.45, k: 0.55, ph: r() * Math.PI * 2 },
        { t: 'chip', x: pitX + g + pw / 2, y: 1.4 },
      ];
      return { o, len: 0.5 + g + pw + g + 1 };
    } },

  // Sector 5: gravity flips. Ride the ceiling; spikes hang from it; jumping drops you down.
  { id: 'flip', sector: 5, weight: (s) => (s === 5 ? 2.4 : 1.1),
    build(x, d, r, intro) {
      const v = speedAt(x), zx = x + 0.5, L = 13 + r() * 5 + d * 2;
      const o = [{ t: 'flip', x: zx, w: L }, { t: 'pit', x: zx + 3, w: L - 6 }];
      const gap = Math.max(range(x) * (intro ? 0.6 : 0.95), 4.6);
      let sx = zx + (intro ? 5.7 : 8);
      while (sx <= zx + L - 4) {
        const n = (intro ? 8 : 1) + Math.floor(r() * 2);
        spikes(o, sx, n, CEIL_Y, true);
        sx += n * SW + gap + r() * 1.5;
      }
      for (let cx = zx + 4.5; cx < zx + L - 1; cx += 1.6) {
        if (!o.some((q) => q.t === 'spike' && Math.abs(q.x + 0.4 - cx) < 1.2)) o.push({ t: 'chip', x: cx, y: CEIL_Y - PS / 2 - 0.05 });
      }
      return { o, len: 0.5 + L + 0.32 * v + 1.5 };
    } },

  // Sector 6: slot gates. Jump so the rise or the fall of the arc threads the gap; the apex is too tall.
  { id: 'gate', sector: 6, weight: (s) => (s === 6 ? 2.6 : 1.1),
    build(x) {
      const gx = x + 1;
      const o = [{ t: 'gate', x: gx, w: GATE_W, y: GATE_LO, h: GATE_HI }, { t: 'chip', x: gx + GATE_W / 2, y: (GATE_LO + GATE_HI) / 2 }];
      return { o, len: 1 + GATE_W + 1 };
    } },

  // Sector 7: sweep columns. Two or three slot gates a jump apart: thread one, land, jump again.
  { id: 'sweep', sector: 7, weight: (s) => (s === 7 ? 2.6 : 1.2),
    build(x, d, r) {
      const v = speedAt(x), n = 2 + (d > 0.5 && r() < 0.4 ? 1 : 0);
      const gap = v * AIR + 1 + r() * 1.5;
      const o = [];
      for (let i = 0; i < n; i++) {
        const gx = x + 1 + i * gap;
        o.push({ t: 'gate', x: gx, w: GATE_W, y: GATE_LO, h: GATE_HI }, { t: 'chip', x: gx + GATE_W / 2, y: (GATE_LO + GATE_HI) / 2 });
      }
      return { o, len: 1 + (n - 1) * gap + GATE_W + 0.32 * v + 1 };
    } },

  // Sector 8: pulse rails. A rail across the track glows lit, dark, lit to a beat. Touch it lit and you
  // crash: be in the air when it glows, land in the dark half, and hop again for the second glow.
  { id: 'pulse', sector: 8, weight: (s) => (s === 8 ? 2.6 : 1.2),
    build(x, d, r) {
      const v = speedAt(x + 4), per = v * 0.8, w = per * 1.5, rx = x + 1;
      const o = [
        { t: 'rail', x: rx, w, per },
        { t: 'chip', x: rx + per * 0.2, y: 1.7 },
        { t: 'chip', x: rx + per * 1.2, y: 1.7 },
      ];
      return { o, len: 1 + w + 1 };
    } },

  // Sector 9: crumble track. Floor panels glow, then drop out ahead of the runner, leaving holes to leap.
  // To the sim each is a plain pit (c: 1); `glow` and `drop` are how far ahead the panel starts to glow
  // and when it falls away, so the renderer can warn the player. Solid track between holes fits any landing.
  { id: 'crumble', sector: 9, weight: (s) => (s === 9 ? 2.6 : 1.2),
    build(x, d, r, intro) {
      const v = speedAt(x + 4), rg = range(x + 4), hw = rg * ((intro ? 0.74 : 0.36) + r() * 0.06), gp = rg * 0.7;
      const n = 2 + (d > 0.5 && r() < 0.4 ? 1 : 0), o = [];
      let hx = x + 1;
      for (let i = 0; i < n; i++) {
        o.push({ t: 'pit', x: hx, w: hw, c: 1, glow: v * 1.3, drop: v * 0.7 }, { t: 'chip', x: hx + hw / 2, y: 2.3 });
        hx += hw + gp;
      }
      return { o, len: hx - gp - x + 0.5 };
    } },

  // Sector 10: boost pads. A pad throws the runner over tall walls onto a short landing strip that ends at a pit:
  // land, then tap in the short stretch before the edge. Single-lane, jump-only: the only input is that one tap.
  { id: 'boost', sector: 10, weight: (s) => (s === 10 ? 2.6 : 1.1),
    build(x, d, r, intro) {
      const v = speedAt(x + 6), rp = v * PAD_AIR, px = x + 0.5;
      const o = [{ t: 'pad', x: px, w: 1.4 }];
      for (let wx = px + Math.max(3, 0.9 + v * 0.16), i = 0, n = 1 + (r() < 0.5 ? 1 : 0); i < n; i++) {
        const ww = 1.6 + r() * 1.2;
        o.push({ t: 'block', x: wx, w: ww, h: 3 }, { t: 'chip', x: wx + ww / 2, y: 3.6 });
        wx += ww + 1.4;
      }
      // The landing strip: the arc comes down, and a wide spike field starts just after the first safe takeoff. The
      // field is as long as it can be while the clear-jump window stays at `want` seconds, so the tap has to be timed.
      const want = intro ? 0.065 : 0.085, left = px - 0.4 + rp;
      let n = 4;
      while (n < 14 && (spikeWindow(0, n + 1, v)[1] - spikeWindow(0, n + 1, v)[0]) / v >= want) n++;
      const [lo0] = spikeWindow(0, n, v);
      const sx = Math.max(left + 1, left + v * 0.05 - lo0); // takeoff window opens ~50 ms after landing
      spikes(o, sx, n);
      o.push({ t: 'chip', x: sx + n * SW / 2, y: 2.7 });
      return { o, len: sx + n * SW - x + 0.5 };
    } },

  // Sector 11: riser steps. A short raised block (hop up onto it) ends straight at a pit: land on the step, then
  // jump before the edge. The pit is as wide as it can be while the take-off window stays at `want` seconds.
  { id: 'riser', sector: 11, weight: (s) => (s === 11 ? 2.6 : 1.1),
    build(x, d, r, intro) {
      const v = speedAt(x + 6), lead = range(x) * 0.6, bx = x + lead, bw = 2 + r() * 0.8, want = intro ? 0.075 : 0.09;
      const pw = 0.34 + v * (RISER_REACH - want), ex = bx + bw;
      const o = [
        { t: 'block', x: bx, w: bw, h: 1 },
        { t: 'pit', x: ex, w: pw },
        { t: 'chip', x: bx + bw / 2, y: 1.7 },
        { t: 'chip', x: ex + pw / 2, y: 2.4 },
      ];
      return { o, len: lead + bw + pw + 0.5 };
    } },

  // Sector 12: stagger spikes. Two spike pairs, each close enough to clear in one jump, then a long gap, so the rhythm
  // of a held jump is wrong: read the gap, jump the first pair, land, wait, and jump the second. The first pair's
  // take-off window is wide; the second opens a beat after any landing from the first and is as narrow as `want`.
  { id: 'stagger', sector: 12, weight: (s) => (s === 12 ? 1.8 : 0.9),
    build(x, d, r, intro) {
      const v = speedAt(x + 6), want = intro ? 0.09 : 0.115, w1 = 0.2 + r() * 0.04;
      const cw1 = (T2 - T1 - w1) * v - 0.08, cw2 = (T2 - T1 - want) * v - 0.08; // cluster widths: first spike start to last spike end
      const hi1 = -0.44 - T1 * v;
      const lo2 = hi1 + (AIR + 0.05) * v;
      const sx2 = lo2 - cw2 + 0.36 + T2 * v, ax = x + 1, bx = ax + sx2;
      const o = [
        { t: 'spike', x: ax, y: 0, inv: false }, { t: 'spike', x: ax + cw1 - SW, y: 0, inv: false },
        { t: 'spike', x: bx, y: 0, inv: false }, { t: 'spike', x: bx + cw2 - SW, y: 0, inv: false },
        { t: 'chip', x: ax + cw1 / 2, y: 2.7 }, { t: 'chip', x: bx + cw2 / 2, y: 2.7 },
      ];
      return { o, len: bx + cw2 - x + 0.5 };
    } },

  // Sector 13: drop ledges. A raised ledge (hop up onto it) ends straight over a spike strip on the floor: running
  // off the edge drops you into the spikes, so jump off the edge. The strip is as long as it can be while the
  // take-off window (the last `want` seconds before the edge) still clears its far end.
  { id: 'drop', sector: 13, weight: (s) => (s === 13 ? 1.8 : 0.9),
    build(x, d, r, intro) {
      const v = speedAt(x + 6), lead = range(x) * 0.6, bx = x + lead, bw = 3 + r() * 0.8, want = intro ? 0.06 : 0.08;
      const ex = bx + bw, sx = ex + 0.5, farEnd = ex - 0.06 + v * (DROP_TOP - want) - 0.44; // last spike's start
      const n = Math.max(3, Math.floor((farEnd - sx) / SW) + 1);
      const o = [{ t: 'block', x: bx, w: bw, h: 1 }, { t: 'chip', x: bx + bw / 2, y: 1.7 }];
      spikes(o, sx, n);
      o.push({ t: 'chip', x: sx + n * SW / 2, y: 2.7 });
      return { o, len: lead + bw + 0.5 + n * SW + 0.5 };
    } },

  // Sector 14: shuttle blocks. A one-unit block slides back along the track toward the runner (it closes at 1.6x the
  // track speed), so the hop depends on how fast it is coming, not on a fixed spacing. A short spike strip lies past
  // the block's contact point: hop too early and the arc lands in the spikes, too late and the block is in your face.
  // The tap has two windows: an early jump that lands on the block's top (then rides it off), and a late hop clean
  // over it. A later strip widens the first and narrows the second; a longer strip narrows the first. `want` and `n`
  // are tuned with jumpWindow (hyperline-shuttle-probe) so both come out near 80-110 ms.
  { id: 'shuttle', sector: 14, weight: (s) => (s === 14 ? 1.8 : 0.9),
    build(x, d, r, intro) {
      const xc = x + 8 + r() * 2, v = speedAt(xc + 6), want = intro ? 0.076 : 0.096, n = 5, SL = 0.6, M = 12;
      const sx = xc - (TB + want) * v + 0.16 + T2 * v - (n - 1) * SW - 0.6;
      const o = [{ t: 'block', x: xc + (PS - 0.06) - SL * M, w: 1.4 + r() * 0.4, h: 1, sl: SL, m: xc + M }];
      spikes(o, sx, n);
      o.push({ t: 'chip', x: sx + n * SW / 2, y: 2.7 });
      return { o, len: sx + n * SW - x + 0.5 };
    } },

  // Sector 15: falling pillars. A one-unit pillar drops onto the track (o.f: the runner position where it lands) with a
  // short spike strip right behind it. Hop it and the strip in one jump: too early and the arc comes down on the strip,
  // too late and the pillar is in your face. The pillar lands `PILLAR_LEAD` seconds before the take-off window opens,
  // so the read is the landing, and the window is `want` seconds wide (110-125 ms, the L-133 sizing).
  { id: 'pillars', sector: 15, weight: (s) => (s === 15 ? 1.8 : 0.9),
    build(x, d, r, intro) {
      const v = speedAt(x + 8), want = intro ? 0.112 : 0.125, units = intro ? 1 : 1 + (r() < 0.45 ? 1 : 0);
      // Take-off window (runner left edge) relative to the pillar's left edge: clear its side, then stay above the strip's far end.
      const hiRel = 0.06 - PS - TB * v, loRel = hiRel - want * v, midRel = (loRel + hiRel) / 2;
      const o = [];
      let bx = x + 1 - loRel + v * PILLAR_LEAD, end = bx;
      for (let i = 0; i < units; i++) {
        const pw = 0.9 + r() * 0.2, sl = bx + loRel - 0.44 + T2 * v; // last spike start, so the window is exactly `want` wide
        const n = Math.max(2, Math.floor((sl - (bx + pw + 0.1)) / SW) + 1), sx = sl - (n - 1) * SW;
        o.push({ t: 'block', x: bx, w: pw, h: 1, f: bx + loRel - v * PILLAR_LEAD });
        spikes(o, sx, n);
        o.push({ t: 'chip', x: sx + n * SW / 2, y: 2.7 });
        end = sx + n * SW;
        bx = bx + midRel + AIR * v + v * (PILLAR_LEAD + 0.2) + 1 - loRel;
      }
      return { o, len: end - x + 0.5 };
    } },
];

// Seconds a falling pillar has been on the track when its take-off window opens.
const PILLAR_LEAD = 0.12;

// Seconds after a jump when the runner first clears a one-unit block's side (top at 1 less the 0.14 sink-in).
const TB = (JV - Math.sqrt(JV * JV - 2 * GRAV * 0.86)) / GRAV;

// Seconds a jump from the ledge (one unit up) stays at least 0.5 above the track, the height that clears a spike.
const DROP_TOP = (JV + Math.sqrt(JV * JV + 2 * GRAV * 0.5)) / GRAV;

// Seconds a jump from the edge of a one-unit step takes to come down to the track on the far side of the pit.
const RISER_REACH = (JV + Math.sqrt(JV * JV + 2 * GRAV * 0.88)) / GRAV;

const BY_ID =Object.fromEntries(PATTERNS.map((p) => [p.id, p]));

/** The pattern each sector opens with: the obstacle it introduces. */
export const INTRO = { 1: 'bar', 2: 'padPit', 3: 'twin', 4: 'mover', 5: 'flip', 6: 'gate', 7: 'sweep', 8: 'pulse', 9: 'crumble', 10: 'boost', 11: 'riser', 12: 'stagger', 13: 'drop', 14: 'shuttle', 15: 'pillars' };

/** startX: where the run begins (0, or a sector start for a practice run); the same 24-unit lead-in follows it. */
export function createCourse(seed, startX = 0) {
  return { seed: seed >>> 0, rng: mulberry32(seed), objs: [], nextX: startX + 24, introduced: [], last: '', count: 0 };
}

/** Appends patterns until the course reaches untilX. Idempotent for x already built. */
export function extendCourse(c, untilX) {
  const r = c.rng;
  while (c.nextX < untilX) {
    const x = c.nextX, s = sectorAt(x), d = Math.min(1, x / 900);
    let p, isIntro = false;
    const intro = INTRO[s];
    if (intro && !c.introduced.includes(s)) { c.introduced.push(s); p = BY_ID[intro]; isIntro = true; }
    else {
      const avail = PATTERNS.filter((q) => q.sector <= s);
      const ws = avail.map((q) => q.weight(s) * (q.id === c.last ? 0.4 : 1));
      let k = r() * ws.reduce((a, b) => a + b, 0), i = 0;
      while (i < ws.length - 1 && (k -= ws[i]) >= 0) i++;
      p = avail[i];
    }
    const { o, len } = p.build(x, d, r, isIntro);
    o.sort((a, b) => a.x - b.x);
    const g = c.count++;
    for (const ob of o) { ob.p = p.id; ob.g = g; c.objs.push(ob); }
    c.last = p.id;
    c.nextX += len + Math.max(2.8, 5.4 - d * 2.6, speedAt(x) * 0.4) + r() * 1.8;
  }
}

/** Index of the first object with x >= v (objects are sorted by x). */
export function lowerBound(objs, v) {
  let lo = 0, hi = objs.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (objs[m].x < v) lo = m + 1; else hi = m; }
  return lo;
}

/** Drops objects far behind x so long runs stay cheap. */
export function pruneCourse(c, x) {
  const i = lowerBound(c.objs, x - 40);
  if (i > 200) c.objs.splice(0, i);
}
