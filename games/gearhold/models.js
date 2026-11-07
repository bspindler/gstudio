// Gearhold geometry: a tiny mesh builder, the citadel architecture built from a level grid, the
// machines, pickups and the distant sky scenery. World axes: x = map x, z = map y, y = up.
// Colours are display (sRGB) values 0..1; the emissive flag (1) makes a surface glow.

export const PAL = {
  stone: [0.84, 0.8, 0.72], stoneShade: [0.76, 0.71, 0.63], plinth: [0.3, 0.29, 0.33],
  brass: [0.9, 0.68, 0.32], brassDark: [0.58, 0.41, 0.2], lacquer: [0.13, 0.36, 0.39], conduit: [0.2, 0.21, 0.27],
  floorA: [0.27, 0.3, 0.37], floorB: [0.31, 0.34, 0.41], grout: [0.66, 0.52, 0.28],
  porcelain: [0.95, 0.93, 0.88], ceramicDark: [0.24, 0.25, 0.3], bronze: [0.72, 0.48, 0.24],
  eye: [1, 0.28, 0.2], ember: [1, 0.48, 0.16], exit: [0.35, 1, 0.82], amber: [1, 0.7, 0.25],
  teal: [0.35, 1, 0.85], gold: [1, 0.8, 0.32], rock: [0.42, 0.38, 0.42], isle: [0.8, 0.76, 0.66],
};

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => mul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
const jitter = (c, k) => c.map((v) => Math.max(0, Math.min(1, v * k)));
export const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };

export function builder() {
  const v = [];
  const push = (p, n, c, e) => v.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], e);
  const b = {
    poly(pts, n, c, e = 0) {
      for (let i = 1; i < pts.length - 1; i++) { push(pts[0], n, c, e); push(pts[i], n, c, e); push(pts[i + 1], n, c, e); }
      return b;
    },
    // quad a,b (bottom) c,d (top) with a vertical colour gradient
    grad(pts, n, cBot, cTop, e = 0) {
      const [a, bb, c, d] = pts;
      push(a, n, cBot, e); push(bb, n, cBot, e); push(c, n, cTop, e);
      push(a, n, cBot, e); push(c, n, cTop, e); push(d, n, cTop, e);
      return b;
    },
    // polygon whose normal is chosen to face away from `inside`
    auto(pts, inside, c, e = 0) {
      let n = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
      let cen = [0, 0, 0]; for (const p of pts) cen = add(cen, p); cen = mul(cen, 1 / pts.length);
      if (dot(n, sub(cen, inside)) < 0) n = mul(n, -1);
      return b.poly(pts, n, c, e);
    },
    obox(c, ax, hs, col, e = 0, skip = '') {
      const names = ['x', 'y', 'z'];
      for (let a = 0; a < 3; a++) for (const s of [1, -1]) {
        if (skip.includes((s > 0 ? '+' : '-') + names[a])) continue;
        const i = (a + 1) % 3, j = (a + 2) % 3;
        const at = (si, sj) => add(add(add(c, mul(ax[a], s * hs[a])), mul(ax[i], si * hs[i])), mul(ax[j], sj * hs[j]));
        b.poly([at(1, 1), at(-1, 1), at(-1, -1), at(1, -1)], mul(ax[a], s), col, e);
      }
      return b;
    },
    box(x0, y0, z0, x1, y1, z1, col, e = 0, skip = '') {
      return b.obox([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2], col, e, skip);
    },
    cyl(p0, p1, r0, r1, segs, col, e = 0, caps = true) {
      const axis = norm(sub(p1, p0));
      const helper = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const u = norm(cross(axis, helper)), w = cross(axis, u);
      const dir = (i) => { const t = (i / segs) * Math.PI * 2; return add(mul(u, Math.cos(t)), mul(w, Math.sin(t))); };
      for (let i = 0; i < segs; i++) {
        const d0 = dir(i), d1 = dir(i + 1);
        b.poly([add(p0, mul(d0, r0)), add(p0, mul(d1, r0)), add(p1, mul(d1, r1)), add(p1, mul(d0, r1))], dir(i + 0.5), col, e);
      }
      if (caps) {
        const ring = (p, r) => Array.from({ length: segs }, (_, i) => add(p, mul(dir(i), r)));
        if (r0 > 0) b.poly(ring(p0, r0).reverse(), mul(axis, -1), col, e);
        if (r1 > 0) b.poly(ring(p1, r1), axis, col, e);
      }
      return b;
    },
    sphere(c, rx, ry, rz, segU, segV, col, e = 0) {
      const pt = (i, j) => {
        const th = (i / segU) * Math.PI * 2, ph = (j / segV) * Math.PI;
        return [c[0] + Math.cos(th) * Math.sin(ph) * rx, c[1] + Math.cos(ph) * ry, c[2] + Math.sin(th) * Math.sin(ph) * rz];
      };
      for (let i = 0; i < segU; i++) for (let j = 0; j < segV; j++) {
        const q = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)];
        const pts = j === 0 ? [q[0], q[2], q[3]] : j === segV - 1 ? [q[0], q[1], q[2]] : q;
        b.auto(pts, c, col, e);
      }
      return b;
    },
    // bipyramid crystal around a vertical axis
    crystal(c, r, h, sides, col, e = 1, twist = 0) {
      const top = [c[0], c[1] + h, c[2]], bot = [c[0], c[1] - h, c[2]];
      const ring = Array.from({ length: sides }, (_, i) => { const t = (i / sides) * Math.PI * 2 + twist; return [c[0] + Math.cos(t) * r, c[1], c[2] + Math.sin(t) * r]; });
      for (let i = 0; i < sides; i++) { const a = ring[i], d = ring[(i + 1) % sides]; b.auto([a, d, top], c, col, e); b.auto([d, a, bot], c, col, e); }
      return b;
    },
    get size() { return v.length / 10; },
    data: () => new Float32Array(v),
  };
  return b;
}

