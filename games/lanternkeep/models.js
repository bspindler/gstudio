// Lanternkeep models: a tiny flat-shaded mesh builder and every model in the game, built from
// primitives at load time. World units are grid cells; y is up. Models face +z.
// Colours are display (sRGB) values 0..1; e = 1 marks a glowing (emissive) surface.
import { M4 } from './gl.js';

export const PAL = {
  // plants
  glowcap: [0.36, 0.98, 0.8], glowcapDeep: [0.25, 0.55, 1], stem: [0.9, 0.86, 0.74],
  frost: [0.68, 0.88, 1], frostDark: [0.42, 0.62, 0.85], ice: [0.86, 0.97, 1],
  ember: [1, 0.46, 0.2], emberCore: [1, 0.82, 0.45], leaf: [0.32, 0.5, 0.28], coal: [0.2, 0.14, 0.14],
  sun: [1, 0.86, 0.4], sunDark: [0.72, 0.52, 0.2], sunCore: [1, 0.96, 0.75],
  // lantern
  paper: [1, 0.72, 0.36], wood: [0.36, 0.25, 0.16], iron: [0.22, 0.2, 0.24], stone: [0.48, 0.47, 0.5],
  // creatures
  mothWing: [0.84, 0.78, 0.96], mothBody: [0.36, 0.28, 0.42], fly: [0.9, 1, 0.45], flyBody: [0.24, 0.2, 0.28],
  shell: [0.2, 0.36, 0.46], shellHi: [0.42, 0.66, 0.8], wisp: [0.7, 0.95, 1], toad: [0.3, 0.24, 0.4], toadBelly: [0.48, 0.38, 0.55],
  eye: [1, 0.88, 0.3], moss: [0.36, 0.6, 0.3], mossShell: [0.32, 0.28, 0.22], spore: [0.7, 1, 0.5],
  queen: [0.62, 0.48, 0.86], queenMark: [1, 0.6, 0.9],
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const hash = (x, y, k = 0) => { const s = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };
const shade = (c, k) => c.map((v) => Math.max(0, Math.min(1, v * k)));
const TAU = Math.PI * 2;

// Builder: primitives at the origin, placed by a matrix stack. Face normals are computed after the
// transform, so non-uniform scales and any winding are fine (the shader lights both faces).
export function builder() {
  const v = [];
  const stack = [M4.ident()];
  let jitter = 0;
  let face = 0;
  const cur = () => stack[stack.length - 1];
  const b = {
    push(m) { stack.push(M4.mul(cur(), m)); return b; },
    pop() { stack.pop(); return b; },
    at(m, fn) { b.push(m); fn(); b.pop(); return b; },
    jitter(k) { jitter = k; return b; },
    tri(p0, p1, p2, col, e = 0) {
      const m = cur();
      const a = M4.apply(m, p0), bb = M4.apply(m, p1), c = M4.apply(m, p2);
      const n = norm(cross(sub(bb, a), sub(c, a)));
      const cc = jitter ? shade(col, 1 - jitter + hash(face++, a[0] + a[2], a[1]) * jitter * 2) : col;
      for (const p of [a, bb, c]) v.push(p[0], p[1], p[2], n[0], n[1], n[2], cc[0], cc[1], cc[2], e);
      return b;
    },
    quad(p0, p1, p2, p3, col, e = 0) { b.tri(p0, p1, p2, col, e); b.tri(p0, p2, p3, col, e); return b; },
    poly(pts, col, e = 0) { for (let i = 1; i < pts.length - 1; i++) b.tri(pts[0], pts[i], pts[i + 1], col, e); return b; },
    box(x0, y0, z0, x1, y1, z1, col, e = 0, top = col) {
      const P = (x, y, z) => [x, y, z];
      b.quad(P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1), top, e);
      b.quad(P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1), shade(col, 0.6), e);
      b.quad(P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0), col, e);
      b.quad(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), col, e);
      b.quad(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0), shade(col, 0.9), e);
      b.quad(P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0), shade(col, 0.9), e);
      return b;
    },
    // vertical frustum from y0 (radius r0) to y1 (radius r1)
    cyl(y0, y1, r0, r1, segs, col, e = 0, caps = true, colTop = col) {
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU;
        const p = (a, r, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
        b.quad(p(a0, r0, y0), p(a1, r0, y0), p(a1, r1, y1), p(a0, r1, y1), col, e);
        if (caps && r1 > 0) b.tri([0, y1, 0], p(a0, r1, y1), p(a1, r1, y1), colTop, e);
        if (caps && r0 > 0) b.tri([0, y0, 0], p(a1, r0, y0), p(a0, r0, y0), shade(col, 0.6), e);
      }
      return b;
    },
    // ellipsoid; yFrom/yTo in -1..1 clip it (e.g. 0..1 for a dome). colFn(y01) can grade colours.
    sphere(rx, ry, rz, segs, rings, col, e = 0, yFrom = -1, yTo = 1, colFn = null) {
      const lat0 = Math.asin(yFrom), lat1 = Math.asin(yTo);
      for (let j = 0; j < rings; j++) {
        const t0 = lat0 + ((lat1 - lat0) * j) / rings, t1 = lat0 + ((lat1 - lat0) * (j + 1)) / rings;
        const c = colFn ? colFn((j + 0.5) / rings) : col;
        for (let i = 0; i < segs; i++) {
          const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU;
          const p = (a, t) => [Math.cos(a) * Math.cos(t) * rx, Math.sin(t) * ry, Math.sin(a) * Math.cos(t) * rz];
          b.quad(p(a0, t0), p(a1, t0), p(a1, t1), p(a0, t1), c, e);
        }
      }
      if (yTo < 1 && yFrom <= -1) { /* open top */ }
      return b;
    },
    // a flat leaf/wing outline in the XZ plane (pts as [x,z]), double-sided by the shader
    flat(pts, col, e = 0, y = 0) { b.poly(pts.map(([x, z]) => [x, y, z]), col, e); return b; },
    data() { return new Float32Array(v); },
    get count() { return v.length / 10; },
  };
  return b;
}

