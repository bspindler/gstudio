// Gearhold first-person weapons as small 3D models. gunTriangles() poses one for the renderer's
// first-person pass so the gun points into the screen at the crosshair.
// Gun space: x right, y down, z forward along the bore (metres, roughly).

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => mul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));

// Materials: colour (0..1), specular strength, shininess. `glow` ignores lighting.
const MAT = {
  steel: { c: [0.66, 0.69, 0.73], ks: 0.75, p: 30 },
  steelDark: { c: [0.36, 0.39, 0.43], ks: 0.6, p: 22 },
  blued: { c: [0.13, 0.14, 0.16], ks: 0.5, p: 18 },
  rubber: { c: [0.1, 0.1, 0.11], ks: 0.06, p: 6 },
  skin: { c: [0.82, 0.56, 0.42], ks: 0.14, p: 8 },
  nail: { c: [0.95, 0.8, 0.74], ks: 0.4, p: 20 },
  robo: { c: [0.36, 0.42, 0.5], ks: 0.75, p: 24 },
  roboDark: { c: [0.16, 0.19, 0.23], ks: 0.5, p: 20 },
  sleeve: { c: [0.22, 0.24, 0.19], ks: 0.04, p: 4 },
  hazard: { c: [0.95, 0.55, 0.12], ks: 0.2, p: 10 },
  glowCyan: { glow: '#7ff6ff' },
  glowGreen: { glow: '#5dff9e' },
  glowAmber: { glow: '#ffb04a' },
};

function mesh() {
  const faces = [];
  const api = {
    faces,
    quad(pts, n, mat, bias = 0) { faces.push({ pts, n, mat: MAT[mat], bias }); },
    // Oriented box: centre, three unit axes, half sizes.
    obox(c, ax, hs, mat, bias = 0) {
      for (let a = 0; a < 3; a++) for (const s of [1, -1]) {
        const b = (a + 1) % 3, d = (a + 2) % 3;
        const at = (sb, sd) => add(add(add(c, mul(ax[a], s * hs[a])), mul(ax[b], sb * hs[b])), mul(ax[d], sd * hs[d]));
        api.quad([at(1, 1), at(-1, 1), at(-1, -1), at(1, -1)], mul(ax[a], s), mat, bias);
      }
    },
    box(c, hs, mat, bias = 0) { api.obox(c, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], hs, mat, bias); },
    // Cylinder (or cone) from p0 to p1. `matAt(i)` lets alternate sides differ (cylinder flutes).
    cyl(p0, p1, r0, r1, segs, mat, bias = 0, caps = true) {
      const axis = norm(sub(p1, p0));
      const helper = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const u = norm(cross(axis, helper)), w = cross(axis, u);
      const dir = (i) => { const t = (i / segs) * Math.PI * 2; return add(mul(u, Math.cos(t)), mul(w, Math.sin(t))); };
      const m = typeof mat === 'function' ? mat : () => mat;
      for (let i = 0; i < segs; i++) {
        const d0 = dir(i), d1 = dir(i + 1);
        api.quad([add(p0, mul(d0, r0)), add(p0, mul(d1, r0)), add(p1, mul(d1, r1)), add(p1, mul(d0, r1))], dir(i + 0.5), m(i), bias);
      }
      if (caps) {
        const ring = (p, r) => Array.from({ length: segs }, (_, i) => add(p, mul(dir(i), r)));
        api.quad(ring(p0, r0).reverse(), mul(axis, -1), m(-1), bias);
        api.quad(ring(p1, r1), axis, m(-1), bias);
      }
    },
  };
  return api;
}

