// Lanternkeep 3D scene: turns a game state into draw calls. Same interface as the 2D renderer
// (render.js), which stays as the fallback when WebGL2 is missing.
// World: x = grid column, z = grid row, y = up. The camera sits past the last row looking back,
// so row 0 is far (top of the screen) and the lantern end is near.
import { COLS, ROWS, ENEMIES, FLARE_RADIUS, TOWERS, flareCharge, stats } from './lib/sim.js';
import { M4, MAX_LIGHTS, createGL, lin } from './gl.js';
import { PAL, builder, creatureMeshes, hash, lanternMeshes, plantMesh } from './models.js';

const TAU = Math.PI * 2;
const T = (x, y, z, ry = 0, rx = 0, rz = 0, s = 1, sy = s, sz = s) => M4.trs(x, y, z, ry, rx, rz, s, sy, sz);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ease = (t) => 1 - Math.pow(1 - clamp01(t), 3);
const shade = (c, k) => c.map((v) => Math.max(0, Math.min(1, v * k)));

// ---------- region looks ----------
export const MOODS = {
  moon: {
    skyTop: [0.04, 0.04, 0.13], skyHorizon: [0.2, 0.14, 0.3], fog: [0.09, 0.07, 0.17], aurora: [0.3, 0.12, 0.45],
    ambient: [0.5, 0.5, 0.74], ground: [0.2, 0.17, 0.26], sunDir: [-0.45, 0.85, -0.55], sunColor: [0.3, 0.32, 0.55],
    moonDir: [-0.3, 0.32, -1], moonColor: [0.9, 0.88, 1], fogDensity: 0.05, fogStart: 14,
    grass: [0.24, 0.44, 0.32], grass2: [0.2, 0.38, 0.3], path: [0.86, 0.82, 0.72], pathDark: [0.36, 0.34, 0.36], apron: [0.14, 0.24, 0.2],
    tree: [0.12, 0.24, 0.2], trunk: [0.22, 0.16, 0.14], flower: [[0.8, 0.72, 1], [1, 0.92, 0.75]], motes: [0.7, 1, 0.6],
  },
  frost: {
    skyTop: [0.03, 0.07, 0.14], skyHorizon: [0.2, 0.3, 0.42], fog: [0.12, 0.17, 0.26], aurora: [0.1, 0.55, 0.45],
    ambient: [0.38, 0.44, 0.6], ground: [0.16, 0.18, 0.25], sunDir: [0.4, 0.85, -0.5], sunColor: [0.2, 0.25, 0.4],
    moonDir: [0.35, 0.3, -1], moonColor: [0.8, 0.92, 1], fogDensity: 0.05, fogStart: 14,
    grass: [0.5, 0.6, 0.68], grass2: [0.44, 0.54, 0.63], path: [0.62, 0.8, 0.95], pathDark: [0.26, 0.31, 0.42], apron: [0.32, 0.4, 0.48],
    tree: [0.14, 0.26, 0.3], trunk: [0.2, 0.18, 0.2], flower: [[0.7, 0.9, 1], [0.9, 0.95, 1]], motes: [0.85, 0.95, 1],
  },
  ember: {
    skyTop: [0.07, 0.02, 0.07], skyHorizon: [0.36, 0.12, 0.12], fog: [0.17, 0.07, 0.09], aurora: [0.55, 0.16, 0.05],
    ambient: [0.54, 0.38, 0.42], ground: [0.26, 0.12, 0.1], sunDir: [0.2, 0.8, -0.6], sunColor: [0.42, 0.24, 0.22],
    moonDir: [0.1, 0.26, -1], moonColor: [1, 0.7, 0.55], fogDensity: 0.055, fogStart: 13,
    grass: [0.38, 0.36, 0.22], grass2: [0.44, 0.34, 0.2], path: [0.9, 0.66, 0.5], pathDark: [0.3, 0.2, 0.18], apron: [0.24, 0.17, 0.13],
    tree: [0.3, 0.22, 0.14], trunk: [0.16, 0.1, 0.08], flower: [[1, 0.6, 0.3], [1, 0.85, 0.5]], motes: [1, 0.6, 0.25],
  },
};

const LIGHT = {
  glowcap: lin(PAL.glowcap), frost: lin(PAL.frost), ember: lin(PAL.ember), sunspire: lin(PAL.sun),
};
const LANTERN = [3.2, 1.9, 0.8];

// ---------- ground and props ----------

function tree(b, m, x, z, s, kind) {
  b.at(T(x, 0, z, hash(x, z) * TAU, 0, 0, s), () => {
    if (kind === 'frost') {
      b.cyl(0, 0.5, 0.08, 0.06, 5, m.trunk);
      for (let k = 0; k < 3; k++) b.at(T(0, 0.4 + k * 0.45, 0), () => { b.jitter(0.1).cyl(0, 0.8, 0.6 - k * 0.15, 0, 7, m.tree, 0, true).jitter(0); b.at(T(0, 0.35, 0), () => b.cyl(0, 0.45, 0.36 - k * 0.09, 0, 7, [0.86, 0.92, 0.98], 0, false)); });
    } else if (kind === 'ember') {
      b.cyl(0, 1.2, 0.1, 0.05, 5, m.trunk);
      for (let k = 0; k < 4; k++) b.at(T(0, 1 + k * 0.08, 0, k * 1.7, 0.9, 0), () => b.cyl(0, 0.6, 0.04, 0, 4, m.trunk));
      b.at(T(0, 1.2, 0), () => b.sphere(0.12, 0.12, 0.12, 5, 2, [1, 0.55, 0.2], 1));
    } else {
      b.cyl(0, 0.7, 0.1, 0.07, 6, m.trunk);
      b.jitter(0.14);
      b.at(T(0, 1.05, 0), () => b.sphere(0.55, 0.5, 0.55, 7, 4, m.tree));
      b.at(T(0.25, 1.4, 0.1), () => b.sphere(0.35, 0.32, 0.35, 6, 3, shade(m.tree, 1.15)));
      b.jitter(0);
    }
  });
}