// ---------- the citadel, built from a level grid ----------
const DOOR_H = 1.7;
const SIDES = [
  // map neighbour, face origin corner (relative to cell), tangent along the face, outward normal
  { dx: 1, dy: 0, o: [1, 0], t: [0, 0, 1], n: [1, 0, 0] },
  { dx: -1, dy: 0, o: [0, 1], t: [0, 0, -1], n: [-1, 0, 0] },
  { dx: 0, dy: 1, o: [1, 1], t: [-1, 0, 0], n: [0, 0, 1] },
  { dx: 0, dy: -1, o: [0, 0], t: [1, 0, 0], n: [0, 0, -1] },
];

export function wallHeights(grid, mw, mh) {
  const h = new Float32Array(mw * mh);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    const c = grid[y * mw + x], edge = x === 0 || y === 0 || x === mw - 1 || y === mh - 1 ? 0.5 : 0;
    const r = hash(x, y);
    h[y * mw + x] = c === '#' ? 1.5 + Math.floor(r * 4) * 0.25 + edge
      : c === 'M' ? 1.35 + edge
        : c === 'P' ? 2.0 + edge
          : c === 'X' ? 2.6
            : 0;
  }
  return h;
}

/**
 * Static level geometry plus what the game needs to light and animate it.
 * Returns { data, heights, emitters: [{p, c, r, kind}], doors: [{x, y, axis, kind}] }.
 */
