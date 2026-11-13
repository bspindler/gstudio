// Lanternkeep models for the three.js renderer: smooth, physically shaded plants, creatures, the lantern and
// scenery, built from code at load time (no model files). One world unit is one grid cell; y is up; models
// face +z. Emissive parts are pushed above 1 so the bloom pass turns them into glows.
import * as THREE from './vendor/three.module.js';

const TAU = Math.PI * 2;
const V2 = (x, y) => new THREE.Vector2(x, y);
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
export const hash = (x, y, k = 0) => { const s = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };
const noise = new THREE.SimplexNoise();

// ---------- materials ----------
const cache = new Map();
/** A shared standard (or physical) material; same options give the same instance. */
export function mat(color, o = {}) {
  const key = JSON.stringify([color, o]);
  if (cache.has(key)) return cache.get(key);
  const physical = o.clearcoat || o.iridescence || o.transmission || o.sheen;
  const M = physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const m = new M({
    color: new THREE.Color(color), roughness: o.rough ?? 0.6, metalness: o.metal ?? 0,
    emissive: new THREE.Color(o.emissive ?? 0x000000), emissiveIntensity: o.ei ?? 1,
    side: o.double ? THREE.DoubleSide : THREE.FrontSide, transparent: o.opacity !== undefined && o.opacity < 1, opacity: o.opacity ?? 1,
    flatShading: !!o.flat, vertexColors: !!o.vc,
  });
  if (physical) Object.assign(m, {
    clearcoat: o.clearcoat ?? 0, clearcoatRoughness: o.ccRough ?? 0.15, iridescence: o.iridescence ?? 0, iridescenceIOR: 1.4,
    transmission: o.transmission ?? 0, thickness: o.thickness ?? 0.3, ior: o.ior ?? 1.45, sheen: o.sheen ?? 0, sheenColor: new THREE.Color(o.sheenColor ?? 0xffffff),
  });
  if (o.depthWrite === false) m.depthWrite = false;
  cache.set(key, m);
  return m;
}
/** A glowing unlit-looking surface: dark base, bright emissive. */
export const glow = (color, ei = 2.5, o = {}) => mat(0x000000, { emissive: color, ei, rough: 0.4, ...o });

// ---------- geometry helpers ----------
export function lathe(profile, segs = 28) { return new THREE.LatheGeometry(profile.map(([r, y]) => V2(Math.max(0, r), y)), segs); }

/** A smooth sphere pushed in and out by noise: rocks, toad skin, tree canopies. */
export function blob(r, amp = 0.15, freq = 1.6, seed = 0, ws = 28, hs = 18, sy = 1) {
  const g = new THREE.SphereGeometry(r, ws, hs);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    const d = 1 + amp * noise.noise3d(n.x * freq + seed, n.y * freq + seed * 1.7, n.z * freq - seed);
    p.setXYZ(i, v.x * d, v.y * d * sy, v.z * d);
  }
  g.computeVertexNormals();
  return g;
}

/** A ribbon along a curve: width(t) across, optional upward cup. Used for leaves, fronds, wings' veins. */
export function ribbon(curve, width, segs = 16, cup = 0) {
  const pos = [], idx = [];
  const up = V3(0, 1, 0);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, p = curve.getPoint(t), tan = curve.getTangent(t);
    let side = new THREE.Vector3().crossVectors(tan, up);
    if (side.lengthSq() < 1e-6) side = V3(1, 0, 0);
    side.normalize();
    const w = width(t), lift = new THREE.Vector3().crossVectors(side, tan).normalize().multiplyScalar(cup * w);
    for (const s of [-1, 0, 1]) { const q = p.clone().addScaledVector(side, s * w); if (s !== 0) q.add(lift); pos.push(q.x, q.y, q.z); }
    if (i < segs) { const a = i * 3; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const mesh = (geo, material, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, sx, sy, sz, shadow = true } = {}) => {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.scale.set(sx ?? s, sy ?? s, sz ?? s);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
};
const group = (...kids) => { const g = new THREE.Group(); for (const k of kids) g.add(k); return g; };

// ---------- palette ----------
export const C = {
  glowcap: 0x5ff5cf, glowcapDeep: 0x3a7bff, stem: 0xeae2cc, gill: 0x9fd8c8,
  frost: 0xa9dcff, frostDeep: 0x5d8fd0, ice: 0xdff6ff,
  ember: 0xff6a2a, emberCore: 0xffc060, leaf: 0x48703c, coal: 0x2a1c1c,
  sun: 0xffd35a, sunDeep: 0xc08a2a, sunCore: 0xfff2b8,
  paper: 0xffb060, wood: 0x5a3c26, iron: 0x2c2a30, stone: 0x6a6870, soil: 0x2a2220,
};

// ---------- plants ----------
function soil(r = 0.36, col = C.soil) {
  const g = group(mesh(blob(r, 0.08, 2.2, 3, 24, 10, 0.22), mat(col, { rough: 0.95 }), { y: 0.02 }));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.4;
    g.add(mesh(blob(0.05 + hash(i, 2) * 0.03, 0.25, 2, i, 10, 8, 0.7), mat(C.stone, { rough: 0.8 }), { x: Math.cos(a) * r * 0.92, y: 0.03, z: Math.sin(a) * r * 0.92 }));
  }
  return g;
}

