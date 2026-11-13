// Lanternkeep three.js renderer: a night garden with smooth physically based surfaces, soft moonlight
// shadows, a pool of coloured plant lights, wind-blown grass, bloom on every glow, and image-based
// reflections. Same interface as render.js (the flat fallback), so the page doesn't care which one runs.
// World: x = grid column, z = grid row, y = up; the camera sits past the last row looking back.
import * as THREE from '../sdk/vendor/three.module.js';
import { COLS, ROWS, FLARE_RADIUS, TOWERS, flareCharge, stats } from './lib/sim.js';
import { creatureModel, glow, hash, lanternModel, mat, plantModel, rockGeometry, treeModel } from './models-three.js';

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ease = (t) => 1 - Math.pow(1 - clamp01(t), 3);
const col = (hex) => new THREE.Color(hex);

// ---------- quality tiers ----------
export const TIERS = {
  high: { pr: 2, shadow: 2048, bloom: 1, samples: 4, plantLights: 10, grass: 2600, transmission: true, lanternShadow: true, motes: 90, stars: 1600 },
  medium: { pr: 1.5, shadow: 1024, bloom: 0.5, samples: 2, plantLights: 6, grass: 1200, transmission: false, lanternShadow: false, motes: 50, stars: 1000 },
  low: { pr: 1, shadow: 0, bloom: 0.5, samples: 0, plantLights: 3, grass: 0, transmission: false, lanternShadow: false, motes: 24, stars: 600 },
};

// ---------- region looks ----------
export const REGIONS = {
  moon: {
    skyTop: 0x05061a, skyHorizon: 0x2b1d4a, aurora: 0x6a2a9a, fog: 0x120d26, fogDensity: 0.035,
    hemiSky: 0x5a5aa8, hemiGround: 0x1a1426, hemi: 0.55, moon: 0xb8c4ff, moonI: 0.9, moonDir: [-0.45, 0.62, -0.65],
    tileA: 0x2f5c46, tileB: 0x285440, path: 0xcfc8b4, pathGlow: 0x8070b0, bed: 0x1c1a24, rim: 0x3a3646,
    terrainLow: 0x1c3328, terrainHigh: 0x2c3a3c, grass: [0x3f7a54, 0x4f9060, 0x2f6a4a], flowers: [0xc8b0ff, 0xfff0c8, 0x90e0ff],
    motes: 0xb8ff90, trees: 'moon', env: 0.22,
  },
  frost: {
    skyTop: 0x03091a, skyHorizon: 0x1e3a5a, aurora: 0x20c8a0, fog: 0x101e30, fogDensity: 0.035,
    hemiSky: 0x7a9ad8, hemiGround: 0x1a2232, hemi: 0.6, moon: 0xc8e4ff, moonI: 0.95, moonDir: [0.45, 0.6, -0.65],
    tileA: 0x8ea4b8, tileB: 0x7d95ab, path: 0xb8d8f4, pathGlow: 0x5090d0, bed: 0x162030, rim: 0x46566a,
    terrainLow: 0x8ea0b4, terrainHigh: 0xc4d2e2, grass: [0x9ab8c8, 0xb8d0dc, 0x7a9cb0], flowers: [0xbfeaff, 0xffffff, 0x9ad0ff],
    motes: 0xe8f4ff, trees: 'frost', env: 0.3,
  },
  ember: {
    skyTop: 0x0c030a, skyHorizon: 0x5a1a14, aurora: 0xc04010, fog: 0x1e0a0c, fogDensity: 0.04,
    hemiSky: 0x9a5a5a, hemiGround: 0x2a1210, hemi: 0.55, moon: 0xffc0a0, moonI: 0.85, moonDir: [0.2, 0.55, -0.8],
    tileA: 0x5a4a2a, tileB: 0x604428, path: 0xe0a880, pathGlow: 0xc04a20, bed: 0x22100e, rim: 0x4a2c26,
    terrainLow: 0x2e1c14, terrainHigh: 0x3c2a22, grass: [0x8a7038, 0x9a6a30, 0x6a5a2a], flowers: [0xff9a50, 0xffd080, 0xff6040],
    motes: 0xff8a3a, trees: 'ember', env: 0.22,
  },
};

const PLANT_LIGHT = { glowcap: 0x5ff5cf, frost: 0x8ec8ff, ember: 0xff7a30, sunspire: 0xffd060 };