// Grip, trigger guard and the gripping right hand, seen from behind and to the left: the robot back of
// the hand wrapped behind the grip, a human thumb along the left of the frame, robot fingertips
// curling round the front, a robot trigger finger, a human palm heel, wrist and sleeve.
function gripAndHand(m) {
  const gy = [0, 0.95, -0.31], gz = [0, 0.31, 0.95], G = [[1, 0, 0], gy, gz];
  m.obox([0, 0.074, -0.068], G, [0.0155, 0.052, 0.022], 'rubber');
  m.box([0, 0.051, -0.008], [0.004, 0.002, 0.024], 'steelDark');
  m.box([0, 0.041, 0.015], [0.004, 0.011, 0.002], 'steelDark');
  m.box([0, 0.038, -0.004], [0.0025, 0.009, 0.0025], 'blued');
  // back of the hand (robot plating) wrapped behind the grip, knuckle ridge on top
  m.obox([0.004, 0.068, -0.099], G, [0.022, 0.04, 0.016], 'robo', -0.03);
  m.obox([0.004, 0.03, -0.094], G, [0.019, 0.008, 0.017], 'roboDark', -0.035);
  m.obox([-0.0185, 0.068, -0.1], G, [0.0012, 0.032, 0.012], 'glowCyan', -0.04);
  // robot fingers round the front of the grip, fingertips curling onto the left side
  for (let i = 0; i < 3; i++) {
    const y = 0.062 + i * 0.0175, z = -0.044 - i * 0.0055;
    m.cyl([0.019, y, z + 0.004], [-0.017, y, z + 0.006], 0.0088, 0.0084, 10, i % 2 ? 'robo' : 'roboDark', -0.05);
    m.cyl([-0.017, y, z + 0.006], [-0.022, y + 0.002, z - 0.017], 0.0082, 0.0074, 10, 'robo', -0.055);
    m.box([-0.0255, y, z + 0.005], [0.0012, 0.0022, 0.0022], 'glowAmber', -0.06);
  }
  // trigger finger resting in the guard
  m.cyl([0.012, 0.044, -0.03], [-0.003, 0.04, -0.006], 0.0076, 0.0072, 10, 'robo', -0.05);
  // human palm heel and thumb on the left side
  m.obox([-0.012, 0.1, -0.085], G, [0.011, 0.028, 0.024], 'skin', -0.04);
  m.cyl([-0.018, 0.05, -0.1], [-0.024, 0.026, -0.064], 0.0122, 0.0108, 14, 'skin', -0.045);
  m.cyl([-0.024, 0.026, -0.064], [-0.024, 0.014, -0.032], 0.0104, 0.009, 14, 'skin', -0.05);
  m.box([-0.0328, 0.0145, -0.036], [0.0009, 0.004, 0.006], 'nail', -0.055);
  // robot wrist with a glowing graft ring, then the sleeve
  m.cyl([0.004, 0.105, -0.118], [0.026, 0.18, -0.17], 0.029, 0.032, 14, 'robo', -0.03);
  m.cyl([0.004, 0.105, -0.118], [0.007, 0.114, -0.125], 0.0305, 0.0308, 14, 'glowCyan', -0.035, false);
  m.cyl([0.026, 0.18, -0.17], [0.08, 0.42, -0.34], 0.04, 0.05, 14, 'sleeve', -0.02);
}

function revolver() {
  const m = mesh(), A = -0.004;
  // frame, top strap, hammer, sights
  m.box([0, 0.004, 0.004], [0.016, 0.029, 0.045], 'steel');
  m.box([0, -0.004, -0.053], [0.0115, 0.021, 0.012], 'steel');
  m.box([0, -0.028, -0.004], [0.009, 0.004, 0.044], 'steel');
  m.box([0, -0.034, -0.046], [0.007, 0.003, 0.005], 'blued');
  m.box([0, -0.035, -0.068], [0.004, 0.011, 0.006], 'blued');
  m.box([0, -0.045, -0.078], [0.005, 0.003, 0.009], 'blued');
  // fluted cylinder
  m.cyl([0, 0.012, -0.036], [0, 0.012, 0.036], 0.034, 0.034, 18, (i) => (i < 0 ? 'steelDark' : i % 2 ? 'steelDark' : 'steel'));
  // barrel, full underlug, vent rib with slots, compensator
  m.cyl([0, A, 0.05], [0, A, 0.3], 0.0145, 0.0145, 16, 'steel');
  m.box([0, 0.013, 0.175], [0.0105, 0.012, 0.125], 'steel');
  m.box([0, -0.0205, 0.175], [0.006, 0.0035, 0.125], 'steel');
  for (let z = 0.07; z < 0.27; z += 0.022) m.box([0, -0.0244, z], [0.0062, 0.0004, 0.006], 'blued', -0.002);
  m.box([0, 0.0, 0.29], [0.016, 0.02, 0.016], 'steelDark');
  for (const z of [0.281, 0.293]) m.box([0, -0.0204, z], [0.007, 0.0006, 0.0035], 'blued', -0.002);
  m.box([0, -0.028, 0.284], [0.0022, 0.005, 0.007], 'blued');
  m.box([0, -0.031, 0.2785], [0.0016, 0.0016, 0.0006], 'glowGreen', -0.004);
  gripAndHand(m);
  return { faces: m.faces, tips: [[0, A, 0.306]], pivot: [0, 0.06, -0.07] };
}