export function buildLevel(grid, mw, mh, mood) {
  const b = builder(), heights = wallHeights(grid, mw, mh), emitters = [], doors = [];
  const at = (x, y) => (x < 0 || y < 0 || x >= mw || y >= mh ? '#' : grid[y * mw + x]);
  const isWall = (c) => '#MPX'.includes(c);
  const isDoor = (c) => c === 'D' || c === 'K';
  const H = (x, y) => (x < 0 || y < 0 || x >= mw || y >= mh ? Infinity : heights[y * mw + x]);

  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    const c = at(x, y);
    if (!isWall(c)) {
      // floor: brass grout under an inset slate tile
      b.box(x, -0.05, y, x + 1, 0, y + 1, PAL.grout, 0, '-y');
      const tone = ((x + y) % 2 ? PAL.floorA : PAL.floorB);
      b.box(x + 0.025, 0, y + 0.025, x + 0.975, 0.014, y + 0.975, jitter(tone, 0.95 + hash(y, x) * 0.1), 0, '-y');
      if (isDoor(c)) {
        const axis = isWall(at(x - 1, y)) && isWall(at(x + 1, y)) ? 'x' : 'z';
        doors.push({ x, y, axis, kind: c });
        // lintel over the door, up to the lower of its two walls
        const top = axis === 'x' ? Math.min(H(x - 1, y), H(x + 1, y)) : Math.min(H(x, y - 1), H(x, y + 1));
        if (top > DOOR_H + 0.05) {
          if (axis === 'x') b.box(x, DOOR_H, y + 0.28, x + 1, top, y + 0.72, PAL.stoneShade);
          else b.box(x + 0.28, DOOR_H, y, x + 0.72, top, y + 1, PAL.stoneShade);
        }
      }
      continue;
    }
    const h = heights[y * mw + x], k = 0.96 + hash(x * 3, y * 7) * 0.08;
    const face = c === '#' ? jitter(PAL.stone, k) : c === 'M' ? jitter(PAL.lacquer, k) : c === 'P' ? PAL.conduit : PAL.plinth;
    // top and brass cap (overhangs only where the wall meets open floor)
    const over = (dx, dy) => (H(x + dx, y + dy) < h ? 0.05 : 0);
    b.box(x - over(-1, 0), h, y - over(0, -1), x + 1 + over(1, 0), h + 0.12, y + 1 + over(0, 1), PAL.brass, 0, '-y');
    for (const s of SIDES) {
      const nh = H(x + s.dx, y + s.dy);
      if (nh >= h) continue;
      const o = [x + s.o[0], 0, y + s.o[1]];
      const P = (t, yy, out = 0) => [o[0] + s.t[0] * t + s.n[0] * out, yy, o[2] + s.t[2] * t + s.n[2] * out];
      const slab = (t0, t1, y0, y1, out0, out1, col, e = 0) => {
        const cen = P((t0 + t1) / 2, (y0 + y1) / 2, (out0 + out1) / 2);
        b.obox(cen, [s.t, [0, 1, 0], s.n], [(t1 - t0) / 2, (y1 - y0) / 2, (out1 - out0) / 2], col, e, '-z');
      };
      b.grad([P(0, nh), P(1, nh), P(1, h), P(0, h)], s.n, nh > 0 ? face : jitter(face, 0.62), face);
      if (nh > 0) continue; // only faces that meet the floor get trim
      const nb = at(x + s.dx, y + s.dy);
      if (isDoor(nb)) continue;
      slab(0, 1, 0, 0.2, 0, 0.04, PAL.plinth);
      if (c === '#') {
        slab(0, 1, 0.98, 1.04, 0, 0.025, PAL.brass);
        if (h > 2) slab(0, 1, h - 0.3, h - 0.25, 0, 0.02, PAL.brassDark);
      } else if (c === 'M') {
        for (const t of [0.1, 0.9]) slab(t - 0.035, t + 0.035, 0.2, h, 0, 0.05, PAL.brass);
        slab(0.25, 0.75, 0.9, 0.95, 0, 0.012, PAL.teal, 1);
      } else if (c === 'P') {
        for (const [t, yy, r, hh] of [[0.3, 0.85, 0.09, 0.36], [0.7, 1.2, 0.11, 0.46], [0.5, 1.65, 0.07, 0.26]]) {
          b.crystal(P(t, yy, 0.06), r, hh, 5, mood.crystal, 1, t * 3);
        }
        slab(0, 1, 0.2, 0.32, 0, 0.03, PAL.brassDark);
        emitters.push({ p: P(0.5, 1.1, 0.6), c: mood.crystal, r: 3.6, kind: 'crystal' });
      } else if (c === 'X') {
        slab(0.06, 0.2, 0.2, 2.05, 0, 0.14, PAL.brass);
        slab(0.8, 0.94, 0.2, 2.05, 0, 0.14, PAL.brass);
        slab(0.06, 0.94, 1.95, 2.15, 0, 0.16, PAL.brass);
        slab(0.2, 0.8, 0.2, 1.95, 0, 0.02, PAL.exit, 1);
        b.crystal(P(0.5, 2.32, 0.12), 0.09, 0.16, 4, PAL.exit, 1);
        emitters.push({ p: P(0.5, 1.2, 0.7), c: PAL.exit, r: 4.8, kind: 'exit' });
      }
    }
  }
  return { data: b.data(), heights, emitters, doors };
}

