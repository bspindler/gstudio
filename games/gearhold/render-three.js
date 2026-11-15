// Gearhold three.js renderer (three.js is the shared core library, ../sdk/vendor/three.module.js). It keeps the game's
// own look (the same lit flat-shaded brass shading, sun shadow, fog, procedural sky and billboards, as three ShaderMaterials)
// and adds a restrained bloom on the light sources only. Same interface as the plain WebGL2 renderer in render3d.js,
// which stays as the fallback. Only parts exported by scripts/vendor/three-entry.js are used.
import * as THREE from '../sdk/vendor/three.module.js';

const lin = (c) => c.map((v) => Math.pow(v, 2.2));
const SHADOW_SIZE = 2048;
const MAX_LIGHTS = 16;
const NO_BLENDING = 0; // three's NoBlending (not in the bundle's export list)

const LIT_VS = `
attribute vec3 aCol; attribute float aEmi;
uniform mat4 uSunVP;
varying vec3 vPos; varying vec3 vN; varying vec3 vCol; varying float vEmi; varying vec4 vSun;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPos = w.xyz; vN = transpose(inverse(mat3(modelMatrix))) * normal; vCol = aCol; vEmi = aEmi; vSun = uSunVP * w;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const LIT_FS = `
varying vec3 vPos; varying vec3 vN; varying vec3 vCol; varying float vEmi; varying vec4 vSun;
uniform vec3 uEye, uSunDir, uSunCol, uSky, uGround, uFogCol, uTint;
uniform float uFog, uShadowOn, uFlash, uEmi;
uniform int uNL; uniform vec4 uLP[${MAX_LIGHTS}]; uniform vec3 uLC[${MAX_LIGHTS}];
uniform sampler2D uShadow; uniform vec2 uTexel;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float shadowAt() {
  vec3 p = vSun.xyz / vSun.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float s = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
    float d = dot(texture2D(uShadow, p.xy + vec2(float(i), float(j)) * uTexel), vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0));
    s += (p.z - 0.002 <= d) ? 1.0 : 0.0;
  }
  return s / 9.0;
}
void main() {
  vec3 base = pow(vCol, vec3(2.2)) * uTint;
  float dist = length(uEye - vPos);
  float fogF = exp(-uFog * dist);
  vec3 col;
  if (vEmi > 0.5) {
    col = base * (1.6 * uEmi + 0.15) + base * uFlash * 2.0;
  } else {
    vec3 n = normalize(vN);
    vec3 V = normalize(uEye - vPos);
    float sh = uShadowOn > 0.5 ? shadowAt() : 1.0;
    float ndl = max(dot(n, uSunDir), 0.0);
    vec3 amb = mix(uGround, uSky, n.y * 0.5 + 0.5);
    vec3 H = normalize(uSunDir + V);
    float spec = pow(max(dot(n, H), 0.0), 70.0) * 0.55;
    float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
    col = base * (amb * 0.42 + uSunCol * ndl * sh) + uSunCol * spec * sh + uSky * fres * 0.1;
    for (int i = 0; i < ${MAX_LIGHTS}; i++) {
      if (i >= uNL) break;
      vec3 d = uLP[i].xyz - vPos; float L = length(d);
      float a = max(0.0, 1.0 - L / uLP[i].w); a *= a;
      vec3 l = d / max(L, 0.001);
      col += (base * max(dot(n, l), 0.0) + pow(max(dot(n, normalize(l + V)), 0.0), 40.0) * 0.35) * uLC[i] * a;
    }
    col += base * uFlash * 3.0;
  }
  col = mix(uFogCol, col, fogF);
  gl_FragColor = vec4(pow(aces(col), vec3(1.0 / 2.2)), 1.0);
}`;
const DEPTH_VS = `
uniform mat4 uSunVP; varying float vZ;
void main() { vec4 c = uSunVP * modelMatrix * vec4(position, 1.0); vZ = c.z / c.w * 0.5 + 0.5; gl_Position = c; }`;
const DEPTH_FS = `
varying float vZ;
void main() {
  vec4 e = fract(clamp(vZ, 0.0, 1.0) * vec4(1.0, 255.0, 65025.0, 16581375.0));
  e -= e.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
  gl_FragColor = e;
}`;
const SKY_VS = `
varying vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
const SKY_FS = `
varying vec2 vNdc;
uniform mat4 uInvVP; uniform vec3 uEye, uTop, uHor, uCloud, uSunDir, uSunCol; uniform float uTime, uStars;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec4 w = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 d = normalize(w.xyz / w.w - uEye);
  float y = d.y;
  vec3 c = mix(uHor, uTop, pow(clamp(y, 0.0, 1.0), 0.5));
  if (y < 0.0) {
    vec2 p = d.xz / (-y + 0.03) * 0.35 + vec2(uTime * 0.012, uTime * 0.004);
    float n = fbm(p);
    vec3 sea = mix(uCloud * 0.55, uCloud, smoothstep(0.35, 0.8, n));
    c = mix(uHor, sea, smoothstep(0.0, 0.08, -y));
  }
  float sd = max(dot(d, uSunDir), 0.0);
  c += uSunCol * (pow(sd, 900.0) * 8.0 + pow(sd, 40.0) * 0.35 + pow(sd, 6.0) * 0.12);
  if (uStars > 0.5 && y > 0.05) {
    vec2 g = vec2(atan(d.z, d.x) * 120.0, y * 180.0);
    float h = hash(floor(g));
    float s = step(0.992, h) * smoothstep(0.5, 0.0, length(fract(g) - 0.5)) * smoothstep(0.05, 0.4, y);
    c += vec3(s) * 1.6;
  }
  gl_FragColor = vec4(pow(aces(c), vec3(1.0 / 2.2)), 1.0);
}`;
const BILL_VS = `
attribute vec3 aCenter; attribute vec2 aCorner; attribute float aSize; attribute vec4 aCol;
uniform vec3 uRight, uUp;
varying vec2 vC; varying vec4 vCol; varying vec3 vPos;
void main() {
  vec3 p = aCenter + (uRight * aCorner.x + uUp * aCorner.y) * aSize;
  vC = aCorner; vCol = aCol; vPos = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const BILL_FS = `