function rock(b, x, z, s, col) {
  b.jitter(0.18).at(T(x, 0, z, hash(z, x) * TAU, 0, 0, s, s * 0.65, s), () => b.sphere(0.4, 0.4, 0.4, 6, 3, col, 0, -0.2, 1)).jitter(0);
}

function reeds(b, x, z, m) {
  for (let i = 0; i < 6; i++) {
    const a = hash(x, z, i) * TAU, rr = hash(z, x, i) * 0.25;
    b.at(T(x + Math.cos(a) * rr, 0, z + Math.sin(a) * rr, a, (hash(i, x) - 0.5) * 0.3), () => {
      b.cyl(0, 0.6 + hash(i, z) * 0.4, 0.02, 0.008, 3, m.grass2);
      if (i % 3 === 0) b.at(T(0, 0.55 + hash(i, z) * 0.4, 0), () => b.cyl(0, 0.12, 0.03, 0.03, 4, [0.4, 0.24, 0.12]));
    });
  }
}

// One static mesh for the board, path, apron and scenery. Built once per level.
export function groundData(g, region) {
  const m = MOODS[region] ?? MOODS.moon;
  const b = builder();
  const path = g.blocked;
  // apron: a wide ground plane past the board, with gentle hills further out
  // the apron sits below the sunken path (whose bed is at -0.14), and so does all the scenery
  const APRON = -0.2;
  b.box(-8, -0.6, -9, COLS + 8, APRON, ROWS + 7, m.apron, 0, m.apron);
  b.push(T(0, APRON, 0));
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * TAU, R = 14 + hash(i, 3) * 6;
    b.jitter(0.1).at(T(COLS / 2 + Math.cos(a) * R, -0.4, ROWS / 2 + Math.sin(a) * R * 1.1, 0, 0, 0, 3 + hash(i, 9) * 3, 1.2 + hash(i, 5) * 1.6, 3 + hash(i, 9) * 3), () => b.sphere(1, 1, 1, 7, 3, shade(m.apron, 0.85), 0, 0, 1)).jitter(0);
  }
  // board edge: a low stone rim
  const rimCol = shade(m.pathDark, 0.9);
  b.jitter(0.12);
  b.box(-0.18, -0.3, -0.18, COLS + 0.18, 0.22, 0, rimCol);
  b.box(-0.18, -0.3, ROWS, COLS + 0.18, 0.22, ROWS + 0.18, rimCol);
  b.box(-0.18, -0.3, 0, 0, 0.22, ROWS, rimCol);
  b.box(COLS, -0.3, 0, COLS + 0.18, 0.22, ROWS, rimCol);
  b.pop();
  b.jitter(0);

  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const v = hash(c, r);
    if (path.has(`${c},${r}`)) {
      // sunken path: a bed, then a few flagstones
      b.box(c, -0.14, r, c + 1, -0.08, r + 1, m.pathDark);
      // irregular flagstones: two rows, each split once at a random point
      const zs = 0.35 + hash(c, r, 3) * 0.3;
      const rows = [[r + 0.05, r + zs - 0.03], [r + zs + 0.03, r + 0.95]];
      rows.forEach(([z0, z1], k) => {
        const xs = 0.3 + hash(c, r, k + 7) * 0.4;
        const cuts = hash(r, c, k) > 0.35 ? [[c + 0.05, c + xs - 0.03], [c + xs + 0.03, c + 0.95]] : [[c + 0.05, c + 0.95]];
        cuts.forEach(([x0, x1], j) => {
          const h = -0.06 + hash(c + j, r + k, 9) * 0.02;
          const ins = 0.015 + hash(j, k, c + r) * 0.02;
          b.box(x0 + ins, -0.11, z0 + ins, x1 - ins, h, z1 - ins, shade(m.path, 0.62 + hash(c, r, k * 3 + j) * 0.22), 0.045);
        });
      });
    } else {
      const top = 0.0 + v * 0.05;
      const col = (c + r) % 2 ? m.grass : m.grass2;
      b.box(c + 0.02, -0.3, r + 0.02, c + 0.98, top, r + 0.98, shade(col, 0.55), 0, shade(col, 0.9 + v * 0.2));
      // tufts and a few flowers
      for (let i = 0; i < 3; i++) {
        const x = c + 0.15 + hash(c, r, i + 1) * 0.7, z = r + 0.15 + hash(c, r, i + 9) * 0.7;
        b.at(T(x, top, z, hash(i, c, r) * TAU), () => {
          b.tri([-0.04, 0, 0], [0.04, 0, 0], [0.01, 0.09 + hash(r, i) * 0.05, 0.01], shade(col, 1.25));
          b.tri([0, 0, -0.04], [0, 0, 0.04], [-0.01, 0.07, 0.02], shade(col, 1.1));
        });
      }
      if (hash(c, r, 50) > 0.84) {
        const fc = m.flower[hash(c, r, 53) > 0.5 ? 0 : 1];
        b.at(T(c + 0.2 + hash(c, r, 51) * 0.6, top, r + 0.2 + hash(c, r, 52) * 0.6), () => { b.cyl(0, 0.08, 0.008, 0.008, 3, shade(col, 1.2)); b.at(T(0, 0.09, 0), () => b.sphere(0.035, 0.02, 0.035, 5, 1, fc, 1)); });
      }
    }
  }

  // entrance arches where creatures come in
  b.push(T(0, APRON, 0));
  for (const p of g.paths) {
    const a = p.pts[0], n = p.pts[1];
    const ex = Math.min(COLS + 0.4, Math.max(-0.4, a.x)), ez = Math.min(ROWS + 0.4, Math.max(-0.4, a.y));
    const ang = Math.atan2(n.x - a.x, n.y - a.y);
    b.at(T(ex, 0, ez, ang), () => {
      for (const s of [-1, 1]) b.at(T(s * 0.52, 0, 0), () => b.jitter(0.1).cyl(0, 0.9, 0.09, 0.07, 5, [0.3, 0.26, 0.3]).jitter(0));
      b.at(T(0, 0.92, 0, 0, 0, Math.PI / 2), () => b.cyl(-0.6, 0.6, 0.06, 0.06, 5, [0.3, 0.26, 0.3]));
    });
  }

  // scenery around the board (never on it)
  const kind = region === 'frost' ? 'frost' : region === 'ember' ? 'ember' : 'moon';
  const spots = [];
  for (let i = 0; i < 70; i++) {
    const side = i % 4;
    const t = hash(i, 1);
    const d = 0.9 + hash(i, 2) * 4.5;
    let x, z;
    if (side === 0) { x = -d; z = t * (ROWS + 4) - 2; }
    else if (side === 1) { x = COLS + d; z = t * (ROWS + 4) - 2; }
    else if (side === 2) { x = t * (COLS + 6) - 3; z = -d - 0.4; }
    else { x = t * (COLS + 6) - 3; z = ROWS + d + 0.6; }
    spots.push([x, z, i]);
  }
  for (const [x, z, i] of spots) {
    const r = hash(i, 7);
    // keep the near side (bottom of the screen) low so it never hides the lantern
    const near = z > ROWS;
    if (r < 0.45 && !near) tree(b, m, x, z, 0.8 + hash(i, 8) * 0.7, kind);
    else if (r < 0.7) rock(b, x, z, 0.4 + hash(i, 6) * 0.7, shade(m.pathDark, 1.1));
    else if (kind === 'ember') reeds(b, x, z, m);
    else if (!near && kind === 'moon') tree(b, m, x, z, 0.5 + hash(i, 8) * 0.4, kind);
    else rock(b, x, z, 0.25 + hash(i, 6) * 0.3, shade(m.apron, 1.4));
  }
  // region set pieces
  if (kind === 'frost') {
    b.at(T(-4.5, -0.015, 5), () => b.cyl(0, 0.01, 3, 3, 14, [0.55, 0.72, 0.86], 0, true, [0.62, 0.8, 0.92]));
  } else if (kind === 'ember') {
    for (const [x, z, r] of [[-4, 4, 1.8], [COLS + 4, 8, 2.2], [-3.5, 11, 1.4]]) b.at(T(x, -0.01, z), () => b.cyl(0, 0.01, r, r, 12, [0.95, 0.45, 0.18], 1, true, [1, 0.6, 0.25]));
  } else {
    for (let i = 0; i < 9; i++) b.at(T(-1.2, 0, 1 + i * 1.4), () => b.box(-0.04, 0, -0.04, 0.04, 0.5, 0.04, m.trunk));
    b.at(T(-1.2, 0.38, 0.9), () => b.box(-0.03, 0, 0, 0.03, 0.04, 11.4, m.trunk));
  }
  b.pop();
  return b.data();
}