function mushroom(h, r, capCol, { deep = false } = {}) {
  const g = new THREE.Group();
  const stem = lathe([[r * 0.24, 0], [r * 0.3, h * 0.08], [r * 0.2, h * 0.5], [r * 0.18, h * 0.92], [r * 0.12, h]], 20);
  g.add(mesh(stem, mat(C.stem, { rough: 0.55, sheen: 0.6, sheenColor: 0xffffff })));
  // cap: a dome with a rolled rim, gills underneath
  const capProfile = [[r * 0.86, -0.05], [r * 1.03, -0.02]];
  for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI * 0.5; capProfile.push([Math.cos(a) * r, Math.sin(a) * r * 0.66]); }
  const cap = mesh(lathe(capProfile, 36), mat(capCol, { rough: 0.35, clearcoat: 0.8, emissive: capCol, ei: deep ? 0.22 : 0.12 }), { y: h });
  g.add(cap);
  g.add(mesh(new THREE.CircleGeometry(r * 0.97, 36), mat(deep ? 0x2f4fa0 : C.gill, { rough: 0.8, emissive: capCol, ei: 0.5, double: true }), { y: h - 0.03, rx: Math.PI / 2, shadow: false }));
  // glowing spots on the cap
  const spot = new THREE.SphereGeometry(1, 12, 8);
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4 + 0.3, rr = 0.25 + (i % 3) * 0.22;
    const y = Math.sqrt(Math.max(0, 1 - rr * rr)) * r * 0.66;
    g.add(mesh(spot, glow(deep ? 0x9fd0ff : 0xc8fff0, deep ? 2.4 : 1.9), { x: Math.cos(a) * rr * r, y: h + y, z: Math.sin(a) * rr * r, s: r * (0.07 + (i % 2) * 0.03), sy: r * 0.04, shadow: false }));
  }
  return g;
}

function frond(len, col, tip, curl = 0.9, leaflets = 7) {
  const curve = new THREE.CatmullRomCurve3([V3(0, 0, 0), V3(0, len * 0.45, len * 0.25), V3(0, len * 0.7 * curl, len * 0.65), V3(0, len * 0.6 * curl, len)]);
  const g = group(mesh(ribbon(curve, (t) => 0.035 * (1 - t * 0.7), 18, 0.4), mat(col, { rough: 0.45, sheen: 1, sheenColor: 0xe0f4ff, emissive: col, ei: 0.12, double: true })));
  for (let i = 1; i <= leaflets; i++) {
    const t = i / (leaflets + 1), p = curve.getPoint(t), tan = curve.getTangent(t);
    for (const s of [-1, 1]) {
      const l = 0.12 * (1 - t * 0.6);
      const dir = new THREE.Vector3().crossVectors(tan, V3(0, 1, 0)).normalize().multiplyScalar(s);
      const c2 = new THREE.QuadraticBezierCurve3(p, p.clone().addScaledVector(dir, l * 0.6).add(V3(0, l * 0.3, 0)), p.clone().addScaledVector(dir, l).add(tan.clone().multiplyScalar(l * 0.4)));
      g.add(mesh(ribbon(c2, (u) => 0.022 * Math.sin(Math.PI * Math.min(1, u * 1.1 + 0.05)), 6, 0.3), mat(col, { rough: 0.45, sheen: 1, sheenColor: 0xe0f4ff, emissive: col, ei: 0.12, double: true }), { shadow: false }));
    }
  }
  const end = curve.getPoint(1);
  g.add(mesh(new THREE.OctahedronGeometry(0.05, 0), mat(tip, { emissive: tip, ei: 1.8, rough: 0.1, flat: true }), { x: end.x, y: end.y, z: end.z, sy: 1.8 }));
  return g;
}

