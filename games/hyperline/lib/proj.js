// Hand-written 3D math for the Canvas2D renderer: a look-at perspective camera, near-plane
// clipping, back-face culling and the runner meshes. No DOM; tested in hyperline-proj.test.ts.
// Coordinates: x along the track, y up, z across the track.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** fovDeg is the vertical field of view. */
export function makeCamera(eye, target, fovDeg, w, h, near = 0.1) {
  const f = norm(sub(target, eye));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const focal = h / 2 / Math.tan((fovDeg * Math.PI) / 360);
  return { eye, f, r, u, focal, w, h, cx: w / 2, cy: h / 2, near };
}

export function toView(cam, x, y, z) {
  const d = [x - cam.eye[0], y - cam.eye[1], z - cam.eye[2]];
  return [dot(d, cam.r), dot(d, cam.u), dot(d, cam.f)];
}

/** Screen point {x, y}, view depth z and scale s (pixels per world unit at that depth); null if behind. */
export function project(cam, x, y, z) {
  const ex = x - cam.eye[0], ey = y - cam.eye[1], ez = z - cam.eye[2];
  const vz = ex * cam.f[0] + ey * cam.f[1] + ez * cam.f[2];
  if (vz < cam.near) return null;
  const vx = ex * cam.r[0] + ey * cam.r[1] + ez * cam.r[2];
  const vy = ex * cam.u[0] + ey * cam.u[1] + ez * cam.u[2];
  const s = cam.focal / vz;
  return { x: cam.cx + vx * s, y: cam.cy - vy * s, z: vz, s };
}

/** Clips the world segment a-b to the near plane; null if it is entirely behind. */
export function clipToNear(cam, a, b) {
  const za = toView(cam, a[0], a[1], a[2])[2], zb = toView(cam, b[0], b[1], b[2])[2], n = cam.near;
  if (za < n && zb < n) return null;
  if (za >= n && zb >= n) return [a, b];
  const t = (n - za) / (zb - za);
  const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  return za < n ? [p, b] : [a, p];
}

/** Screen-space winding test (y down): true for faces whose outward side faces the camera. */
export function faceVisible(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s > 0;
}

/** Rotates about x, then y, then z. */
export function rotateXYZ(v, ax, ay, az) {
  let [x, y, z] = v;
  let c = Math.cos(ax), s = Math.sin(ax);
  [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(ay); s = Math.sin(ay);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(az); s = Math.sin(az);
  [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}

function hexPrism() {
  const verts = [], faces = [];
  for (const z of [-0.42, 0.42]) for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    verts.push([Math.cos(a) * 0.56, Math.sin(a) * 0.56, z]);
  }
  faces.push([6, 7, 8, 9, 10, 11], [5, 4, 3, 2, 1, 0]);
  for (let i = 0; i < 6; i++) faces.push([i, (i + 1) % 6, 6 + ((i + 1) % 6), 6 + i]);
  return { verts, faces };
}

function octahedron() {
  const verts = [[0.62, 0, 0], [-0.62, 0, 0], [0, 0.62, 0], [0, -0.62, 0], [0, 0, 0.62], [0, 0, -0.62]];
  const faces = [];
  for (const sx of [0, 1]) for (const sy of [2, 3]) for (const sz of [4, 5]) {
    const sign = (sx === 0 ? 1 : -1) * (sy === 2 ? 1 : -1) * (sz === 4 ? 1 : -1);
    faces.push(sign > 0 ? [sx, sy, sz] : [sx, sz, sy]);
  }
  return { verts, faces };
}

/** Unit meshes centred on the origin, faces wound counter-clockwise seen from outside. */
export const MESHES = {
  cube: {
    verts: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]],
    faces: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [0, 1, 5, 4], [3, 7, 6, 2]],
  },
  hex: hexPrism(),
  octa: octahedron(),
  pyramid: {
    verts: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5], [0, 0.5, 0]],
    faces: [[0, 1, 2, 3], [0, 4, 1], [1, 4, 2], [2, 4, 3], [3, 4, 0]],
  },
};

/** Outward unit normal of a face (Newell's method, robust for any planar polygon). */
export function faceNormal(pts) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return norm([nx, ny, nz]);
}
