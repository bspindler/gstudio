// Hyperline's three.js renderer (quality plan, phase 2). Draws the same state object as render.js's drawScene, from
// the same camera (cameraFor), as a real lit 3D scene: emissive meshes with neon edges, exponential fog, a shader
// floor grid, sky, sun and mountains, and a bloom pass. The sim and course code are untouched; everything here reads
// state and never changes it. Text pops and the binary trail's digits are drawn on a 2D overlay canvas (drawOverlay in
// render.js) that is composited into the frame before bloom.
//
// Drawing is immediate-mode over pools: each frame, draw calls take the next pooled mesh or line from a pool and set
// it up; whatever a frame does not use is hidden. No per-object allocation in steady state.

import { magnetPull } from './lib/feel.js';
import { blockX, moverH, railLit } from './lib/sim.js';
import { bladeX, pitEnd } from './lib/course.js';
import { bestMarkShimmer } from './lib/ghost.js';
import { MESHES } from './lib/proj.js';
import { BAR_H, CEIL_Y, GRAV, JV, PS, sectorAt, speedAt } from './lib/world.js';
import { cameraFor, hueShiftHex, lightTrailAlpha, mixHex, paletteAt, sectorHueShift, shardAlpha, skinColors, squashScale, takeoffTicks } from './render.js';

export const BLOOM3D = { strength: 0.7, radius: 0.45, threshold: 0.68 };
/** Colour meaning (docs/hyperline/style-guide.md): safe is cyan, hazards magenta (static) or red (live), rewards gold. */
export const STYLE = { safe: '#22F0FF', safe2: '#2B6BFF', hazard: '#FF2BD6', live: '#FF2B5E', gold: '#FFE45C', gold2: '#FF9F1C' };
const { safe: SAFE, hazard: HAZ, live: LIVE, gold: GOLD } = STYLE;
/**
 * The runner: a Quaternius hero (the player picks M or F), HERO.height units tall, under a low ceiling's 1.05. The Large
 * runner setting draws it HERO.large units tall (the hitbox never changes), and it ducks into a crouch under low ceilings.
 */
export const HERO = { height: 0.95, large: 1.5 };
/**
 * Quality tiers. 0 is a desktop; phones start at 1. When frames run long the game steps down a tier before it lowers
 * the resolution. street: how far ahead (units) the street row is drawn; bloom: the glow's resolution, as a fraction
 * of the screen's.
 */
export const QUALITY = [{ street: 100, bloom: 1 }, { street: 70, bloom: 0.5 }, { street: 45, bloom: 0.35 }];
/** Street-level buildings: Quaternius Downtown City MegaKit (CC0), interiors and ornamental trim left out. */
export const CITY = { large: () => import('./models/city/large.js'), medium: () => import('./models/city/medium.js'), small: () => import('./models/city/small.js') };
/** The street row: one building per lot along each side of the track, facing it, CITY_LOT units apart. */
export const CITY_LOT = 13;
/** The bodies, loaded on demand (each module is the hero and its clips). */
export const BODIES = { m: () => import('./models/hero-male.js'), f: () => import('./models/hero-female.js') };
/** The outfit a locked skin's thumbnail shows: a dark silhouette. */
const LOCKED = { trim: '#3A2A6A', visor: '#3A2A6A', g: Object.fromEntries(['helmet', 'top', 'belt', 'sleeves', 'gloves', 'pants', 'boots'].map((k) => [k, { c: '#1A1033' }])) };
/** Themes by sector (style guide): towers, window colours and sign words. */
export const THEMES = [
  { name: 'Neon District', until: 7, facade: '#0C0618', win: ['#FF2BD6', '#22F0FF'], hMin: 6, hMax: 20, words: ['ARCADE', 'NOODLES', 'OPEN'] },
  { name: 'Flip City', until: 14, facade: '#05121A', win: ['#22F0FF', '#FFB347'], hMin: 9, hMax: 28, words: ['SYNTH', 'VOLT', '24/7'] },
  { name: 'Hypercore', until: Infinity, facade: '#0A0A1C', win: ['#FFFFFF', '#B98CFF'], hMin: 12, hMax: 40, words: ['CORE', 'HYPER', 'MAX'] },
];
export const themeAt = (x) => { const i = sectorAt(x); return THEMES.find((t) => i < t.until); };
const TZ = 1.15, FLOOR_Y = -3.2;
const SHAPE_MESH = { square: 'cube', hex: 'hex', diamond: 'octa' };
const hash = (i, k) => { const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };

/**
 * Resolves to the renderer, or null when three.js or WebGL is unavailable (the caller keeps the 2D renderer).
 * opts.body: 'm' or 'f', the hero to run as (setBody switches it later).
 */