function thistle(h, r, petal, core, spikes = 22, coal = false) {
  const g = new THREE.Group();
  const stemCurve = new THREE.CatmullRomCurve3([V3(0, 0, 0), V3(0.02, h * 0.5, 0), V3(0, h, 0)]);
  g.add(mesh(new THREE.TubeGeometry(stemCurve, 10, 0.03, 8), mat(C.leaf, { rough: 0.7 })));
  for (const s of [-1, 1]) {
    const c = new THREE.CatmullRomCurve3([V3(0, h * 0.25, 0), V3(s * 0.12, h * 0.35, 0.02), V3(s * 0.24, h * 0.3, 0.05)]);
    g.add(mesh(ribbon(c, (t) => 0.05 * Math.sin(Math.PI * t), 10, 0.5), mat(C.leaf, { rough: 0.6, double: true })));
  }
  const head = new THREE.Group();
  head.position.y = h + r * 0.7;
  head.add(mesh(new THREE.SphereGeometry(r * 0.72, 24, 16), coal ? mat(C.coal, { rough: 0.9, emissive: core, ei: 0.6 }) : glow(core, 2.4)));
  const spike = new THREE.ConeGeometry(r * 0.12, r * 0.9, 8);
  spike.translate(0, r * 0.45, 0);
  const pm = coal ? mat(0x3a2622, { rough: 0.85 }) : mat(petal, { rough: 0.45, emissive: petal, ei: 0.6 });
  for (let i = 0; i < spikes; i++) {
    const y = 1 - (2 * (i + 0.5)) / spikes, rad = Math.sqrt(1 - y * y), a = i * 2.39996;
    const dir = V3(Math.cos(a) * rad, y * 0.9 + 0.15, Math.sin(a) * rad).normalize();
    const m = mesh(spike, pm, { shadow: false });
    m.quaternion.setFromUnitVectors(V3(0, 1, 0), dir);
    m.position.copy(dir.clone().multiplyScalar(r * 0.55));
    head.add(m);
  }
  g.add(head);
  return g;
}

function crystal(h, r, col, core, sides = 6, physical = true) {
  const profile = [[0, 0], [r * 0.9, 0.02], [r, h * 0.1], [r * 0.88, h * 0.72], [0, h]];
  const m = physical
    ? mat(col, { transmission: 0.55, thickness: 0.4, ior: 1.6, rough: 0.12, emissive: col, ei: 0.35, flat: true, clearcoat: 1 })
    : mat(col, { rough: 0.15, metal: 0.2, emissive: col, ei: 0.5, flat: true });
  const g = group(mesh(lathe(profile, sides), m));
  g.add(mesh(new THREE.SphereGeometry(r * 0.42, 16, 12), glow(core, 3), { y: h * 0.42, sy: 2.2, shadow: false }));
  return g;
}