const T = (x, y, z, ry = 0, rx = 0, rz = 0, s = 1, sy = s, sz = s) => M4.trs(x, y, z, ry, rx, rz, s, sy, sz);

// ---------- plants ----------

function mushroom(b, x, z, h, r, cap, e = 1, spots = PAL.stem) {
  b.at(T(x, 0, z), () => {
    b.cyl(0, h, r * 0.28, r * 0.22, 7, PAL.stem);
    b.at(T(0, h, 0), () => {
      b.sphere(r, r * 0.62, r, 9, 3, cap, 0, 0, 1, (y) => shade(cap, 0.75 + y * 0.35));
      b.cyl(-0.01, 0.02, r * 0.98, r * 0.5, 9, shade(cap, 0.5), 0, false);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + 0.4, rr = r * (i % 2 ? 0.55 : 0.3);
        b.at(T(Math.cos(a) * rr, r * (i % 2 ? 0.42 : 0.56), Math.sin(a) * rr), () => b.sphere(r * 0.11, r * 0.06, r * 0.11, 5, 1, spots, e));
      }
    });
  });
}

function fern(b, n, len, col, tip, spread = 1.1) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    b.at(T(0, 0.05, 0, a, 0, 0), () => {
      for (let k = 0; k < 4; k++) {
        const t0 = k / 4, t1 = (k + 1) / 4;
        const p = (t) => [0, Math.sin(t * spread) * len * 0.8, t * len * 0.9];
        const w = 0.07 * (1 - t0 * 0.7);
        const q0 = p(t0), q1 = p(t1);
        b.quad([-w, q0[1], q0[2]], [w, q0[1], q0[2]], [w * 0.7, q1[1], q1[2]], [-w * 0.7, q1[1], q1[2]], shade(col, 0.8 + t0 * 0.3));
      }
      const e = [0, Math.sin(spread) * len * 0.8, len * 0.9];
      b.at(T(e[0], e[1], e[2], 0, 0.4), () => b.cyl(0, 0.16, 0.05, 0, 4, tip, 1));
    });
  }
}