export function buildDoor(axis, kind) {
  const b = builder();
  const col = kind === 'K' ? PAL.amber : PAL.teal;
  // built along x, then rotated for doors that span z
  const slab = (x0, y0, z0, x1, y1, z1, c, e = 0) => (axis === 'x' ? b.box(x0, y0, z0, x1, y1, z1, c, e) : b.box(z0, y0, x0, z1, y1, x1, c, e));
  slab(0, 0, 0.4, 1, DOOR_H, 0.6, PAL.porcelain);
  slab(0.04, 0.02, 0.385, 0.96, 0.12, 0.615, PAL.brassDark);
  slab(0.04, 0.9, 0.392, 0.96, 0.95, 0.608, col, 1);
  for (const x of [0.33, 0.66]) slab(x - 0.006, 0.12, 0.395, x + 0.006, DOOR_H - 0.06, 0.605, PAL.stoneShade);
  if (kind === 'K') {
    for (const z of [0.37, 0.63]) {
      const p0 = axis === 'x' ? [0.5, 1.25, z - 0.012] : [z - 0.012, 1.25, 0.5], p1 = axis === 'x' ? [0.5, 1.25, z + 0.012] : [z + 0.012, 1.25, 0.5];
      b.cyl(p0, p1, 0.2, 0.2, 10, PAL.gold, 1);
    }
  }
  return b.data();
}

export function buildLantern(mood) {
  const b = builder();
  b.crystal([0, 0, 0], 0.12, 0.24, 6, mood.lamp, 1);
  b.cyl([0, 0.03, 0], [0, -0.03, 0], 0.17, 0.17, 12, PAL.brass, 0, false);
  b.cyl([0, 0.03, 0], [0, -0.03, 0], 0.15, 0.15, 12, PAL.brassDark, 0, false);
  b.cyl([0, 0.24, 0], [0, 0.36, 0], 0.015, 0.015, 6, PAL.brass);
  return b.data();
}