/** form: 0 | 1 (growth levels) | 'a' | 'b' (branches). */
export function plantModel(type, form, { physical = true } = {}) {
  const g = new THREE.Group();
  if (type === 'glowcap') {
    g.add(soil());
    if (form === 'b') { g.add(mushroom(0.5, 0.44, C.glowcapDeep, { deep: true })); const s = mushroom(0.2, 0.13, C.glowcap); s.position.set(0.25, 0, 0.14); g.add(s); }
    else if (form === 'a') { for (const [x, z, k] of [[-0.14, -0.06, 1], [0.17, -0.08, 0.85], [0.02, 0.17, 0.75]]) { const m = mushroom(0.4 * k, 0.25 * k, C.glowcap); m.position.set(x, 0, z); m.rotation.z = x * 0.6; g.add(m); } }
    else {
      g.add(mushroom(form === 1 ? 0.42 : 0.36, form === 1 ? 0.3 : 0.26, C.glowcap));
      if (form === 1) for (const [x, z, k] of [[-0.22, 0.12, 0.45], [0.22, 0.1, 0.38]]) { const m = mushroom(0.36 * k, 0.26 * k, C.glowcap); m.position.set(x, 0, z); g.add(m); }
    }
  } else if (type === 'frost') {
    g.add(soil(0.36, 0x232a36));
    const n = form === 'a' ? 9 : form === 'b' ? 6 : form === 1 ? 7 : 5;
    const len = form === 'a' ? 0.42 : form === 1 ? 0.42 : 0.36;
    for (let i = 0; i < n; i++) {
      const f = frond(len * (0.9 + hash(i, n) * 0.2), form === 'b' ? C.frostDeep : C.frost, C.ice, form === 'a' ? 0.7 : 0.95);
      f.rotation.y = (i / n) * TAU;
      f.position.y = 0.06;
      g.add(f);
    }
    if (form === 'a') for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; g.add(mesh(new THREE.OctahedronGeometry(0.06, 0), mat(C.ice, { emissive: C.ice, ei: 1.4, rough: 0.05, flat: true }), { x: Math.cos(a) * 0.3, y: 0.08, z: Math.sin(a) * 0.3, sy: 2.4 })); }
    if (form === 'b') for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; const ic = mesh(new THREE.ConeGeometry(0.06, 0.6 - i * 0.05, 6), mat(C.ice, { emissive: C.ice, ei: 1.1, rough: 0.05, flat: true, clearcoat: 1 }), { x: Math.cos(a) * 0.1, y: 0.32, z: Math.sin(a) * 0.1, rx: Math.sin(a) * 0.25, rz: -Math.cos(a) * 0.25 }); g.add(ic); }
  } else if (type === 'ember') {
    g.add(soil(0.36, 0x2a1e1a));
    if (form === 'a') { g.add(thistle(0.32, 0.25, C.ember, C.emberCore, 30)); for (const s of [-1, 1]) { const t = thistle(0.18, 0.11, C.ember, C.emberCore, 12); t.position.set(s * 0.22, 0, 0.08); g.add(t); } }
    else if (form === 'b') g.add(thistle(0.32, 0.22, C.coal, C.ember, 20, true));
    else g.add(thistle(form === 1 ? 0.32 : 0.28, form === 1 ? 0.2 : 0.17, C.ember, C.emberCore, form === 1 ? 26 : 20));
  } else if (type === 'sunspire') {
    g.add(soil(0.36, 0x2c2620));
    const big = (h, r, x = 0, z = 0, tilt = 0) => { const c = crystal(h, r, C.sun, C.sunCore, 6, physical); c.position.set(x, 0.02, z); c.rotation.z = tilt; return c; };
    if (form === 'a') { g.add(big(1.1, 0.11)); g.add(big(0.5, 0.07, 0.15, 0.06, -0.22)); g.add(big(0.42, 0.06, -0.15, 0.05, 0.25)); }
    else if (form === 'b') {
      g.add(big(0.78, 0.15));
      const halo = mesh(new THREE.TorusGeometry(0.3, 0.025, 12, 48), glow(C.sunCore, 2.6), { y: 0.66, rx: Math.PI / 2, shadow: false });
      halo.name = 'spin';
      g.add(halo);
    } else {
      g.add(big(form === 1 ? 0.75 : 0.64, 0.13));
      if (form === 1) { g.add(big(0.36, 0.06, 0.17, 0.04, -0.28)); g.add(big(0.3, 0.06, -0.16, 0.05, 0.3)); }
    }
  }
  return g;
}