function thistle(b, h, r, col, core, spikes = 14) {
  b.cyl(0, h, 0.035, 0.03, 5, PAL.leaf);
  for (const s of [-1, 1]) b.at(T(0, h * 0.35, 0, s > 0 ? 0 : Math.PI, 0, 0.6), () => b.flat([[0, 0], [0.08, 0.16], [0, 0.3], [-0.08, 0.16]], PAL.leaf));
  b.at(T(0, h + r, 0), () => {
    b.sphere(r * 0.75, r * 0.75, r * 0.75, 7, 4, core, 1);
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * TAU, el = ((i * 7) % 5) / 5 - 0.4;
      b.at(T(0, 0, 0, a, el, 0), () => b.at(T(0, 0, r * 0.55, 0, Math.PI / 2), () => b.cyl(0, r * 0.75, r * 0.12, 0, 4, col, 0)));
    }
  });
}

function crystal(b, h, r, col, core, sides = 6) {
  b.cyl(0, h * 0.72, r, r * 0.86, sides, col, 0, false);
  b.at(T(0, h * 0.72, 0), () => b.cyl(0, h * 0.28, r * 0.86, 0, sides, shade(col, 1.15), 0, false));
  b.at(T(0, h * 0.35, 0), () => b.sphere(r * 0.45, h * 0.2, r * 0.45, 6, 2, core, 1));
}

function soil(b, r = 0.36, col = [0.2, 0.17, 0.15]) {
  b.jitter(0.15).cyl(0, 0.06, r, r * 0.86, 9, col).jitter(0);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.3;
    b.at(T(Math.cos(a) * r * 0.9, 0.03, Math.sin(a) * r * 0.9, a), () => b.box(-0.05, 0, -0.04, 0.05, 0.06, 0.04, PAL.stone));
  }
}

// key: `${type}:${tier}` or `${type}:a` / `${type}:b`
export function plantMesh(type, form) {
  const b = builder();
  if (type === 'glowcap') {
    soil(b);
    if (form === 'b') { mushroom(b, 0, 0, 0.42, 0.4, PAL.glowcapDeep); mushroom(b, 0.22, 0.12, 0.18, 0.12, PAL.glowcap); }
    else if (form === 'a') { mushroom(b, -0.13, -0.05, 0.36, 0.24, PAL.glowcap); mushroom(b, 0.16, -0.08, 0.3, 0.2, PAL.glowcap); mushroom(b, 0.02, 0.17, 0.26, 0.19, PAL.glowcap); }
    else {
      mushroom(b, 0, 0, 0.34 + (form === 1 ? 0.06 : 0), 0.26 + (form === 1 ? 0.04 : 0), PAL.glowcap);
      if (form === 1) { mushroom(b, -0.2, 0.12, 0.16, 0.12, PAL.glowcap); mushroom(b, 0.2, 0.1, 0.13, 0.1, PAL.glowcap); }
    }
  } else if (type === 'frost') {
    soil(b, 0.36, [0.22, 0.24, 0.3]);
    if (form === 'a') {
      fern(b, 9, 0.42, PAL.frost, PAL.ice, 0.7);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; b.at(T(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3, 0, 0, 0.3 * Math.cos(a)), () => b.cyl(0, 0.12, 0.04, 0, 4, PAL.ice, 1)); }
    } else if (form === 'b') {
      fern(b, 6, 0.32, PAL.frostDark, PAL.ice);
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; b.at(T(Math.cos(a) * 0.12, 0.02, Math.sin(a) * 0.12, 0, Math.sin(a) * 0.25, Math.cos(a) * 0.25), () => b.cyl(0, 0.55 - i * 0.04, 0.06, 0, 5, PAL.ice, 1)); }
    } else fern(b, form === 1 ? 7 : 5, 0.34 + (form === 1 ? 0.06 : 0), PAL.frost, PAL.ice);
  } else if (type === 'ember') {
    soil(b, 0.36, [0.22, 0.16, 0.13]);
    if (form === 'a') { thistle(b, 0.28, 0.24, PAL.ember, PAL.emberCore, 18); for (const s of [-1, 1]) b.at(T(s * 0.2, 0, 0.08), () => thistle(b, 0.16, 0.1, PAL.ember, PAL.emberCore, 8)); }
    else if (form === 'b') { thistle(b, 0.3, 0.2, PAL.coal, PAL.ember, 12); }
    else thistle(b, 0.28 + (form === 1 ? 0.04 : 0), 0.16 + (form === 1 ? 0.03 : 0), PAL.ember, PAL.emberCore, form === 1 ? 16 : 12);
  } else if (type === 'sunspire') {
    soil(b, 0.36, [0.26, 0.22, 0.18]);
    if (form === 'a') { crystal(b, 1.05, 0.1, PAL.sun, PAL.sunCore, 5); for (const s of [-1, 1]) b.at(T(s * 0.15, 0, 0.05, 0, 0, s * 0.2), () => crystal(b, 0.45, 0.06, PAL.sunDark, PAL.sunCore, 5)); }
    else if (form === 'b') {
      crystal(b, 0.7, 0.14, PAL.sun, PAL.sunCore);
      b.at(T(0, 0.62, 0, 0, Math.PI / 2), () => { for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; b.at(T(Math.cos(a) * 0.28, Math.sin(a) * 0.28, 0), () => b.sphere(0.035, 0.035, 0.035, 4, 2, PAL.sunCore, 1)); } });
    } else {
      crystal(b, 0.62 + (form === 1 ? 0.1 : 0), 0.13, PAL.sun, PAL.sunCore);
      if (form === 1) for (const s of [-1, 1]) b.at(T(s * 0.17, 0, 0.04, 0, 0, s * 0.25), () => crystal(b, 0.34, 0.06, PAL.sunDark, PAL.sunCore, 5));
    }
  }
  return b.data();
}

