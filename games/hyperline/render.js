// Canvas2D perspective renderer. Everything is a projection of the 2D sim world (x along the
// track, y up) extruded across the track in z. Painter's algorithm: sky, floor grid, track, then
// objects sorted far to near. Glow is faked with additive double strokes (no shadowBlur in the
// hot path) so it holds 60fps on a mid phone.

import { clipToNear, faceNormal, makeCamera, MESHES, project, rotateXYZ, toView } from './lib/proj.js';
import { blockX, moverH, railLit } from './lib/sim.js';
import { bladeX } from './lib/course.js';
import { AIR, BAR_H, CEIL_Y, PS, SECTOR_LEN, sectorAt, sectorInfo, speedAt } from './lib/world.js';

/* ---------- bloom presenter (three.js, shared core copy) ---------- */
/** Shows the finished Canvas2D frame through three.js with a neon bloom pass. The scene and camera are
 *  untouched; only the final present changes. Resolves null when WebGL or the module is unavailable,
 *  and the caller keeps the plain 2D present. */
export const BLOOM = { strength: 0.55, radius: 0.55, threshold: 0.72 };
export async function createBloom(glCanvas, src) {
  let T, renderer;
  try {
    T = await import('../sdk/vendor/three.module.js');
    renderer = new T.WebGLRenderer({ canvas: glCanvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    const scene = new T.Scene(), cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mat = new T.MeshBasicMaterial({ toneMapped: false });
    scene.add(new T.Mesh(new T.PlaneGeometry(2, 2), mat));
    const composer = new T.EffectComposer(renderer);
    composer.addPass(new T.RenderPass(scene, cam));
    const bloom = new T.UnrealBloomPass(new T.Vector2(2, 2), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    composer.addPass(bloom);
    composer.addPass(new T.OutputPass());
    let tex = null, lost = () => {};
    glCanvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost(); });
    return {
      onLost(fn) { lost = fn; },
      resize(w, h) {
        renderer.setSize(w, h, false); composer.setSize(w, h);
        if (tex) tex.dispose();
        tex = new T.CanvasTexture(src); tex.colorSpace = T.SRGBColorSpace;
        tex.minFilter = T.LinearFilter; tex.generateMipmaps = false;
        mat.map = tex; mat.needsUpdate = true;
      },
      present() { if (!tex) return; tex.needsUpdate = true; composer.render(); },
      dispose() { try { composer.dispose(); renderer.dispose(); } catch { /* already gone */ } },
    };
  } catch {
    try { renderer && renderer.dispose(); } catch { /* ignore */ }
    return null;
  }
}

/* ---------- colour ---------- */
const rgbCache = new Map();
export function rgb(hex) {
  let v = rgbCache.get(hex);
  if (!v) { const n = parseInt(hex.slice(1), 16); v = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; rgbCache.set(hex, v); }
  return v;
}
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const lerpC = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const toHex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
export const mixHex = (a, b, t) => toHex(lerpC(rgb(a), rgb(b), t));
function hsl(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return toHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

/** Palette at distance x: blends into each new sector's palette over its first 30m. */
export function paletteAt(x) {
  const i = sectorAt(x), t = Math.min(1, (x - i * SECTOR_LEN) / 30);
  const cur = sectorInfo(i).pal;
  if (i === 0 || t >= 1) return cur;
  const prev = sectorInfo(i - 1).pal;
  const m = (a, b) => mixHex(a, b, t);
  return { sky: [0, 1, 2].map((k) => m(prev.sky[k], cur.sky[k])), sun: [m(prev.sun[0], cur.sun[0]), m(prev.sun[1], cur.sun[1])],
    grid: m(prev.grid, cur.grid), rail: m(prev.rail, cur.rail), neon: m(prev.neon, cur.neon), block: m(prev.block, cur.block) };
}

/** Rotates a hex colour's hue by deg, keeping saturation and lightness. */
export function hueShiftHex(hex, deg) {
  const [r, g, b] = rgb(hex).map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const l = (mx + mn) / 2;
  if (d === 0) return hex;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + deg + 360) % 360;
  return hsl(h, s * 100, l * 100);
}

/** Hue drift (degrees) for the grid and rail glow as a sector begins: 0 at the boundary, a gentle swell
 *  through the first second, back to 0 so the sector's own palette lands with no pop. Never in sector 0. */
export const SECTOR_HUE = { deg: 38, secs: 1 };
export function sectorHueShift(x) {
  const i = sectorAt(x);
  if (i <= 0) return 0;
  const secs = (x - i * SECTOR_LEN) / speedAt(x), k = secs / SECTOR_HUE.secs;
  if (k <= 0 || k >= 1) return 0;
  return SECTOR_HUE.deg * Math.sin(Math.PI * k);
}

/* ---------- skins ---------- */
export function skinColors(sk, t) {
  if (sk.fx === 'rainbow') return [hsl((t * 80) % 360, 100, 72), hsl((t * 80 + 140) % 360, 100, 58)];
  return [sk.a, sk.b];
}
const SHAPE_MESH = { square: 'cube', hex: 'hex', diamond: 'octa' };
const LIGHT = (() => { const l = [-0.45, 0.8, 0.55], n = Math.hypot(...l); return l.map((v) => v / n); })();

/* ---------- primitives ---------- */
function pathPts(c, pts) {
  c.beginPath(); c.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
  c.closePath();
}
/** Neon stroke: a wide faint pass and a thin bright pass, both additive. */
function neon(c, col, w, glow = true) {
  const op = c.globalCompositeOperation;
  c.globalCompositeOperation = 'lighter';
  if (glow) { c.strokeStyle = css(rgb(col), 0.22); c.lineWidth = w * 3.2; c.stroke(); }
  c.strokeStyle = col; c.lineWidth = w; c.stroke();
  c.globalCompositeOperation = op;
}
function seg(c, cam, a, b) {
  const s = clipToNear(cam, a, b);
  if (!s) return false;
  const p = project(cam, ...s[0]), q = project(cam, ...s[1]);
  if (!p || !q) return false;
  c.moveTo(p.x, p.y); c.lineTo(q.x, q.y);
  return true;
}

const CUBE = MESHES.cube;
/** Axis-aligned box with back faces culled: solid faces lit in the box's own colour, neon edges.
 *  fillA is opacity in [0, 1] (1 = solid). */
function box(c, cam, x0, x1, y0, y1, z0, z1, col, fillA, edgeW, surface = false) {
  // Trim the part behind the camera instead of dropping the whole box.
  x0 = Math.max(x0, cam.eye[0] + 0.25);
  if (x1 <= x0) return;
  const wv = CUBE.verts.map(([vx, vy, vz]) => [vx < 0 ? x0 : x1, vy < 0 ? y0 : y1, vz < 0 ? z0 : z1]);
  const vs = wv.map((v) => project(cam, v[0], v[1], v[2]));
  if (vs.some((v) => !v)) return;
  const cc = rgb(col), dark = [10, 5, 24];
  const vis = [];
  for (const f of CUBE.faces) {
    // World-space culling: keep faces whose outward normal points toward the eye.
    const fw = f.map((i) => wv[i]), n = faceNormal(fw), e = cam.eye;
    const ctr = [0, 1, 2].map((k) => fw.reduce((acc, v) => acc + v[k], 0) / fw.length);
    if (n[0] * (e[0] - ctr[0]) + n[1] * (e[1] - ctr[1]) + n[2] * (e[2] - ctr[2]) > 0) vis.push({ pts: f.map((i) => vs[i]), n });
  }
  const a0 = c.globalAlpha;
  for (const { pts, n } of vis) {
    const l = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
    // Top faces glow brightest; sides fall off to a deep tint, never to black.
    // Track surfaces stay dark so the grid and the runner read on top of them.
    const lit = surface ? lerpC(dark, cc, 0.1 + 0.12 * l) : n[1] > 0.5 ? lerpC(cc, [255, 255, 255], 0.12) : lerpC(dark, cc, 0.55 + 0.4 * l);
    pathPts(c, pts);
    c.globalAlpha = a0 * fillA;
    const b = project(cam, (x0 + x1) / 2, y0, (z0 + z1) / 2), t = project(cam, (x0 + x1) / 2, y1, (z0 + z1) / 2);
    if (!surface && n[1] <= 0.5 && b && t) {
      const g = c.createLinearGradient(0, t.y, 0, b.y);
      g.addColorStop(0, css(lit)); g.addColorStop(1, css(lerpC(lit, dark, 0.3)));
      c.fillStyle = g;
    } else c.fillStyle = css(lit);
    c.fill();
  }
  c.globalAlpha = a0;
  c.beginPath();
  for (const { pts } of vis) { c.moveTo(pts[0].x, pts[0].y); for (let i = 1; i <= pts.length; i++) c.lineTo(pts[i % pts.length].x, pts[i % pts.length].y); }
  neon(c, col, edgeW);
}

/** Any mesh at world position, scaled and rotated, flat-shaded between colours a and b. */
function mesh(c, cam, m, pos, scale, rot, a, b, alpha = 1, wire = false, edge = '') {
  const wv = m.verts.map((v) => {
    const r = rotateXYZ([v[0] * scale[0], v[1] * scale[1], v[2] * scale[2]], rot[0], rot[1], rot[2]);
    return [r[0] + pos[0], r[1] + pos[1], r[2] + pos[2]];
  });
  const pv = wv.map((v) => project(cam, v[0], v[1], v[2]));
  if (pv.some((v) => !v)) return;
  const ca = rgb(a), cb = rgb(b);
  c.globalAlpha *= alpha;
  for (const f of m.faces) {
    const pts = f.map((i) => pv[i]), fw = f.map((i) => wv[i]), n = faceNormal(fw), e = cam.eye;
    // World-space culling (the screen-space winding test is mirrored under this camera).
    const ctr = [0, 1, 2].map((k) => fw.reduce((acc, v) => acc + v[k], 0) / fw.length);
    if (!wire && n[0] * (e[0] - ctr[0]) + n[1] * (e[1] - ctr[1]) + n[2] * (e[2] - ctr[2]) <= 0) continue;
    pathPts(c, pts);
    if (!wire) {
      const l = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
      c.fillStyle = css(lerpC(lerpC(cb, [6, 3, 16], 0.35), lerpC(ca, [255, 255, 255], 0.25), 0.15 + 0.85 * l)); c.fill();
      if (edge) neon(c, edge, 1.6);
      else { c.strokeStyle = css(lerpC(ca, [255, 255, 255], 0.5), 0.9); c.lineWidth = 1.4; c.stroke(); }
    } else neon(c, a, 1.4, false);
  }
  c.globalAlpha /= alpha;
}

function sphere(c, cam, pos, r, rot, a, b, alpha = 1, wire = false) {
  const p = project(cam, pos[0], pos[1], pos[2]);
  if (!p) return;
  const R = r * p.s;
  c.globalAlpha *= alpha;
  c.beginPath(); c.arc(p.x, p.y, R, 0, Math.PI * 2);
  if (wire) neon(c, a, 1.4, false);
  else {
    const g = c.createRadialGradient(p.x - R * 0.35, p.y - R * 0.4, R * 0.1, p.x, p.y, R);
    g.addColorStop(0, '#FFFFFF'); g.addColorStop(0.25, a); g.addColorStop(1, b);
    c.fillStyle = g; c.fill();
  }
  // Two meridians that turn with the roll, so the ball visibly spins.
  c.beginPath();
  for (const off of [0, Math.PI / 2]) {
    const k = Math.cos(rot + off);
    c.ellipse(p.x, p.y, Math.abs(k) * R, R, 0, 0, Math.PI * 2);
  }
  c.strokeStyle = wire ? css(rgb(a), 0.5) : 'rgba(255,255,255,.45)'; c.lineWidth = 1.2; c.stroke();
  c.globalAlpha /= alpha;
}

/** Visual-only squash/stretch factors for q in [-1 (take-off stretch), 1 (landing squash)]. */
export function squashScale(q) {
  const k = Math.max(-1, Math.min(1, q || 0));
  return { sx: 1 + 0.2 * k, sy: 1 - 0.28 * k };
}

/** The runner shape for a skin, centred at pos with roll rz. squash (-1..1) deforms it about its feet. */
function runnerShape(c, cam, sk, pos, rz, t, alpha = 1, wire = false, squash = 0, flip = false) {
  const [a, b] = skinColors(sk, t);
  const s = PS * 1.02;
  const rot = [0, sk.shape === 'diamond' ? t * 1.6 : 0.0, -rz];
  const { sx, sy } = squashScale(squash);
  if (squash) pos = [pos[0], pos[1] + (flip ? 1 : -1) * (PS / 2) * (sy - 1) * -1, pos[2]];
  const draw = (ca, cb, al, w) => {
    if (sk.shape === 'circle') {
      const p = squash ? project(cam, pos[0], pos[1], pos[2]) : null;
      if (p) { c.save(); c.translate(p.x, p.y); c.scale(sx, sy); c.translate(-p.x, -p.y); }
      sphere(c, cam, pos, s * 0.55, rz, ca, cb, al, w);
      if (p) c.restore();
    } else mesh(c, cam, MESHES[SHAPE_MESH[sk.shape] || 'cube'], pos, [s * sx, s * sy, s * sx], rot, ca, cb, al, w);
  };
  if (sk.fx === 'glitch' && !wire) {
    const j = 0.06 * Math.sin(t * 37);
    draw('#22F0FF', '#22F0FF', 0.45 * alpha, false);
    pos = [pos[0] + j, pos[1], pos[2]];
    draw('#FF2BD6', '#FF2BD6', 0.45 * alpha, false);
    pos = [pos[0] - j * 2, pos[1] + 0.02 * Math.cos(t * 13), pos[2]];
  }
  draw(a, b, alpha, wire);
}

/* ---------- thumbnails ---------- */
/** A skin rendered in 3D for the locker, shop and flex card. */
export function drawSkinThumb(c, sk, cx, cy, size, t, locked) {
  const Wd = size * 2.2, cam = makeCamera([0, 1.25, 3.85], [0, 0, 0], 30, Wd, Wd);
  c.save(); c.translate(cx - Wd / 2, cy - Wd / 2);
  const rz = 0, spin = 0.65 + t * 0.9;
  if (locked) {
    const m = MESHES[SHAPE_MESH[sk.shape] || 'cube'];
    if (sk.shape === 'circle') sphere(c, cam, [0, 0, 0], 0.56, 0, '#3A2A6A', '#1A1033');
    else mesh(c, cam, m, [0, 0, 0], [1, 1, 1], [0, spin, 0], '#3A2A6A', '#1A1033');
    c.fillStyle = '#8A7AC0'; c.font = `700 ${size * 0.55}px "Chakra Petch",sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', Wd / 2, Wd / 2 + size * 0.03);
    c.restore(); return;
  }
  const [a, b] = skinColors(sk, t);
  const g = c.createRadialGradient(Wd / 2, Wd / 2, 0, Wd / 2, Wd / 2, size * 0.95);
  g.addColorStop(0, css(rgb(a), 0.45)); g.addColorStop(1, css(rgb(a), 0));
  c.fillStyle = g; c.fillRect(0, 0, Wd, Wd);
  if (sk.shape === 'circle') sphere(c, cam, [0, 0, 0], 0.56, spin, a, b);
  else {
    const m = MESHES[SHAPE_MESH[sk.shape] || 'cube'];
    if (sk.fx === 'glitch') {
      mesh(c, cam, m, [0.05 * Math.sin(t * 37), 0, 0], [1, 1, 1], [-0.1, spin, rz], '#22F0FF', '#22F0FF', 0.45);
      mesh(c, cam, m, [-0.05 * Math.cos(t * 29), 0, 0], [1, 1, 1], [-0.1, spin, rz], '#FF2BD6', '#FF2BD6', 0.45);
    }
    mesh(c, cam, m, [0, 0, 0], [1, 1, 1], [-0.1, spin, rz], a, b);
  }
  c.restore();
}

/* ---------- trails ---------- */
function drawTrail(c, cam, id, pts, sk, t) {
  if (pts.length < 2) return;
  const [a, b] = skinColors(sk, t);
  const op = c.globalCompositeOperation;
  c.globalCompositeOperation = 'lighter';
  const n = pts.length;
  if (id === 'classic' || id === 'binary') {
    for (let i = 0; i < n; i++) {
      const q = pts[i], p = project(cam, q.x, q.y, 0);
      if (!p) continue;
      const k = i / n, sz = PS * 0.28 * p.s * (0.4 + k * 0.6);
      c.globalAlpha = k * 0.8;
      c.fillStyle = id === 'binary' ? '#7CFF6B' : a;
      if (id === 'binary') { c.font = `700 ${Math.max(8, sz * 1.6)}px "Chakra Petch",monospace`; c.textAlign = 'center'; c.fillText(q.k > 0.5 ? '1' : '0', p.x, p.y); }
      else c.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
  } else if (id === 'ribbon' || id === 'prism') {
    for (let i = 1; i < n; i++) {
      const q0 = pts[i - 1], q1 = pts[i];
      const p0 = project(cam, q0.x, q0.y + 0.18, 0), p1 = project(cam, q1.x, q1.y + 0.18, 0);
      const p2 = project(cam, q1.x, q1.y - 0.18, 0), p3 = project(cam, q0.x, q0.y - 0.18, 0);
      if (!p0 || !p1 || !p2 || !p3) continue;
      c.globalAlpha = (i / n) * 0.7;
      c.fillStyle = id === 'prism' ? hsl((t * 120 + i * 14) % 360, 100, 60) : b;
      pathPts(c, [p0, p1, p2, p3]); c.fill();
    }
  } else {
    // comet and sparks: a tapering glowing line
    for (let i = 1; i < n; i++) {
      const q0 = pts[i - 1], q1 = pts[i];
      const p0 = project(cam, q0.x, q0.y, 0), p1 = project(cam, q1.x, q1.y, 0);
      if (!p0 || !p1) continue;
      const k = i / n;
      c.globalAlpha = k * (id === 'sparks' ? 0.5 : 0.9);
      c.beginPath(); c.moveTo(p0.x, p0.y); c.lineTo(p1.x, p1.y);
      c.strokeStyle = id === 'sparks' ? '#FFE45C' : a; c.lineWidth = PS * p1.s * (id === 'sparks' ? 0.12 : 0.55) * k; c.lineCap = 'round'; c.stroke();
    }
    c.lineCap = 'butt';
  }
  c.globalAlpha = 1;
  c.globalCompositeOperation = op;
}

/** A short neon streak behind the runner: points live this many seconds (less than a beat). */
export const LIGHT_TRAIL_LIFE = 0.3;
export function lightTrailAlpha(age) {
  const k = 1 - (age || 0) / LIGHT_TRAIL_LIFE;
  return k <= 0 ? 0 : 0.7 * k * k;
}
function drawLightTrail(c, cam, pts, sk, t) {
  if (!pts || pts.length < 2) return;
  const [a] = skinColors(sk, t);
  const op = c.globalCompositeOperation;
  c.globalCompositeOperation = 'lighter';
  c.lineCap = 'round';
  c.strokeStyle = a;
  for (let i = 1; i < pts.length; i++) {
    const q0 = pts[i - 1], q1 = pts[i];
    const al = lightTrailAlpha(q1.age);
    if (al <= 0) continue;
    const p0 = project(cam, q0.x, q0.y, 0), p1 = project(cam, q1.x, q1.y, 0);
    if (!p0 || !p1) continue;
    c.globalAlpha = al;
    c.lineWidth = Math.max(1, PS * p1.s * 0.5 * (al / 0.7));
    c.beginPath(); c.moveTo(p0.x, p0.y); c.lineTo(p1.x, p1.y); c.stroke();
  }
  c.lineCap = 'butt';
  c.globalAlpha = 1;
  c.globalCompositeOperation = op;
}

/** Crash shards: a few bright neon slivers thrown outward that fade in well under half a second. */
export const SHARD_LIFE = 0.42;
export function shardAlpha(age) {
  const k = 1 - (age || 0) / SHARD_LIFE;
  return k <= 0 ? 0 : k;
}
export function makeShards(x, y, n, rand) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + rand() * 0.8) / n) * Math.PI * 2, v = 4 + rand() * 4;
    out.push({ x, y, z: 0, vx: Math.cos(a) * v, vy: Math.sin(a) * v + 1.5, vz: (rand() - 0.5) * 3,
      rot: rand() * Math.PI, spin: (rand() - 0.5) * 18, len: 0.3 + rand() * 0.3, age: 0 });
  }
  return out;
}
function drawShards(c, cam, shards, sk, t) {
  if (!shards || !shards.length) return;
  const [a] = skinColors(sk, t);
  const op = c.globalCompositeOperation;
  c.globalCompositeOperation = 'lighter';
  c.lineCap = 'round';
  c.strokeStyle = a;
  for (const s of shards) {
    const al = shardAlpha(s.age);
    if (al <= 0) continue;
    const p = project(cam, s.x, s.y, s.z);
    if (!p) continue;
    const ang = s.rot + s.spin * s.age, h = s.len * p.s * 0.5, dx = Math.cos(ang) * h, dy = Math.sin(ang) * h;
    c.globalAlpha = al;
    c.lineWidth = Math.max(1.5, PS * p.s * 0.14);
    c.beginPath(); c.moveTo(p.x - dx, p.y - dy); c.lineTo(p.x + dx, p.y + dy); c.stroke();
  }
  c.lineCap = 'butt';
  c.globalAlpha = 1;
  c.globalCompositeOperation = op;
}

/** Visual-only take-off ticks: a faint neon mark on the track where a jump peaks over the middle of a
 *  block, spike or pit. x is where the runner's centre should leave the ground. Strength is 0 once the
 *  runner has passed, rises to full by TICK.fadeIn metres ahead and softens again over the last stretch. */
export const TICK = { max: 0.4, reach: 32, fadeIn: 10, fadeOut: 2.5 };
export function tickAlpha(ahead) {
  if (!(ahead > 0) || ahead > TICK.reach) return 0;
  const far = Math.min(1, (TICK.reach - ahead) / TICK.fadeIn), near = Math.min(1, ahead / TICK.fadeOut);
  return TICK.max * far * near;
}
export function takeoffTicks(objs, rcx) {
  const out = [];
  for (const o of objs) {
    if (o.x > rcx + TICK.reach + 20) break;
    if (o.t !== 'block' && o.t !== 'spike' && o.t !== 'pit') continue;
    if (o.t === 'spike' && o.inv) continue;
    const mid = o.t === 'spike' ? o.x + 0.4 : o.x + (o.w || 0) / 2;
    const x = mid - (AIR * speedAt(mid)) / 2, a = tickAlpha(x - rcx);
    if (a > 0) out.push({ x, a });
  }
  return out;
}

/* ---------- scene ---------- */
const STARS = Array.from({ length: 80 }, (_, i) => {
  const h = (k) => { const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };
  return { x: h(1), y: h(2) * 0.55, s: h(3) * 1.4 + 0.4, p: h(4) * 6 };
});
const hash = (i, k) => { const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };

export function cameraFor(st, W, H) {
  const rx = st.rx, f = st.flipT;
  const eye = [rx - 5.6 + st.shakeX, 3.1 + st.lift - f * 1.5 + st.shakeY, 2.5];
  const target = [rx + 6.5, 0.55 + st.lift * 0.85 + f * 2.4, -0.25];
  return makeCamera(eye, target, W > H ? 50 : 64, W, H);
}

/**
 * st: { rx, runner, course, skin, trailId, trailPts, ghost, parts, pops, t, lift, flipT,
 *       shakeX, shakeY, flash, reduced, speed, showRunner }
 */
export function drawScene(c, W, H, st) {
  let pal = paletteAt(st.rx);
  const hs = st.reduced ? 0 : sectorHueShift(st.rx);
  // grid and rail glow only; obstacle colours keep their contrast
  if (hs) pal = { ...pal, grid: hueShiftHex(pal.grid, hs), rail: hueShiftHex(pal.rail, hs) };
  const cam = cameraFor(st, W, H), t = st.t, rx = st.rx;

  // horizon: where the flat floor meets the sky
  const dh = [cam.f[0], 0, cam.f[2]], dl = Math.hypot(dh[0], dh[2]);
  const hv = toView(cam, cam.eye[0] + dh[0] / dl * 1000, cam.eye[1], cam.eye[2] + dh[2] / dl * 1000);
  const hy = cam.cy - (hv[1] / hv[2]) * cam.focal, hx = cam.cx + (hv[0] / hv[2]) * cam.focal;

  // sky
  let g = c.createLinearGradient(0, 0, 0, Math.max(10, hy));
  g.addColorStop(0, pal.sky[0]); g.addColorStop(0.65, pal.sky[1]); g.addColorStop(1, pal.sky[2]);
  c.fillStyle = g; c.fillRect(0, 0, W, Math.max(0, hy) + 2);
  c.fillStyle = '#fff';
  for (const s of STARS) {
    let x = (s.x * W - rx * 0.6) % W; if (x < 0) x += W;
    const y = s.y * hy;
    if (y > hy - 8) continue;
    c.globalAlpha = st.reduced ? 0.6 : 0.35 + 0.4 * Math.sin(t * 2 + s.p);
    c.fillRect(x, y, s.s, s.s);
  }
  c.globalAlpha = 1;

  // sun with synthwave cuts
  const sunR = Math.min(W, H) * 0.2, sx = hx + W * 0.08, sy = hy - sunR * 0.3;
  c.save();
  c.beginPath(); c.rect(0, 0, W, hy); c.clip();
  g = c.createLinearGradient(0, sy - sunR, 0, sy + sunR);
  g.addColorStop(0, pal.sun[0]); g.addColorStop(1, pal.sun[1]);
  c.globalAlpha = 0.9; c.fillStyle = g;
  c.beginPath(); c.arc(sx, sy, sunR, 0, Math.PI * 2); c.fill();
  const halo = c.createRadialGradient(sx, sy, sunR * 0.8, sx, sy, sunR * 2.2);
  halo.addColorStop(0, css(rgb(pal.sun[1]), 0.35)); halo.addColorStop(1, css(rgb(pal.sun[1]), 0));
  c.fillStyle = halo; c.fillRect(sx - sunR * 2.2, sy - sunR * 2.2, sunR * 4.4, sunR * 4.4);
  c.globalAlpha = 1; c.fillStyle = pal.sky[2];
  for (let i = 0; i < 6; i++) { const yy = sy + sunR * (0.05 + i * 0.16); c.fillRect(sx - sunR, yy, sunR * 2, 1.5 + i * 1.5); }
  // mountains
  const mo = rx * 1.2, step = 26;
  c.beginPath(); c.moveTo(-10, hy + 1);
  for (let i = -1; i <= W / step + 2; i++) {
    const wi = Math.floor(mo / step) + i, x = wi * step - mo;
    const hgt = (0.25 + hash(wi, 7) * 0.75) * sunR * 0.75 * (0.6 + 0.4 * Math.sin(wi * 0.37));
    c.lineTo(x, hy - Math.max(4, hgt));
  }
  c.lineTo(W + 10, hy + 1); c.closePath();
  c.fillStyle = mixHex(pal.sky[0], pal.sky[2], 0.3); c.fill();
  neon(c, pal.grid, 1, false);
  c.restore();

  // floor
  g = c.createLinearGradient(0, hy, 0, H);
  g.addColorStop(0, mixHex(pal.sky[2], '#000000', 0.55)); g.addColorStop(1, '#030108');
  c.fillStyle = g; c.fillRect(0, hy, W, H - hy + 2);
  const FY = -3.2;
  c.beginPath();
  for (let z = -26; z <= 26; z += 2) seg(c, cam, [rx - 8, FY, z], [rx + 140, FY, z]);
  const gx0 = Math.floor((rx - 8) / 2) * 2;
  for (let x = gx0; x < rx + 140; x += 2) seg(c, cam, [x, FY, -26], [x, FY, 26]);
  c.globalAlpha = 0.5; neon(c, pal.grid, 1, false); c.globalAlpha = 1;
  // fog band to soften the far grid into the horizon
  g = c.createLinearGradient(0, hy, 0, hy + (H - hy) * 0.35);
  g.addColorStop(0, css(rgb(pal.sky[2]), 0.95)); g.addColorStop(1, css(rgb(pal.sky[2]), 0));
  c.fillStyle = g; c.fillRect(0, hy, W, (H - hy) * 0.35);

  // track segments between pits, far to near
  const objs = st.course.objs, near = rx - 7, far = rx + 75;
  const pits = [];
  const rcx = st.runner.x + PS / 2;
  // a crumble panel still holds the floor up until it drops, `drop` units before the runner reaches it
  for (const o of objs) { if (o.x > far) break; if (o.t === 'pit' && o.x + o.w > near && !(o.c && rcx < o.x - o.drop)) pits.push(o); }
  const segs = [];
  let a = near;
  for (const p of pits) { if (p.x > a) segs.push([a, p.x]); a = Math.max(a, p.x + p.w); }
  if (a < far) segs.push([a, far]);
  const TZ = 1.15;
  for (let i = segs.length - 1; i >= 0; i--) {
    const [x0, x1] = segs[i];
    const fade = Math.max(0.15, Math.min(1, 1 - (x0 - rx - 35) / 40));
    c.globalAlpha = fade;
    box(c, cam, x0, x1, -0.38, 0, -TZ, TZ, pal.rail, 0.9, 1.6, true);
    c.beginPath();
    for (let x = Math.ceil(x0); x < x1; x += 2) seg(c, cam, [x, 0.001, -TZ], [x, 0.001, TZ]);
    seg(c, cam, [x0, 0.001, 0], [x1, 0.001, 0]);
    c.globalAlpha = fade * 0.35; neon(c, pal.rail, 1, false);
    c.beginPath(); seg(c, cam, [x0, 0, TZ], [x1, 0, TZ]); seg(c, cam, [x0, 0, -TZ], [x1, 0, -TZ]);
    c.globalAlpha = fade; neon(c, pal.rail, 2.2);
  }
  c.globalAlpha = 1;

  // faint take-off ticks on the track, fading as the runner passes (visual only)
  if (!st.runner.flip) for (const k of takeoffTicks(objs, rcx)) {
    c.beginPath(); seg(c, cam, [k.x, 0.004, -TZ * 0.8], [k.x, 0.004, TZ * 0.8]);
    c.globalAlpha = k.a; neon(c, pal.neon, 1.6);
  }
  c.globalAlpha = 1;

  // objects, depth sorted
  const dr = [];
  const depth = (x, y, z) => toView(cam, x, y, z)[2];
  for (const o of objs) {
    if (o.x > far) break;
    const w = o.w || 0.8;
    if (o.x + w < rx - 6) continue;
    const fade = Math.max(0, Math.min(1, 1 - (o.x - rx - 38) / 36));
    if (fade <= 0) continue;
    switch (o.t) {
      case 'block': dr.push({ z: depth(o.x + w, o.h / 2, 0), f: () => {
        const bx = blockX(o, st.runner.x); c.globalAlpha = fade;
        if (o.f !== undefined) {
          // a falling pillar: a faint outline on the track where it will land, and the pillar dropping until it lands at o.f
          const left = o.f - st.runner.x, lift = left > 0 ? Math.min(1, left / 7) * 9 : 0;
          if (left > 0) box(c, cam, bx, bx + o.w, 0, 0.04, -1, 1, pal.block, 0.35, 1);
          box(c, cam, bx, bx + o.w, lift, lift + o.h, -1, 1, pal.block, 1, 2);
        } else box(c, cam, bx, bx + o.w, 0, o.h, -1, 1, pal.block, 1, 2);
      } }); break;
      case 'blade': dr.push({ z: depth(o.x + o.amp + o.w, o.h / 2, 0), f: () => {
        // a pendulum blade: a slab swaying along the track from a pivot rod high above, drawn where the sim has it
        const bx = bladeX(o, st.runner.x), px = o.x + o.amp + o.w / 2, top = o.h + 4;
        c.globalAlpha = fade;
        box(c, cam, bx, bx + o.w, 0, o.h, -1, 1, pal.block, 1, 2);
        c.beginPath();
        seg(c, cam, [px, top, -1], [bx + o.w / 2, o.h, -1]); seg(c, cam, [px, top, 1], [bx + o.w / 2, o.h, 1]);
        seg(c, cam, [px - 0.4, top, -1], [px + 0.4, top, -1]); seg(c, cam, [px - 0.4, top, 1], [px + 0.4, top, 1]);
        c.globalAlpha = fade * 0.55; neon(c, pal.neon, 1.6);
      } }); break;
      case 'spike': dr.push({ z: depth(o.x + 0.4, o.y, 0), f: () => {
        c.globalAlpha = fade;
        for (const zz of [-0.52, 0.52]) mesh(c, cam, MESHES.pyramid, [o.x + 0.4, o.inv ? o.y - 0.4 : o.y + 0.4, zz], [0.76, 0.8, 0.92], [o.inv ? Math.PI : 0, 0, 0], mixHex(pal.neon, '#12051F', 0.55), mixHex(pal.neon, '#12051F', 0.85), 1, false, pal.neon);
      } }); break;
      case 'bar': dr.push({ z: depth(o.x + o.w, o.y + 0.6, 0), f: () => {
        c.globalAlpha = fade;
        box(c, cam, o.x, o.x + o.w, o.y, o.y + BAR_H, -1.3, 1.3, '#FF8A3D', 0.55, 2);
        c.beginPath();
        for (let k = 0.3; k < BAR_H; k += 0.45) seg(c, cam, [o.x, o.y + k, -1.3], [o.x, o.y + k, 1.3]);
        c.globalAlpha = fade * 0.45; neon(c, '#FFE45C', 1, false);
        c.beginPath(); seg(c, cam, [o.x, o.y, -1.3], [o.x, o.y, 1.3]); seg(c, cam, [o.x, o.y, 1.3], [o.x + o.w, o.y, 1.3]);
        c.globalAlpha = fade; neon(c, '#FFE45C', 3);
      } }); break;
      case 'pad': dr.push({ z: depth(o.x + o.w, 0, 0) + 1, f: () => {
        c.globalAlpha = fade;
        box(c, cam, o.x, o.x + o.w, 0, 0.1, -0.9, 0.9, '#7CFF6B', 1, 1.6);
        c.beginPath();
        const ph = (t * 3) % 1;
        for (let k = 0; k < 2; k++) {
          const xx = o.x + 0.3 + ((k * 0.5 + ph) % 1) * (o.w - 0.6);
          seg(c, cam, [xx - 0.3, 0.12, -0.7], [xx, 0.12, 0]); seg(c, cam, [xx, 0.12, 0], [xx - 0.3, 0.12, 0.7]);
        }
        neon(c, '#7CFF6B', 2.2);
      } }); break;
      case 'mover': dr.push({ z: depth(o.x + o.w, 0, 0), f: () => {
        const h = moverH(o, st.runner.x);
        c.globalAlpha = fade;
        c.beginPath();
        for (const xx of [o.x + 0.2, o.x + o.w - 0.2]) seg(c, cam, [xx, h - 0.3, 1], [xx, -3.2, 1]);
        c.globalAlpha = fade * 0.35; neon(c, '#FFE45C', 1, false); c.globalAlpha = fade;
        box(c, cam, o.x, o.x + o.w, h - 0.3, h, -1, 1, '#FFE45C', 1, 2);
      } }); break;
      case 'flip': dr.push({ z: depth(o.x + o.w, CEIL_Y, 0) + 3, f: () => {
        c.globalAlpha = fade;
        box(c, cam, o.x, o.x + o.w, CEIL_Y, CEIL_Y + 0.3, -TZ, TZ, pal.rail, 0.5, 1.8, true);
        c.beginPath();
        for (let x = Math.ceil(o.x) + 0.5; x < o.x + o.w; x += 3) { seg(c, cam, [x, 0.4, 0], [x, 1.2, 0]); seg(c, cam, [x - 0.25, 0.9, 0], [x, 1.2, 0]); seg(c, cam, [x + 0.25, 0.9, 0], [x, 1.2, 0]); }
        c.globalAlpha = fade * (0.5 + 0.3 * Math.sin(t * 6)); neon(c, pal.rail, 2);
      } }); break;
      case 'gate': dr.push({ z: depth(o.x + o.w, o.y, 0), f: () => {
        c.globalAlpha = fade;
        box(c, cam, o.x, o.x + o.w, 0, o.y, -1.2, 1.2, pal.block, 0.8, 2);
        box(c, cam, o.x, o.x + o.w, o.h, o.h + 1.4, -1.2, 1.2, pal.block, 0.8, 2);
        c.beginPath();
        for (const zz of [-1.2, 1.2]) seg(c, cam, [o.x, o.y, zz], [o.x, o.h, zz]);
        seg(c, cam, [o.x, o.y, -1.2], [o.x, o.y, 1.2]); seg(c, cam, [o.x, o.h, -1.2], [o.x, o.h, 1.2]);
        c.globalAlpha = fade * (0.6 + 0.3 * Math.sin(t * 7)); neon(c, pal.neon, 3);
      } }); break;
      case 'pit': if (o.c) dr.push({ z: depth(o.x + o.w, 0, 0) + 1, f: () => {
        const ahead = o.x - o.drop - rcx; // > 0: still standing; <= 0: dropped
        if (ahead > 0) {
          // glowing warning: starts `glow` units out and flickers faster as the drop nears
          const k = Math.max(0, Math.min(1, 1 - ahead / (o.glow - o.drop)));
          if (k <= 0) return;
          const blink = st.reduced ? 1 : 0.6 + 0.4 * Math.sin(t * (8 + 14 * k));
          c.globalAlpha = fade * (0.4 + 0.6 * k) * blink;
          box(c, cam, o.x, o.x + o.w, 0, 0.1, -1.1, 1.1, '#FF8A3D', 0.9, 2.2);
          c.beginPath();
          for (let xx = o.x; xx <= o.x + o.w + 0.01; xx += o.w / 4) seg(c, cam, [xx, 0.12, -1.1], [xx, 0.12, 1.1]);
          neon(c, '#FFE45C', 2.4);
        } else {
          // the panel falls away behind the drop
          const tf = -ahead / speedAt(o.x);
          if (tf > 0.55) return;
          c.globalAlpha = fade * (1 - tf / 0.55) * 0.8;
          const yy = -30 * tf * tf;
          box(c, cam, o.x, o.x + o.w, yy - 0.1, yy, -1.1, 1.1, '#FF8A3D', 0.7, 1.6);
        }
      } });
        break;
      case 'rail': dr.push({ z: depth(o.x + o.w, 0, 0) + 1, f: () => {
        // lit (hot, wide glow) or dark (dim outline) exactly as the sim sees it at the runner's centre
        const lit = railLit(o, st.runner.x + PS / 2), col = lit ? '#FF2B5E' : '#7CFFEA';
        c.globalAlpha = fade * (lit ? 1 : 0.35);
        box(c, cam, o.x, o.x + o.w, 0, lit ? 0.22 : 0.06, -1.1, 1.1, col, lit ? 1 : 0.4, lit ? 2.4 : 1.2);
        c.beginPath();
        for (const zz of [-1.2, 1.2]) seg(c, cam, [o.x, 0, zz], [o.x + o.w, 0, zz]);
        for (let k = 0; k <= 3; k++) { const xx = o.x + (o.w * k) / 3; seg(c, cam, [xx, 0, -1.2], [xx, lit ? 1.1 : 0.3, -1.2]); seg(c, cam, [xx, 0, 1.2], [xx, lit ? 1.1 : 0.3, 1.2]); }
        c.globalAlpha = fade * (lit ? 1 : 0.5); neon(c, col, lit ? 3.2 : 1.6);
      } }); break;
      case 'chip': if (!o.got) dr.push({ z: depth(o.x, o.y, 0), f: () => {
        c.globalAlpha = fade;
        mesh(c, cam, MESHES.octa, [o.x, o.y, 0], [0.34, 0.5, 0.34], [0, t * 3 + o.x, 0], '#FFE45C', '#FF9F1C');
      } }); break;
    }
  }
  const r = st.runner;
  const rpos = [r.x + PS / 2, r.y + PS / 2, 0];
  if (st.ghost) {
    const gp = [st.ghost.x + PS / 2, st.ghost.y + PS / 2, 0];
    dr.push({ z: depth(...gp) + 0.01, f: () => { c.globalAlpha = 1; runnerShape(c, cam, st.skin, gp, 0, t, 0.5, true); } });
  }
  dr.push({ z: depth(...rpos), f: () => {
    c.globalAlpha = 1;
    drawTrail(c, cam, st.trailId, st.trailPts, st.skin, t);
    if (st.showRunner) drawLightTrail(c, cam, st.lightTrail, st.skin, t);
    if (!st.showRunner) return;
    const p = project(cam, ...rpos);
    if (p) {
      const [ca] = skinColors(st.skin, t), R = PS * p.s * 1.6;
      const gg = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
      gg.addColorStop(0, css(rgb(ca), 0.45)); gg.addColorStop(1, css(rgb(ca), 0));
      const op = c.globalCompositeOperation; c.globalCompositeOperation = 'lighter';
      c.fillStyle = gg; c.fillRect(p.x - R, p.y - R, R * 2, R * 2); c.globalCompositeOperation = op;
      // contact shadow on whichever surface the runner rides
      const sy = r.flip ? CEIL_Y : 0, sp = project(cam, rpos[0], sy + 0.002, 0);
      if (sp && Math.abs(r.y - (r.flip ? CEIL_Y - PS : 0)) < 3) {
        c.fillStyle = 'rgba(0,0,0,.4)'; c.beginPath(); c.ellipse(sp.x, sp.y, PS * sp.s * 0.6, PS * sp.s * 0.18, 0, 0, Math.PI * 2); c.fill();
      }
    }
    runnerShape(c, cam, st.skin, rpos, r.rot, t, st.blink ? 0.35 : 1, false, st.squash || 0, r.flip);
  } });
  dr.sort((p, q) => q.z - p.z);
  for (const d of dr) d.f();
  c.globalAlpha = 1;

  // landing ripples: a cyan ring spreading over the track from where the runner touched down
  for (const rp of st.ripples || []) {
    const k = Math.min(1, rp.age / 0.45), rad = st.reduced ? 0.9 : 0.4 + k * 1.3, sy = rp.flip ? CEIL_Y : 0.004;
    c.beginPath();
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI * 2, a1 = ((i + 1) / 16) * Math.PI * 2;
      seg(c, cam, [rp.x + Math.cos(a0) * rad * 1.5, sy, Math.sin(a0) * rad * 0.8], [rp.x + Math.cos(a1) * rad * 1.5, sy, Math.sin(a1) * rad * 0.8]);
    }
    c.globalAlpha = 0.9 * (1 - k); neon(c, '#22F0FF', 2.2);
  }
  c.globalAlpha = 1;

  // particles
  c.globalCompositeOperation = 'lighter';
  for (const p of st.parts) {
    const q = project(cam, p.x, p.y, p.z);
    if (!q) continue;
    const sz = Math.max(1, p.size * q.s);
    c.globalAlpha = Math.max(0, p.life / p.max);
    c.fillStyle = p.col; c.fillRect(q.x - sz / 2, q.y - sz / 2, sz, sz);
  }
  c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  drawShards(c, cam, st.shards, st.skin, t);

  // floating text pops
  for (const pp of st.pops) {
    const q = project(cam, pp.x, pp.y + pp.age * 1.6, 0);
    if (!q) continue;
    c.globalAlpha = Math.max(0, 1 - pp.age / pp.life);
    c.font = `700 ${Math.round(pp.size)}px "Chakra Petch",sans-serif`; c.textAlign = 'center';
    c.lineWidth = 4; c.strokeStyle = 'rgba(7,3,15,.8)'; c.strokeText(pp.text, q.x, q.y);
    c.fillStyle = pp.col; c.fillText(pp.text, q.x, q.y);
  }
  c.globalAlpha = 1;

  // speed lines at the edges once things get fast
  if (!st.reduced && st.speed > 10.5 && st.showRunner) {
    const k = Math.min(1, (st.speed - 10.5) / 4);
    c.strokeStyle = `rgba(255,255,255,${0.1 * k})`; c.lineWidth = 1.5; c.beginPath();
    for (let i = 0; i < 14; i++) {
      const y = hash(i, Math.floor(t * 20)) * H, len = 30 + hash(i, 3) * 60 * k;
      const x = hash(i, 5) < 0.5 ? hash(i, 6) * W * 0.15 : W - hash(i, 6) * W * 0.15;
      c.moveTo(x, y); c.lineTo(x - len, y + len * 0.08);
    }
    c.stroke();
  }
  if (st.nearFlash > 0) {
    // Neon edge spark: a cyan vignette that fades fast, no full-screen strobe.
    const a = Math.min(0.5, st.nearFlash), r = Math.max(W, H) * 0.75;
    const g = c.createRadialGradient(W / 2, H / 2, r * 0.45, W / 2, H / 2, r);
    g.addColorStop(0, 'rgba(34,240,255,0)'); g.addColorStop(1, `rgba(34,240,255,${a})`);
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  }
  if (st.flash > 0) { c.fillStyle = `rgba(255,255,255,${Math.min(0.6, st.flash)})`; c.fillRect(0, 0, W, H); }
}