// ---------- lantern ----------
export function lanternModel() {
  const g = new THREE.Group();
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; g.add(mesh(blob(0.08, 0.25, 2, i, 12, 8, 0.6), mat(0x55535c, { rough: 0.85 }), { x: Math.cos(a) * 0.22, y: 0.02, z: Math.sin(a) * 0.22 })); }
  g.add(mesh(lathe([[0.075, 0], [0.07, 0.05], [0.055, 0.1], [0.05, 1.7], [0.06, 1.75], [0, 1.78]], 16), mat(C.wood, { rough: 0.7 })));
  const arm = new THREE.CatmullRomCurve3([V3(0, 1.62, 0), V3(0, 1.72, 0.18), V3(0, 1.7, 0.42)]);
  g.add(mesh(new THREE.TubeGeometry(arm, 12, 0.025, 8), mat(C.iron, { rough: 0.4, metal: 0.7 })));
  // a short chain
  for (let i = 0; i < 4; i++) g.add(mesh(new THREE.TorusGeometry(0.02, 0.006, 6, 12), mat(C.iron, { rough: 0.4, metal: 0.8 }), { y: 1.66 - i * 0.035, z: 0.42, ry: i % 2 ? Math.PI / 2 : 0, shadow: false }));
  const hang = new THREE.Group();
  hang.position.set(0, 1.52, 0.42);
  const body = lathe([[0.02, -0.26], [0.11, -0.24], [0.19, -0.14], [0.215, 0], [0.19, 0.14], [0.11, 0.24], [0.02, 0.26]], 40);
  const paper = mesh(body, mat(0xb85a1a, { emissive: 0xff6a10, ei: 1.6, rough: 0.7, sheen: 0.5, sheenColor: 0xffc080 }), { shadow: false });
  hang.add(paper);
  for (const y of [-0.14, 0, 0.14]) hang.add(mesh(new THREE.TorusGeometry(y === 0 ? 0.216 : 0.192, 0.006, 6, 40), mat(0x5a3a1a, { rough: 0.6 }), { y, rx: Math.PI / 2, shadow: false }));
  for (const y of [0.27, -0.27]) hang.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.04, 20), mat(C.iron, { rough: 0.45, metal: 0.6 }), { y }));
  g.add(hang);
  g.userData.hang = hang;
  g.userData.paper = paper;
  return g;
}

// ---------- creatures (face +z, origin on the ground) ----------
function wingGeometry(span, len, back = 0.5) {
  const s = new THREE.Shape();
  s.moveTo(0, 0.03);
  s.bezierCurveTo(span * 0.3, len * 0.55, span * 0.85, len * 0.5, span, len * 0.12);
  s.bezierCurveTo(span * 1.02, -len * back * 0.4, span * 0.6, -len * back, span * 0.3, -len * back * 0.9);
  s.bezierCurveTo(span * 0.12, -len * back * 0.7, 0.02, -len * 0.15, 0, -0.03);
  const g = new THREE.ShapeGeometry(s, 24);
  g.rotateX(-Math.PI / 2);
  return g;
}

function addEyes(g, x, y, z, r, color = 0xffe066, ei = 3) {
  for (const s of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(r, 12, 10), glow(color, ei), { x: s * x, y, z, shadow: false }));
}