varying vec2 vC; varying vec4 vCol; varying vec3 vPos;
uniform vec3 uEye; uniform float uFog, uAdd;
void main() {
  float r = length(vC);
  if (r > 1.0) discard;
  float fogF = exp(-uFog * length(uEye - vPos));
  if (uAdd > 0.5) { float a = pow(1.0 - r, 3.0); gl_FragColor = vec4(vCol.rgb * a * vCol.a * fogF, 1.0); }
  else { float a = smoothstep(1.0, 0.55, r) * vCol.a; gl_FragColor = vec4(vCol.rgb, a * fogF); }
}`;

const v3 = (a = [0, 0, 0]) => new THREE.Vector3(a[0], a[1], a[2]);
const u = (value) => ({ value });
const arr = (n, make) => Array.from({ length: n }, make);

// Vertex layout everywhere: position(3) normal(3) colour(3, sRGB) emissive(1), split into attributes.
function fillGeometry(geo, data, count) {
  const n = count ?? data.length / 10;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Float32Array(n * 3), emi = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 10;
    pos[i * 3] = data[o]; pos[i * 3 + 1] = data[o + 1]; pos[i * 3 + 2] = data[o + 2];
    nrm[i * 3] = data[o + 3]; nrm[i * 3 + 1] = data[o + 4]; nrm[i * 3 + 2] = data[o + 5];
    col[i * 3] = data[o + 6]; col[i * 3 + 1] = data[o + 7]; col[i * 3 + 2] = data[o + 8];
    emi[i] = data[o + 9];
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aEmi', new THREE.BufferAttribute(emi, 1));
  return geo;
}

export function createThreeRenderer(canvas, M4, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 is required');
  renderer.autoClear = true;
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 1);
  renderer.toneMapping = THREE.NoToneMapping; // the shaders tone-map themselves, so the output is already display colour
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  // A software rasteriser can't carry bloom: it renders plainly.
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const software = /swiftshader|llvmpipe|software|basic render/i.test(String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)));
  let useBloom = !software && opts.bloom !== false;

  const camera = new THREE.PerspectiveCamera();
  camera.matrixAutoUpdate = false;
  const scene = new THREE.Scene();
  const shadowScene = new THREE.Scene();
  const shadowCam = new THREE.PerspectiveCamera();
  const shadowRT = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
  shadowRT.texture.generateMipmaps = false;

  // uniforms shared by every lit material of the main pass
  const U = {
    uEye: u(v3()), uSunDir: u(v3()), uSunCol: u(v3()), uSky: u(v3()), uGround: u(v3()), uFogCol: u(v3()),
    uFog: u(0), uShadowOn: u(1), uNL: u(0),
    uLP: u(arr(MAX_LIGHTS, () => new THREE.Vector4())), uLC: u(arr(MAX_LIGHTS, () => new THREE.Vector3())),
    uShadow: u(shadowRT.texture), uTexel: u(new THREE.Vector2(1 / SHADOW_SIZE, 1 / SHADOW_SIZE)),
    uSunVP: u(new THREE.Matrix4()),
  };
  const litMaterial = (shared) => new THREE.ShaderMaterial({
    vertexShader: LIT_VS, fragmentShader: LIT_FS, fog: false, lights: false, side: THREE.DoubleSide,
    uniforms: { ...shared, uTint: u(v3([1, 1, 1])), uFlash: u(0), uEmi: u(1) },
  });
  const depthMat = new THREE.ShaderMaterial({
    vertexShader: DEPTH_VS, fragmentShader: DEPTH_FS, uniforms: { uSunVP: U.uSunVP }, blending: NO_BLENDING,
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4,
  });

  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VS, fragmentShader: SKY_FS, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide,
    uniforms: {
      uInvVP: u(new THREE.Matrix4()), uEye: U.uEye, uTop: u(v3()), uHor: u(v3()), uCloud: u(v3()), uSunDir: U.uSunDir, uSunCol: U.uSunCol,
      uTime: u(0), uStars: u(0),
    },
  });
  const skyMesh = new THREE.Mesh(tri, skyMat);
  skyMesh.frustumCulled = false; skyMesh.renderOrder = -10; skyMesh.matrixAutoUpdate = false;
  scene.add(skyMesh);

  // pooled meshes for the frame's draws (main pass and shadow pass)
  const pool = [], shadowPool = [];
  function slot(list, parent, i, material) {
    let m = list[i];
    if (!m) {
      m = new THREE.Mesh(tri, material());
      m.frustumCulled = false; m.matrixAutoUpdate = false;
      list.push(m); parent.add(m);
    }
    return m;
  }
  function place(m, d) {
    m.geometry = d.mesh.geo;
    m.matrix.fromArray(d.model);
    m.matrixWorldNeedsUpdate = true;
    m.visible = true;
  }

  // billboards: one dynamic geometry per blend mode
  const bills = [0, 1].map((add) => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: BILL_VS, fragmentShader: BILL_FS, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
      blending: add ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uRight: u(v3()), uUp: u(v3()), uEye: U.uEye, uFog: u(0), uAdd: u(add) },
    });
    const b = { cap: 0, geo: null, mesh: new THREE.Mesh(new THREE.BufferGeometry(), mat), data: null, mat };
    b.mesh.frustumCulled = false; b.mesh.matrixAutoUpdate = false; b.mesh.renderOrder = add ? 2 : 1; b.mesh.visible = false;
    scene.add(b.mesh);
    return b;
  });
  function ensureBill(b, n) {
    if (b.cap >= n) return;
    b.cap = Math.max(256, b.cap * 2, n);
    b.mesh.geometry.dispose();
    const g = new THREE.BufferGeometry(), v = b.cap * 6;
    b.arrays = { aCenter: new Float32Array(v * 3), aCorner: new Float32Array(v * 2), aSize: new Float32Array(v), aCol: new Float32Array(v * 4) };
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v * 3), 3)); // unused, gives three its vertex count
    g.setAttribute('aCenter', new THREE.BufferAttribute(b.arrays.aCenter, 3));
    g.setAttribute('aCorner', new THREE.BufferAttribute(b.arrays.aCorner, 2));
    g.setAttribute('aSize', new THREE.BufferAttribute(b.arrays.aSize, 1));
    g.setAttribute('aCol', new THREE.BufferAttribute(b.arrays.aCol, 4));
    b.mesh.geometry = g;
  }

  // first-person pass
  const vm = {
    uniforms: {
      uEye: u(v3()), uSunDir: u(v3()), uSunCol: U.uSunCol, uSky: U.uSky, uGround: U.uGround, uFogCol: U.uFogCol,
      uFog: u(0), uShadowOn: u(0), uNL: u(0),
      uLP: u(arr(1, () => new THREE.Vector4())), uLC: u(arr(1, () => new THREE.Vector3())),
      uShadow: U.uShadow, uTexel: U.uTexel, uSunVP: U.uSunVP,
    },
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), cap: 0,
  };
  vm.camera.matrixAutoUpdate = false;
  vm.material = litMaterial(vm.uniforms);
  vm.mesh = new THREE.Mesh(new THREE.BufferGeometry(), vm.material);
  vm.mesh.frustumCulled = false;
  vm.scene.add(vm.mesh);

  // post
  let composer = null, bloomPass = null, size = [canvas.width || 1, canvas.height || 1];
  function buildComposer() {
    composer?.dispose();
    composer = null; bloomPass = null;
    if (!useBloom) return;
    const [w, h] = size;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    composer = new THREE.EffectComposer(renderer, rt);
    composer.addPass(new THREE.RenderPass(scene, camera));
    // Restrained: a high threshold keeps it to light sources (lamps, glows, sparks), never the whole frame.
    bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(w, h), 0.35, 0.4, 0.97);
    composer.addPass(bloomPass);
  }

  let S = null, rendered = false;
  const tmp = new THREE.Matrix4();

  function renderMain() {
    if (rendered) return;
    rendered = true;
    renderer.setRenderTarget(null);
    renderer.setViewport(0, 0, canvas.width, canvas.height);
    if (useBloom) {
      try {
        if (!composer) buildComposer();
        if (composer) { composer.render(); return; }
      } catch (e) {
        console.warn('gearhold: bloom off,', e && e.message);
        useBloom = false; composer = null;
        renderer.setRenderTarget(null);
      }
    }
    renderer.autoClear = true;
    renderer.render(scene, camera);
  }

  return {
    kind: 'three',
    geometry(data) { return fillGeometry(new THREE.BufferGeometry(), data); },
    freeGeometry(g) { g?.dispose(); },
    resize(w, h) {
      size = [w, h];
      renderer.setSize(w, h, false);
      if (composer) composer.setSize(w, h);
    },

    begin(f) {
      rendered = false;
      const mood = f.mood;
      const sunDir = (() => { const s = mood.sunDir, l = Math.hypot(...s); return s.map((x) => x / l); })();
      S = { ...f, sunDir };
      S.vp = M4.mul(f.proj, f.view);
      const c = f.center, r = f.radius;
      const eye = [c[0] + sunDir[0] * 60, c[1] + sunDir[1] * 60, c[2] + sunDir[2] * 60];
      const sunVP = M4.mul(M4.ortho(-r, r, -r, r, 1, 140), M4.lookAt(eye, c, Math.abs(sunDir[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]));
      U.uSunVP.value.fromArray(sunVP);

      camera.projectionMatrix.fromArray(f.proj);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      camera.matrixWorldInverse.fromArray(f.view);
      camera.matrix.copy(camera.matrixWorldInverse).invert();
      camera.matrixWorld.copy(camera.matrix);
      camera.matrixWorldNeedsUpdate = false;

      U.uEye.value.fromArray(f.eye); U.uSunDir.value.fromArray(sunDir);
      U.uSunCol.value.fromArray(mood.sunColor.map((x) => x * 0.8));
      U.uSky.value.fromArray(lin(mood.ambient)); U.uGround.value.fromArray(lin(mood.ground)); U.uFogCol.value.fromArray(lin(mood.skyHorizon));
      U.uFog.value = mood.fog; U.uShadowOn.value = 1;
      const n = Math.min(MAX_LIGHTS, f.lights.length);
      for (let i = 0; i < n; i++) {
        const l = f.lights[i];
        U.uLP.value[i].set(l.p[0], l.p[1], l.p[2], l.r);
        U.uLC.value[i].set(l.c[0], l.c[1], l.c[2]);
      }
      U.uNL.value = n;
      skyMat.uniforms.uTop.value.fromArray(lin(mood.skyTop));
      skyMat.uniforms.uHor.value.fromArray(lin(mood.skyHorizon));
      skyMat.uniforms.uCloud.value.fromArray(lin(mood.cloud));
      skyMat.uniforms.uStars.value = mood.stars || 0;
      for (const b of bills) b.mat.uniforms.uFog.value = mood.fog;
      for (const b of bills) b.mesh.visible = false;
      renderer.setViewport(0, 0, canvas.width, canvas.height);
    },

    shadows(draws) {
      let n = 0;
      for (const d of draws) {
        if (d.noShadow) continue;
        const m = slot(shadowPool, shadowScene, n++, () => depthMat);
        place(m, d);
      }
      for (let i = n; i < shadowPool.length; i++) shadowPool[i].visible = false;
      renderer.setRenderTarget(shadowRT);
      renderer.setClearColor(0xffffff, 1);
      renderer.autoClear = true;
      renderer.render(shadowScene, shadowCam);
      renderer.setClearColor(0x000000, 1);
      renderer.setRenderTarget(null);
    },

    sky(time) {
      skyMat.uniforms.uTime.value = time;
      tmp.fromArray(S.vp).invert();
      skyMat.uniforms.uInvVP.value.copy(tmp);
    },

    draw(draws) {
      draws.forEach((d, i) => {
        const m = slot(pool, scene, i, () => litMaterial(U));
        place(m, d);
        const un = m.material.uniforms, t = d.tint || [1, 1, 1];
        un.uTint.value.set(t[0], t[1], t[2]); un.uFlash.value = d.flash || 0; un.uEmi.value = d.emi ?? 1;
      });
      for (let i = draws.length; i < pool.length; i++) pool[i].visible = false;
    },

    // items: { p:[x,y,z], size, c:[r,g,b] (linear), a, add }. The scene is drawn here, after everything it holds is set.
    billboards(items) {
      if (items.length) {
        const right = [S.view[0], S.view[4], S.view[8]], up = [S.view[1], S.view[5], S.view[9]];
        for (const add of [0, 1]) {
          const b = bills[add], list = items.filter((x) => !!x.add === !!add);
          if (!list.length) continue;
          ensureBill(b, list.length);
          const { aCenter, aCorner, aSize, aCol } = b.arrays;
          let v = 0;
          for (const it of list) {
            for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) {
              aCenter[v * 3] = it.p[0]; aCenter[v * 3 + 1] = it.p[1]; aCenter[v * 3 + 2] = it.p[2];
              aCorner[v * 2] = cx; aCorner[v * 2 + 1] = cy; aSize[v] = it.size;
              aCol[v * 4] = it.c[0]; aCol[v * 4 + 1] = it.c[1]; aCol[v * 4 + 2] = it.c[2]; aCol[v * 4 + 3] = it.a ?? 1;
              v++;
            }
          }
          const g = b.mesh.geometry;
          for (const k of ['aCenter', 'aCorner', 'aSize', 'aCol']) g.attributes[k].needsUpdate = true;
          g.setDrawRange(0, v);
          b.mat.uniforms.uRight.value.fromArray(right); b.mat.uniforms.uUp.value.fromArray(up);
          b.mesh.visible = true;
        }
      }
      renderMain();
    },

    // First-person pass: `data` is vertices already in view space (camera at origin looking down -z).
    viewmodel(data, proj, flashLight) {
      renderMain();
      const n = data.length / 10;
      if (n > vm.cap) {
        vm.cap = Math.max(n, vm.cap * 2, 1024);
        vm.mesh.geometry.dispose();
        vm.mesh.geometry = fillGeometry(new THREE.BufferGeometry(), new Float32Array(vm.cap * 10), vm.cap);
        for (const a of Object.values(vm.mesh.geometry.attributes)) a.setUsage(THREE.DynamicDrawUsage ?? 35048);
      }
      const g = vm.mesh.geometry, A = g.attributes;
      for (let i = 0; i < n; i++) {
        const o = i * 10;
        A.position.array.set(data.subarray(o, o + 3), i * 3);
        A.normal.array.set(data.subarray(o + 3, o + 6), i * 3);
        A.aCol.array.set(data.subarray(o + 6, o + 9), i * 3);
        A.aEmi.array[i] = data[o + 9];
      }
      for (const k of ['position', 'normal', 'aCol', 'aEmi']) A[k].needsUpdate = true;
      g.setDrawRange(0, n);
      const v = S.view, sd = S.sunDir;
      vm.uniforms.uSunDir.value.set(
        v[0] * sd[0] + v[4] * sd[1] + v[8] * sd[2], v[1] * sd[0] + v[5] * sd[1] + v[9] * sd[2], v[2] * sd[0] + v[6] * sd[1] + v[10] * sd[2],
      );
      let nl = 0;
      if (flashLight) {
        vm.uniforms.uLP.value[0].set(flashLight.p[0], flashLight.p[1], flashLight.p[2], flashLight.r);
        vm.uniforms.uLC.value[0].set(flashLight.c[0], flashLight.c[1], flashLight.c[2]);
        nl = 1;
      }
      vm.uniforms.uNL.value = nl;
      vm.material.uniforms.uTint.value.fromArray(S.vmTint || [1, 1, 1]);
      vm.camera.projectionMatrix.fromArray(proj);
      vm.camera.projectionMatrixInverse.copy(vm.camera.projectionMatrix).invert();
      renderer.setRenderTarget(null);
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(vm.scene, vm.camera);
      renderer.autoClear = true;
    },
  };
}