// ---------- lantern ----------

export function lanternMeshes() {
  const post = builder();
  post.jitter(0.12);
  for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; post.at(T(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2, a), () => post.box(-0.06, -0.02, -0.05, 0.06, 0.06, 0.05, [0.34, 0.33, 0.38])); }
  post.jitter(0);
  post.cyl(0, 1.25, 0.06, 0.05, 6, PAL.wood);
  post.at(T(0, 1.22, 0), () => post.box(-0.04, -0.03, -0.04, 0.04, 0.03, 0.42, PAL.wood));
  post.at(T(0, 1.18, 0.4), () => post.cyl(-0.12, 0, 0.008, 0.008, 4, PAL.iron));
  const paper = builder();
  paper.at(T(0, 0, 0), () => {
    paper.cyl(0.18, 0.21, 0.08, 0.12, 8, PAL.iron);
    paper.sphere(0.17, 0.2, 0.17, 10, 5, PAL.paper, 1, -1, 1, (y) => shade(PAL.paper, 0.85 + 0.25 * Math.sin(y * Math.PI)));
    paper.cyl(-0.22, -0.19, 0.1, 0.07, 8, PAL.iron);
  });
  return { post: post.data(), paper: paper.data() };
}

// ---------- creatures (parts face +z, origin at the ground under the body) ----------

function wingShape(span, len, back = 0.5) {
  return [[0, 0.04], [span * 0.55, len * 0.5], [span, len * 0.15], [span * 0.9, -len * back * 0.6], [span * 0.4, -len * back], [0, -0.04]];
}