// ---------- shaders ----------
const SKY = {
  vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform vec3 uTop, uHor, uAur, uMoonDir; uniform float uTime; varying vec3 vDir;
    float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
    void main() {
      float y = vDir.y;
      vec3 c = mix(uHor, uTop, pow(clamp(y * 1.6, 0.0, 1.0), 0.55));
      float a = atan(vDir.z, vDir.x);
      float band = (n(vec2(a * 4.0 + uTime * 0.03, y * 5.0)) * 0.7 + n(vec2(a * 9.0 - uTime * 0.05, y * 11.0)) * 0.3) * smoothstep(0.04, 0.22, y) * smoothstep(0.62, 0.22, y);
      c += uAur * band * 0.55;
      float md = max(dot(vDir, normalize(uMoonDir)), 0.0);
      c += vec3(0.75, 0.78, 1.0) * (pow(md, 40.0) * 0.35 + pow(md, 6.0) * 0.06);
      gl_FragColor = vec4(c, 1.0);
    }`,
};
const STARS = {
  vertexShader: `attribute float aSize; attribute float aPhase; uniform float uTime, uScale; varying float vA;
    void main() { vA = 0.55 + 0.45 * sin(uTime * (1.0 + aPhase) + aPhase * 30.0); vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying float vA; void main() { float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard; gl_FragColor = vec4(vec3(0.9, 0.93, 1.0) * pow(1.0 - r, 2.0) * vA * 1.6, 1.0); }`,
};
const PARTICLES = {
  vertexShader: `attribute float aSize; attribute vec4 aColor; uniform float uScale; varying vec4 vC;
    void main() { vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uSoft; varying vec4 vC; void main() { float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard;
    float a = uSoft > 0.5 ? smoothstep(1.0, 0.2, r) * vC.a : pow(1.0 - r, 1.8) * vC.a; gl_FragColor = uSoft > 0.5 ? vec4(vC.rgb, a) : vec4(vC.rgb * a, 1.0); }`,
};

// Finishing pass: a soft vignette, a touch of cool-shadow / warm-light grading, and fine film grain.
const GRADE = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.035 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uGrain; varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c * vec3(0.94, 0.97, 1.08), c * vec3(1.06, 1.0, 0.92), smoothstep(0.15, 0.7, l));
      vec2 d = vUv - 0.5; c *= 1.0 - smoothstep(0.35, 0.95, length(d * vec2(1.0, 0.8))) * 0.55;
      c += (h(vUv * 900.0 + fract(uTime * 7.0)) - 0.5) * uGrain;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

// Procedural textures: moss for the tiles, worn stone for the path. Drawn once on canvases, never downloaded.
function noiseCanvas(size, paint) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  paint(c.getContext('2d'), size);
  return c;
}
function makeTextures() {
  const rnd = (i) => hash(i, 7.3, 1.1);
  const moss = noiseCanvas(256, (x, n) => {
    x.fillStyle = '#c8d8c8'; x.fillRect(0, 0, n, n);
    for (let i = 0; i < 2600; i++) { const r = 1 + rnd(i) * 5; x.fillStyle = `rgba(${rnd(i + 1) > 0.5 ? '255,255,240' : '60,80,60'},${0.05 + rnd(i + 2) * 0.12})`; x.beginPath(); x.arc(rnd(i + 3) * n, rnd(i + 4) * n, r, 0, TAU); x.fill(); }
  });
  const mossBump = noiseCanvas(256, (x, n) => {
    x.fillStyle = '#808080'; x.fillRect(0, 0, n, n);
    for (let i = 0; i < 3000; i++) { const v = Math.round(90 + rnd(i + 5) * 120); x.fillStyle = `rgba(${v},${v},${v},0.35)`; x.beginPath(); x.arc(rnd(i + 6) * n, rnd(i + 7) * n, 1 + rnd(i + 8) * 3, 0, TAU); x.fill(); }
  });
  const stone = noiseCanvas(256, (x, n) => {
    x.fillStyle = '#e8e4dc'; x.fillRect(0, 0, n, n);
    for (let i = 0; i < 1800; i++) { x.fillStyle = `rgba(${rnd(i) > 0.5 ? '255,255,255' : '90,84,96'},${0.04 + rnd(i + 9) * 0.1})`; x.beginPath(); x.arc(rnd(i + 10) * n, rnd(i + 11) * n, 1 + rnd(i + 12) * 7, 0, TAU); x.fill(); }
    x.strokeStyle = 'rgba(70,64,80,0.25)'; x.lineWidth = 1.2;
    for (let i = 0; i < 14; i++) { x.beginPath(); let px = rnd(i + 13) * n, py = rnd(i + 14) * n; x.moveTo(px, py); for (let k = 0; k < 5; k++) { px += (rnd(i * 7 + k) - 0.5) * 40; py += (rnd(i * 9 + k) - 0.5) * 40; x.lineTo(px, py); } x.stroke(); }
  });
  const stoneBump = noiseCanvas(256, (x, n) => {
    x.fillStyle = '#909090'; x.fillRect(0, 0, n, n);
    for (let i = 0; i < 2200; i++) { const v = Math.round(60 + rnd(i + 15) * 150); x.fillStyle = `rgba(${v},${v},${v},0.3)`; x.beginPath(); x.arc(rnd(i + 16) * n, rnd(i + 17) * n, 1 + rnd(i + 18) * 6, 0, TAU); x.fill(); }
  });
  const tex = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  return { moss: tex(moss, true), mossBump: tex(mossBump), stone: tex(stone, true), stoneBump: tex(stoneBump) };
}
let TEX = null;

// ---------- the renderer ----------
export function createRendererThree(canvas, overlay, opts = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  } catch { return null; }
  if (!renderer.capabilities.isWebGL2) { renderer.dispose(); return null; }
  const reduced = !!opts.reducedMotion;
  const coarse = matchMedia('(pointer: coarse)').matches;
  // A software rasteriser (no GPU, or a blocked one) can't carry shadows and bloom: start it on the lightest look.
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const software = /swiftshader|llvmpipe|software|basic render/i.test(String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)));
  const defaultTier = software ? 'low' : coarse ? 'medium' : 'high';
  let tierName = opts.lowFx ? 'low' : defaultTier;
  let tier = TIERS[tierName];
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  TEX ??= makeTextures();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35.5, 1, 0.1, 200);
  // Reflections come from a generated environment map. Building it costs a moment, so it waits until the first
  // frame is on screen (startup stays quick on slow phones and in software GL).
  let envPending = true;
  function buildEnvironment() {
    envPending = false;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
    iconScene.environment = scene.environment;
    pmrem.dispose();
  }

  // sky, stars, moon
  const skyMat = new THREE.ShaderMaterial({ ...SKY, side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { uTop: { value: col(0) }, uHor: { value: col(0) }, uAur: { value: col(0) }, uMoonDir: { value: new THREE.Vector3() }, uTime: { value: 0 } } });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16), skyMat);
  sky.renderOrder = -2;
  scene.add(sky);
  const starMat = new THREE.ShaderMaterial({ ...STARS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, uniforms: { uTime: { value: 0 }, uScale: { value: 1 } } });
  let stars = null;
  const moon = new THREE.Mesh(new THREE.SphereGeometry(2.6, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.2, 3.6), fog: false }));
  scene.add(moon);

  // lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0.5);
  scene.add(hemi);
  const moonLight = new THREE.DirectionalLight(0xffffff, 1);
  moonLight.shadow.camera.left = -9; moonLight.shadow.camera.right = 9; moonLight.shadow.camera.top = 10; moonLight.shadow.camera.bottom = -10;
  moonLight.shadow.camera.near = 1; moonLight.shadow.camera.far = 60;
  moonLight.shadow.normalBias = 0.03; moonLight.shadow.radius = 3;
  scene.add(moonLight, moonLight.target);
  const lanternLight = new THREE.PointLight(0xffa050, 6, 9, 1.6);
  lanternLight.shadow.mapSize.set(512, 512); lanternLight.shadow.bias = -0.004; lanternLight.shadow.radius = 4;
  scene.add(lanternLight);
  let plantLights = [];
  const fxLights = Array.from({ length: 3 }, () => { const l = new THREE.PointLight(0xffffff, 0, 4, 2); scene.add(l); return l; });

  // post: multisampled HDR target, bloom, tone mapping
  let composer, bloom, grade;
  function buildComposer(w, h) {
    composer?.dispose();
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: tier.samples });
    composer = new THREE.EffectComposer(renderer, rt);
    composer.addPass(new THREE.RenderPass(scene, camera));
    bloom = new THREE.UnrealBloomPass(new THREE.Vector2(w * tier.bloom, h * tier.bloom), 0.62, 0.5, 0.92);
    composer.addPass(bloom);
    composer.addPass(new THREE.OutputPass());
    grade = new THREE.ShaderPass(GRADE);
    composer.addPass(grade);
  }

  // dynamic objects
  const world = new THREE.Group();
  scene.add(world);
  const lantern = lanternModel();
  scene.add(lantern);
  const plantRoot = new THREE.Group(), creatureRoot = new THREE.Group();
  scene.add(plantRoot, creatureRoot);
  const plantForms = new Map(); // `${type}:${form}` -> template
  const plants = new Map(); // tower id -> { obj, key }
  const creatures = new Map(); // enemy id -> { root, parts, seen }
  const creatureTemplates = new Map();

  // decals: selection, hint, range rings, effect rings
  const addMat = (c, o = 1) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const square = (inner, outer) => { const g = new THREE.RingGeometry(inner, outer, 4, 1); g.rotateZ(Math.PI / 4); g.rotateX(-Math.PI / 2); return g; };
  const selMesh = new THREE.Mesh(square(0.6, 0.68), addMat(new THREE.Color(2.4, 1.9, 1)));
  const hintMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2), addMat(new THREE.Color(1.4, 1.1, 0.4), 0.5));
  const ringGeo = new THREE.RingGeometry(0.965, 1, 96).rotateX(-Math.PI / 2);
  const discGeo = new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2);
  const rangeRing = new THREE.Mesh(ringGeo, addMat(0xffffff, 0.8));
  const rangeDisc = new THREE.Mesh(discGeo, addMat(0xffffff, 0.06));
  const flareRing = new THREE.Mesh(ringGeo, addMat(new THREE.Color(1.6, 1, 0.4), 0.3));
  for (const m of [selMesh, hintMesh, rangeRing, rangeDisc, flareRing]) { m.renderOrder = 2; scene.add(m); }
  const ringPool = Array.from({ length: 18 }, () => { const m = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 64).rotateX(-Math.PI / 2), addMat(0xffffff, 1)); m.visible = false; m.renderOrder = 3; scene.add(m); return m; });
  const beamPool = Array.from({ length: 12 }, () => { const g = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true); g.translate(0, 0.5, 0); g.rotateX(Math.PI / 2); const m = new THREE.Mesh(g, addMat(new THREE.Color(3, 2.2, 0.8), 1)); m.visible = false; scene.add(m); return m; });

  // particles: one additive and one soft (smoke) system, refilled every frame
  function particleSystem(cap, soft) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(cap * 3), colr = new Float32Array(cap * 4), size = new Float32Array(cap);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(35048));
    g.setAttribute('aColor', new THREE.BufferAttribute(colr, 4).setUsage(35048));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(35048));
    const m = new THREE.ShaderMaterial({ ...PARTICLES, transparent: true, depthWrite: false, blending: soft ? THREE.NormalBlending : THREE.AdditiveBlending, uniforms: { uScale: { value: 300 }, uSoft: { value: soft ? 1 : 0 } } });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    p.renderOrder = soft ? 4 : 5;
    scene.add(p);
    let n = 0;
    return {
      mat: m,
      begin() { n = 0; },
      add(x, y, z, s, r, gg, b, a = 1) { if (n >= cap) return; pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = z; colr[n * 4] = r; colr[n * 4 + 1] = gg; colr[n * 4 + 2] = b; colr[n * 4 + 3] = a; size[n] = s; n++; },
      end() { g.setDrawRange(0, n); for (const k of ['position', 'aColor', 'aSize']) g.attributes[k].needsUpdate = true; },
    };
  }
  const glowP = particleSystem(5000, false), smokeP = particleSystem(600, true);

  // ---------- world per level ----------
  let region = 'moon', R = REGIONS.moon, worldKey = '', grassMat = null, motes = [], mist = [];
  const disposeTree = (o) => o.traverse((x) => { if (x.isMesh || x.isPoints || x.isInstancedMesh) { x.geometry.dispose(); } });

  function buildWorld(g) {
    disposeTree(world);
    world.clear();
    const T = new THREE.Object3D();
    const blocked = g.blocked;
    // board tiles: rounded, slightly uneven
    const tileGeo = new THREE.RoundedBoxGeometry(0.94, 0.36, 0.94, 3, 0.07);
    const free = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (!blocked.has(`${c},${r}`)) free.push([c, r]);
    const tiles = new THREE.InstancedMesh(tileGeo, new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, map: TEX.moss, bumpMap: TEX.mossBump, bumpScale: 1.2 }), free.length);
    free.forEach(([c, r], i) => {
      T.position.set(c + 0.5, -0.18 + hash(c, r) * 0.035, r + 0.5); T.rotation.set(0, (hash(r, c) - 0.5) * 0.04, 0); T.scale.set(1, 1, 1); T.updateMatrix();
      tiles.setMatrixAt(i, T.matrix);
      tiles.setColorAt(i, col((c + r) % 2 ? R.tileA : R.tileB).multiplyScalar(0.85 + hash(c, r, 2) * 0.3));
    });
    tiles.receiveShadow = true;
    world.add(tiles);
    // the path: a dark bed with moonstone flagstones
    const pathCells = [...blocked].map((k) => k.split(',').map(Number));
    const bed = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.1, 1), mat(R.bed, { rough: 1 }), pathCells.length);
    pathCells.forEach(([c, r], i) => { T.position.set(c + 0.5, -0.2, r + 0.5); T.rotation.set(0, 0, 0); T.updateMatrix(); bed.setMatrixAt(i, T.matrix); });
    bed.receiveShadow = true;
    world.add(bed);
    const stones = [];
    for (const [c, r] of pathCells) {
      const zs = 0.35 + hash(c, r, 3) * 0.3;
      for (const [z0, z1, k] of [[0.05, zs - 0.03, 0], [zs + 0.03, 0.95, 1]]) {
        const xs = 0.3 + hash(c, r, k + 7) * 0.4;
        const cuts = hash(r, c, k) > 0.35 ? [[0.05, xs - 0.03], [xs + 0.03, 0.95]] : [[0.05, 0.95]];
        for (const [x0, x1] of cuts) stones.push([c + (x0 + x1) / 2, r + (z0 + z1) / 2, x1 - x0 - 0.03, z1 - z0 - 0.03, hash(c * 3 + x0, r + z0)]);
      }
    }
    const stoneMesh = new THREE.InstancedMesh(new THREE.RoundedBoxGeometry(1, 1, 1, 2, 0.18), new THREE.MeshStandardMaterial({ roughness: 0.65, emissive: col(R.pathGlow), emissiveIntensity: 0.1, map: TEX.stone, bumpMap: TEX.stoneBump, bumpScale: 1.5 }), stones.length);
    stones.forEach(([x, z, w, d, v], i) => {
      T.position.set(x, -0.12 + v * 0.02, z); T.rotation.set(0, (v - 0.5) * 0.12, 0); T.scale.set(w, 0.08, d); T.updateMatrix();
      stoneMesh.setMatrixAt(i, T.matrix);
      stoneMesh.setColorAt(i, col(R.path).multiplyScalar(0.36 + v * 0.22));
    });
    stoneMesh.receiveShadow = true;
    world.add(stoneMesh);
    // a stone rim round the board
    const rimMat = mat(R.rim, { rough: 0.8 });
    for (const [x, z, w, d] of [[COLS / 2, -0.12, COLS + 0.4, 0.24], [COLS / 2, ROWS + 0.12, COLS + 0.4, 0.24], [-0.12, ROWS / 2, 0.24, ROWS], [COLS + 0.12, ROWS / 2, 0.24, ROWS]]) {
      const m = new THREE.Mesh(new THREE.RoundedBoxGeometry(w, 0.42, d, 2, 0.08), rimMat);
      m.position.set(x, -0.08, z); m.receiveShadow = true; m.castShadow = true;
      world.add(m);
    }
    // terrain: smooth rolling ground beyond the board
    const S = 70, N = 150;
    const terr = new THREE.PlaneGeometry(S, S, N, N).rotateX(-Math.PI / 2);
    terr.translate(COLS / 2, 0, ROWS / 2);
    const tp = terr.attributes.position, colors = new Float32Array(tp.count * 3);
    const lo = col(R.terrainLow), hi = col(R.terrainHigh), tmp = new THREE.Color();
    const sn = new THREE.SimplexNoise();
    for (let i = 0; i < tp.count; i++) {
      const x = tp.getX(i), z = tp.getZ(i);
      const dx = Math.max(-0.3 - x, 0, x - COLS - 0.3), dz = Math.max(-0.3 - z, 0, z - ROWS - 0.3);
      const d = Math.hypot(dx, dz);
      const n = sn.noise(x * 0.12, z * 0.12) * 0.6 + sn.noise(x * 0.4, z * 0.4) * 0.15;
      const rise = THREE.MathUtils.smoothstep(d, 0.6, 9);
      // keep the near side (bottom of the screen) low so it never hides the lantern
      const near = z > ROWS ? 0.25 : 1;
      tp.setY(i, -0.24 + rise * (1.2 + n * 1.6) * near + (d > 18 ? (d - 18) * 0.25 : 0));
      tmp.copy(lo).lerp(hi, clamp01(0.5 + n * 0.8 + rise * 0.2));
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    terr.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    terr.computeVertexNormals();
    const terrain = new THREE.Mesh(terr, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    terrain.receiveShadow = true;
    world.add(terrain);
    const heightAt = (x, z) => {
      const dx = Math.max(-0.3 - x, 0, x - COLS - 0.3), dz = Math.max(-0.3 - z, 0, z - ROWS - 0.3), d = Math.hypot(dx, dz);
      const n = sn.noise(x * 0.12, z * 0.12) * 0.6 + sn.noise(x * 0.4, z * 0.4) * 0.15;
      return -0.24 + THREE.MathUtils.smoothstep(d, 0.6, 9) * (1.2 + n * 1.6) * (z > ROWS ? 0.25 : 1);
    };
    // entrance arches where creatures come in
    for (const p of g.paths) {
      const a = p.pts[0], b = p.pts[1];
      const ex = Math.min(COLS + 0.3, Math.max(-0.3, a.x)), ez = Math.min(ROWS + 0.3, Math.max(-0.3, a.y));
      const arch = new THREE.Group();
      arch.position.set(ex, -0.1, ez);
      arch.rotation.y = Math.atan2(b.x - a.x, b.y - a.y);
      const am = mat(0x3a3442, { rough: 0.7 });
      for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.1, 12), am); post.position.set(s * 0.55, 0.55, 0); post.castShadow = true; arch.add(post); }
      const top = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.055, 10, 32, Math.PI), am);
      top.position.y = 1.1; top.castShadow = true; arch.add(top);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.08), glow(0xb070ff, 3));
      gem.position.y = 1.68; arch.add(gem);
      world.add(arch);
    }
    // scenery: trees and rocks around the board, never on it
    const rockMat = mat(0xffffff, { rough: 0.8 });
    const rockCol = R.trees === 'frost' ? 0xb8c8da : R.trees === 'ember' ? 0x6a4a40 : 0x7a7688;
    const rocks = new THREE.InstancedMesh(rockGeometry(3), rockMat, 60);
    let ri = 0;
    for (let i = 0; i < 90; i++) {
      const side = i % 4, t = hash(i, 1), d = 1.1 + hash(i, 2) * 6;
      let x, z;
      if (side === 0) { x = -d; z = t * (ROWS + 6) - 3; } else if (side === 1) { x = COLS + d; z = t * (ROWS + 6) - 3; }
      else if (side === 2) { x = t * (COLS + 8) - 4; z = -d - 0.5; } else { x = t * (COLS + 8) - 4; z = ROWS + d * 0.6 + 0.8; }
      const near = z > ROWS;
      const y = heightAt(x, z);
      if (hash(i, 7) < 0.5 && !near) {
        const tr = treeModel(R.trees, i);
        tr.position.set(x, y, z); tr.rotation.y = hash(i, 5) * TAU; tr.scale.setScalar(0.85 + hash(i, 8) * 0.8);
        tr.traverse((o) => { if (o.isMesh) { o.castShadow = d < 4; o.receiveShadow = true; } });
        world.add(tr);
      } else if (ri < 60) {
        T.position.set(x, y, z); T.rotation.set(hash(i, 3), hash(i, 4) * TAU, 0); T.scale.setScalar(0.4 + hash(i, 6) * (near ? 0.4 : 0.9)); T.updateMatrix();
        rocks.setMatrixAt(ri, T.matrix); rocks.setColorAt(ri, col(rockCol).multiplyScalar(0.7 + hash(i, 9) * 0.4)); ri++;
      }
    }
    rocks.count = ri; rocks.castShadow = true; rocks.receiveShadow = true;
    world.add(rocks);
    // set pieces: a frozen lake, ember pools, a garden fence
    if (R.trees === 'frost') {
      const lake = new THREE.Mesh(new THREE.CircleGeometry(3.2, 64).rotateX(-Math.PI / 2), mat(0x10243a, { rough: 0.04, metal: 0.2, clearcoat: 1, ccRough: 0.02 }));
      lake.position.set(-4.6, heightAt(-4.6, 5) + 0.06, 5); lake.receiveShadow = true; world.add(lake);
    } else if (R.trees === 'ember') {
      for (const [x, z, r] of [[-4, 4, 1.8], [COLS + 4, 8, 2.2], [-3.4, 11, 1.3]]) {
        const pool = new THREE.Mesh(new THREE.CircleGeometry(r, 48).rotateX(-Math.PI / 2), glow(0xff5a1a, 1.6, { rough: 0.2 }));
        pool.position.set(x, heightAt(x, z) + 0.05, z); world.add(pool);
      }
    } else {
      const fm = mat(0x4a3428, { rough: 0.8 });
      for (let i = 0; i < 9; i++) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.6, 8), fm); p.position.set(-1.3, heightAt(-1.3, 1 + i * 1.4) + 0.3, 1 + i * 1.4); p.castShadow = true; world.add(p); }
      for (const y of [0.38, 0.18]) { const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 11.4, 8).rotateX(Math.PI / 2), fm); rail.position.set(-1.3, heightAt(-1.3, 6.6) + y, 6.6); world.add(rail); }
    }
    // grass: thousands of blades swaying in the wind
    if (tier.grass > 0) {
      const blade = new THREE.BufferGeometry();
      const bp = [], bi = [];
      for (let k = 0; k <= 3; k++) { const t = k / 3, w = 0.018 * (1 - t); bp.push(-w, t, 0, w, t, 0); if (k < 3) bi.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2); }
      blade.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
      blade.setIndex(bi);
      blade.computeVertexNormals();
      grassMat = new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide });
      grassMat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = { value: 0 };
        grassMat.userData.shader = sh;
        sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 ip = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float sway = sin(uTime * 1.6 + ip.x * 0.7 + ip.z * 0.5) * 0.5 + sin(uTime * 2.7 + ip.x * 1.9) * 0.25;
          transformed.x += sway * 0.09 * position.y * position.y;
          transformed.z += sway * 0.04 * position.y * position.y;`);
      };
      const grass = new THREE.InstancedMesh(blade, grassMat, tier.grass);
      let gi = 0;
      const gc = R.grass.map(col);
      for (let i = 0; gi < tier.grass && i < tier.grass * 3; i++) {
        let x, z, y;
        if (i % 3 === 0) { const [c, r] = free[Math.floor(hash(i, 1) * free.length)] ?? [0, 0]; x = c + 0.08 + hash(i, 2) * 0.84; z = r + 0.08 + hash(i, 3) * 0.84; y = -0.0 + hash(c, r) * 0.035; }
        else { x = -6 + hash(i, 4) * (COLS + 12); z = -6 + hash(i, 5) * (ROWS + 10); if (x > -0.4 && x < COLS + 0.4 && z > -0.4 && z < ROWS + 0.4) continue; y = heightAt(x, z); }
        T.position.set(x, y, z); T.rotation.set((hash(i, 6) - 0.5) * 0.5, hash(i, 7) * TAU, 0); T.scale.set(1, 0.12 + hash(i, 8) * 0.14, 1); T.updateMatrix();
        grass.setMatrixAt(gi, T.matrix); grass.setColorAt(gi, gc[gi % gc.length].clone().multiplyScalar(0.7 + hash(i, 9) * 0.5)); gi++;
      }
      grass.count = gi; grass.receiveShadow = true;
      world.add(grass);
    } else grassMat = null;
    // flowers on a few tiles
    const fl = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ fog: true }), 80);
    let fi = 0;
    for (const [c, r] of free) {
      if (hash(c, r, 50) < 0.82 || fi >= 80) continue;
      T.position.set(c + 0.2 + hash(c, r, 51) * 0.6, 0.05 + hash(c, r) * 0.035, r + 0.2 + hash(c, r, 52) * 0.6); T.rotation.set(0, 0, 0); T.scale.set(1, 0.6, 1); T.updateMatrix();
      fl.setMatrixAt(fi, T.matrix); fl.setColorAt(fi, col(R.flowers[fi % R.flowers.length]).multiplyScalar(2.2)); fi++;
    }
    fl.count = fi;
    world.add(fl);
    // stars and ambient motes
    if (stars) { stars.geometry.dispose(); scene.remove(stars); }
    const sg = new THREE.BufferGeometry(), sp = [], ss = [], sph = [];
    for (let i = 0; i < tier.stars; i++) {
      const u = hash(i, 11), v = hash(i, 12), th = u * TAU, y = 0.05 + v * 0.95, rr = Math.sqrt(1 - y * y);
      sp.push(Math.cos(th) * rr * 80, y * 80, Math.sin(th) * rr * 80); ss.push(0.8 + hash(i, 13) * 2.2); sph.push(hash(i, 14));
    }
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg.setAttribute('aSize', new THREE.Float32BufferAttribute(ss, 1));
    sg.setAttribute('aPhase', new THREE.Float32BufferAttribute(sph, 1));
    stars = new THREE.Points(sg, starMat);
    stars.position.set(COLS / 2, 0, ROWS / 2);
    stars.frustumCulled = false;
    scene.add(stars);
    mist = Array.from({ length: tierName === 'low' ? 6 : 16 }, (_, i) => ({ x: -2 + hash(i, 21) * (COLS + 4), z: -2 + hash(i, 22) * (ROWS + 4), s: 2.4 + hash(i, 23) * 2.6, v: 0.08 + hash(i, 24) * 0.12, ph: hash(i, 25) * TAU }));
    motes = Array.from({ length: tier.motes }, (_, i) => ({ x: -3 + hash(i, 1) * (COLS + 6), y: 0.15 + hash(i, 2) * (R.trees === 'frost' ? 6 : 1.8), z: -3 + hash(i, 3) * (ROWS + 6), s: hash(i, 4) }));
  }

  function setRegion(g) {
    region = g.level.region ?? 'moon';
    R = REGIONS[region] ?? REGIONS.moon;
    scene.fog = new THREE.FogExp2(R.fog, R.fogDensity);
    skyMat.uniforms.uTop.value.set(R.skyTop); skyMat.uniforms.uHor.value.set(R.skyHorizon); skyMat.uniforms.uAur.value.set(R.aurora);
    const md = new THREE.Vector3(...R.moonDir).normalize();
    skyMat.uniforms.uMoonDir.value.copy(md);
    sky.position.set(COLS / 2, 0, ROWS / 2);
    moon.position.copy(md.clone().multiplyScalar(80)).add(sky.position);
    moon.material.color.set(R.moon).multiplyScalar(3.2);
    hemi.color.set(R.hemiSky); hemi.groundColor.set(R.hemiGround); hemi.intensity = R.hemi;
    moonLight.color.set(R.moon); moonLight.intensity = R.moonI;
    moonLight.position.copy(md.clone().multiplyScalar(30)).add(new THREE.Vector3(COLS / 2, 0, ROWS / 2));
    moonLight.target.position.set(COLS / 2, 0, ROWS / 2);
    scene.environmentIntensity = R.env;
  }

  function applyTier() {
    tier = TIERS[tierName];
    renderer.shadowMap.enabled = tier.shadow > 0;
    moonLight.castShadow = tier.shadow > 0;
    moonLight.shadow.mapSize.set(tier.shadow || 512, tier.shadow || 512);
    moonLight.shadow.map?.dispose(); moonLight.shadow.map = null;
    lanternLight.castShadow = tier.lanternShadow;
    for (const l of plantLights) scene.remove(l);
    plantLights = Array.from({ length: tier.plantLights }, () => { const l = new THREE.PointLight(0xffffff, 0, 3.6, 1.8); scene.add(l); return l; });
    plantForms.clear();
    for (const [, p] of plants) plantRoot.remove(p.obj);
    plants.clear();
    worldKey = '';
  }

  // ---------- camera ----------
  let cssW = 1, cssH = 1;
  let introT = 1, titleMode = false, focus = null, focusK = 0, shakeT = 0, shakeAmp = 0;
  const tmpV = new THREE.Vector3();
  function fitDistance(asp) {
    const target = new THREE.Vector3(COLS / 2, 0, ROWS / 2 + 0.6), pitch = 0.9;
    camera.aspect = asp; camera.updateProjectionMatrix();
    const corners = [[-0.3, 0, -0.5], [COLS + 0.3, 0, -0.5], [-0.3, 0, ROWS + 0.4], [COLS + 0.3, 0, ROWS + 0.4], [COLS / 2, 1.9, ROWS]];
    let lo = 4, hi = 70;
    for (let i = 0; i < 28; i++) {
      const d = (lo + hi) / 2;
      camera.position.set(target.x, target.y + Math.sin(pitch) * d, target.z + Math.cos(pitch) * d);
      camera.lookAt(target); camera.updateMatrixWorld();
      const ok = corners.every(([x, y, z]) => { tmpV.set(x, y, z).project(camera); return Math.abs(tmpV.x) <= 0.97 && tmpV.y <= 0.9 && tmpV.y >= -0.97 && tmpV.z < 1; });
      if (ok) hi = d; else lo = d;
    }
    return { target, pitch, dist: hi };
  }
  let fitCache = { asp: 0, v: null };
  function placeCamera(time) {
    const asp = cssW / cssH;
    if (fitCache.asp !== asp) fitCache = { asp, v: fitDistance(asp) };
    const fit = fitCache.v;
    let target = fit.target.clone(), pitch = fit.pitch, dist = fit.dist, yaw = 0;
    if (titleMode) {
      yaw = 0.35 + Math.sin(time * 0.07) * 0.35; pitch = 0.55; dist = fit.dist * 0.6;
      target = new THREE.Vector3(COLS / 2 + 0.5, 0, ROWS / 2 + 1.5);
    } else if (introT < 1) {
      const k = ease(introT);
      yaw = (1 - k) * 0.9; pitch = 0.32 + (fit.pitch - 0.32) * k; dist = fit.dist * (1 + (1 - k) * 0.9); target.z -= (1 - k) * 3;
    }
    if (focus && focusK > 0) {
      const k = ease(focusK);
      target.lerp(new THREE.Vector3(focus.x, 0.25, focus.z), k); dist *= 1 - 0.62 * k; pitch -= 0.28 * k;
    }
    camera.aspect = asp; camera.updateProjectionMatrix();
    camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    if (shakeT > 0 && !reduced) { const a = shakeAmp * shakeT; camera.position.x += Math.sin(time * 71) * a; camera.position.y += Math.sin(time * 53) * a * 0.6; camera.position.z += Math.cos(time * 61) * a; }
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }

  // ---------- sizing ----------
  let dpr = 1;
  const octx = overlay.getContext('2d');
  function resize(g, w, h) {
    cssW = Math.max(1, w); cssH = Math.max(1, h);
    dpr = Math.min(tier.pr, window.devicePixelRatio || 1);
    renderer.setPixelRatio(dpr);
    renderer.setSize(cssW, cssH, false);
    canvas.style.width = `${cssW}px`; canvas.style.height = `${cssH}px`;
    overlay.style.width = `${cssW}px`; overlay.style.height = `${cssH}px`;
    overlay.width = Math.round(cssW * dpr); overlay.height = Math.round(cssH * dpr);
    buildComposer(Math.round(cssW * dpr), Math.round(cssH * dpr));
    glowP.mat.uniforms.uScale.value = cssH * dpr * 0.9;
    smokeP.mat.uniforms.uScale.value = cssH * dpr * 0.9;
    starMat.uniforms.uScale.value = dpr;
    fitCache.asp = 0;
    ensureWorld(g);
  }
  function ensureWorld(g) {
    const k = `${g.level.name}:${g.level.region}:${tierName}`;
    if (k === worldKey) return;
    setRegion(g);
    buildWorld(g);
    worldKey = k;
  }

  // ---------- picking ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.03), hitP = new THREE.Vector3();
  function cellAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, 1 - ((clientY - rect.top) / rect.height) * 2);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(ground, hitP)) return null;
    const c = Math.floor(hitP.x), r = Math.floor(hitP.z);
    return c >= 0 && c < COLS && r >= 0 && r < ROWS ? { c, r } : null;
  }
  function project(x, y, z) {
    tmpV.set(x, y, z).project(camera);
    if (tmpV.z > 1) return null;
    return { x: (tmpV.x * 0.5 + 0.5) * cssW, y: (1 - (tmpV.y * 0.5 + 0.5)) * cssH };
  }

  // ---------- effects ----------
  let fx = [], fired = new Map(), leakT = 0;
  function addEvents(events) {
    for (const ev of events) {
      if (ev.e === 'bolt') { fx.push({ k: 'bolt', x1: ev.x1, z1: ev.y1, x2: ev.x2, z2: ev.y2, t: 0, life: 0.18, heavy: ev.heavy }); fired.set(ev.id, 0); }
      else if (ev.e === 'beam') { fx.push({ k: 'beam', x1: ev.x1, z1: ev.y1, x2: ev.x2, z2: ev.y2, t: 0, life: 0.34, heat: ev.heat }); fired.set(ev.id, 0); }
      else if (ev.e === 'burst') { fx.push({ k: 'lob', x1: ev.x1, z1: ev.y1, x2: ev.x2, z2: ev.y2, t: 0, life: 0.24, burn: ev.burn }); fx.push({ k: 'burst', x: ev.x2, z: ev.y2, r: ev.splash, t: -0.24, life: 0.5 }); fired.set(ev.id, 0); }
      else if (ev.e === 'pulse') { fx.push({ k: 'pulse', x: ev.x, z: ev.y, r: ev.range, t: 0, life: 0.7 }); fired.set(ev.id, 0); }
      else if (ev.e === 'kill') {
        const big = ev.type === 'toad' || ev.type === 'mothmother';
        if (ev.reward >= 5) fx.push({ k: 'coin', x: ev.x, z: ev.y, text: `+${ev.reward}`, t: 0, life: 0.95 });
        const n = tierName === 'low' ? (big ? 16 : 6) : big ? 48 : 14;
        const c = ev.type === 'firefly' ? [2, 2.2, 0.6] : ev.type === 'wisp' ? [0.8, 1.8, 2.2] : ev.type === 'mossback' ? [0.9, 2, 0.6] : [2.2, 1.6, 0.8];
        for (let i = 0; i < n; i++) { const a = (i / n) * TAU + hash(i, ev.reward) * 0.6, sp = 0.8 + hash(i, n) * 1.8; fx.push({ k: 'spark', x: ev.x, y: 0.35, z: ev.y, vx: Math.cos(a) * sp, vy: 1 + hash(n, i) * 2.4, vz: Math.sin(a) * sp, t: 0, life: 0.55 + hash(n, i) * 0.45, c }); }
        fx.push({ k: 'puff', x: ev.x, z: ev.y, t: 0, life: 0.6, big });
        if (big) { shakeT = 1; shakeAmp = 0.18; }
      } else if (ev.e === 'leak') { leakT = 0.5; shakeT = 1; shakeAmp = 0.08; }
      else if (ev.e === 'flare') { fx.push({ k: 'flare', x: ev.x, z: ev.y, r: ev.r, t: 0, life: 1 }); shakeT = 1; shakeAmp = 0.22; }
    }
  }
  function tickFx(dt) {
    leakT = Math.max(0, leakT - dt);
    shakeT = Math.max(0, shakeT - dt * 3);
    if (introT < 1) introT = Math.min(1, introT + dt / 2.4);
    focusK = focus ? Math.min(1, focusK + dt * 2.5) : Math.max(0, focusK - dt * 3);
    for (const [id, v] of fired) fired.set(id, v + dt);
    for (const f of fx) {
      f.t += dt;
      if (f.k === 'spark') { f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt; f.vy -= 5 * dt; f.vx *= 0.96; f.vz *= 0.96; if (f.y < 0.05) { f.y = 0.05; f.vy *= -0.3; } }
    }
    fx = fx.filter((f) => f.t < f.life);
  }
  function clearFx() { fx = []; fired = new Map(); leakT = 0; shakeT = 0; for (const [, c] of creatures) creatureRoot.remove(c.root); creatures.clear(); }

  // ---------- frame ----------
  const formOf = (t) => (t.tier < 2 ? t.tier : t.branch);
  function plantTemplate(type, form) {
    const k = `${type}:${form}`;
    if (!plantForms.has(k)) {
      const m = plantModel(type, form, { physical: tier.transmission });
      m.traverse((o) => { if (o.isMesh) { o.castShadow = tier.shadow > 0 && o.castShadow; } });
      plantForms.set(k, m);
    }
    return plantForms.get(k);
  }
  function creatureTemplate(type) {
    if (!creatureTemplates.has(type)) creatureTemplates.set(type, creatureModel(type));
    return creatureTemplates.get(type);
  }
  function cloneCreature(type) {
    const t = creatureTemplate(type);
    const root = t.root.clone(true);
    // re-find the animated parts in the clone by walking the same paths
    const path = (obj) => { const p = []; let o = obj; while (o && o !== t.root) { p.unshift(o.parent.children.indexOf(o)); o = o.parent; } return p; };
    const at = (p) => p.reduce((o, i) => o.children[i], root);
    const parts = { body: at(path(t.parts.body)), wings: t.parts.wings.map((w) => ({ ...w, g: at(path(w.g)) })), legs: t.parts.legs.map((l) => ({ ...l, g: at(path(l.g)) })) };
    root.traverse((o) => { if (o.isMesh) o.castShadow = o.castShadow && tierName !== 'low'; });
    return { root, parts };
  }

  let frameTimes = [], downgradeAt = 0;
  const lanternWorld = new THREE.Vector3();
  function draw(g, view) {
    const t = view.time;
    ensureWorld(g);
    placeCamera(t);
    const life = g.lives / g.maxLives;
    const flick = reduced ? 1 : 0.92 + 0.08 * Math.sin(t * 9) * Math.sin(t * 5.3) + (life < 0.35 ? 0.14 * Math.sin(t * 31) : 0);
    glowP.begin(); smokeP.begin();

    // lantern
    const lx = g.lantern.x, lz = g.lantern.y;
    lantern.position.set(lx - 0.25, 0, lz - 0.3);
    lantern.scale.setScalar(1.6);
    const hang = lantern.userData.hang;
    hang.rotation.x = reduced ? 0 : Math.sin(t * 1.3) * 0.08;
    hang.rotation.z = reduced ? 0 : Math.sin(t * 0.9) * 0.05;
    lantern.userData.paper.material.emissiveIntensity = (0.8 + 2.4 * life) * flick;
    hang.getWorldPosition(lanternWorld);
    lanternLight.position.copy(lanternWorld);
    lanternLight.intensity = (2 + 9 * life) * flick;
    lanternLight.distance = 3 + 6 * life;
    glowP.add(lanternWorld.x, lanternWorld.y, lanternWorld.z, (1.6 + 1.4 * life) * flick, 0.7, 0.32, 0.08, 0.8);
    const charge = flareCharge(g);
    flareRing.visible = g.phase === 'wave' || g.phase === 'ready';
    flareRing.position.set(lx, 0.04, lz);
    flareRing.scale.setScalar(FLARE_RADIUS);
    flareRing.material.opacity = charge >= 1 ? 0.55 + 0.25 * Math.sin(t * 5) : 0.12 + charge * 0.1;
    if (charge >= 1) glowP.add(lanternWorld.x, lanternWorld.y, lanternWorld.z, 2.4 + 0.3 * Math.sin(t * 5), 1, 0.7, 0.35, 0.6);

    // selection, hint, range
    hintMesh.visible = !!view.hint;
    if (view.hint) { hintMesh.position.set(view.hint.c + 0.5, 0.035, view.hint.r + 0.5); hintMesh.material.opacity = 0.35 + 0.25 * Math.sin(t * 4); }
    selMesh.visible = !!view.sel;
    if (view.sel) selMesh.position.set(view.sel.c + 0.5, 0.04, view.sel.r + 0.5);
    const st = view.selTower;
    rangeRing.visible = rangeDisc.visible = !!st;
    if (st) {
      const r = stats(st).range, c = col(PLANT_LIGHT[st.type]).multiplyScalar(1.5);
      for (const m of [rangeRing, rangeDisc]) { m.position.set(st.x, 0.05, st.y); m.scale.setScalar(r); m.material.color.copy(c); }
    }

    // plants
    const seen = new Set();
    let li = 0;
    for (const tw of g.towers) {
      seen.add(tw.id);
      const key = `${tw.type}:${formOf(tw)}`;
      let p = plants.get(tw.id);
      if (!p || p.key !== key) {
        if (p) plantRoot.remove(p.obj);
        const obj = plantTemplate(tw.type, formOf(tw)).clone(true);
        obj.position.set(tw.x, 0.02, tw.y);
        obj.rotation.y = TOWERS[tw.type].kind === 'beam' ? 0 : hash(tw.c, tw.r) * TAU;
        plantRoot.add(obj);
        p = { obj, key, born: t, spin: obj.getObjectByName('spin') };
        plants.set(tw.id, p);
      }
      const since = fired.get(tw.id) ?? 9;
      const grow = Math.min(1, (t - p.born) * 4);
      const pop = since < 0.2 ? 1 + 0.12 * Math.sin((since / 0.2) * Math.PI) : 1;
      const s = 1.45 * ease(grow);
      p.obj.scale.set(s, s * pop, s);
      p.obj.rotation.x = reduced ? 0 : Math.sin(t * 1.4 + tw.id) * 0.025;
      if (p.spin) p.spin.rotation.z = t * 1.5;
      const lc = col(PLANT_LIGHT[tw.type]);
      if (li < plantLights.length) {
        const l = plantLights[li++];
        l.position.set(tw.x, 1.0, tw.y); l.color.copy(lc); l.intensity = 1.3 + tw.tier * 0.35 + (since < 0.15 ? 1.2 : 0); l.distance = 2.8 + tw.tier * 0.4;
      }
      if (since < 0.12) glowP.add(tw.x, 0.75, tw.y, 0.45, lc.r * 0.6, lc.g * 0.6, lc.b * 0.6, 1 - since / 0.12);
    }
    for (; li < plantLights.length; li++) plantLights[li].intensity = 0;
    for (const [id, p] of plants) if (!seen.has(id)) { plantRoot.remove(p.obj); plants.delete(id); }

    // creatures
    const alive = new Set(), drawn = [];
    for (const e of g.enemies) {
      alive.add(e.id);
      let c = creatures.get(e.id);
      if (!c) { c = { ...cloneCreature(e.type), h: 0, x: e.x, z: e.y }; creatureRoot.add(c.root); creatures.set(e.id, c); }
      const prev = view.prev.get(e.id);
      const x = prev ? prev.x + (e.x - prev.x) * view.alpha : e.x, z = prev ? prev.y + (e.y - prev.y) * view.alpha : e.y;
      if (Math.hypot(x - c.x, z - c.z) > 1e-4) c.h = Math.atan2(x - c.x, z - c.z);
      c.x = x; c.z = z;
      const k = e.id * 1.37, frozen = e.stunLeft > 0 ? 0 : 1;
      c.root.position.set(x, 0, z);
      c.root.rotation.y = c.h;
      const sc = 1.45;
      c.root.scale.setScalar(sc);
      const P = c.parts;
      if (e.type === 'moth' || e.type === 'firefly' || e.type === 'mothmother') {
        const big = e.type === 'mothmother';
        c.root.position.y = Math.sin(t * (big ? 3 : 6) + k) * 0.05;
        const flap = Math.sin(t * (e.type === 'firefly' ? 30 : big ? 7 : 16) * frozen + k) * 0.85;
        for (const w of P.wings) w.g.rotation.z = w.s * (0.2 + flap * 0.65);
        if (e.type === 'firefly') glowP.add(x, 0.34 * sc, z, 0.5, 0.9, 1.1, 0.2, 0.8);
      } else if (e.type === 'wisp') {
        c.root.position.y = Math.sin(t * 3 + k) * 0.07;
        P.body.rotation.z = Math.sin(t * 4 + k) * 0.1;
        P.body.scale.set(1, 1 + Math.sin(t * 7 + k) * 0.06, 1);
        glowP.add(x, 0.55, z, 0.9, 0.25, 0.55, 0.7, 1);
      } else {
        const toad = e.type === 'toad';
        const hop = toad ? Math.abs(Math.sin(t * 3 * frozen + k)) * 0.14 : Math.abs(Math.sin(t * 9 * frozen + k)) * 0.015;
        c.root.position.y = hop;
        if (toad) P.body.scale.set(1, 1 + Math.sin(t * 6 * frozen + k) * 0.04, 1);
        for (const l of P.legs) l.g.rotation.y = Math.sin(t * 10 * frozen + k + l.j) * 0.3 * l.s;
        if (e.type === 'mossback' && tierName !== 'low') glowP.add(x, 0.4, z, 1.6, 0.06, 0.16, 0.04, 1);
      }
      // status: stars when stunned, frost motes when slowed, green when healed, a white flash when hit
      if (e.stunLeft > 0) for (let i = 0; i < 3; i++) { const a = t * 4 + (i / 3) * TAU; glowP.add(x + Math.cos(a) * 0.3, 0.85, z + Math.sin(a) * 0.3, 0.14, 1.6, 1.3, 0.5, 1); }
      if (e.slow > 0) for (let i = 0; i < 4; i++) { const a = t * 2 + (i / 4) * TAU + k; glowP.add(x + Math.cos(a) * 0.32, 0.25 + (i % 2) * 0.3, z + Math.sin(a) * 0.32, 0.1, 0.6, 1, 1.6, 0.9); }
      if (e.healed > 0) glowP.add(x, 0.5, z, 0.7, 0.3, 1, 0.3, e.healed);
      if (e.hitFlash > 0) glowP.add(x, 0.4, z, 0.9, 1.6, 1.6, 1.6, Math.min(1, e.hitFlash * 6));
      drawn.push([e, x, z]);
    }
    for (const [id, c] of creatures) if (!alive.has(id)) { creatureRoot.remove(c.root); creatures.delete(id); }

    // burning ground
    for (const p of g.patches) {
      const a = Math.min(1, p.left);
      for (let i = 0; i < (tierName === 'low' ? 4 : 9); i++) {
        const ang = hash(i, p.x) * TAU, rr = hash(p.y, i) * p.r * 0.8;
        glowP.add(p.x + Math.cos(ang) * rr, 0.06 + ((t * 0.8 + hash(i, 3)) % 1) * 0.45, p.y + Math.sin(ang) * rr, 0.22, 1.8, 0.5, 0.1, a * 0.9);
      }
      glowP.add(p.x, 0.08, p.y, p.r * 2.2, 0.6, 0.15, 0.03, a);
    }

    // effects
    let ringI = 0, beamI = 0, fxl = 0;
    const ring = (x, z, r, c, o) => { if (ringI >= ringPool.length) return; const m = ringPool[ringI++]; m.visible = true; m.position.set(x, 0.06, z); m.scale.setScalar(r); m.material.color.setRGB(c[0], c[1], c[2]); m.material.opacity = o; };
    const fxLight = (x, y, z, c, i, d) => { if (fxl >= fxLights.length) return; const l = fxLights[fxl++]; l.position.set(x, y, z); l.color.setRGB(c[0], c[1], c[2]); l.intensity = i; l.distance = d; };
    for (const f of fx) {
      const k = 1 - Math.max(0, f.t) / f.life;
      if (f.k === 'bolt') {
        const q = Math.min(1, f.t / (f.life * 0.75));
        const x = f.x1 + (f.x2 - f.x1) * q, z = f.z1 + (f.z2 - f.z1) * q, y = 0.62 - 0.3 * q;
        const c = f.heavy ? [0.5, 0.9, 3] : [0.6, 3, 2.2];
        glowP.add(x, y, z, f.heavy ? 0.32 : 0.22, ...c, 1);
        for (let j = 1; j <= 3; j++) glowP.add(x - (f.x2 - f.x1) * 0.05 * j, y + 0.01 * j, z - (f.z2 - f.z1) * 0.05 * j, 0.16 - j * 0.03, c[0] * 0.5, c[1] * 0.5, c[2] * 0.5, 1);
      } else if (f.k === 'beam') {
        if (beamI < beamPool.length) {
          const m = beamPool[beamI++], heat = 1 + (f.heat ?? 0) * 0.35;
          const from = new THREE.Vector3(f.x1, 1.1, f.z1), to = new THREE.Vector3(f.x2, 0.35, f.z2);
          m.visible = true; m.position.copy(from); m.lookAt(to);
          const w = 0.06 * k * heat;
          m.scale.set(w, w, from.distanceTo(to));
          m.material.opacity = k;
        }
        glowP.add(f.x2, 0.4, f.z2, 0.9 * k, 3, 2.2, 0.7, 1);
        fxLight(f.x2, 0.6, f.z2, [1, 0.8, 0.4], 8 * k, 3);
      } else if (f.k === 'lob') {
        const q = f.t / f.life;
        const x = f.x1 + (f.x2 - f.x1) * q, z = f.z1 + (f.z2 - f.z1) * q, y = 0.7 + Math.sin(q * Math.PI) * 1 - q * 0.45;
        glowP.add(x, y, z, 0.3, ...(f.burn ? [2.4, 0.6, 0.15] : [2.8, 1.2, 0.35]), 1);
        glowP.add(x, y + 0.08, z, 0.18, 1, 0.4, 0.1, 0.6);
      } else if (f.k === 'burst' && f.t > 0) {
        ring(f.x, f.z, f.r * (0.4 + 0.8 * (1 - k)), [2.5 * k, 0.9 * k, 0.2 * k], 1);
        glowP.add(f.x, 0.35, f.z, f.r * (0.9 + (1 - k) * 1.2), 2 * k, 0.8 * k, 0.15 * k, 1);
        fxLight(f.x, 0.6, f.z, [1, 0.45, 0.15], 10 * k, 3.4);
      } else if (f.k === 'pulse') {
        ring(f.x, f.z, f.r * (0.15 + 0.85 * (1 - k)), [0.7 * k, 1.3 * k, 2.2 * k], 1);
      } else if (f.k === 'flare') {
        const q = 1 - k;
        ring(f.x, f.z, f.r * (0.2 + 1 * ease(q)), [3 * k, 2.2 * k, 0.9 * k], 1);
        ring(f.x, f.z, f.r * (0.1 + 0.7 * ease(q)), [1.5 * k, 1 * k, 0.4 * k], 0.6);
        glowP.add(lanternWorld.x, lanternWorld.y, lanternWorld.z, 5 * ease(q) + 0.5, 2 * k, 1.5 * k, 0.8 * k, 1);
        fxLight(f.x, 1.2, f.z, [1, 0.75, 0.45], 40 * k, 7);
      } else if (f.k === 'spark') {
        glowP.add(f.x, f.y, f.z, 0.09, f.c[0] * k, f.c[1] * k, f.c[2] * k, 1);
      } else if (f.k === 'puff') {
        smokeP.add(f.x, 0.3 + (1 - k) * 0.4, f.z, (f.big ? 1.6 : 0.7) * (1.3 - k * 0.6), 0.55, 0.5, 0.65, 0.45 * k);
      }
    }
    for (; ringI < ringPool.length; ringI++) ringPool[ringI].visible = false;
    for (; beamI < beamPool.length; beamI++) beamPool[beamI].visible = false;
    for (; fxl < fxLights.length; fxl++) fxLights[fxl].intensity = 0;

    // ambient motes: fireflies, snow, rising embers
    const mc = col(R.motes);
    for (const m of motes) {
      let x = m.x, y = m.y, z = m.z;
      if (R.trees === 'frost') { y = (((m.y - t * (0.3 + m.s * 0.3)) % 6) + 6) % 6; x += Math.sin(t * 0.6 + m.s * 9) * 0.3; smokeP.add(x, y, z, 0.05 + m.s * 0.04, 0.9, 0.95, 1, 0.85); continue; }
      if (R.trees === 'ember') { y = (m.y + t * (0.2 + m.s * 0.3)) % 2.4; x += Math.sin(t * 0.8 + m.s * 9) * 0.2; }
      else { x += Math.sin(t * 0.4 + m.s * 20) * 0.5; y += Math.sin(t * 0.9 + m.s * 7) * 0.2; z += Math.cos(t * 0.3 + m.s * 11) * 0.5; }
      const tw = 0.5 + 0.5 * Math.sin(t * 3 + m.s * 30);
      glowP.add(x, y, z, 0.09 + 0.06 * tw, mc.r * (0.8 + tw * 1.4), mc.g * (0.8 + tw * 1.4), mc.b * (0.8 + tw * 1.4), 1);
    }
    const fc = col(R.fog).lerp(new THREE.Color(0xb0a8d8), 0.35);
    for (const m of mist) {
      const x = ((m.x + t * m.v + 2) % (COLS + 4)) - 2, z = m.z + Math.sin(t * 0.1 + m.ph) * 0.6;
      smokeP.add(x, 0.25, z, m.s, fc.r, fc.g, fc.b, 0.07 + 0.03 * Math.sin(t * 0.3 + m.ph));
    }
    glowP.end(); smokeP.end();

    skyMat.uniforms.uTime.value = t;
    starMat.uniforms.uTime.value = t;
    if (grassMat?.userData.shader) grassMat.userData.shader.uniforms.uTime.value = t;
    if (grade) { grade.uniforms.uTime.value = t; grade.uniforms.uGrain.value = tierName === 'low' ? 0 : 0.035; }
    composer.render();
    // the lightest look skips reflections altogether
    if (envPending && tierName !== 'low') setTimeout(() => { if (envPending && tierName !== 'low') buildEnvironment(); }, 400);

    // overlay: health bars, coin text, low-life vignette
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, cssW, cssH);
    for (const [e, x, z] of drawn) {
      if (e.hp >= e.maxHp) continue;
      const big = e.type === 'toad' || e.type === 'mothmother';
      const s = project(x, big ? 1.35 : 0.85, z);
      if (!s) continue;
      const w = big ? 42 : 24, h = big ? 5 : 4, f = Math.max(0, e.hp) / e.maxHp;
      octx.fillStyle = 'rgba(12,8,22,0.8)';
      octx.beginPath(); octx.roundRect(s.x - w / 2 - 1.5, s.y - 1.5, w + 3, h + 3, 3); octx.fill();
      octx.fillStyle = f > 0.5 ? '#9df08a' : f > 0.25 ? '#ffd36b' : '#ff7a5c';
      octx.beginPath(); octx.roundRect(s.x - w / 2, s.y, Math.max(1, w * f), h, 2); octx.fill();
    }
    octx.textAlign = 'center';
    octx.font = '800 16px system-ui, sans-serif';
    for (const f of fx) {
      if (f.k !== 'coin') continue;
      const s = project(f.x, 1 + f.t * 0.8, f.z);
      if (!s) continue;
      const k = 1 - f.t / f.life;
      octx.lineWidth = 3.5; octx.strokeStyle = `rgba(30,15,40,${k * 0.8})`; octx.strokeText(f.text, s.x, s.y);
      octx.fillStyle = `rgba(255,214,110,${k})`; octx.fillText(f.text, s.x, s.y);
    }
    if (leakT > 0 || life < 0.3) {
      const a = Math.max((leakT / 0.5) * 0.5, life < 0.3 ? 0.18 + 0.08 * Math.sin(t * 4) : 0) * (reduced ? 0.6 : 1);
      const gr = octx.createRadialGradient(cssW / 2, cssH / 2, Math.min(cssW, cssH) * 0.35, cssW / 2, cssH / 2, Math.max(cssW, cssH) * 0.75);
      gr.addColorStop(0, 'rgba(255,60,40,0)'); gr.addColorStop(1, `rgba(255,60,40,${a})`);
      octx.fillStyle = gr; octx.fillRect(0, 0, cssW, cssH);
    }

    // automatic quality: step down when the frame rate stays low (never back up within a session)
    if (opts.autoQuality !== false && !titleMode) {
      const now = performance.now();
      frameTimes.push(now);
      while (frameTimes.length && now - frameTimes[0] > 3000) frameTimes.shift();
      if (frameTimes.length > 30 && now > downgradeAt) {
        const fps = (frameTimes.length - 1) / ((now - frameTimes[0]) / 1000);
        if (fps < 40 && tierName !== 'low') { setQuality(tierName === 'high' ? 'medium' : 'low', g); downgradeAt = now + 6000; frameTimes = []; }
      }
    }
  }

  function setQuality(name, g) {
    if (!TIERS[name]) return;
    tierName = name;
    applyTier();
    if (g) resize(g, cssW, cssH);
    opts.onQuality?.(name);
  }

  // ---------- icons: one plant, rendered straight to the canvas and copied out ----------
  const iconScene = new THREE.Scene();
  iconScene.environmentIntensity = 0.5;
  iconScene.add(new THREE.HemisphereLight(0xc8c0ff, 0x302040, 1.4));
  const iconSun = new THREE.DirectionalLight(0xffffff, 2.2); iconSun.position.set(2, 3, 2); iconScene.add(iconSun);
  const iconCam = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
  iconCam.position.set(1.25, 1.2, 1.75); iconCam.lookAt(0, 0.36, 0);
  function snapshot(type, form, target, bg = [0.12, 0.09, 0.2]) {
    const pr = renderer.getPixelRatio();
    const css = target.clientWidth || 64;
    const size = Math.round(css * pr);
    const W = renderer.domElement.width, H = renderer.domElement.height;
    if (W < size || H < size) return;
    const model = plantModel(type, form, { physical: false });
    iconScene.add(model);
    iconScene.background = new THREE.Color().setRGB(bg[0], bg[1], bg[2], THREE.SRGBColorSpace);
    renderer.setScissorTest(true);
    renderer.setScissor(0, 0, css, css);
    renderer.setViewport(0, 0, css, css);
    renderer.render(iconScene, iconCam);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, cssW, cssH);
    iconScene.remove(model);
    target.width = size; target.height = size;
    const c = target.getContext('2d');
    c.clearRect(0, 0, size, size);
    c.drawImage(renderer.domElement, 0, H - size, size, size, 0, 0, size, size);
  }

  applyTier();
  return {
    kind: '3d',
    resize, cellAt, draw, addEvents, tickFx, clearFx, project, snapshot,
    intro() { introT = reduced ? 1 : 0; },
    skipIntro() { introT = 1; },
    get introDone() { return introT >= 1; },
    setTitle(v) { titleMode = v; },
    setFocus(p) { focus = p ? { x: p.x, z: p.y } : null; },
    setLowFx(v, g) { setQuality(v ? 'low' : defaultTier, g); },
    setQuality,
    get quality() { return tierName; },
  };
}