// ---------- machines (facing +z, standing on y = 0) ----------
function ring(b, r, n, hs, col, y = 0, tilt = 0) {
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const rad = [Math.cos(t), Math.sin(t) * Math.sin(tilt), Math.sin(t) * Math.cos(tilt)];
    const tan = [-Math.sin(t), Math.cos(t) * Math.sin(tilt), Math.cos(t) * Math.cos(tilt)];
    const up = cross(tan, rad);
    b.obox([rad[0] * r, y + rad[1] * r, rad[2] * r], [tan, up, rad], hs, col);
  }
}
export function buildMachines() {
  const M = {};
  // Wisp drone: porcelain orb, one eye, spinning brass ring. Origin at its centre.
  const db = builder();
  db.sphere([0, 0, 0], 0.2, 0.2, 0.2, 12, 8, PAL.porcelain);
  db.cyl([0, 0, 0.15], [0, 0, 0.2], 0.115, 0.105, 12, PAL.brass);
  db.cyl([0, 0, 0.19], [0, 0, 0.212], 0.075, 0.07, 12, PAL.eye, 1);
  for (const s of [-1, 1]) db.obox([s * 0.21, 0, -0.02], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.025, 0.1, 0.07], PAL.brass);
  db.cyl([0, 0.19, 0], [0, 0.3, 0], 0.012, 0.008, 6, PAL.brassDark);
  db.crystal([0, 0.33, 0], 0.025, 0.04, 4, PAL.teal, 1);
  const dr = builder(); ring(dr, 0.31, 16, [0.045, 0.012, 0.02], PAL.brass, 0, 0.0);
  M.d = { body: db.data(), ring: dr.data() };

  // Tick crawler: brass beetle, six legs (each leg built pointing +x from its hip).
  const cb = builder();
  cb.sphere([0, 0.17, 0], 0.24, 0.11, 0.3, 12, 6, PAL.bronze);
  cb.sphere([0, 0.22, -0.03], 0.19, 0.075, 0.25, 10, 5, PAL.brass);
  cb.obox([0, 0.25, -0.03], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.008, 0.035, 0.22], PAL.brassDark);
  cb.sphere([0, 0.15, 0.27], 0.11, 0.08, 0.08, 10, 5, PAL.ceramicDark);
  for (const s of [-1, 1]) {
    cb.obox([s * 0.045, 0.17, 0.335], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.018, 0.014, 0.01], PAL.eye, 1);
    cb.obox([s * 0.05, 0.1, 0.35], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.012, 0.012, 0.05], PAL.brassDark);
  }
  const lb = builder();
  lb.cyl([0, 0, 0], [0.2, 0.08, 0], 0.02, 0.016, 6, PAL.brassDark);
  lb.cyl([0.2, 0.08, 0], [0.32, -0.15, 0], 0.016, 0.008, 6, PAL.bronze);
  M.c = { body: cb.data(), leg: lb.data() };

  // Kilnwarden: porcelain golem with a glowing kiln core.
  const bb = builder(), I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  bb.obox([0, 0.8, 0], I, [0.36, 0.3, 0.24], PAL.porcelain);
  bb.obox([0, 0.52, 0], I, [0.33, 0.04, 0.22], PAL.brass);
  bb.obox([0, 1.1, 0], I, [0.37, 0.025, 0.25], PAL.brass);
  bb.obox([0, 0.8, 0.245], I, [0.17, 0.13, 0.008], PAL.ember, 1);
  for (const x of [-0.12, -0.04, 0.04, 0.12]) bb.obox([x, 0.8, 0.258], I, [0.012, 0.14, 0.01], PAL.ceramicDark);
  for (const s of [-1, 1]) bb.sphere([s * 0.42, 1.04, 0], 0.13, 0.11, 0.13, 10, 6, PAL.brass);
  bb.obox([0, 1.26, 0.02], I, [0.13, 0.1, 0.13], PAL.porcelain);
  bb.obox([0, 1.27, 0.152], I, [0.09, 0.02, 0.006], PAL.eye, 1);
  bb.crystal([0, 1.43, 0], 0.04, 0.07, 4, PAL.ember, 1);
  const bl = builder();
  bl.obox([0, 0.24, 0], I, [0.085, 0.24, 0.1], PAL.ceramicDark);
  bl.obox([0, 0.03, 0.03], I, [0.1, 0.03, 0.14], PAL.brass);
  const ba = builder();
  ba.cyl([0, 0, 0], [0, -0.36, 0], 0.075, 0.07, 8, PAL.ceramicDark);
  ba.obox([0, -0.44, 0], I, [0.1, 0.1, 0.1], PAL.brass);
  M.b = { body: bb.data(), leg: bl.data(), arm: ba.data() };

  // Volatile energy cell.
  const ob = builder();
  ob.cyl([0, 0, 0], [0, 0.08, 0], 0.19, 0.19, 12, PAL.brass);
  ob.cyl([0, 0.47, 0], [0, 0.55, 0], 0.19, 0.17, 12, PAL.brass);
  ob.cyl([0, 0.08, 0], [0, 0.47, 0], 0.12, 0.12, 10, PAL.amber, 1);
  for (let i = 0; i < 4; i++) { const t = (i / 4) * Math.PI * 2 + 0.4; ob.obox([Math.cos(t) * 0.16, 0.275, Math.sin(t) * 0.16], [[Math.cos(t), 0, Math.sin(t)], [0, 1, 0], [-Math.sin(t), 0, Math.cos(t)]], [0.02, 0.2, 0.025], PAL.brassDark); }
  M.o = { body: ob.data() };
  return M;
}