export function creatureMeshes() {
  const M = {};
  const make = (fn) => { const b = builder(); fn(b); return b.data(); };

  M.moth = {
    body: make((b) => { b.at(T(0, 0.28, 0), () => { b.sphere(0.06, 0.06, 0.14, 6, 4, PAL.mothBody); b.at(T(0, 0.02, 0.15), () => b.sphere(0.05, 0.05, 0.05, 5, 3, PAL.mothBody)); for (const s of [-1, 1]) b.at(T(s * 0.03, 0.04, 0.18, 0, -0.9, s * 0.5), () => b.cyl(0, 0.12, 0.006, 0.004, 3, PAL.mothBody)); b.at(T(0, 0.04, 0.19), () => { b.at(T(0.025, 0, 0), () => b.sphere(0.015, 0.015, 0.015, 4, 2, PAL.eye, 1)); b.at(T(-0.025, 0, 0), () => b.sphere(0.015, 0.015, 0.015, 4, 2, PAL.eye, 1)); }); }); }),
    wing: make((b) => { b.flat(wingShape(0.32, 0.3), PAL.mothWing); b.flat([[0.08, 0.02], [0.2, 0.08], [0.22, -0.05], [0.12, -0.08]], shade(PAL.mothWing, 0.75), 0, 0.002); }),
    wingY: 0.3, wingSpan: 1,
  };
  M.firefly = {
    body: make((b) => { b.at(T(0, 0.35, 0), () => { b.sphere(0.035, 0.035, 0.07, 5, 3, PAL.flyBody); b.at(T(0, -0.01, -0.09), () => b.sphere(0.045, 0.04, 0.06, 6, 3, PAL.fly, 1)); }); }),
    wing: make((b) => b.flat([[0, 0.03], [0.12, 0.05], [0.14, -0.02], [0, -0.03]], [0.85, 0.9, 1])),
    wingY: 0.37, wingSpan: 1,
  };
  M.beetle = {
    body: make((b) => {
      b.at(T(0, 0.12, 0), () => {
        b.jitter(0.1).sphere(0.22, 0.16, 0.27, 9, 4, PAL.shell, 0, 0, 1, (y) => shade(PAL.shell, 0.8 + y * 0.5)).jitter(0);
        b.cyl(-0.01, 0.02, 0.22, 0.2, 9, shade(PAL.shell, 0.5), 0, false);
        b.at(T(0, 0.155, 0), () => b.box(-0.005, 0, -0.26, 0.005, 0.01, 0.2, [0.1, 0.14, 0.18]));
        b.at(T(0, 0.02, 0.27), () => { b.sphere(0.1, 0.07, 0.07, 6, 3, [0.14, 0.18, 0.22]); for (const s of [-1, 1]) b.at(T(s * 0.05, 0.02, 0.05), () => b.sphere(0.02, 0.02, 0.02, 4, 2, [0.7, 0.9, 1], 1)); });
      });
    }),
    legs: make((b) => { for (const s of [-1, 1]) for (const j of [-1, 0, 1]) b.at(T(s * 0.18, 0.1, j * 0.12, 0, 0, s * -0.9), () => b.cyl(0, -0.2, 0.018, 0.012, 3, [0.1, 0.12, 0.15])); }),
  };
  M.wisp = {
    body: make((b) => {
      b.at(T(0, 0.38, 0), () => {
        b.sphere(0.18, 0.22, 0.18, 8, 5, PAL.wisp, 1, -1, 0.4);
        b.at(T(0, 0.08, 0), () => b.cyl(0, 0.26, 0.15, 0, 8, PAL.wisp, 1, false));
        for (const s of [-1, 1]) b.at(T(s * 0.06, 0.02, 0.165), () => b.sphere(0.03, 0.04, 0.01, 5, 2, [0.08, 0.06, 0.16]));
      });
    }),
  };
  M.mossback = {
    body: make((b) => {
      b.at(T(0, 0.08, 0), () => {
        b.jitter(0.12).sphere(0.28, 0.22, 0.32, 9, 4, PAL.mossShell, 0, 0, 1).jitter(0);
        for (let i = 0; i < 12; i++) { const a = i * 2.4, rr = 0.08 + (i % 4) * 0.05; b.at(T(Math.cos(a) * rr, 0.2 - rr * 0.35, Math.sin(a) * rr * 1.1), () => b.sphere(0.07, 0.05, 0.07, 5, 2, PAL.moss)); }
        for (let i = 0; i < 5; i++) { const a = i * 1.3; b.at(T(Math.cos(a) * 0.13, 0.24, Math.sin(a) * 0.15), () => b.sphere(0.025, 0.025, 0.025, 4, 2, PAL.spore, 1)); }
        b.at(T(0, 0.04, 0.33), () => { b.sphere(0.09, 0.08, 0.09, 6, 3, [0.4, 0.5, 0.32]); for (const s of [-1, 1]) b.at(T(s * 0.04, 0.03, 0.07), () => b.sphere(0.018, 0.018, 0.018, 4, 2, PAL.eye, 1)); });
      });
    }),
    legs: make((b) => { for (const s of [-1, 1]) for (const j of [-1, 1]) b.at(T(s * 0.22, 0.06, j * 0.18), () => b.cyl(0, -0.08, 0.05, 0.05, 5, [0.36, 0.44, 0.28])); }),
  };
  M.toad = {
    body: make((b) => {
      b.at(T(0, 0.3, 0), () => {
        b.jitter(0.08).sphere(0.42, 0.32, 0.44, 10, 5, PAL.toad, 0, -0.6, 1, (y) => (y < 0.35 ? PAL.toadBelly : PAL.toad)).jitter(0);
        for (let i = 0; i < 9; i++) { const a = i * 2.1; b.at(T(Math.cos(a) * 0.25, 0.22, Math.sin(a) * 0.28 - 0.05), () => b.sphere(0.05, 0.03, 0.05, 5, 2, shade(PAL.toad, 1.3))); }
        for (const s of [-1, 1]) b.at(T(s * 0.2, 0.24, 0.24), () => { b.sphere(0.12, 0.11, 0.12, 7, 3, PAL.toad); b.at(T(0, 0.02, 0.06), () => b.sphere(0.075, 0.075, 0.07, 7, 3, PAL.eye, 1)); b.at(T(0, 0.02, 0.125), () => b.box(-0.012, -0.05, -0.005, 0.012, 0.05, 0.005, [0.05, 0.03, 0.06])); });
        b.at(T(0, -0.02, 0.4), () => b.box(-0.22, -0.01, -0.01, 0.22, 0.01, 0.02, [0.18, 0.12, 0.22]));
      });
    }),
    legs: make((b) => { for (const s of [-1, 1]) { b.at(T(s * 0.36, 0.08, -0.15), () => b.sphere(0.16, 0.1, 0.2, 6, 3, PAL.toad)); b.at(T(s * 0.3, 0.04, 0.25), () => b.sphere(0.07, 0.05, 0.1, 5, 2, PAL.toadBelly)); } }),
  };
  M.mothmother = {
    body: make((b) => {
      b.at(T(0, 0.5, 0), () => {
        b.sphere(0.12, 0.12, 0.3, 8, 5, PAL.mothBody);
        b.at(T(0, 0.04, 0.3), () => b.sphere(0.1, 0.1, 0.1, 6, 3, PAL.mothBody));
        for (let i = 0; i < 5; i++) b.at(T((i - 2) * 0.035, 0.13, 0.32, 0, -0.3), () => b.cyl(0, 0.08 + (i % 2) * 0.04, 0.015, 0, 4, PAL.queenMark, 1));
        for (const s of [-1, 1]) b.at(T(s * 0.05, 0.06, 0.38), () => b.sphere(0.03, 0.03, 0.03, 4, 2, PAL.eye, 1));
        for (let i = 0; i < 4; i++) b.at(T(0, 0.08, -0.06 - i * 0.07), () => b.box(-0.09, 0, -0.01, 0.09, 0.01, 0.01, PAL.queenMark, 1));
      });
    }),
    wing: make((b) => {
      b.flat(wingShape(0.7, 0.62, 0.7), PAL.queen);
      b.flat([[0.3, 0.1], [0.42, 0.2], [0.5, 0.08], [0.4, -0.02]], PAL.queenMark, 1, 0.003);
      b.flat([[0.2, -0.15], [0.34, -0.1], [0.36, -0.28], [0.22, -0.3]], shade(PAL.queen, 0.7), 0, 0.003);
    }),
    wingY: 0.52, wingSpan: 1,
  };
  return M;
}

// ---------- a turntable model for reveal cards ----------
export function previewKind(id) {
  return id in { glowcap: 1, frost: 1, ember: 1, sunspire: 1 } ? 'plant' : 'creature';
}