export async function createRenderer3d(canvas, overlay, opts = {}) {
  let T, renderer;
  try {
    T = await import('../sdk/vendor/three.module.js');
    renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  // The runner's rig and outfit code, and the chosen body; without them the runner falls back to the skin shapes.
  let kit = null;
  try {
    const [rig, outfit, gear, body] = await Promise.all([import('./lib/rig.js'), import('./outfit3d.js'), import('./gear3d.js'), (BODIES[opts.body] || BODIES.m)()]);
    const hair = await gear.loadHair(Object.keys(gear.HAIRS)); // small; loaded once so a runner can be dressed at once
    kit = { buildRig: rig.buildRig, decodePrim: rig.decodePrim, decode: rig.decode, ...outfit, dress: gear.dress, hair, data: body.default, body: BODIES[opts.body] ? opts.body : 'm' };
    try { kit.city = (await Promise.all(Object.values(CITY).map((f) => f()))).map((m) => m.default); } catch { /* code-built towers only */ }
  } catch { /* shapes */ }
  try {
    return build(T, renderer, canvas, overlay, kit, opts);
  } catch (e) {
    try { renderer.dispose(); } catch { /* ignore */ }
    console.error('render3d: setup failed', e);
    return null;
  }
}

function build(T, renderer, canvas, overlay, kit, opts = {}) {
  let tier = Math.max(0, Math.min(QUALITY.length - 1, opts.tier | 0));
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.NoToneMapping;
  renderer.info.autoReset = false; // count the whole frame (scene, overlay and bloom passes), reset in render()
  const scene = new T.Scene();
  scene.fog = new T.Fog(0x000000, 40, 115);
  const cam = new T.PerspectiveCamera(64, 1, 0.1, 600);
  const col = new T.Color(), col2 = new T.Color();
  let W = 1, H = 1, DPR = 1;

  // ---------- lights ----------
  const hemi = new T.HemisphereLight(0x8a6cff, 0x0a0418, 0.7);
  const sunL = new T.DirectionalLight(0xffffff, 1.6);
  sunL.position.set(-0.45, 0.8, 0.55);
  scene.add(hemi, sunL, sunL.target);

  // ---------- shared geometry ----------
  const unitBox = new T.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5); // spans 0..1 on each axis
  const boxEdges = new T.LineSegmentsGeometry().fromEdgesGeometry(new T.EdgesGeometry(unitBox));
  const meshGeo = {};
  const meshEdge = {};
  for (const [name, m] of Object.entries(MESHES)) {
    const pos = [];
    for (const f of m.faces) for (let i = 1; i + 1 < f.length; i++) for (const k of [f[0], f[i], f[i + 1]]) pos.push(...m.verts[k]);
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    meshGeo[name] = g;
    meshEdge[name] = new T.LineSegmentsGeometry().fromEdgesGeometry(new T.EdgesGeometry(g, 1));
  }
  const sphereGeo = new T.IcosahedronGeometry(1, 2);
  const sphereEdge = new T.LineSegmentsGeometry().fromEdgesGeometry(new T.EdgesGeometry(new T.IcosahedronGeometry(1, 1), 1));

  // ---------- pools ----------
  const lineMats = [];
  const lineMat = (opts = {}) => {
    const m = new T.LineMaterial({ color: 0xffffff, linewidth: 2, transparent: true, depthWrite: false, toneMapped: false, worldUnits: false, ...opts });
    m.fog = true;
    lineMats.push(m);
    return m;
  };
  function pool(make) {
    const items = []; let used = 0;
    return {
      next() { if (used === items.length) items.push(make()); const it = items[used++]; it.root.visible = true; return it; },
      begin() { used = 0; },
      end() { for (let i = used; i < items.length; i++) items[i].root.visible = false; },
    };
  }
  const world = new T.Group();
  scene.add(world);

  // Boxes: a lit, emissive solid and its neon edges.
  const boxes = pool(() => {
    const mat = new T.MeshLambertMaterial({ transparent: true }); // Lambert: far cheaper per pixel on phones than PBR, and these are flat neon slabs
    const solid = new T.Mesh(unitBox, mat);
    const edges = new T.LineSegments2(boxEdges, lineMat());
    const root = new T.Group(); root.add(solid, edges); world.add(root);
    return { root, solid, edges, mat };
  });
  /** An axis-aligned box from (x0,y0,z0) to (x1,y1,z1): faces tinted col (fillA = their opacity), edges in neon. */
  // Nothing is drawn through the camera. three's wide lines break into screen-wide stripes when a segment reaches behind
  // the lens, and the camera looks down at the track, so its near plane is tilted: the top of a tall wall beside the
  // camera can be behind it while its base is still in front. Every neon segment is trimmed against the real near plane
  // (view depth NEAR_D, eye E looking along F), and a box that reaches behind it draws its edges as trimmed segments.
  const NEAR_D = 0.3, E = [0, 0, 0], F = [1, 0, 0];
  const depth = (x, y, z) => (x - E[0]) * F[0] + (y - E[1]) * F[1] + (z - E[2]) * F[2];
  function clipNear(pts) {
    let out = null;
    for (let i = 0; i < pts.length; i += 6) {
      const da = depth(pts[i], pts[i + 1], pts[i + 2]) - NEAR_D, db = depth(pts[i + 3], pts[i + 4], pts[i + 5]) - NEAR_D;
      if (da >= 0 && db >= 0) { if (out) out.push(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], pts[i + 4], pts[i + 5]); continue; }
      if (!out) out = pts.slice(0, i);
      if (da < 0 && db < 0) continue;
      const k = da / (da - db), p = [0, 1, 2].map((j) => pts[i + j] + (pts[i + 3 + j] - pts[i + j]) * k);
      if (da < 0) out.push(...p, pts[i + 3], pts[i + 4], pts[i + 5]); else out.push(pts[i], pts[i + 1], pts[i + 2], ...p);
    }
    return out || pts;
  }
  /** The 12 edges of an axis-aligned box as flat segments. */
  const boxEdgeSegs = (x0, x1, y0, y1, z0, z1) => [
    x0, y0, z0, x1, y0, z0, x0, y1, z0, x1, y1, z0, x0, y0, z1, x1, y0, z1, x0, y1, z1, x1, y1, z1,
    x0, y0, z0, x0, y1, z0, x1, y0, z0, x1, y1, z0, x0, y0, z1, x0, y1, z1, x1, y0, z1, x1, y1, z1,
    x0, y0, z0, x0, y0, z1, x1, y0, z0, x1, y0, z1, x0, y1, z0, x0, y1, z1, x1, y1, z0, x1, y1, z1,
  ];
  function box(x0, x1, y0, y1, z0, z1, c, fillA, edgeW, surface = false, alpha = 1, edgeCol = c) {
    if (x1 - x0 <= 0.001 || alpha <= 0) return;
    const b = boxes.next();
    b.root.position.set(x0, y0, z0); b.root.scale.set(x1 - x0, Math.max(0.001, y1 - y0), z1 - z0);
    col.set(c);
    if (surface) { b.mat.color.setRGB(0.02, 0.01, 0.05); b.mat.emissive.copy(col).multiplyScalar(0.05); }
    else { b.mat.color.copy(col).multiplyScalar(0.55); b.mat.emissive.copy(col).multiplyScalar(0.32); }
    b.mat.opacity = fillA * alpha; b.solid.visible = fillA > 0;
    b.mat.depthWrite = fillA * alpha > 0.85;
    const lm = b.edges.material; lm.color.set(edgeCol); lm.linewidth = edgeW * DPR; lm.opacity = alpha;
    let behind = false;
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) if (depth(x, y, z) < NEAR_D) behind = true;
    b.edges.visible = edgeW > 0 && !behind;
    if (edgeW > 0 && behind) segs(boxEdgeSegs(x0, x1, y0, y1, z0, z1), edgeCol, edgeW, alpha, false);
  }

  // Free line sets: segments given as flat [x0,y0,z0, x1,y1,z1, ...].
  const lines = pool(() => {
    const geo = new T.LineSegmentsGeometry();
    const ls = new T.LineSegments2(geo, lineMat());
    ls.frustumCulled = false;
    world.add(ls);
    return { root: ls, geo, cap: 0 };
  });
  function segs(pts, c, w, alpha = 1, additive = true) {
    pts = clipNear(pts);
    if (pts.length < 6 || alpha <= 0) return;
    const l = lines.next();
    // setPositions keeps the array it is given, so the buffer is reused until a frame needs more room.
    const need = pts.length;
    if (need > l.cap) { l.cap = Math.max(need, l.cap * 2, 24); l.buf = new Float32Array(l.cap); l.geo.setPositions(l.buf); }
    l.buf.set(pts);
    l.geo.attributes.instanceStart.data.needsUpdate = true;
    l.geo.instanceCount = need / 6;
    const m = l.root.material; m.color.set(c); m.linewidth = w * DPR; m.opacity = alpha;
    m.blending = additive ? T.AdditiveBlending : T.NormalBlending;
  }

  // Meshes from MESHES (runner shapes, spikes, chips), flat shaded with neon edges.
  const meshes = pool(() => {
    const mat = new T.MeshLambertMaterial({ flatShading: true, transparent: true });
    const solid = new T.Mesh(meshGeo.cube, mat);
    const edges = new T.LineSegments2(meshEdge.cube, lineMat());
    const root = new T.Group(); root.add(solid, edges); world.add(root);
    return { root, solid, edges, mat };
  });
  function mesh(name, pos, scale, rot, a, b, alpha = 1, wire = false, edge = '') {
    const m = meshes.next();
    const sphere = name === 'sphere';
    m.solid.geometry = sphere ? sphereGeo : meshGeo[name]; m.edges.geometry = sphere ? sphereEdge : meshEdge[name];
    m.root.position.set(pos[0], pos[1], pos[2]); m.root.scale.set(scale[0], scale[1], scale[2]);
    m.root.rotation.set(rot[0], rot[1], rot[2], 'ZYX'); // rotateXYZ in proj.js turns about x, then y, then z
    m.solid.visible = !wire;
    col.set(a); col2.set(b);
    m.mat.color.copy(col).lerp(col2, 0.35); m.mat.emissive.copy(col2).multiplyScalar(0.45);
    m.mat.opacity = alpha; m.mat.depthWrite = alpha > 0.9;
    const lm = m.edges.material;
    lm.color.set(edge || (wire ? a : mixHex(a, '#FFFFFF', 0.5))); lm.linewidth = (edge ? 1.8 : 1.4) * DPR; lm.opacity = alpha;
    m.edges.visible = depth(pos[0], pos[1], pos[2]) - Math.max(scale[0], scale[1], scale[2]) > NEAR_D; // small: drop its edges near the lens
  }

  // ---------- sky, sun, stars, mountains, floor ----------
  const skyMat = new T.ShaderMaterial({
    uniforms: { c0: { value: new T.Color() }, c1: { value: new T.Color() }, c2: { value: new T.Color() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 c0; uniform vec3 c1; uniform vec3 c2; varying vec3 vDir;
      void main(){ float h = clamp(vDir.y, -0.2, 1.0); vec3 c = h > 0.12 ? mix(c1, c0, smoothstep(0.12, 0.6, h)) : mix(c2, c1, smoothstep(-0.02, 0.12, h));
        gl_FragColor = vec4(c, 1.0); }`,
    side: T.BackSide, depthWrite: false, fog: false,
  });
  const sky = new T.Mesh(new T.SphereGeometry(500, 24, 16), skyMat);
  sky.renderOrder = -10; scene.add(sky);

  const starGeo = new T.BufferGeometry();
  { const p = []; for (let i = 0; i < 160; i++) { const az = hash(i, 1) * Math.PI * 2, el = 0.08 + hash(i, 2) * 1.2; p.push(Math.cos(az) * Math.cos(el) * 480, Math.sin(el) * 480, Math.sin(az) * Math.cos(el) * 480); }
    starGeo.setAttribute('position', new T.Float32BufferAttribute(p, 3)); }
  const starMat = new T.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.6, fog: false, depthWrite: false });
  const stars = new T.Points(starGeo, starMat); stars.renderOrder = -9; scene.add(stars);

  const sunMat = new T.ShaderMaterial({
    uniforms: { a: { value: new T.Color() }, b: { value: new T.Color() }, cut: { value: new T.Color() } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 a; uniform vec3 b; uniform vec3 cut; varying vec2 vUv;
      void main(){ vec2 p = vUv * 2.0 - 1.0; float r = length(p) * 2.2; // the disc is r < 1, the halo reaches r = 2.2
        if (r > 2.2) discard;
        vec3 sunC = mix(b, a, clamp(p.y * 1.1 + 0.5, 0.0, 1.0));
        float halo = (1.0 - smoothstep(0.85, 2.2, r)) * 0.35;
        float disc = 1.0 - smoothstep(0.98, 1.0, r);
        float yy = -p.y * 2.2; // 0 at centre, 1 at the bottom of the disc
        float band = 0.0; for (int i = 0; i < 6; i++) { float y0 = 0.05 + float(i) * 0.16; float h = 0.012 + float(i) * 0.012; band = max(band, step(y0, yy) * step(yy, y0 + h)); }
        vec3 c = mix(b * halo, sunC * 0.85, disc * (1.0 - band));
        float al = max(halo, disc * (1.0 - band));
        gl_FragColor = vec4(c, al); }`,
    transparent: true, depthWrite: false, fog: false,
  });
  const sun = new T.Mesh(new T.PlaneGeometry(1, 1), sunMat); sun.renderOrder = -8; scene.add(sun);

  const mtnMat = new T.ShaderMaterial({
    uniforms: { fill: { value: new T.Color() }, edge: { value: new T.Color() }, off: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 fill; uniform vec3 edge; uniform float off; varying vec2 vUv;
      float h1(float i){ return fract(sin(i * 12.9898 + 7.0 * 78.233) * 43758.5453); }
      float ht(float u){ float i = floor(u), f = fract(u); float a = (0.25 + h1(i) * 0.75) * (0.6 + 0.4 * sin(i * 0.37)); float b = (0.25 + h1(i + 1.0) * 0.75) * (0.6 + 0.4 * sin((i + 1.0) * 0.37)); return mix(a, b, f); }
      void main(){ float u = vUv.x * 60.0 + off; float h = 0.08 + ht(u) * 0.8; float y = vUv.y;
        if (y > h) discard;
        float e = 1.0 - smoothstep(0.0, 0.025, h - y);
        gl_FragColor = vec4(mix(fill, edge, e), 1.0); }`,
    depthWrite: false, fog: false,
  });
  const mtn = new T.Mesh(new T.PlaneGeometry(1, 1), mtnMat); mtn.renderOrder = -7; scene.add(mtn);

  const floorMat = new T.ShaderMaterial({
    uniforms: { grid: { value: new T.Color() }, base: { value: new T.Color() }, horizon: { value: new T.Color() }, eye: { value: new T.Vector3() } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform vec3 grid; uniform vec3 base; uniform vec3 horizon; uniform vec3 eye; varying vec3 vW;
      void main(){ vec2 g = abs(fract(vW.xz * 0.5 + 0.5) - 0.5) / fwidth(vW.xz * 0.5);
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        float d = length(vW.xz - eye.xz);
        float fogK = smoothstep(30.0, 150.0, d);
        vec3 c = base + grid * line * 0.55 * (1.0 - fogK);
        gl_FragColor = vec4(mix(c, horizon, fogK), 1.0); }`,
    fog: false,
  });
  const floor = new T.Mesh(new T.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), floorMat);
  floor.position.y = FLOOR_Y; floor.renderOrder = -6; scene.add(floor);

  // ---------- runner glow, contact shadow ----------
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64); const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t; })();
  const glow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.3, toneMapped: false }));
  world.add(glow);
  const shadow = new T.Mesh(new T.CircleGeometry(1, 24).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false, side: T.DoubleSide }));
  world.add(shadow);

  // ---------- the runner: a Quaternius hero in an outfit (style guide) ----------
  /** The hero in the chosen body: an outfit material on the body (eyes and brows hidden under the helmet), or a wireframe ghost. */
  function makeRunner(ghost, parent = world, lookId = 'volt') {
    if (!kit) return null;
    const look = kit.OUTFITS[lookId] || kit.OUTFITS.volt;
    const suit = ghost ? null : kit.outfitMaterial(T);
    const ghostMat = ghost ? new T.MeshBasicMaterial({ color: SAFE, transparent: true, opacity: 0.3, wireframe: true, depthWrite: false, toneMapped: false }) : null;
    const rig = kit.buildRig(T, kit.data, () => (ghost ? ghostMat : suit));
    let headTop = 1.8, gear = null;
    for (const m of rig.meshes) {
      if (/superhero/i.test(m.name)) { const top = kit.tagParts(T, m); headTop = top; if (suit) kit.setVisor(suit, top); }
      else m.visible = false; // the outfit's helmet, or its hair, brows and shades, replace the model's eyes and brows
    }
    // hair and accessories go on while the rig is at rest and unscaled (gear3d.js)
    if (!ghost) gear = kit.dress(T, rig, look, kit.body, kit.hair, headTop);
    const holder = new T.Group(), flipper = new T.Group(), sc = HERO.height / headTop;
    rig.root.scale.setScalar(sc);
    rig.root.rotation.y = Math.PI / 2; // face down the track (+x)
    flipper.add(rig.root); holder.add(flipper); parent.add(holder);
    rig.root.traverse((part) => { part.frustumCulled = false; });
    rig.actions.run.play();
    return { holder, flipper, rig, suit, ghostMat, gear, look, lookId, cur: rig.actions.run, mode: 'run', lastT: null };
  }
  let runnerR = makeRunner(false), ghostR = makeRunner(true);
  /** Picks the clip: idle on the start line, run on the ground, the airborne loop in the air, a crouch-run to duck. */
  function animate(R, phase, airborne, speed, t, duck = false) {
    const A = R.rig.actions;
    const dt = R.lastT === null ? 0 : Math.max(0, Math.min(0.1, t - R.lastT)); R.lastT = t;
    const want = phase === 'ready' ? 'idle' : airborne ? 'jump' : duck && A.crouch ? 'crouch' : 'run';
    if (want !== R.mode) {
      const next = A[want];
      next.reset(); next.setLoop(T.LoopRepeat, Infinity); next.timeScale = 1;
      next.play(); R.cur.crossFadeTo(next, want === 'jump' ? 0.06 : 0.1, false); R.cur = next; R.mode = want;
    }
    if (want === 'run') A.run.timeScale = speed / 11; // the stride keeps up with the track
    if (want === 'crouch') A.crouch.timeScale = speed / 5;
    R.rig.mixer.update(dt);
  }
  /** Feet on the surface (the ceiling, upside down, in a flip), squash about the feet. */
  function placeRunner(R, x, y, flip, sx, sy) {
    R.holder.position.set(x, flip ? y + PS : y, 0);
    R.flipper.rotation.x = flip ? Math.PI : 0;
    R.holder.scale.set(sx, sy, sx);
  }
  function dropRunner(R) {
    if (!R) return;
    if (R.gear) R.gear.dispose();
    R.holder.parent && R.holder.parent.remove(R.holder);
    R.rig.root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    if (R.suit) R.suit.dispose();
    if (R.ghostMat) R.ghostMat.dispose();
  }

  // ---------- skyline: towers with lit windows, and neon signs (style guide, themes) ----------
  const TOWERS = 44, TSPACE = 8.5;
  const towerMat = new T.ShaderMaterial({
    uniforms: { facade: { value: new T.Color() }, w0: { value: new T.Color() }, w1: { value: new T.Color() }, fogC: { value: new T.Color() }, eye: { value: new T.Vector3() }, lit: { value: 0.45 } },
    vertexShader: `varying vec3 vW; varying vec3 vN; flat varying float vId;
      void main(){ vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(instanceMatrix) * normal); vId = float(gl_InstanceID); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 facade; uniform vec3 w0; uniform vec3 w1; uniform vec3 fogC; uniform vec3 eye; uniform float lit; varying vec3 vW; varying vec3 vN; flat varying float vId;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + vId * 3.17) * 43758.5453); }
      void main(){
        vec3 c = facade;
        if (abs(vN.y) < 0.5) {
          float along = abs(vN.x) > 0.5 ? vW.z : vW.x;
          vec2 cell = floor(vec2(along / 1.3, vW.y / 1.6)), f = fract(vec2(along / 1.3, vW.y / 1.6));
          float on = step(1.0 - lit, h(cell)) * step(0.22, f.x) * step(f.x, 0.78) * step(0.25, f.y) * step(f.y, 0.7);
          c = mix(c, mix(w0, w1, step(0.5, h(cell + 7.0))) * 0.9, on);
        } else c = facade * 1.6;
        float d = length(vW - eye);
        gl_FragColor = vec4(mix(c, fogC, smoothstep(45.0, 175.0, d) * 0.85), 1.0);
      }`,
  });
  const towers = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), towerMat, TOWERS);
  towers.frustumCulled = false; towers.renderOrder = -5; scene.add(towers);
  const signTex = new Map();
  const signTexture = (word, c) => {
    const key = word + c; if (signTex.has(key)) return signTex.get(key);
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 72; const g = cv.getContext('2d');
    g.font = '700 54px "Chakra Petch", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = c; g.shadowBlur = 14; g.fillStyle = c; g.fillText(word, 128, 38); g.shadowBlur = 0; g.fillStyle = '#FFFFFF'; g.globalAlpha = 0.65; g.fillText(word, 128, 38);
    const tx = new T.CanvasTexture(cv); tx.colorSpace = T.SRGBColorSpace; signTex.set(key, tx); return tx;
  };
  const signs = pool(() => {
    const m = new T.Mesh(new T.PlaneGeometry(1, 72 / 256), new T.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, side: T.DoubleSide }));
    m.renderOrder = -4; scene.add(m); return { root: m };
  });
  // ---------- the street row: Downtown City MegaKit buildings (walls and glass), instanced ----------
  // Walls: the theme's facade colour, trim a little lighter, lit from the key light; glass: each pane lit or dark at
  // random in the theme's window colours. Both fog into the horizon like the towers behind.
  const cityShader = (glass) => new T.ShaderMaterial({
    uniforms: { facade: { value: new T.Color() }, w0: { value: new T.Color() }, w1: { value: new T.Color() }, fogC: { value: new T.Color() }, eye: { value: new T.Vector3() } },
    vertexShader: `attribute float shade; varying vec3 vW; varying vec3 vN; varying float vS; flat varying float vId;
      void main(){ vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(instanceMatrix) * normal); vS = shade; vId = float(gl_InstanceID); gl_Position = projectionMatrix * viewMatrix * w; }`,
    // glass: shade carries each pane's own random number (panes are found at build time), so whole windows light up
    fragmentShader: `uniform vec3 facade; uniform vec3 w0; uniform vec3 w1; uniform vec3 fogC; uniform vec3 eye; varying vec3 vW; varying vec3 vN; varying float vS; flat varying float vId;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + vId * 3.17) * 43758.5453); }
      void main(){
        vec3 c;
        ${glass ? `float r = fract(vS * 7.31 + vId * 0.6180339);
          float on = step(0.42, r); c = mix(vec3(0.03, 0.02, 0.07), mix(w0, w1, step(0.72, fract(r * 13.7))) * 0.95, on);`
          : `float l = 0.45 + 0.55 * max(0.0, dot(vN, normalize(vec3(-0.45, 0.8, 0.55)))); c = facade * l * mix(1.0, 2.2, vS);`}
        float d = length(vW - eye);
        gl_FragColor = vec4(mix(c, fogC, smoothstep(40.0, 150.0, d) * 0.85), 1.0);
      }`,
  });
  const cityFacade = cityShader(false), cityGlass = cityShader(true), CITY_MAX = 12;
  /** A random number per window: the glass mesh's connected pieces (vertices welded by position), grouped into windows. */
  function paneRandoms(g) {
    const pos = g.attributes.position, idx = g.index.array, n = pos.count, parent = new Int32Array(n).map((_, i) => i), weld = new Map();
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const join = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
    for (let i = 0; i < n; i++) { const k = `${Math.round(pos.getX(i) * 100)},${Math.round(pos.getY(i) * 100)},${Math.round(pos.getZ(i) * 100)}`; if (weld.has(k)) join(i, weld.get(k)); else weld.set(k, i); }
    for (let t = 0; t < idx.length; t += 3) { join(idx[t], idx[t + 1]); join(idx[t], idx[t + 2]); }
    // a window is several panes split by mullions: group pieces by where their centres fall on a window-sized grid
    // (about 1.6 m wide, one 3.2 m floor tall) so a whole window lights or goes dark together
    const sum = new Map();
    for (let i = 0; i < n; i++) { const r = find(i), c = sum.get(r) || [0, 0, 0, 0]; c[0] += pos.getX(i); c[1] += pos.getY(i); c[2] += pos.getZ(i); c[3]++; sum.set(r, c); }
    const rand = new Map();
    for (const [r, c] of sum) rand.set(r, hash(Math.floor(c[0] / c[3] / 1.6) * 7.1 + Math.floor(c[2] / c[3] / 1.6) * 3.3, Math.floor(c[1] / c[3] / 3.2) + 31));
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = rand.get(find(i));
    return out;
  }
  /** One building type: merged walls and merged glass, each an InstancedMesh; footprint for placing it. */
  const cityTypes = (kit && kit.city ? kit.city : []).map((data) => {
    const walls = [], glass = [];
    for (const m of data.meshes) for (const p of m.prims) {
      const d = kit.decodePrim(p), g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(d.pos, 3)); g.setAttribute('normal', new T.BufferAttribute(d.nrm, 3));
      g.setIndex(new T.BufferAttribute(kit.decode(p.idx, p.idx32 ? 'u32' : 'u16'), 1));
      if (/glass/i.test(p.mat)) glass.push(g);
      else { g.setAttribute('shade', new T.BufferAttribute(new Float32Array(d.pos.length / 3).fill(/trim|concrete/i.test(p.mat) ? 1 : 0), 1)); walls.push(g); }
    }
    for (const g of glass) g.setAttribute('shade', new T.BufferAttribute(paneRandoms(g), 1));
    const merge = (gs) => (gs.length ? T.mergeGeometries(gs) : null);
    const wg = merge(walls), gg = merge(glass);
    const box = new T.Box3(); for (const g of [wg, gg]) if (g) { g.computeBoundingBox(); box.union(g.boundingBox); }
    const mk = (g, mat) => { if (!g) return null; const im = new T.InstancedMesh(g, mat, CITY_MAX); im.frustumCulled = false; im.renderOrder = -5; im.count = 0; scene.add(im); return im; };
    return { walls: mk(wg, cityFacade), glass: mk(gg, cityGlass), box, n: 0 };
  });
  const cityQ = new T.Quaternion(), cityFlip = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI);

  const tmpM = new T.Matrix4(), tmpQ = new T.Quaternion(), tmpS = new T.Vector3(), tmpP = new T.Vector3();
  function skyline(rx, theme, reduced) {
    signs.begin();
    const k0 = Math.floor((rx - 12) / TSPACE);
    for (let i = 0; i < TOWERS; i++) {
      const k = k0 + (i >> 1), side = i & 1 ? 1 : -1, seed = k * 2 + (i & 1);
      const hgt = theme.hMin + hash(seed, 3) ** 1.6 * (theme.hMax - theme.hMin), wd = 4 + hash(seed, 4) * 5, dp = 4 + hash(seed, 5) * 5;
      const back = cityTypes.length ? 1.45 : 1; // behind the street row, the towers are the taller skyline
      const z = side * (cityTypes.length ? 34 + hash(seed, 6) * 30 : 18 + hash(seed, 6) * 28), x = k * TSPACE + hash(seed, 7) * 3;
      tmpP.set(x, FLOOR_Y, z); tmpS.set(wd, hgt * back, dp); tmpM.compose(tmpP, tmpQ, tmpS); towers.setMatrixAt(i, tmpM);
      if (!cityTypes.length && hash(seed, 8) < 0.3 && x > rx + 8) {
        const sgn = signs.next().root, word = theme.words[Math.floor(hash(seed, 9) * theme.words.length)], c = theme.win[hash(seed, 10) < 0.5 ? 0 : 1];
        sgn.material.map = signTexture(word, c); sgn.material.needsUpdate = sgn.userData.key !== word + c; sgn.userData.key = word + c;
        const sw = Math.min(dp * 0.9, 6);
        sgn.scale.set(sw, sw, 1); sgn.position.set(x - wd / 2 - 0.05, FLOOR_Y + hgt * (0.55 + hash(seed, 11) * 0.3), z);
        sgn.rotation.set(0, -Math.PI / 2, 0); // on the face that looks back at the runner, so it reads as you approach
        sgn.material.opacity = reduced ? 0.85 : 0.75 + 0.25 * (hash(seed, 12) < 0.15 ? Math.abs(Math.sin(rx * 0.9 + seed)) : 1);
      }
    }
    towers.instanceMatrix.needsUpdate = true;

    // the street row: lots from just behind the camera to the fog, both sides, a kit building on each
    for (const ct of cityTypes) ct.n = 0;
    if (cityTypes.length) {
      const l0 = Math.floor((rx - 12) / CITY_LOT), l1 = Math.floor((rx + QUALITY[tier].street) / CITY_LOT);
      for (let k = l0; k <= l1; k++) for (const side of [-1, 1]) {
        const seed = k * 2 + (side > 0 ? 1 : 0), ct = cityTypes[Math.floor(hash(seed, 21) * cityTypes.length)];
        if (ct.n >= CITY_MAX || hash(seed, 22) < 0.12) continue; // the odd empty lot
        const bw = ct.box.max.x - ct.box.min.x, sc = Math.min(0.62, (CITY_LOT - 1.2) / bw) * (0.85 + 0.15 * hash(seed, 23));
        const cx = -(ct.box.min.x + ct.box.max.x) / 2, dist = 12.5 + hash(seed, 24) * 4;
        // the front (local z = 0, facing +z) toward the track: as is on the far side, turned round on the near side
        const q = side < 0 ? cityQ : cityFlip, x = k * CITY_LOT + CITY_LOT / 2;
        tmpP.set(cx * sc * (side < 0 ? 1 : -1), 0, 0).add(new T.Vector3(x, FLOOR_Y, side * dist));
        tmpS.set(sc, sc, sc); tmpM.compose(tmpP, q, tmpS);
        if (ct.walls) ct.walls.setMatrixAt(ct.n, tmpM);
        if (ct.glass) ct.glass.setMatrixAt(ct.n, tmpM);
        ct.n++;
        if (hash(seed, 8) < 0.35 && x > rx + 8) {
          const sgn = signs.next().root, word = theme.words[Math.floor(hash(seed, 9) * theme.words.length)], c = theme.win[hash(seed, 10) < 0.5 ? 0 : 1];
          sgn.material.map = signTexture(word, c); sgn.material.needsUpdate = sgn.userData.key !== word + c; sgn.userData.key = word + c;
          const hgt = (ct.box.max.y - ct.box.min.y) * sc, sw = Math.min(5, (ct.box.max.z - ct.box.min.z) * sc * 0.8);
          sgn.scale.set(sw, sw, 1); sgn.position.set(x - (bw * sc) / 2 - 0.08, FLOOR_Y + hgt * (0.45 + hash(seed, 11) * 0.35), side * (dist + (ct.box.max.z - ct.box.min.z) * sc * 0.5));
          sgn.rotation.set(0, -Math.PI / 2, 0); // on the side wall that looks back at the runner
          sgn.material.opacity = reduced ? 0.85 : 0.75 + 0.25 * (hash(seed, 12) < 0.15 ? Math.abs(Math.sin(rx * 0.9 + seed)) : 1);
        }
      }
    }
    for (const ct of cityTypes) for (const im of [ct.walls, ct.glass]) if (im) { im.count = ct.n; im.instanceMatrix.needsUpdate = true; }
    signs.end();
  }

  // ---------- particles (and the classic trail's squares) ----------
  const PMAX = 700;
  const pGeo = new T.BufferGeometry();
  const pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 3), pSize = new Float32Array(PMAX), pAl = new Float32Array(PMAX);
  pGeo.setAttribute('position', new T.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new T.BufferAttribute(pCol, 3));
  pGeo.setAttribute('size', new T.BufferAttribute(pSize, 1)); pGeo.setAttribute('alpha', new T.BufferAttribute(pAl, 1));
  const pMat = new T.ShaderMaterial({
    uniforms: { scale: { value: 1 } },
    vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; uniform float scale; varying vec3 vC; varying float vA;
      void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = max(1.0, size * scale / -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: 'varying vec3 vC; varying float vA; void main(){ gl_FragColor = vec4(vC * vA, vA); }',
    transparent: true, depthWrite: false, blending: T.AdditiveBlending,
  });
  const points = new T.Points(pGeo, pMat); points.frustumCulled = false; world.add(points);
  let pN = 0;
  /** 0 within 2.2 units of the camera, 1 from 4.5 on: trails and particles fade out before they reach the lens
   *  (a light trail behind a runner launched above the camera otherwise swept the top of the screen). */
  const lensFade = (x, y, z = 0) => Math.max(0, Math.min(1, (depth(x, y, z) - NEAR_D - 2.2) / 2.3));
  const pt = (x, y, z, c, size, alpha) => {
    alpha *= lensFade(x, y, z);
    if (pN >= PMAX || alpha <= 0) return;
    col.set(c); pPos.set([x, y, z], pN * 3); pCol.set([col.r, col.g, col.b], pN * 3); pSize[pN] = size; pAl[pN] = alpha; pN++;
  };

  // ---------- ribbons (trails, light trail) ----------
  const ribbons = pool(() => {
    const geo = new T.BufferGeometry();
    const cap = 64;
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array(cap * 2 * 3), 3));
    geo.setAttribute('color', new T.BufferAttribute(new Float32Array(cap * 2 * 4), 4));
    const idx = []; for (let i = 0; i < cap - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    const m = new T.Mesh(geo, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, toneMapped: false }));
    m.frustumCulled = false; world.add(m);
    return { root: m, geo, cap };
  });
  /** A strip through pts [{x, y, w (half width), c, a}] in the track plane z = 0. */
  function ribbon(pts) {
    pts = pts.filter((p) => lensFade(p.x, p.y) > 0).map((p) => ({ ...p, a: p.a * lensFade(p.x, p.y) }));
    if (pts.length < 2) return;
    const r = ribbons.next(), n = Math.min(pts.length, r.cap);
    const P = r.geo.attributes.position.array, C = r.geo.attributes.color.array;
    for (let i = 0; i < n; i++) {
      const p = pts[pts.length - n + i];
      P.set([p.x, p.y + p.w, 0, p.x, p.y - p.w, 0], i * 6);
      col.set(p.c); C.set([col.r, col.g, col.b, p.a, col.r, col.g, col.b, p.a], i * 8);
    }
    r.geo.setDrawRange(0, (n - 1) * 6);
    r.geo.attributes.position.needsUpdate = true; r.geo.attributes.color.needsUpdate = true;
  }

  // ---------- screen-space layer: overlay canvas, speed lines, flashes ----------
  const ortho = new T.OrthographicCamera(0, 1, 1, 0, -1, 1);
  const screen = new T.Scene();
  const ovTex = new T.CanvasTexture(overlay); ovTex.colorSpace = T.SRGBColorSpace; ovTex.minFilter = T.LinearFilter; ovTex.generateMipmaps = false;
  const ovQuad = new T.Mesh(new T.PlaneGeometry(1, 1).translate(0.5, 0.5, 0), new T.MeshBasicMaterial({ map: ovTex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  screen.add(ovQuad);
  const flashQuad = new T.Mesh(new T.PlaneGeometry(1, 1).translate(0.5, 0.5, 0), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  const vigMat = new T.ShaderMaterial({
    uniforms: { a: { value: 0 }, aspect: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform float a; uniform float aspect; varying vec2 vUv; void main(){ vec2 p = (vUv - 0.5) * vec2(aspect, 1.0); float r = length(p) / max(aspect, 1.0) * 1.33; float k = smoothstep(0.45, 1.0, r); gl_FragColor = vec4(0.133, 0.94, 1.0, a * k); }',
    transparent: true, depthTest: false, depthWrite: false,
  });
  const vigQuad = new T.Mesh(new T.PlaneGeometry(1, 1).translate(0.5, 0.5, 0), vigMat);
  const speedGeo = new T.BufferGeometry(); speedGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(14 * 2 * 3), 3));
  const speed = new T.LineSegments(speedGeo, new T.LineBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false, toneMapped: false }));
  speed.frustumCulled = false;
  screen.add(speed, vigQuad, flashQuad);

  // ---------- composer ----------
  // The scene renders into a 4x multisampled buffer: the bloom chain draws into render targets, which the renderer's
  // own antialias flag doesn't reach, and without it every neon edge is jagged (grainy on a phone's dense screen).
  const msaa = new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, samples: 4 });
  const composer = new T.EffectComposer(renderer, msaa);
  composer.addPass(new T.RenderPass(scene, cam));
  const screenPass = new T.RenderPass(screen, ortho); screenPass.clear = false; screenPass.clearDepth = true;
  composer.addPass(screenPass);
  const bloom = new T.UnrealBloomPass(new T.Vector2(2, 2), BLOOM3D.strength, BLOOM3D.radius, BLOOM3D.threshold);
  // a lower quality tier blurs the glow at a fraction of the screen's resolution (the glow is soft anyway)
  const bloomSetSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => bloomSetSize(Math.max(2, Math.round(w * QUALITY[tier].bloom)), Math.max(2, Math.round(h * QUALITY[tier].bloom)));
  composer.addPass(bloom);
  composer.addPass(new T.OutputPass());

  let lost = () => {};
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost(); });

  function render(st) {
    let pal = paletteAt(st.rx);
    const hs = st.reduced ? 0 : sectorHueShift(st.rx);
    if (hs) pal = { ...pal, grid: hueShiftHex(pal.grid, hs), rail: hueShiftHex(pal.rail, hs) };
    const c2 = cameraFor(st, W, H), t = st.t, rx = st.rx, r = st.runner;
    cam.fov = 2 * Math.atan(H / 2 / c2.focal) * 180 / Math.PI; cam.aspect = W / H; cam.updateProjectionMatrix();
    cam.position.set(...c2.eye); cam.up.set(0, 1, 0); cam.lookAt(c2.eye[0] + c2.f[0], c2.eye[1] + c2.f[1], c2.eye[2] + c2.f[2]);

    renderer.info.reset();
    E[0] = c2.eye[0]; E[1] = c2.eye[1]; E[2] = c2.eye[2]; F[0] = c2.f[0]; F[1] = c2.f[1]; F[2] = c2.f[2];
    boxes.begin(); lines.begin(); meshes.begin(); ribbons.begin(); pN = 0;

    // backdrop
    skyMat.uniforms.c0.value.set(pal.sky[0]); skyMat.uniforms.c1.value.set(pal.sky[1]); skyMat.uniforms.c2.value.set(pal.sky[2]);
    sky.position.copy(cam.position); stars.position.copy(cam.position);
    starMat.opacity = st.reduced ? 0.6 : 0.45 + 0.2 * Math.sin(t * 2);
    scene.fog.color.set(mixHex(pal.sky[2], '#000000', 0.35));
    const fwd = new T.Vector3(c2.f[0], 0, c2.f[2]).normalize();
    const SUN_D = 330, sunR = 34;
    sun.position.set(cam.position.x + fwd.x * SUN_D + 40, cam.position.y + sunR * 0.55, cam.position.z + fwd.z * SUN_D);
    sun.lookAt(cam.position); sun.scale.setScalar(sunR * 2 * 2.2);
    sunMat.uniforms.a.value.set(pal.sun[0]); sunMat.uniforms.b.value.set(pal.sun[1]); sunMat.uniforms.cut.value.set(pal.sky[2]);
    const MTN_D = 300;
    mtn.position.set(cam.position.x + fwd.x * MTN_D, FLOOR_Y + 26, cam.position.z + fwd.z * MTN_D);
    mtn.lookAt(cam.position.x, FLOOR_Y + 26, cam.position.z); mtn.scale.set(1400, 70, 1);
    mtnMat.uniforms.fill.value.set(mixHex(pal.sky[0], pal.sky[2], 0.3)); mtnMat.uniforms.edge.value.set(pal.grid); mtnMat.uniforms.off.value = rx * 0.05;
    const theme = themeAt(rx);
    towerMat.uniforms.facade.value.set(theme.facade); towerMat.uniforms.w0.value.set(theme.win[0]); towerMat.uniforms.w1.value.set(theme.win[1]);
    towerMat.uniforms.fogC.value.copy(scene.fog.color); towerMat.uniforms.eye.value.copy(cam.position);
    for (const m of [cityFacade, cityGlass]) { const u = m.uniforms; u.facade.value.set(theme.facade).multiplyScalar(2.2); u.w0.value.set(theme.win[0]); u.w1.value.set(theme.win[1]); u.fogC.value.copy(scene.fog.color); u.eye.value.copy(cam.position); }
    skyline(rx, theme, st.reduced);
    floor.position.x = Math.floor(rx / 2) * 2; floor.position.z = 0;
    floorMat.uniforms.grid.value.set(pal.grid); floorMat.uniforms.base.value.set(mixHex(pal.sky[2], '#000000', 0.7));
    floorMat.uniforms.horizon.value.copy(scene.fog.color); floorMat.uniforms.eye.value.copy(cam.position);

    // track segments between pits
    const objs = st.course.objs, near = rx - 7, far = rx + 110;
    const rcx = r.x + PS / 2;
    const pits = [];
    for (const o of objs) { if (o.x > far) break; if (o.t === 'pit' && pitEnd(o, r.x) > near && !(o.c && rcx < o.x - o.drop)) pits.push(o); }
    const tsegs = [];
    let a = near;
    for (const p of pits) { if (p.x > a) tsegs.push([a, p.x]); a = Math.max(a, pitEnd(p, r.x)); }
    if (a < far) tsegs.push([a, far]);
    for (const [x0, x1] of tsegs) {
      box(x0, x1, -0.38, 0, -TZ, TZ, SAFE, 1, 1.2, true);
      const L = [];
      for (let x = Math.ceil(x0); x < x1; x += 2) L.push(x, 0.002, -TZ, x, 0.002, TZ);
      L.push(x0, 0.002, 0, x1, 0.002, 0);
      segs(L, SAFE, 1, 0.28);
      segs([x0, 0, TZ, x1, 0, TZ, x0, 0, -TZ, x1, 0, -TZ], SAFE, 2.4, 1);
    }

    // take-off ticks
    if (!r.flip) { const L = []; let al = 0; for (const k of takeoffTicks(objs, rcx)) { L.push(k.x, 0.006, -TZ * 0.8, k.x, 0.006, TZ * 0.8); al = Math.max(al, k.a); } segs(L, SAFE, 1.6, al); }

    // objects
    for (const o of objs) {
      if (o.x > far) break;
      const w = o.w || 0.8;
      if (o.x + w < rx - 6) continue;
      switch (o.t) {
        case 'block': {
          const bx = blockX(o, r.x);
          if (o.f !== undefined) {
            const left = o.f - r.x, lift = left > 0 ? Math.min(1, left / 7) * 9 : 0;
            if (left > 0) box(bx, bx + o.w, 0, 0.04, -1, 1, SAFE, 0.35, 1);
            box(bx, bx + o.w, lift, lift + o.h, -1, 1, SAFE, 1, 2);
          } else box(bx, bx + o.w, 0, o.h, -1, 1, SAFE, 1, 2);
          break;
        }
        case 'blade': {
          const bx = bladeX(o, r.x), px = o.x + o.amp + o.w / 2, top = o.h + 4;
          box(bx, bx + o.w, 0, o.h, -1, 1, HAZ, 1, 2);
          segs([px, top, -1, bx + o.w / 2, o.h, -1, px, top, 1, bx + o.w / 2, o.h, 1, px - 0.4, top, -1, px + 0.4, top, -1, px - 0.4, top, 1, px + 0.4, top, 1], HAZ, 1.6, 0.55);
          break;
        }
        case 'spike': {
          const rise = o.f === undefined ? 1 : Math.max(0.02, Math.min(1, 1 - (o.f - r.x) / 1.6));
          if (rise < 1) box(o.x + 0.04, o.x + 0.76, 0, 0.04, -1, 1, HAZ, 0.35, 1);
          for (const zz of [-0.52, 0.52]) mesh('pyramid', [o.x + 0.4, o.inv ? o.y - 0.4 * rise : o.y + 0.4 * rise, zz], [0.76, 0.8 * rise, 0.92], [o.inv ? Math.PI : 0, 0, 0], mixHex(HAZ, '#12051F', 0.55), mixHex(HAZ, '#12051F', 0.85), 1, false, HAZ);
          break;
        }
        case 'bar': {
          box(o.x, o.x + o.w, o.y, o.y + BAR_H, -1.3, 1.3, HAZ, 0.55, 2);
          const L = []; for (let k = 0.3; k < BAR_H; k += 0.45) L.push(o.x, o.y + k, -1.3, o.x, o.y + k, 1.3);
          segs(L, HAZ, 1, 0.45);
          segs([o.x, o.y, -1.3, o.x, o.y, 1.3, o.x, o.y, 1.3, o.x + o.w, o.y, 1.3], HAZ, 3, 1);
          break;
        }
        case 'pad': {
          box(o.x, o.x + o.w, 0, 0.1, -0.9, 0.9, SAFE, 1, 1.6);
          const ph = (t * 3) % 1, L = [];
          for (let k = 0; k < 2; k++) { const xx = o.x + 0.3 + ((k * 0.5 + ph) % 1) * (o.w - 0.6); L.push(xx - 0.3, 0.12, -0.7, xx, 0.12, 0, xx, 0.12, 0, xx - 0.3, 0.12, 0.7); }
          segs(L, SAFE, 2.2, 1);
          break;
        }
        case 'mover': {
          const h = moverH(o, r.x);
          segs([o.x + 0.2, h - 0.3, 1, o.x + 0.2, FLOOR_Y, 1, o.x + o.w - 0.2, h - 0.3, 1, o.x + o.w - 0.2, FLOOR_Y, 1], SAFE, 1, 0.35);
          box(o.x, o.x + o.w, h - 0.3, h, -1, 1, SAFE, 1, 2);
          break;
        }
        case 'flip': {
          box(o.x, o.x + o.w, CEIL_Y, CEIL_Y + 0.3, -TZ, TZ, SAFE, 0.5, 1.8, true);
          const L = [];
          for (let x = Math.ceil(o.x) + 0.5; x < o.x + o.w; x += 3) L.push(x, 0.4, 0, x, 1.2, 0, x - 0.25, 0.9, 0, x, 1.2, 0, x + 0.25, 0.9, 0, x, 1.2, 0);
          segs(L, SAFE, 2, 0.5 + 0.3 * Math.sin(t * 6));
          break;
        }
        case 'gate': {
          box(o.x, o.x + o.w, 0, o.y, -1.2, 1.2, HAZ, 0.8, 2);
          box(o.x, o.x + o.w, o.h, o.h + 1.4, -1.2, 1.2, HAZ, 0.8, 2);
          segs([o.x, o.y, -1.2, o.x, o.h, -1.2, o.x, o.y, 1.2, o.x, o.h, 1.2, o.x, o.y, -1.2, o.x, o.y, 1.2, o.x, o.h, -1.2, o.x, o.h, 1.2], SAFE, 3, 0.6 + 0.3 * Math.sin(t * 7)); // the gap you thread is the safe part
          break;
        }
        case 'pit': {
          if (!o.c) break;
          const ahead = o.x - o.drop - rcx;
          if (ahead > 0) {
            const k = Math.max(0, Math.min(1, 1 - ahead / (o.glow - o.drop)));
            if (k <= 0) break;
            const blink = st.reduced ? 1 : 0.6 + 0.4 * Math.sin(t * (8 + 14 * k)), al = (0.4 + 0.6 * k) * blink;
            box(o.x, o.x + o.w, 0, 0.1, -1.1, 1.1, LIVE, 0.9, 2.2, false, al);
            const L = []; for (let xx = o.x; xx <= o.x + o.w + 0.01; xx += o.w / 4) L.push(xx, 0.12, -1.1, xx, 0.12, 1.1);
            segs(L, LIVE, 2.4, al);
          } else {
            const tf = -ahead / speedAt(o.x);
            if (tf > 0.55) break;
            const yy = -30 * tf * tf;
            box(o.x, o.x + o.w, yy - 0.1, yy, -1.1, 1.1, LIVE, 0.7, 1.6, false, (1 - tf / 0.55) * 0.8);
          }
          break;
        }
        case 'rail': {
          const lit = railLit(o, rcx), c = lit ? LIVE : SAFE;
          box(o.x, o.x + o.w, 0, lit ? 0.22 : 0.06, -1.1, 1.1, c, lit ? 1 : 0.4, lit ? 2.4 : 1.2, false, lit ? 1 : 0.35);
          const L = [o.x, 0, -1.2, o.x + o.w, 0, -1.2, o.x, 0, 1.2, o.x + o.w, 0, 1.2];
          for (let k = 0; k <= 3; k++) { const xx = o.x + (o.w * k) / 3; L.push(xx, 0, -1.2, xx, lit ? 1.1 : 0.3, -1.2, xx, 0, 1.2, xx, lit ? 1.1 : 0.3, 1.2); }
          segs(L, c, lit ? 3.2 : 1.6, lit ? 1 : 0.5);
          break;
        }
        case 'chip': {
          if (o.got) break;
          const mx = rcx, my = r.y + PS / 2, pull = st.reduced ? 0 : magnetPull(o.x - mx, o.y - my);
          mesh('octa', [o.x + (mx - o.x) * pull, o.y + (my - o.y) * pull, 0], [0.34, 0.5, 0.34], [0, t * 3 + o.x, 0], GOLD, STYLE.gold2);
          break;
        }
      }
    }

    // best-distance gate
    if (st.bestMark != null && st.bestMark > rx - 6 && st.bestMark < far) {
      const bm = st.bestMark, sh = bestMarkShimmer(rx, bm), L = [bm, 0, -1.2, bm, 3, -1.2, bm, 0, 1.2, bm, 3, 1.2, bm, 3, -1.2, bm, 3, 1.2];
      segs(L, GOLD, 1, 0.3);
      if (sh > 0) segs(L, GOLD, 2, sh * (st.reduced ? 0.5 : 0.45 + 0.15 * Math.sin(t * 14)));
    }

    // ghost: a translucent outline of the runner
    if (ghostR) {
      ghostR.holder.visible = !!st.ghost;
      if (st.ghost) { const k = st.large ? HERO.large / HERO.height : 1; placeRunner(ghostR, st.ghost.x + PS / 2, st.ghost.y, !!st.ghost.flip, k, k); animate(ghostR, 'run', false, speedAt(st.ghost.x), t); }
    } else if (st.ghost) runnerShape(st.skin, [st.ghost.x + PS / 2, st.ghost.y + PS / 2, 0], 0, t, 0.5, true, 0, false);

    // speed streaks along the track edges once things get fast (they stand still in the world, so they stream past)
    if (!st.reduced && st.speed > 12.5 && st.showRunner) {
      const k = Math.min(1, (st.speed - 12.5) / 4), j0 = Math.floor(rx / 4), L = [];
      for (let i = 0; i < 18; i++) { const j = j0 + i, x = j * 4 + hash(j, 1) * 4, z = (hash(j, 2) < 0.5 ? -1 : 1) * (1.6 + hash(j, 3) * 1.4), y = 0.15 + hash(j, 4) * 1.8; L.push(x, y, z, x + 2 + hash(j, 5) * 3, y, z); }
      segs(L, '#CFFBFF', 1.2, 0.35 * k);
    }

    // runner, trails, glow, shadow
    const rpos = [r.x + PS / 2, r.y + PS / 2, 0];
    drawTrail(st.trailId, st.trailPts, st.skin, t);
    glow.visible = shadow.visible = !!st.showRunner;
    if (st.showRunner) {
      const lt = st.lightTrail || [];
      if (lt.length > 1) { const [ca] = skinColors(st.skin, t); ribbon(lt.map((q) => { const al = lightTrailAlpha(q.age); return { x: q.x, y: q.y, w: PS * 0.25 * (al / 0.7), c: ca, a: al }; })); }
      const [ca] = skinColors(st.skin, t);
      glow.material.color.set(ca); glow.position.set(...rpos); glow.scale.setScalar(PS * 2.6);
      const sy = r.flip ? CEIL_Y : 0;
      shadow.visible = Math.abs(r.y - (r.flip ? CEIL_Y - PS : 0)) < 3;
      shadow.position.set(rpos[0], sy + (r.flip ? -0.003 : 0.003), 0); shadow.scale.set(PS * 0.6, 1, PS * 0.35);
      if (runnerR && runnerR.lookId !== st.skin.id) { dropRunner(runnerR); runnerR = makeRunner(false, world, st.skin.id); } // a new outfit: dress from scratch
      if (runnerR) {
        const al = st.blink ? 0.35 : 1, jx = st.skin.fx === 'glitch' ? 0.05 * Math.sin(t * 37) : 0, look = runnerR.look;
        kit.applyOutfit(runnerR.suit, look, t, st.tone);
        runnerR.suit.opacity = al; runnerR.suit.depthWrite = al > 0.9;
        const { sx, sy } = squashScale(st.squash || 0), k = st.large ? HERO.large / HERO.height : 1;
        // a large runner ducks under low ceilings (it would otherwise poke through slabs the hitbox passes under)
        const duck = st.large && !r.flip && objs.some((o) => o.t === 'bar' && o.x - 0.9 < r.x + PS && o.x + o.w + 0.25 > r.x);
        placeRunner(runnerR, rpos[0] + jx, r.y, r.flip, sx * k, sy * k);
        animate(runnerR, st.phase, !r.grounded, st.speed, t, duck);
        if (runnerR.gear) runnerR.gear.update({ t, speed: st.phase === 'run' ? st.speed : 0, air: !r.grounded, trim: kit.trimAt(look, t) });
      } else runnerShape(st.skin, rpos, r.rot, t, st.blink ? 0.35 : 1, false, st.squash || 0, r.flip);
    }
    if (runnerR) runnerR.holder.visible = !!st.showRunner;

    // ripples
    for (const rp of st.ripples || []) {
      const k = Math.min(1, rp.age / 0.45), rad = st.reduced ? 0.9 : 0.4 + k * 1.3, sy = rp.flip ? CEIL_Y - 0.004 : 0.004, L = [];
      for (let i = 0; i < 24; i++) { const a0 = (i / 24) * Math.PI * 2, a1 = ((i + 1) / 24) * Math.PI * 2; L.push(rp.x + Math.cos(a0) * rad * 1.5, sy, Math.sin(a0) * rad * 0.8, rp.x + Math.cos(a1) * rad * 1.5, sy, Math.sin(a1) * rad * 0.8); }
      segs(L, '#22F0FF', 2.2, 0.9 * (1 - k));
    }

    // particles and shards
    for (const p of st.parts) pt(p.x, p.y, p.z, p.col, p.size, Math.max(0, p.life / p.max));
    if (st.shards && st.shards.length) {
      const [sa] = skinColors(st.skin, t), L = []; let al = 0;
      for (const s of st.shards) { const k = shardAlpha(s.age); if (k <= 0) continue; al = Math.max(al, k); const ang = s.rot + s.spin * s.age, h = s.len * 0.5; L.push(s.x - Math.cos(ang) * h, s.y - Math.sin(ang) * h, s.z, s.x + Math.cos(ang) * h, s.y + Math.sin(ang) * h, s.z); }
      segs(L, sa, 3, al);
    }
    pGeo.setDrawRange(0, pN);
    for (const k of ['position', 'color', 'size', 'alpha']) pGeo.attributes[k].needsUpdate = true;
    pMat.uniforms.scale.value = (H * DPR) / 2 / Math.tan((cam.fov * Math.PI) / 360);

    boxes.end(); lines.end(); meshes.end(); ribbons.end();

    // screen layer
    ortho.left = 0; ortho.right = W; ortho.top = H; ortho.bottom = 0; ortho.updateProjectionMatrix();
    ovQuad.scale.set(W, H, 1); flashQuad.scale.set(W, H, 1); vigQuad.scale.set(W, H, 1);
    ovQuad.visible = !!st.overlayDirty; if (ovQuad.visible) ovTex.needsUpdate = true;
    flashQuad.visible = st.flash > 0; flashQuad.material.opacity = Math.min(0.6, st.flash || 0);
    vigQuad.visible = st.nearFlash > 0; vigMat.uniforms.a.value = Math.min(0.5, st.nearFlash || 0); vigMat.uniforms.aspect.value = W / H;
    speed.visible = !st.reduced && st.speed > 10.5 && st.showRunner;
    if (speed.visible) {
      const k = Math.min(1, (st.speed - 10.5) / 4), P = speedGeo.attributes.position.array;
      for (let i = 0; i < 14; i++) {
        const y = H - hash(i, Math.floor(t * 20)) * H, len = 30 + hash(i, 3) * 60 * k;
        const x = hash(i, 5) < 0.5 ? hash(i, 6) * W * 0.15 : W - hash(i, 6) * W * 0.15;
        P.set([x, y, 0, x - len, y - len * 0.08, 0], i * 6);
      }
      speedGeo.attributes.position.needsUpdate = true; speed.material.opacity = 0.1 * k;
    }

    for (const m of lineMats) m.resolution.set(W * DPR, H * DPR);
    composer.render();
  }

  function runnerShape(sk, pos, rz, t, alpha, wire, squash, flip) {
    const [a, b] = skinColors(sk, t);
    const s = PS * 1.02;
    const rot = [0, sk.shape === 'diamond' ? t * 1.6 : 0, -rz];
    const { sx, sy } = squashScale(squash);
    if (squash) pos = [pos[0], pos[1] + (flip ? 1 : -1) * (PS / 2) * (sy - 1) * -1, pos[2]];
    const draw = (ca, cb, al, w, p) => {
      if (sk.shape === 'circle') mesh('sphere', p, [s * 0.55 * sx, s * 0.55 * sy, s * 0.55 * sx], [0, 0, -rz], ca, cb, al, w);
      else mesh(SHAPE_MESH[sk.shape] || 'cube', p, [s * sx, s * sy, s * sx], rot, ca, cb, al, w);
    };
    if (sk.fx === 'glitch' && !wire) {
      const j = 0.06 * Math.sin(t * 37);
      draw('#22F0FF', '#22F0FF', 0.45 * alpha, false, pos);
      draw('#FF2BD6', '#FF2BD6', 0.45 * alpha, false, [pos[0] + j, pos[1], pos[2]]);
      pos = [pos[0] - j, pos[1] + 0.02 * Math.cos(t * 13), pos[2]];
    }
    draw(a, b, alpha, wire, pos);
  }

  function drawTrail(id, pts, sk, t) {
    if (!pts || pts.length < 2) return;
    const [a, b] = skinColors(sk, t), n = pts.length;
    if (id === 'classic') { pts.forEach((q, i) => { const k = i / n; pt(q.x, q.y, 0, a, PS * 0.28 * (0.4 + k * 0.6), k * 0.8); }); return; }
    if (id === 'binary') return; // digits: drawn on the overlay
    if (id === 'ribbon' || id === 'prism') {
      ribbon(pts.map((q, i) => ({ x: q.x, y: q.y, w: 0.18, c: id === 'prism' ? `hsl(${(t * 120 + i * 14) % 360},100%,60%)` : b, a: (i / n) * 0.7 })));
      return;
    }
    const sparks = id === 'sparks';
    ribbon(pts.map((q, i) => { const k = i / n; return { x: q.x, y: q.y, w: PS * (sparks ? 0.06 : 0.27) * k, c: sparks ? '#FFE45C' : a, a: k * (sparks ? 0.5 : 0.9) }; }));
  }

  // ---------- locker and shop thumbnails: the hero in a skin's outfit, on its own small renderer ----------
  let thumbR = null, thumbTone = '#E0AC82';
  /** The hero in skin sk's outfit on a px-square canvas (transparent), turned a little with t; locked is a dark silhouette. */
  function thumb(sk, px, t, locked) {
    if (!kit) return null;
    if (!thumbR) {
      const cvs = document.createElement('canvas');
      const tr = new T.WebGLRenderer({ canvas: cvs, antialias: true, alpha: true, preserveDrawingBuffer: true });
      tr.outputColorSpace = T.SRGBColorSpace;
      const sc = new T.Scene();
      sc.add(new T.HemisphereLight(0x8a6cff, 0x0a0418, 1.3));
      const dl = new T.DirectionalLight(0xffffff, 2.2); dl.position.set(-1.2, 2, 3); sc.add(dl);
      const cm = new T.PerspectiveCamera(30, 1, 0.1, 50); cm.position.set(0, 0.52, 2.5); cm.lookAt(0, 0.48, 0);
      thumbR = { tr, cvs, sc, cm, byId: new Map() };
    }
    const tt = thumbR, id = locked ? '__locked' : sk.id;
    // one dressed runner per outfit (a locked skin is a plain dark silhouette), shown only while it is drawn
    let R = tt.byId.get(id);
    if (!R) { R = makeRunner(false, tt.sc, locked ? '__none' : sk.id); if (locked) { R.gear.dispose(); R.look = LOCKED; } R.rig.actions.run.stop(); R.rig.actions.idle.play(); R.rig.mixer.update(0.6); tt.byId.set(id, R); }
    for (const [k, other] of tt.byId) other.holder.visible = k === id;
    if (tt.cvs.width !== px) { tt.tr.setPixelRatio(1); tt.tr.setSize(px, px, false); }
    kit.applyOutfit(R.suit, locked ? LOCKED : R.look, t, thumbTone);
    if (R.gear) R.gear.update({ t, speed: 0, air: false, trim: locked ? LOCKED.trim : kit.trimAt(R.look, t) });
    R.suit.opacity = 1; R.suit.depthWrite = true;
    R.holder.rotation.y = -Math.PI / 2 + 0.45 + (t - 1.3) * 0.9; // a three-quarter view; turns when t runs
    tt.tr.setClearColor(0x000000, 0);
    tt.tr.render(tt.sc, tt.cm);
    return tt.cvs;
  }

  /** Switches the hero body ('m' or 'f'): loads it if needed, then rebuilds the runner, the ghost and the thumbnail runner. */
  async function setBody(body) {
    if (!kit || !BODIES[body] || body === kit.body) return;
    const mod = await BODIES[body]();
    kit = { ...kit, data: mod.default, body };
    const lookId = runnerR ? runnerR.lookId : 'volt';
    dropRunner(runnerR); dropRunner(ghostR);
    runnerR = makeRunner(false, world, lookId); ghostR = makeRunner(true);
    if (thumbR) { for (const R of thumbR.byId.values()) dropRunner(R); thumbR.byId.clear(); }
  }

  // Warm-up: one of each pooled kind, then compile every shader now, so the first spike or sign on screen
  // doesn't stall a frame mid-run.
  boxes.begin(); lines.begin(); meshes.begin(); ribbons.begin(); signs.begin();
  box(0, 1, 0, 1, 0, 1, SAFE, 1, 1); segs([0, 0, 0, 1, 1, 1], SAFE, 1); mesh('pyramid', [0, 0, 0], [1, 1, 1], [0, 0, 0], HAZ, HAZ); ribbon([{ x: 0, y: 0, w: 1, c: SAFE, a: 1 }, { x: 1, y: 0, w: 1, c: SAFE, a: 1 }]);
  signs.next().root.material.map = signTexture(THEMES[0].words[0], THEMES[0].win[0]);
  try { renderer.compile(scene, cam); renderer.compile(screen, ortho); } catch { /* compiled lazily instead */ }
  boxes.end(); lines.end(); meshes.end(); ribbons.end(); signs.end();

  let lastSize = null;
  return {
    /** The quality tier (QUALITY index); setTier re-sizes the bloom to match. */
    tier: () => tier,
    setTier(t) { tier = Math.max(0, Math.min(QUALITY.length - 1, t)); if (lastSize) this.resize(...lastSize); },
    thumb,
    setBody,
    /** The skin tone the thumbnails show on hair outfits. */
    setThumbTone(tone) { thumbTone = tone; },
    /** Draw calls and triangles in the last frame (for the budget check). */
    info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
    onLost(fn) { lost = fn; },
    /** w, h: CSS pixels; dpr: device pixels per CSS pixel. */
    resize(w, h, dpr) {
      lastSize = [w, h, dpr];
      W = w; H = h; DPR = dpr;
      renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); composer.setPixelRatio(dpr); composer.setSize(w, h);
    },
    render,
    dispose() { try { composer.dispose(); renderer.dispose(); } catch { /* already gone */ } },
  };
}