function scatterCannon() {
  const m = mesh(), A = -0.004;
  m.box([0, 0.002, -0.01], [0.026, 0.03, 0.06], 'steelDark');
  m.box([-0.0262, 0.004, -0.01], [0.0005, 0.007, 0.05], 'hazard', -0.002);
  for (let i = 0; i < 4; i++) m.box([-0.0264, -0.012, -0.04 + i * 0.016], [0.0005, 0.002, 0.004], 'glowAmber', -0.003);
  for (const x of [-0.0145, 0.0145]) {
    m.cyl([x, A, 0.05], [x, A, 0.34], 0.0135, 0.0135, 12, 'steel');
    m.cyl([x, A, 0.336], [x, A, 0.342], 0.0142, 0.0142, 12, 'blued');
  }
  m.box([0, -0.019, 0.2], [0.004, 0.003, 0.14], 'blued');
  m.box([0, 0.014, 0.16], [0.02, 0.006, 0.1], 'rubber');
  m.box([0, -0.034, -0.05], [0.006, 0.004, 0.012], 'blued');
  gripAndHand(m);
  return { faces: m.faces, tips: [[-0.0145, A, 0.345], [0.0145, A, 0.345]], pivot: [0, 0.06, -0.07] };
}

export function buildGuns() { return [revolver(), scatterCannon()]; }

function rotator(yaw, pitch, roll) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  return ([x, y, z]) => {
    // roll (z), then pitch (x), then yaw (y)
    let x1 = x * cr - y * sr, y1 = x * sr + y * cr, z1 = z;
    const y2 = y1 * cp - z1 * sp, z2 = y1 * sp + z1 * cp;
    return [x1 * cy + z2 * sy, y2, -x1 * sy + z2 * cy];
  };
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

/**
 * The gun as triangles in view space (x right, y up, z toward the viewer; the camera looks down -z),
 * in the renderer's vertex layout: position, normal, colour (sRGB), emissive flag.
 * pose: { pos, yaw, pitch, roll, kick } in gun space (x right, y down, z forward).
 * Returns { data, tips } where tips are the muzzle points in view space.
 */
export function gunTriangles(gun, pose) {
  const R = rotator(pose.yaw, pose.pitch, pose.roll), K = rotator(0, pose.kick, 0), pv = gun.pivot;
  const toView = (p) => { const q = add(pose.pos, R(add(pv, K(sub(p, pv))))); return [q[0], -q[1], -q[2]]; };
  const nView = (n) => { const q = R(K(n)); return [q[0], -q[1], -q[2]]; };
  const out = [];
  for (const face of gun.faces) {
    const pts = face.pts.map(toView), n = nView(face.n);
    const col = face.mat.glow ? hex(face.mat.glow) : face.mat.c, e = face.mat.glow ? 1 : 0;
    for (let i = 1; i < pts.length - 1; i++) {
      for (const p of [pts[0], pts[i], pts[i + 1]]) out.push(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2], e);
    }
  }
  return { data: new Float32Array(out), tips: gun.tips.map(toView) };
}