/** Returns { root, parts } where parts.wings / parts.legs / parts.body can be animated. */
export function creatureModel(type) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const parts = { body, wings: [], legs: [] };
  if (type === 'moth' || type === 'mothmother' || type === 'firefly') {
    const big = type === 'mothmother', fly = type === 'firefly';
    const k = big ? 2.1 : fly ? 0.6 : 1;
    body.position.y = (big ? 0.5 : fly ? 0.36 : 0.3);
    body.add(mesh(new THREE.CapsuleGeometry(0.05 * k, 0.16 * k, 6, 14), mat(big ? 0x3a2a4a : 0x4a3a58, { rough: 0.9, sheen: 1, sheenColor: 0xc8b0ff }), { rx: Math.PI / 2 }));
    body.add(mesh(new THREE.SphereGeometry(0.055 * k, 16, 12), mat(0x3e3050, { rough: 0.85, sheen: 1, sheenColor: 0xc8b0ff }), { z: 0.15 * k }));
    addEyes(body, 0.03 * k, 0.015 * k, 0.19 * k, 0.017 * k, big ? 0xff80d0 : 0xffd060, 2.2);
    for (const s of [-1, 1]) {
      const ant = new THREE.QuadraticBezierCurve3(V3(s * 0.02 * k, 0.03 * k, 0.18 * k), V3(s * 0.07 * k, 0.12 * k, 0.24 * k), V3(s * 0.11 * k, 0.12 * k, 0.3 * k));
      body.add(mesh(new THREE.TubeGeometry(ant, 8, 0.005 * k, 5), mat(0x2a2030, { rough: 0.8 }), { shadow: false }));
    }
    if (fly) body.add(mesh(new THREE.SphereGeometry(0.07, 16, 12), glow(0xe8ff70, 4), { z: -0.1, sz: 1.3, shadow: false }));
    if (big) {
      for (let i = 0; i < 5; i++) body.add(mesh(new THREE.ConeGeometry(0.016, 0.1 + (i % 2) * 0.06, 6), glow(0xff8ad8, 2.6), { x: (i - 2) * 0.035, y: 0.12, z: 0.32, rx: -0.3, shadow: false }));
      for (let i = 0; i < 4; i++) body.add(mesh(new THREE.TorusGeometry(0.1 - i * 0.008, 0.008, 6, 20), glow(0xff8ad8, 1.6), { z: -0.05 - i * 0.07, rx: 0, shadow: false }));
    }
    const wingCol = big ? 0x9a7ad8 : fly ? 0xdde8ff : 0xd6caf2;
    const wm = mat(wingCol, { rough: 0.6, double: true, sheen: 1, sheenColor: 0xffffff, opacity: fly ? 0.55 : 0.95, emissive: big ? 0x5a2a8a : 0x2a2040, ei: big ? 0.8 : 0.3 });
    const wg = wingGeometry(0.34 * k, 0.32 * k, big ? 0.75 : 0.55);
    for (const s of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.set(s * 0.03 * k, 0.02 * k, 0.02 * k);
      const w = mesh(wg, wm, { shadow: !fly, sx: s });
      hinge.add(w);
      // eye-spot markings
      if (!fly) for (const [px, pz, rr] of [[0.2, 0.06, 0.035], [0.15, -0.1, 0.025]]) hinge.add(mesh(new THREE.CircleGeometry(rr * k, 20), big ? glow(0xff9ae0, 2.2, { double: true }) : mat(0x6a5a90, { double: true, rough: 0.7 }), { x: s * px * k, y: 0.004, z: pz * k, rx: -Math.PI / 2, shadow: false }));
      body.add(hinge);
      parts.wings.push({ g: hinge, s });
    }
  } else if (type === 'beetle') {
    body.position.y = 0.12;
    const shell = lathe(Array.from({ length: 13 }, (_, i) => { const a = (i / 12) * Math.PI * 0.5; return [Math.cos(a) * 0.24, Math.sin(a) * 0.18]; }), 32);
    body.add(mesh(shell, mat(0x1e3a52, { rough: 0.25, metal: 0.3, clearcoat: 1, ccRough: 0.08, iridescence: 1 }), { sz: 1.25 }));
    body.add(mesh(new THREE.BoxGeometry(0.008, 0.01, 0.56), mat(0x0c141c, { rough: 0.5 }), { y: 0.178, shadow: false }));
    body.add(mesh(new THREE.SphereGeometry(0.1, 18, 12), mat(0x18222c, { rough: 0.4, clearcoat: 0.6 }), { z: 0.3, sy: 0.7 }));
    addEyes(body, 0.05, 0.02, 0.37, 0.022, 0xa8e6ff, 2.4);
    for (const s of [-1, 1]) for (const j of [-1, 0, 1]) {
      const leg = new THREE.Group();
      leg.position.set(s * 0.18, 0, j * 0.13);
      const c = new THREE.CatmullRomCurve3([V3(0, 0, 0), V3(s * 0.12, 0.04, 0), V3(s * 0.2, -0.1, j * 0.04)]);
      leg.add(mesh(new THREE.TubeGeometry(c, 8, 0.016, 6), mat(0x10161c, { rough: 0.5 }), { shadow: false }));
      body.add(leg);
      parts.legs.push({ g: leg, s, j });
    }
  } else if (type === 'wisp') {
    body.position.y = 0.4;
    const flame = lathe([[0, -0.2], [0.12, -0.17], [0.18, -0.06], [0.16, 0.06], [0.1, 0.18], [0.04, 0.3], [0, 0.38]], 28);
    body.add(mesh(flame, mat(0x9ff0ff, { emissive: 0x60d8ff, ei: 1.6, rough: 0.2, opacity: 0.7, depthWrite: false }), { shadow: false }));
    body.add(mesh(new THREE.SphereGeometry(0.08, 16, 12), glow(0xe0ffff, 3.5), { y: -0.02, shadow: false }));
    for (const s of [-1, 1]) body.add(mesh(new THREE.SphereGeometry(0.025, 10, 8), mat(0x0a0820, { rough: 0.3 }), { x: s * 0.055, y: 0.03, z: 0.15, sy: 1.4, shadow: false }));
  } else if (type === 'mossback') {
    body.position.y = 0.08;
    body.add(mesh(blob(0.3, 0.08, 2, 7, 28, 16, 0.75), mat(0x4a3c2c, { rough: 0.85 }), { y: 0.02, sz: 1.15 }));
    for (let i = 0; i < 22; i++) {
      const y = 1 - (i + 0.5) / 22, rr = Math.sqrt(1 - y * y), a = i * 2.39996;
      if (y < 0.15) continue;
      body.add(mesh(blob(0.06 + hash(i, 1) * 0.04, 0.3, 3, i, 10, 8, 0.7), mat(0x4f8a3a, { rough: 0.95, sheen: 1, sheenColor: 0xa0ff80 }), { x: Math.cos(a) * rr * 0.27, y: 0.02 + y * 0.22, z: Math.sin(a) * rr * 0.3, shadow: false }));
    }
    for (let i = 0; i < 6; i++) { const a = i * 1.3; body.add(mesh(new THREE.SphereGeometry(0.022, 10, 8), glow(0xb8ff70, 3), { x: Math.cos(a) * 0.14, y: 0.25, z: Math.sin(a) * 0.15, shadow: false })); }
    body.add(mesh(new THREE.SphereGeometry(0.09, 16, 12), mat(0x5a7044, { rough: 0.7 }), { y: 0.05, z: 0.34 }));
    addEyes(body, 0.04, 0.08, 0.41, 0.018, 0xfff080, 2.4);
    for (const s of [-1, 1]) for (const j of [-1, 1]) { const leg = new THREE.Group(); leg.position.set(s * 0.22, 0, j * 0.18); leg.add(mesh(new THREE.CapsuleGeometry(0.045, 0.06, 4, 10), mat(0x5a7044, { rough: 0.7 }), { y: -0.04 })); body.add(leg); parts.legs.push({ g: leg, s, j }); }
  } else if (type === 'toad') {
    body.position.y = 0.3;
    body.add(mesh(blob(0.42, 0.06, 2.5, 11, 36, 24, 0.75), mat(0x3a2c4c, { rough: 0.35, clearcoat: 0.7, ccRough: 0.25 })));
    body.add(mesh(new THREE.SphereGeometry(0.3, 28, 16), mat(0x6a557a, { rough: 0.5 }), { y: -0.12, z: 0.08, sy: 0.55 }));
    for (let i = 0; i < 14; i++) { const a = i * 2.4, rr = 0.15 + (i % 4) * 0.06; body.add(mesh(new THREE.SphereGeometry(0.035 + (i % 3) * 0.012, 10, 8), mat(0x4e3e64, { rough: 0.4, clearcoat: 0.5 }), { x: Math.cos(a) * rr, y: 0.2 + (0.3 - rr) * 0.3, z: Math.sin(a) * rr * 1.1 - 0.05, shadow: false })); }
    for (const s of [-1, 1]) {
      body.add(mesh(new THREE.SphereGeometry(0.12, 20, 14), mat(0x3a2c4c, { rough: 0.35, clearcoat: 0.7 }), { x: s * 0.2, y: 0.24, z: 0.22 }));
      body.add(mesh(new THREE.SphereGeometry(0.08, 20, 14), glow(0xffd84a, 2.6), { x: s * 0.2, y: 0.26, z: 0.29, shadow: false }));
      body.add(mesh(new THREE.BoxGeometry(0.018, 0.09, 0.01), mat(0x050308, { rough: 0.2 }), { x: s * 0.2, y: 0.26, z: 0.366, shadow: false }));
    }
    body.add(mesh(new THREE.TorusGeometry(0.2, 0.012, 6, 30, Math.PI), mat(0x1a1224, { rough: 0.5 }), { y: -0.04, z: 0.36, rx: Math.PI, sy: 0.5, shadow: false }));
    for (const s of [-1, 1]) {
      const back = new THREE.Group(); back.position.set(s * 0.36, -0.22, -0.12); back.add(mesh(blob(0.17, 0.05, 2, s, 16, 12, 0.6), mat(0x3a2c4c, { rough: 0.4, clearcoat: 0.5 }))); body.add(back); parts.legs.push({ g: back, s, j: -1 });
      const front = new THREE.Group(); front.position.set(s * 0.28, -0.25, 0.28); front.add(mesh(new THREE.CapsuleGeometry(0.05, 0.08, 4, 10), mat(0x6a557a, { rough: 0.5 }), { rx: 0.4 })); body.add(front); parts.legs.push({ g: front, s, j: 1 });
    }
  }
  root.traverse((o) => { if (o.isMesh) o.receiveShadow = false; });
  return { root, parts };
}