export function buildItems(mood) {
  const I = {}, X = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const h = builder();
  h.crystal([0, 0.34, 0], 0.11, 0.2, 6, [0.45, 1, 0.7], 1);
  h.cyl([0, 0.02, 0], [0, 0.06, 0], 0.16, 0.14, 12, PAL.brass);
  I.h = h.data();
  const a = builder();
  a.box(-0.17, 0, -0.1, 0.17, 0.12, 0.1, PAL.brassDark);
  for (let i = 0; i < 4; i++) { const x = -0.12 + i * 0.08; a.cyl([x, 0.12, 0], [x, 0.27, 0], 0.03, 0.03, 8, [0.85, 0.22, 0.16]); a.cyl([x, 0.27, 0], [x, 0.3, 0], 0.03, 0.028, 8, PAL.brass); }
  I.a = a.data();
  const k = builder();
  k.cyl([0, 0, -0.03], [0, 0, 0.03], 0.14, 0.14, 16, PAL.gold, 1);
  for (let i = 0; i < 10; i++) { const t = (i / 10) * Math.PI * 2; k.obox([Math.cos(t) * 0.16, Math.sin(t) * 0.16, 0], [[Math.cos(t), Math.sin(t), 0], [-Math.sin(t), Math.cos(t), 0], [0, 0, 1]], [0.035, 0.03, 0.028], PAL.gold, 1); }
  k.cyl([0, 0, -0.035], [0, 0, 0.035], 0.05, 0.05, 10, PAL.brassDark);
  I.k = k.data();
  const w = builder();
  w.box(-0.06, 0.05, -0.12, 0.06, 0.15, 0.08, PAL.ceramicDark);
  for (const x of [-0.03, 0.03]) w.cyl([x, 0.1, 0.08], [x, 0.1, 0.38], 0.028, 0.028, 10, [0.7, 0.73, 0.77]);
  w.obox([0, 0.0, -0.1], X, [0.03, 0.07, 0.03], PAL.brass);
  I.w = w.data();
  return I;
}

// ---------- the sky: floating islands, spires and a colossal armillary ----------
export function buildScenery(cx, cz) {
  const b = builder();
  const rand = (() => { let s = 1234567; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); })();
  for (let i = 0; i < 38; i++) {
    const ang = rand() * Math.PI * 2, dist = 42 + rand() * 70, r = 2.5 + rand() * 9, top = -9 + rand() * 18;
    const x = cx + Math.cos(ang) * dist, z = cz + Math.sin(ang) * dist, sides = 6 + Math.floor(rand() * 4);
    const ring = Array.from({ length: sides }, (_, k) => { const t = (k / sides) * Math.PI * 2 + rand() * 0.3; const rr = r * (0.8 + rand() * 0.3); return [x + Math.cos(t) * rr, top, z + Math.sin(t) * rr]; });
    const tip = [x + (rand() - 0.5) * r * 0.4, top - r * (1.4 + rand()), z + (rand() - 0.5) * r * 0.4];
    const mid = ring.map((p) => [x + (p[0] - x) * 0.7, top - r * 0.5, z + (p[2] - z) * 0.7]);
    b.poly(ring.slice().reverse(), [0, 1, 0], PAL.isle);
    for (let k = 0; k < sides; k++) {
      const a = ring[k], d = ring[(k + 1) % sides], ma = mid[k], md = mid[(k + 1) % sides];
      b.auto([a, d, md, ma], [x, top - r * 0.4, z], PAL.rock);
      b.auto([ma, md, tip], [x, top - r * 0.8, z], jitter(PAL.rock, 0.8));
    }
    if (rand() < 0.45) {
      const h = 4 + rand() * 12, sr = 0.4 + rand() * 0.8;
      b.cyl([x, top, z], [x, top + h, z], sr, sr * 0.8, 6, PAL.stone, 0, false);
      b.cyl([x, top + h, z], [x, top + h + sr * 2.5, z], sr * 1.1, 0, 6, PAL.brass, 0, false);
      if (rand() < 0.5) b.crystal([x, top + h + sr * 3.4, z], sr * 0.5, sr * 0.9, 5, PAL.teal, 1);
    }
  }
  return b.data();
}
export function buildArmillary() {
  const b = builder();
  ring(b, 30, 64, [1.5, 0.6, 0.9], PAL.brass, 0, 0);
  ring(b, 26, 56, [1.3, 0.5, 0.7], PAL.brassDark, 0, 1.1);
  ring(b, 22, 48, [1.1, 0.45, 0.6], PAL.brass, 0, -0.7);
  b.sphere([0, 0, 0], 5, 5, 5, 16, 10, PAL.porcelain);
  b.crystal([0, 0, 0], 1.6, 9, 6, PAL.teal, 1);
  return b.data();
}