// ---------- the renderer ----------

export function createRenderer3d(canvas, overlay, opts = {}) {
  let lowFx = !!opts.lowFx;
  const engine = createGL(canvas, { shadowSize: lowFx ? 1024 : 2048 });
  if (!engine) return null;
  const reduced = !!opts.reducedMotion;
  const octx = overlay.getContext('2d');
  let cssW = 1, cssH = 1, dpr = 1;
  let ground = null, groundKey = '';
  let mood = MOODS.moon;
  let region = 'moon';
  const plantCache = new Map();
  const plant = (type, form) => {
    const k = `${type}:${form}`;
    if (!plantCache.has(k)) plantCache.set(k, engine.mesh(plantMesh(type, form)));
    return plantCache.get(k);
  };
  const L = lanternMeshes();
  const lanternPost = engine.mesh(L.post), lanternPaper = engine.mesh(L.paper);
  const CM = creatureMeshes();
  const cm = {};
  for (const [k, parts] of Object.entries(CM)) {
    cm[k] = {};
    for (const [p, data] of Object.entries(parts)) cm[k][p] = data instanceof Float32Array ? engine.mesh(data) : data;
  }
  const highlight = engine.mesh(builder().box(0.04, 0, 0.04, 0.96, 0.02, 0.96, [1, 0.85, 0.5], 1).data());

  let fx = [];
  let motes = [];
  let shakeT = 0, shakeAmp = 0;
  let introT = 1;
  let titleMode = false;
  let fired = new Map(); // tower id -> seconds since it fired (for a little recoil)
  let cam = null;
  let focus = null, focusK = 0;
  let leakT = 0;
  const prevPos = new Map();

  function formOf(t) { return t.tier < 2 ? t.tier : t.branch; }

  // Fit the board into the viewport: find the distance at which every corner fits.
  function fitCamera(asp, zoom = 1) {
    const target = [COLS / 2, 0, ROWS / 2 + 0.6];
    const pitch = 0.98; // radians down from horizontal
    const fovy = 0.62;
    const proj = M4.persp(fovy, asp, 0.1, 120);
    const corners = [[-0.2, 0, -0.4], [COLS + 0.2, 0, -0.4], [-0.2, 0, ROWS + 0.3], [COLS + 0.2, 0, ROWS + 0.3], [COLS / 2, 1.4, ROWS]];
    let lo = 4, hi = 60;
    for (let i = 0; i < 30; i++) {
      const d = (lo + hi) / 2;
      const eye = [target[0], target[1] + Math.sin(pitch) * d, target[2] + Math.cos(pitch) * d];
      const vp = M4.mul(proj, M4.lookAt(eye, target, [0, 1, 0]));
      const ok = corners.every((c) => { const p = M4.apply(vp, c); return Math.abs(p[0]) <= 0.97 && p[1] <= 0.9 && p[1] >= -0.97 && p[3] > 0; });
      if (ok) hi = d; else lo = d;
    }
    const d = hi / zoom;
    return { target, pitch, fovy, dist: d, proj };
  }

  function camera(time) {
    const asp = cssW / cssH;
    const fit = fitCamera(asp);
    let { target, pitch, dist } = fit;
    let yaw = 0;
    if (titleMode) {
      yaw = 0.35 + Math.sin(time * 0.07) * 0.35;
      pitch = 0.6;
      dist = fit.dist * 0.62;
      target = [COLS / 2 + 0.5, 0, ROWS / 2 + 1.5];
    } else if (introT < 1) {
      const k = ease(introT);
      yaw = (1 - k) * 0.9;
      pitch = 0.35 + (fit.pitch - 0.35) * k;
      dist = fit.dist * (1 + (1 - k) * 0.9);
      target = [target[0], target[1], target[2] - (1 - k) * 3];
    }
    if (focus && focusK > 0) {
      const k = ease(focusK);
      target = [target[0] + (focus.x - target[0]) * k, 0.2 * k, target[2] + (focus.z - target[2]) * k];
      dist = dist * (1 - 0.6 * k);
      pitch = pitch - 0.25 * k;
    }
    const eye = [
      target[0] + Math.sin(yaw) * Math.cos(pitch) * dist,
      target[1] + Math.sin(pitch) * dist,
      target[2] + Math.cos(yaw) * Math.cos(pitch) * dist,
    ];
    if (shakeT > 0 && !reduced) {
      const a = shakeAmp * shakeT;
      eye[0] += Math.sin(time * 71) * a; eye[1] += Math.sin(time * 53) * a * 0.6; eye[2] += Math.cos(time * 61) * a;
    }
    const view = M4.lookAt(eye, target, [0, 1, 0]);
    const proj = M4.persp(fit.fovy, asp, 0.1, 120);
    return { eye, target, view, proj, vp: M4.mul(proj, view) };
  }

  function resize(g, w, h) {
    cssW = Math.max(1, w); cssH = Math.max(1, h);
    dpr = Math.min(lowFx ? 1.25 : 2, window.devicePixelRatio || 1);
    for (const c of [canvas, overlay]) { c.style.width = `${cssW}px`; c.style.height = `${cssH}px`; }
    engine.resize(Math.round(cssW * dpr), Math.round(cssH * dpr));
    overlay.width = Math.round(cssW * dpr); overlay.height = Math.round(cssH * dpr);
    setLevel(g);
  }

  function setLevel(g) {
    region = g.level.region ?? 'moon';
    mood = MOODS[region] ?? MOODS.moon;
    const k = `${g.level.name}:${region}`;
    if (k !== groundKey) {
      engine.free(ground);
      ground = engine.mesh(groundData(g, region));
      groundKey = k;
      motes = [];
      const n = lowFx ? 24 : 60;
      for (let i = 0; i < n; i++) motes.push({ x: -2 + hash(i, 1) * (COLS + 4), y: 0.2 + hash(i, 2) * (region === 'frost' ? 5 : 1.6), z: -2 + hash(i, 3) * (ROWS + 4), s: hash(i, 4) });
    }
  }

  function project(x, y, z) {
    if (!cam) return null;
    const p = M4.apply(cam.vp, [x, y, z]);
    if (p[3] <= 0) return null;
    return { x: (p[0] * 0.5 + 0.5) * cssW, y: (1 - (p[1] * 0.5 + 0.5)) * cssH };
  }

  function cellAt(clientX, clientY) {
    if (!cam) return null;
    const rect = canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1, ny = 1 - ((clientY - rect.top) / rect.height) * 2;
    const inv = M4.invert(cam.vp);
    const a = M4.apply(inv, [nx, ny, -1]), b = M4.apply(inv, [nx, ny, 1]);
    const dy = b[1] - a[1];
    if (Math.abs(dy) < 1e-6) return null;
    const t = (0.03 - a[1]) / dy;
    const x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t;
    const c = Math.floor(x), r = Math.floor(z);
    return c >= 0 && c < COLS && r >= 0 && r < ROWS ? { c, r } : null;
  }

  // ---------- effects ----------
  function addEvents(events) {
    for (const ev of events) {
      if (ev.e === 'bolt') { fx.push({ k: 'bolt', x1: ev.x1, z1: ev.y1, x2: ev.x2, z2: ev.y2, t: 0, life: 0.16, heavy: ev.heavy }); fired.set(ev.id, 0); }
      else if (ev.e === 'beam') { fx.push({ k: 'beam', x1: ev.x1, z1: ev.y1, x2: ev.x2, z2: ev.y2, t: 0, life: 0.32, heat: ev.heat }); fired.set(ev.id, 0); }
      else if (ev.e === 'burst') {
        fx.push({ k: 'lob', x1: ev.x1, z1: ev.y1, x2: ev.x2, z2: ev.y2, t: 0, life: 0.22, burn: ev.burn });
        fx.push({ k: 'burst', x: ev.x2, z: ev.y2, r: ev.splash, t: -0.22, life: 0.45 });
        fired.set(ev.id, 0);
      } else if (ev.e === 'pulse') { fx.push({ k: 'pulse', x: ev.x, z: ev.y, r: ev.range, t: 0, life: 0.6 }); fired.set(ev.id, 0); }
      else if (ev.e === 'kill') {
        const big = ev.type === 'toad' || ev.type === 'mothmother';
        if (ev.reward >= 5) fx.push({ k: 'coin', x: ev.x, z: ev.y, text: `+${ev.reward}`, t: 0, life: 0.9 });
        const n = lowFx ? (big ? 14 : 4) : big ? 36 : 10;
        const col = ev.type === 'firefly' ? [1, 1, 0.5] : ev.type === 'wisp' ? [0.6, 0.95, 1] : ev.type === 'mossback' ? [0.6, 1, 0.5] : [1, 0.85, 0.5];
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + hash(i, ev.reward) * 0.6, sp = 0.8 + hash(i, n) * 1.6;
          fx.push({ k: 'spark', x: ev.x, y: 0.35, z: ev.y, vx: Math.cos(a) * sp, vy: 1 + hash(n, i) * 2, vz: Math.sin(a) * sp, t: 0, life: 0.5 + hash(n, i) * 0.4, c: col });
        }
        fx.push({ k: 'puff', x: ev.x, z: ev.y, t: 0, life: 0.4, big });
        if (big) { shakeT = 1; shakeAmp = 0.18; }
      } else if (ev.e === 'leak') { leakT = 0.5; shakeT = 1; shakeAmp = 0.08; }
      else if (ev.e === 'flare') { fx.push({ k: 'flare', x: ev.x, z: ev.y, r: ev.r, t: 0, life: 0.9 }); shakeT = 1; shakeAmp = 0.22; }
    }
  }

  function tickFx(dt) {
    leakT = Math.max(0, leakT - dt);
    shakeT = Math.max(0, shakeT - dt * 3);
    if (introT < 1) introT = Math.min(1, introT + dt / 2.4);
    if (focus) focusK = Math.min(1, focusK + dt * 2.5); else focusK = Math.max(0, focusK - dt * 3);
    for (const [id, v] of fired) fired.set(id, v + dt);
    for (const f of fx) {
      f.t += dt;
      if (f.k === 'spark') { f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt; f.vy -= 5 * dt; f.vx *= 0.96; f.vz *= 0.96; if (f.y < 0.05) { f.y = 0.05; f.vy *= -0.3; } }
    }
    fx = fx.filter((f) => f.t < f.life);
  }

  function clearFx() { fx = []; fired = new Map(); leakT = 0; shakeT = 0; prevPos.clear(); }

  // ---------- frame ----------
  function draw(g, view) {
    const t = view.time;
    cam = camera(t);
    const life = g.lives / g.maxLives;
    const flick = reduced ? 1 : 0.93 + 0.07 * Math.sin(t * 9) * Math.sin(t * 5.3) + (life < 0.35 ? 0.12 * Math.sin(t * 31) : 0);
    const draws = [];
    const lights = [];
    const bills = [];
    const rings = [];

    draws.push({ mesh: ground, model: M4.ident() });

    // lantern
    const lx = g.lantern.x, lz = g.lantern.y;
    const LS = 1.45;
    draws.push({ mesh: lanternPost, model: T(lx - 0.25, 0, lz - 0.2, 0, 0, 0, LS) });
    const swing = reduced ? 0 : Math.sin(t * 1.3) * 0.06;
    const paperY = 0.95 * LS;
    draws.push({ mesh: lanternPaper, model: T(lx - 0.25, paperY, lz - 0.2 + 0.4 * LS, 0, swing, swing * 0.5, LS), emi: (0.12 + 0.3 * life) * flick, noShadow: true });
    const lp = [lx - 0.25, paperY, lz - 0.2 + 0.4 * LS];
    lights.push({ p: lp, r: (2.6 + 4.2 * life) * flick, c: LANTERN.map((v) => v * (0.45 + 0.55 * life)) });
    bills.push({ p: lp, size: (1 + 0.9 * life) * flick, c: [1, 0.6, 0.25], a: 0.75, add: 1 });
    const charge = flareCharge(g);
    if (g.phase === 'wave' || g.phase === 'ready') {
      rings.push({ c: [lx, 0.03, lz], r: FLARE_RADIUS, col: [1, 0.7, 0.3, charge >= 1 ? 0.35 + 0.15 * Math.sin(t * 5) : 0.08], width: 0.03, dash: charge < 1 });
      if (charge >= 1) bills.push({ p: [lp[0], lp[1] + 0.05, lp[2]], size: 1.4 + 0.2 * Math.sin(t * 5), c: [1, 0.75, 0.35], a: 0.5, add: 1 });
    }

    // selection and hints
    if (view.hint) draws.push({ mesh: highlight, model: T(view.hint.c, 0.06, view.hint.r), emi: 0.25 + 0.2 * Math.sin(t * 4), noShadow: true });
    if (view.sel) {
      draws.push({ mesh: highlight, model: T(view.sel.c, 0.07, view.sel.r), emi: 0.5, noShadow: true });
      if (view.ghost) {
        const r = TOWERS[view.ghost].tiers[0].range;
        rings.push({ c: [view.sel.c + 0.5, 0.08, view.sel.r + 0.5], r, col: [...LIGHT[view.ghost].map((v) => v * 0.6), 0.5], width: 0.03, fill: 0.08 });
      }
    }
    if (view.selTower) {
      const st = view.selTower, s = stats(st);
      rings.push({ c: [st.x, 0.08, st.y], r: s.range, col: [...LIGHT[st.type].map((v) => v * 0.6), 0.6], width: 0.035, fill: 0.1, dash: true });
    }

    // plants (drawn a little larger than a tile's worth so they read on a phone)
    const PS = 1.3;
    for (const tw of g.towers) {
      const since = fired.get(tw.id) ?? 9;
      const pop = since < 0.18 ? 1 + 0.12 * Math.sin((since / 0.18) * Math.PI) : 1;
      const sway = reduced ? 0 : Math.sin(t * 1.4 + tw.id) * 0.03;
      const ry = TOWERS[tw.type].kind === 'beam' ? 0 : hash(tw.c, tw.r) * TAU;
      draws.push({ mesh: plant(tw.type, formOf(tw)), model: T(tw.x, 0.04, tw.y, ry, sway, 0, PS, PS * pop, PS), emi: since < 0.15 ? 1.4 : 0.85 });
      lights.push({ p: [tw.x, 0.7, tw.y], r: 1.9 + tw.tier * 0.35, c: LIGHT[tw.type].map((v) => v * (0.55 + (since < 0.15 ? 0.5 : 0))) });
      if (!lowFx) bills.push({ p: [tw.x, 0.55, tw.y], size: 0.5 + tw.tier * 0.1, c: LIGHT[tw.type].map((v) => v * 0.35), a: 1, add: 1 });
    }

    // creatures
    const CS = 1.35;
    const drawn = [];
    for (const e of g.enemies) {
      const p = view.prev.get(e.id);
      const x = p ? p.x + (e.x - p.x) * view.alpha : e.x, z = p ? p.y + (e.y - p.y) * view.alpha : e.y;
      let heading = prevPos.get(e.id)?.h ?? 0;
      const pp = prevPos.get(e.id);
      if (pp && Math.hypot(x - pp.x, z - pp.z) > 1e-4) heading = Math.atan2(x - pp.x, z - pp.z);
      prevPos.set(e.id, { x, z, h: heading });
      const k = e.id * 1.37;
      const tint = e.stunLeft > 0 ? [1.4, 1.3, 0.9] : e.slow > 0 ? [0.7, 0.9, 1.5] : e.healed > 0 ? [0.8, 1.4, 0.8] : [1, 1, 1];
      const flash = e.hitFlash > 0 ? Math.min(0.6, e.hitFlash * 5) : 0;
      const parts = cm[e.type];
      const frozen = e.stunLeft > 0 ? 0 : 1;
      if (e.type === 'moth' || e.type === 'firefly' || e.type === 'mothmother') {
        const big = e.type === 'mothmother';
        const bob = Math.sin(t * (big ? 3 : 6) + k) * 0.05;
        const base = T(x, bob, z, heading, 0, 0, CS);
        draws.push({ mesh: parts.body, model: base, tint, flash, noShadow: !big });
        const flap = Math.sin(t * (e.type === 'firefly' ? 30 : big ? 7 : 16) * frozen + k) * 0.9;
        for (const s of [-1, 1]) {
          const wm = M4.mul(base, T(0, parts.wingY, 0, 0, 0, s * (0.15 + flap * 0.7)));
          const mirror = s < 0 ? T(0, 0, 0, 0, 0, 0, -1, 1, 1) : M4.ident();
          draws.push({ mesh: parts.wing, model: M4.mul(wm, mirror), tint, flash, noShadow: true });
        }
        if (e.type === 'firefly') lights.push({ p: [x, 0.35, z], r: 0.9, c: [0.5, 0.6, 0.1], weak: true });
      } else if (e.type === 'wisp') {
        const bob = Math.sin(t * 3 + k) * 0.06;
        draws.push({ mesh: parts.body, model: T(x, bob, z, heading, 0, Math.sin(t * 4 + k) * 0.08, CS), tint, flash, alpha: 0.88, noShadow: true });
        bills.push({ p: [x, 0.42 + bob, z], size: 0.5, c: [0.25, 0.5, 0.6], a: 1, add: 1 });
      } else {
        const hop = e.type === 'toad' ? Math.abs(Math.sin(t * 3 * frozen + k)) * 0.12 : Math.abs(Math.sin(t * 9 * frozen + k)) * 0.015;
        const squash = e.type === 'toad' ? 1 + Math.sin(t * 6 * frozen + k) * 0.04 : 1;
        const sc = CS;
        draws.push({ mesh: parts.body, model: T(x, hop, z, heading, 0, 0, sc, sc * squash, sc), tint, flash });
        if (parts.legs) draws.push({ mesh: parts.legs, model: T(x, hop * 0.3, z, heading, Math.sin(t * 10 * frozen + k) * 0.05, 0, CS), tint, flash, noShadow: true });
      }
      if (e.type === 'mossback' && !lowFx) bills.push({ p: [x, 0.42, z], size: 1.4, c: [0.04, 0.12, 0.03], a: 1, add: 1 });
      if (e.stunLeft > 0) for (let i = 0; i < 3; i++) { const a = t * 4 + (i / 3) * TAU; bills.push({ p: [x + Math.cos(a) * 0.25, 0.75, z + Math.sin(a) * 0.25], size: 0.07, c: [1, 0.9, 0.5], a: 1, add: 1 }); }
      drawn.push([e, x, z]);
    }
    if (prevPos.size > 600) prevPos.clear();

    // burning ground
    for (const p of g.patches) {
      const a = Math.min(1, p.left);
      lights.push({ p: [p.x, 0.3, p.y], r: 1.4, c: [0.9 * a, 0.3 * a, 0.05 * a], weak: true });
      for (let i = 0; i < (lowFx ? 3 : 7); i++) {
        const ang = hash(i, p.x) * TAU, rr = hash(p.y, i) * p.r * 0.8;
        bills.push({ p: [p.x + Math.cos(ang) * rr, 0.08 + ((t * 0.8 + hash(i, 3)) % 1) * 0.4, p.y + Math.sin(ang) * rr], size: 0.14, c: [1, 0.4, 0.08], a: a * 0.9, add: 1 });
      }
    }

    // effects
    for (const f of fx) {
      const k = 1 - Math.max(0, f.t) / f.life;
      if (f.k === 'bolt') {
        const q = Math.min(1, f.t / (f.life * 0.75));
        const x = f.x1 + (f.x2 - f.x1) * q, z = f.z1 + (f.z2 - f.z1) * q, y = 0.55 - 0.25 * q;
        const col = f.heavy ? [0.3, 0.5, 1.4] : [0.4, 1.4, 1];
        bills.push({ p: [x, y, z], size: f.heavy ? 0.22 : 0.14, c: col, a: 1, add: 1 });
        bills.push({ p: [x - (f.x2 - f.x1) * 0.08, y + 0.02, z - (f.z2 - f.z1) * 0.08], size: 0.09, c: col.map((v) => v * 0.5), a: 1, add: 1 });
      } else if (f.k === 'beam') {
        const n = 16, heat = 1 + (f.heat ?? 0) * 0.35;
        for (let i = 0; i <= n; i++) {
          const q = i / n;
          bills.push({ p: [f.x1 + (f.x2 - f.x1) * q, 1 - 0.65 * q, f.z1 + (f.z2 - f.z1) * q], size: 0.16 * k * heat, c: [1.6, 1.2 * (1 / heat), 0.4], a: 1, add: 1 });
        }
        lights.push({ p: [f.x2, 0.5, f.z2], r: 2, c: [2 * k, 1.5 * k, 0.5 * k] });
      } else if (f.k === 'lob') {
        const q = f.t / f.life;
        const x = f.x1 + (f.x2 - f.x1) * q, z = f.z1 + (f.z2 - f.z1) * q, y = 0.6 + Math.sin(q * Math.PI) * 0.9 - q * 0.4;
        bills.push({ p: [x, y, z], size: 0.2, c: f.burn ? [1.4, 0.4, 0.1] : [1.6, 0.7, 0.2], a: 1, add: 1 });
      } else if (f.k === 'burst' && f.t > 0) {
        rings.push({ c: [f.x, 0.06, f.z], r: f.r * (0.5 + 0.6 * (1 - k)), col: [1.4 * k, 0.5 * k, 0.1 * k, 1], width: 0.25, fill: 0.3 });
        lights.push({ p: [f.x, 0.5, f.z], r: 2.4, c: [2.5 * k, 0.9 * k, 0.2 * k] });
        bills.push({ p: [f.x, 0.4, f.z], size: f.r * (0.5 + (1 - k)), c: [1.2 * k, 0.5 * k, 0.1 * k], a: 1, add: 1 });
      } else if (f.k === 'pulse') {
        rings.push({ c: [f.x, 0.06, f.z], r: f.r * (0.2 + 0.8 * (1 - k)), col: [0.5 * k, 0.8 * k, 1.2 * k, 1], width: 0.12 });
      } else if (f.k === 'flare') {
        const q = 1 - k;
        rings.push({ c: [f.x, 0.06, f.z], r: f.r * (0.3 + 0.9 * ease(q)), col: [2 * k, 1.5 * k, 0.6 * k, 1], width: 0.2, fill: 0.25 * k });
        lights.push({ p: [f.x, 1, f.z], r: 6 * k + 1, c: [4 * k, 3 * k, 1.5 * k] });
        bills.push({ p: [f.x - 0.18, 1, f.z + 0.4], size: 3 * ease(q) + 0.4, c: [1.2 * k, 0.9 * k, 0.5 * k], a: 1, add: 1 });
      } else if (f.k === 'spark') {
        bills.push({ p: [f.x, f.y, f.z], size: 0.05, c: f.c.map((v) => v * k * 1.5), a: 1, add: 1 });
      } else if (f.k === 'puff') {
        bills.push({ p: [f.x, 0.3 + (1 - k) * 0.3, f.z], size: (f.big ? 0.9 : 0.4) * (1.2 - k * 0.6), c: [0.5, 0.45, 0.6], a: 0.5 * k, add: 0 });
      }
    }

    // ambient motes (fireflies, snow, embers)
    for (const m of motes) {
      let x = m.x, y = m.y, z = m.z;
      if (region === 'frost') { y = ((m.y - t * (0.3 + m.s * 0.3)) % 5 + 5) % 5; x += Math.sin(t * 0.6 + m.s * 9) * 0.3; bills.push({ p: [x, y, z], size: 0.04 + m.s * 0.03, c: [0.85, 0.9, 1], a: 0.8, add: 0 }); continue; }
      if (region === 'ember') { y = ((m.y + t * (0.2 + m.s * 0.3)) % 2.2); x += Math.sin(t * 0.8 + m.s * 9) * 0.2; }
      else { x += Math.sin(t * 0.4 + m.s * 20) * 0.5; y += Math.sin(t * 0.9 + m.s * 7) * 0.2; z += Math.cos(t * 0.3 + m.s * 11) * 0.5; }
      const tw = 0.5 + 0.5 * Math.sin(t * 3 + m.s * 30);
      bills.push({ p: [x, y, z], size: 0.06 + 0.04 * tw, c: lin(mood.motes).map((v) => v * (0.6 + tw)), a: 1, add: 1 });
    }

    // the strongest lights win when there are too many
    lights.sort((a, b) => (a.weak ? 1 : 0) - (b.weak ? 1 : 0));
    const used = lights.slice(0, MAX_LIGHTS);

    engine.begin({ view: cam.view, proj: cam.proj, eye: cam.eye, center: [COLS / 2, 0, ROWS / 2], radius: 11, mood, lights: used });
    if (!lowFx) engine.shadows(draws);
    engine.sky(t);
    engine.draw(draws);
    engine.rings(rings, t);
    engine.billboards(bills);

    // overlay: health bars, coin text, low-life vignette
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, cssW, cssH);
    for (const [e, x, z] of drawn) {
      if (e.hp >= e.maxHp) continue;
      const big = e.type === 'toad' || e.type === 'mothmother';
      const s = project(x, big ? 1.05 : e.type === 'mothmother' ? 1 : 0.75, z);
      if (!s) continue;
      const w = big ? 40 : 22, h = big ? 5 : 3.5;
      octx.fillStyle = 'rgba(15,10,25,0.85)';
      octx.fillRect(s.x - w / 2 - 1, s.y - 1, w + 2, h + 2);
      const f = Math.max(0, e.hp) / e.maxHp;
      octx.fillStyle = f > 0.5 ? '#9df08a' : f > 0.25 ? '#ffd36b' : '#ff7a5c';
      octx.fillRect(s.x - w / 2, s.y, w * f, h);
    }
    octx.textAlign = 'center';
    octx.font = '800 15px system-ui, sans-serif';
    for (const f of fx) {
      if (f.k !== 'coin') continue;
      const s = project(f.x, 0.9 + f.t * 0.8, f.z);
      if (!s) continue;
      const k = 1 - f.t / f.life;
      octx.fillStyle = `rgba(255,211,107,${k})`;
      octx.strokeStyle = `rgba(30,15,40,${k * 0.8})`;
      octx.lineWidth = 3;
      octx.strokeText(f.text, s.x, s.y);
      octx.fillText(f.text, s.x, s.y);
    }
    if (leakT > 0 || life < 0.3) {
      const a = Math.max(leakT / 0.5 * 0.5, life < 0.3 ? 0.18 + 0.08 * Math.sin(t * 4) : 0) * (reduced ? 0.6 : 1);
      const gr = octx.createRadialGradient(cssW / 2, cssH / 2, Math.min(cssW, cssH) * 0.35, cssW / 2, cssH / 2, Math.max(cssW, cssH) * 0.75);
      gr.addColorStop(0, 'rgba(255,60,40,0)');
      gr.addColorStop(1, `rgba(255,60,40,${a})`);
      octx.fillStyle = gr;
      octx.fillRect(0, 0, cssW, cssH);
    }
  }

  // Draw one plant on a transparent-looking backdrop and copy it into a 2D canvas (tray icons, cards).
  function snapshot(type, form, target, bg = [0.12, 0.09, 0.2]) {
    const size = Math.round((target.clientWidth || 64) * Math.min(2, window.devicePixelRatio || 1));
    const W = canvas.width, H = canvas.height;
    if (W < size || H < size) return;
    const gl = engine.gl;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, size, size);
    gl.viewport(0, 0, size, size);
    const proj = M4.persp(0.55, 1, 0.1, 30);
    const eye = [1.15, 1.1, 1.6], at = [0, 0.34, 0];
    const view = M4.lookAt(eye, at, [0, 1, 0]);
    const m = { ...MOODS.moon, ambient: [0.8, 0.78, 0.95], sunColor: [0.9, 0.88, 1], fogDensity: 0, skyTop: bg, skyHorizon: bg };
    engine.begin({ view, proj, eye, center: [0, 0, 0], radius: 2, mood: m, lights: [{ p: [0.8, 1.2, 1.2], r: 4, c: LIGHT[type].map((v) => v * 0.7) }] });
    gl.viewport(0, 0, size, size);
    gl.clearColor(...bg.map((v) => Math.pow(v, 1)), 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    engine.draw([{ mesh: plant(type, form), model: T(0, 0, 0, 0.5), emi: 1 }]);
    gl.disable(gl.SCISSOR_TEST);
    target.width = size; target.height = size;
    const c = target.getContext('2d');
    c.clearRect(0, 0, size, size);
    c.drawImage(canvas, 0, H - size, size, size, 0, 0, size, size);
  }

  return {
    kind: '3d',
    resize, cellAt, draw, addEvents, tickFx, clearFx, project, snapshot,
    intro() { introT = reduced ? 1 : 0; },
    skipIntro() { introT = 1; },
    get introDone() { return introT >= 1; },
    setTitle(v) { titleMode = v; },
    setFocus(p) { focus = p ? { x: p.x, z: p.y } : null; },
    setLowFx(v, g) { lowFx = v; groundKey = ''; if (g) resize(g, cssW, cssH); },
  };
}