// ---------- scenery ----------
export function treeModel(kind, seed) {
  const g = new THREE.Group();
  if (kind === 'frost') {
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.6, 10), mat(0x3a2e2c, { rough: 0.9 }), { y: 0.3 }));
    for (let k = 0; k < 4; k++) {
      const r = 0.62 - k * 0.13, y = 0.45 + k * 0.42;
      g.add(mesh(lathe([[0, 0.02], [r * 0.85, 0], [r, 0.04], [r * 0.4, 0.45], [0, 0.7]], 18), mat(0x1c3a3e, { rough: 0.85 }), { y }));
      g.add(mesh(lathe([[r * 0.62, 0.2], [r * 0.7, 0.25], [r * 0.38, 0.5], [0, 0.72]], 18), mat(0xe8f2ff, { rough: 0.6, sheen: 0.5 }), { y: y + 0.02 }));
    }
  } else if (kind === 'ember') {
    const c = new THREE.CatmullRomCurve3([V3(0, 0, 0), V3(0.08, 0.6, 0), V3(-0.05, 1.2, 0.05), V3(0.05, 1.6, 0)]);
    g.add(mesh(new THREE.TubeGeometry(c, 16, 0.07, 8), mat(0x2a1a14, { rough: 0.9 })));
    for (let i = 0; i < 5; i++) {
      const y = 0.7 + i * 0.18, a = i * 2.1 + seed;
      const b = new THREE.CatmullRomCurve3([V3(0, y, 0), V3(Math.cos(a) * 0.3, y + 0.25, Math.sin(a) * 0.3), V3(Math.cos(a) * 0.5, y + 0.3, Math.sin(a) * 0.5)]);
      g.add(mesh(new THREE.TubeGeometry(b, 8, 0.025, 6), mat(0x2a1a14, { rough: 0.9 })));
      g.add(mesh(new THREE.SphereGeometry(0.06, 12, 10), glow(0xff7a2a, 2.6), { x: Math.cos(a) * 0.5, y: y + 0.28, z: Math.sin(a) * 0.5, shadow: false }));
    }
  } else {
    g.add(mesh(lathe([[0.12, 0], [0.09, 0.2], [0.07, 0.8], [0.05, 1]], 12), mat(0x3a2a22, { rough: 0.9 })));
    const leaves = mat(0x1e3f32, { rough: 0.8, sheen: 0.4, sheenColor: 0x80ffc0 });
    g.add(mesh(blob(0.6, 0.18, 1.8, seed, 28, 18), leaves, { y: 1.15 }));
    g.add(mesh(blob(0.42, 0.2, 2, seed + 3, 24, 16), leaves, { x: 0.32, y: 1.45, z: 0.12 }));
    g.add(mesh(blob(0.36, 0.2, 2, seed + 7, 24, 16), leaves, { x: -0.3, y: 1.35, z: -0.12 }));
  }
  return g;
}

export function rockGeometry(seed) { return blob(0.4, 0.28, 1.4, seed, 22, 14, 0.62); }
