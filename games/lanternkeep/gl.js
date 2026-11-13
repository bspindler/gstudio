// Lanternkeep WebGL2 engine: flat-shaded lit meshes under moonlight (with a shadow map), up to
// MAX_LIGHTS coloured point lights, fog into a night sky with stars and a moon, and additive
// billboards for glows and particles. No libraries. Adapted from Gearhold's renderer.
// Vertex layout: position(3) normal(3) colour(3, sRGB 0..1) emissive(1).

export const MAX_LIGHTS = 24;

// ---------- small matrix library (column-major) ----------
export const M4 = {
  ident() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  },
  persp(fovy, asp, n, f) {
    const t = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
    m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = (2 * f * n) / (n - f);
    return m;
  },
  ortho(l, r, b, t, n, f) {
    const m = new Float32Array(16);
    m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = -2 / (f - n);
    m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = -(f + n) / (f - n); m[15] = 1;
    return m;
  },
  lookAt(e, a, up) {
    let z = [e[0] - a[0], e[1] - a[1], e[2] - a[2]];
    const zl = Math.hypot(...z); z = z.map((v) => v / zl);
    let x = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]];
    const xl = Math.hypot(...x) || 1; x = x.map((v) => v / xl);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    const m = new Float32Array(16);
    m[0] = x[0]; m[4] = x[1]; m[8] = x[2];
    m[1] = y[0]; m[5] = y[1]; m[9] = y[2];
    m[2] = z[0]; m[6] = z[1]; m[10] = z[2];
    m[12] = -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]);
    m[13] = -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]);
    m[14] = -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]);
    m[15] = 1;
    return m;
  },
  // translate * rotY * rotX * rotZ * scale
  trs(x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
    const cy = Math.cos(ry), syn = Math.sin(ry), cx = Math.cos(rx), sxn = Math.sin(rx), cz = Math.cos(rz), szn = Math.sin(rz);
    const r00 = cy * cz + syn * sxn * szn, r10 = cx * szn, r20 = -syn * cz + cy * sxn * szn;
    const r01 = -cy * szn + syn * sxn * cz, r11 = cx * cz, r21 = syn * szn + cy * sxn * cz;
    const r02 = syn * cx, r12 = -sxn, r22 = cy * cx;
    const m = new Float32Array(16);
    m[0] = r00 * sx; m[1] = r10 * sx; m[2] = r20 * sx;
    m[4] = r01 * sy; m[5] = r11 * sy; m[6] = r21 * sy;
    m[8] = r02 * sz; m[9] = r12 * sz; m[10] = r22 * sz;
    m[12] = x; m[13] = y; m[14] = z; m[15] = 1;
    return m;
  },
  invert(m) {
    const a = m, o = new Float32Array(16);
    const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4];
    const b03 = a[1] * a[6] - a[2] * a[5], b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
    const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12], b08 = a[8] * a[15] - a[11] * a[12];
    const b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
    const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
    o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det; o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
    o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det; o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
    o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det; o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
    o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det; o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
    o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det; o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
    o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det; o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
    o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det; o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
    o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det; o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
    return o;
  },
  normal(m) {
    const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C || 1;
    return new Float32Array([
      A / det, (-(b * i - c * h)) / det, (b * f - c * e) / det,
      B / det, (a * i - c * g) / det, (-(a * f - c * d)) / det,
      C / det, (-(a * h - b * g)) / det, (a * e - b * d) / det,
    ]);
  },
  apply(m, [x, y, z]) {
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w, w];
  },
};

export const lin = (c) => c.map((v) => Math.pow(v, 2.2));

// ---------- shaders ----------
const LIT_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec3 aCol; layout(location=3) in float aEmi;
uniform mat4 uVP, uM, uSunVP; uniform mat3 uN;
out vec3 vPos; out vec3 vN; out vec3 vCol; out float vEmi; out vec4 vSun;
void main() {
  vec4 w = uM * vec4(aPos, 1.0);
  vPos = w.xyz; vN = uN * aNrm; vCol = aCol; vEmi = aEmi; vSun = uSunVP * w;
  gl_Position = uVP * w;
}`;
const LIT_FS = `#version 300 es
precision highp float; precision highp sampler2DShadow;
in vec3 vPos; in vec3 vN; in vec3 vCol; in float vEmi; in vec4 vSun;
uniform vec3 uEye, uSunDir, uSunCol, uSky, uGround, uFogCol, uTint;
uniform float uFog, uFogStart, uShadowOn, uFlash, uEmi, uAlpha;
uniform int uNL; uniform vec4 uLP[${MAX_LIGHTS}]; uniform vec3 uLC[${MAX_LIGHTS}];
uniform sampler2DShadow uShadow; uniform vec2 uTexel;
out vec4 o;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float shadowAt() {
  vec3 p = vSun.xyz / vSun.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float s = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) s += texture(uShadow, vec3(p.xy + vec2(i, j) * uTexel, p.z - 0.0015));
  return s / 9.0;
}
void main() {
  vec3 base = pow(vCol, vec3(2.2)) * uTint;
  float dist = length(uEye - vPos);
  float fogF = exp(-uFog * max(0.0, dist - uFogStart));
  vec3 col;
  if (vEmi > 0.95) {
    col = base * (2.6 * uEmi + 0.2) + vec3(uFlash) * 1.5;
  } else {
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;
    vec3 V = normalize(uEye - vPos);
    float sh = uShadowOn > 0.5 ? shadowAt() : 1.0;
    float ndl = max(dot(n, uSunDir), 0.0);
    vec3 amb = mix(uGround, uSky, n.y * 0.5 + 0.5);
    float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
    col = base * (amb + uSunCol * ndl * sh) + uSky * fres * 0.25;
    for (int i = 0; i < ${MAX_LIGHTS}; i++) {
      if (i >= uNL) break;
      vec3 d = uLP[i].xyz - vPos; float L = length(d);
      float a = max(0.0, 1.0 - L / uLP[i].w); a *= a;
      vec3 l = d / max(L, 0.001);
      float wrap = max(dot(n, l) * 0.75 + 0.25, 0.0);
      col += (base * wrap + pow(max(dot(n, normalize(l + V)), 0.0), 32.0) * 0.25) * uLC[i] * a;
    }
    col += base * uFlash * 2.5 + base * vEmi * 2.2;
  }
  col = mix(uFogCol, col, fogF);
  o = vec4(pow(aces(col), vec3(1.0 / 2.2)), uAlpha);
}`;
const DEPTH_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uSunVP, uM;
void main() { gl_Position = uSunVP * uM * vec4(aPos, 1.0); }`;
const DEPTH_FS = `#version 300 es
precision mediump float; out vec4 o; void main() { o = vec4(1.0); }`;
const SKY_VS = `#version 300 es
out vec2 vNdc;
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2.0 - 1.0; vNdc = p; gl_Position = vec4(p, 0.9999, 1.0); }`;
const SKY_FS = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform mat4 uInvVP; uniform vec3 uEye, uTop, uHor, uMoonDir, uMoonCol, uAur; uniform float uTime;
out vec4 o;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec4 w = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 d = normalize(w.xyz / w.w - uEye);
  float y = d.y;
  vec3 c = mix(uHor, uTop, pow(clamp(y * 1.4, 0.0, 1.0), 0.6));
  // a soft band of colour low in the sky, different per region
  float band = noise(vec2(atan(d.z, d.x) * 3.0 + uTime * 0.02, y * 6.0)) * smoothstep(0.05, 0.25, y) * smoothstep(0.6, 0.25, y);
  c += uAur * band * 0.6;
  float md = max(dot(d, uMoonDir), 0.0);
  c += uMoonCol * (smoothstep(0.9993, 0.9996, md) * 3.0 + pow(md, 60.0) * 0.25 + pow(md, 8.0) * 0.05);
  if (y > 0.02) {
    vec2 g = vec2(atan(d.z, d.x) * 140.0, y * 200.0);
    float h = hash(floor(g));
    float tw = 0.6 + 0.4 * sin(uTime * 2.0 + h * 40.0);
    float s = step(0.988, h) * smoothstep(0.5, 0.0, length(fract(g) - 0.5)) * smoothstep(0.02, 0.3, y) * tw;
    c += vec3(0.9, 0.92, 1.0) * s * 1.4;
  }
  o = vec4(pow(aces(c), vec3(1.0 / 2.2)), 1.0);
}`;
const BILL_VS = `#version 300 es
layout(location=0) in vec3 aCenter; layout(location=1) in vec2 aCorner; layout(location=2) in float aSize; layout(location=3) in vec4 aCol;
uniform mat4 uVP; uniform vec3 uRight, uUp;
out vec2 vC; out vec4 vCol; out vec3 vPos;
void main() {
  vec3 p = aCenter + (uRight * aCorner.x + uUp * aCorner.y) * aSize;
  vC = aCorner; vCol = aCol; vPos = p;
  gl_Position = uVP * vec4(p, 1.0);
}`;
const BILL_FS = `#version 300 es
precision highp float;
in vec2 vC; in vec4 vCol; in vec3 vPos;
uniform float uAdd;
out vec4 o;
void main() {
  float r = length(vC);
  if (r > 1.0) discard;
  if (uAdd > 0.5) { float a = pow(1.0 - r, 2.0); o = vec4(vCol.rgb * a * vCol.a, 1.0); }
  else { float a = smoothstep(1.0, 0.6, r) * vCol.a; o = vec4(vCol.rgb, a); }
}`;
// flat ground decals (rings, range circles), drawn additively on the XZ plane
const RING_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
uniform mat4 uVP; uniform vec3 uC; uniform float uR;
out vec2 vC;
void main() { vC = aCorner; gl_Position = uVP * vec4(uC + vec3(aCorner.x, 0.0, aCorner.y) * uR, 1.0); }`;
const RING_FS = `#version 300 es
precision highp float;
in vec2 vC; uniform vec4 uCol; uniform float uWidth, uFill, uDash, uTime;
out vec4 o;
void main() {
  float r = length(vC);
  if (r > 1.0) discard;
  float edge = smoothstep(1.0 - uWidth, 1.0 - uWidth * 0.4, r) * (1.0 - smoothstep(0.98, 1.0, r));
  if (uDash > 0.5) { float a = atan(vC.y, vC.x); edge *= step(0.0, sin(a * 24.0 + uTime * 1.5)); }
  float a = edge + uFill * (1.0 - r * 0.6);
  o = vec4(uCol.rgb * a * uCol.a, 1.0);
}`;

function compile(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

export function createGL(canvas, opts = {}) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
  if (!gl) return null;
  let lit, depth, sky, bill, ring;
  try {
    lit = compile(gl, LIT_VS, LIT_FS); depth = compile(gl, DEPTH_VS, DEPTH_FS);
    sky = compile(gl, SKY_VS, SKY_FS); bill = compile(gl, BILL_VS, BILL_FS); ring = compile(gl, RING_VS, RING_FS);
  } catch {
    return null;
  }
  const skyVao = gl.createVertexArray();
  const SHADOW = opts.shadowSize ?? 2048;

  const shadowTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, shadowTex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SHADOW, SHADOW);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  const shadowFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
  gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  function makeVao(data) {
    const vao = gl.createVertexArray(), buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const stride = 40;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 36);
    gl.bindVertexArray(null);
    return { vao, buf, count: data.length / 10 };
  }
  function freeMesh(m) { if (m) { gl.deleteBuffer(m.buf); gl.deleteVertexArray(m.vao); } }

  const billVao = gl.createVertexArray(), billBuf = gl.createBuffer();
  gl.bindVertexArray(billVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, billBuf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 40, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 40, 20);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 40, 24);
  gl.bindVertexArray(null);

  const ringVao = gl.createVertexArray(), ringBuf = gl.createBuffer();
  gl.bindVertexArray(ringVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, ringBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
  gl.bindVertexArray(null);

  let S = null;
  const lp = new Float32Array(MAX_LIGHTS * 4), lc = new Float32Array(MAX_LIGHTS * 3);
  let billData = new Float32Array(60 * 512);

  return {
    gl,
    mesh: makeVao,
    free: freeMesh,
    resize(w, h) { canvas.width = w; canvas.height = h; },

    // f: { view, proj, eye, center, radius, mood, lights:[{p,r,c}] }
    begin(f) {
      const m = f.mood;
      const sunDir = (() => { const s = m.sunDir, l = Math.hypot(...s); return s.map((v) => v / l); })();
      S = { ...f, sunDir, sunCol: m.sunColor, sky: lin(m.ambient), ground: lin(m.ground), fogCol: lin(m.fog), top: lin(m.skyTop), hor: lin(m.skyHorizon) };
      S.vp = M4.mul(f.proj, f.view);
      const c = f.center, r = f.radius;
      const eye = [c[0] + sunDir[0] * 40, c[1] + sunDir[1] * 40, c[2] + sunDir[2] * 40];
      S.sunVP = M4.mul(M4.ortho(-r, r, -r, r, 1, 90), M4.lookAt(eye, c, [0, 1, 0]));
      const n = Math.min(MAX_LIGHTS, f.lights.length);
      for (let i = 0; i < n; i++) {
        const l = f.lights[i];
        lp[i * 4] = l.p[0]; lp[i * 4 + 1] = l.p[1]; lp[i * 4 + 2] = l.p[2]; lp[i * 4 + 3] = l.r;
        lc[i * 3] = l.c[0]; lc[i * 3 + 1] = l.c[1]; lc[i * 3 + 2] = l.c[2];
      }
      S.nl = n;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    },

    shadows(draws) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
      gl.viewport(0, 0, SHADOW, SHADOW);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2, 4);
      gl.useProgram(depth.p);
      gl.uniformMatrix4fv(depth.u.uSunVP, false, S.sunVP);
      for (const d of draws) {
        if (d.noShadow) continue;
        gl.uniformMatrix4fv(depth.u.uM, false, d.model);
        gl.bindVertexArray(d.mesh.vao);
        gl.drawArrays(gl.TRIANGLES, 0, d.mesh.count);
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      S.shadowOn = 1;
    },

    sky(time) {
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
      gl.useProgram(sky.p);
      gl.uniformMatrix4fv(sky.u.uInvVP, false, M4.invert(S.vp));
      gl.uniform3fv(sky.u.uEye, S.eye);
      gl.uniform3fv(sky.u.uTop, S.top); gl.uniform3fv(sky.u.uHor, S.hor);
      const md = S.mood.moonDir, ml = Math.hypot(...md);
      gl.uniform3fv(sky.u.uMoonDir, md.map((v) => v / ml)); gl.uniform3fv(sky.u.uMoonCol, S.mood.moonColor);
      gl.uniform3fv(sky.u.uAur, lin(S.mood.aurora));
      gl.uniform1f(sky.u.uTime, time);
      gl.bindVertexArray(skyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
    },

    draw(draws) {
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
      gl.useProgram(lit.p);
      const u = lit.u;
      gl.uniformMatrix4fv(u.uVP, false, S.vp);
      gl.uniformMatrix4fv(u.uSunVP, false, S.sunVP);
      gl.uniform3fv(u.uEye, S.eye); gl.uniform3fv(u.uSunDir, S.sunDir); gl.uniform3fv(u.uSunCol, S.sunCol);
      gl.uniform3fv(u.uSky, S.sky); gl.uniform3fv(u.uGround, S.ground); gl.uniform3fv(u.uFogCol, S.fogCol);
      gl.uniform1f(u.uFog, S.mood.fogDensity); gl.uniform1f(u.uFogStart, S.mood.fogStart);
      gl.uniform1f(u.uShadowOn, S.shadowOn ? 1 : 0);
      gl.uniform1i(u.uNL, S.nl);
      gl.uniform4fv(u.uLP, lp); gl.uniform3fv(u.uLC, lc);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, shadowTex);
      gl.uniform1i(u.uShadow, 0); gl.uniform2f(u.uTexel, 1 / SHADOW, 1 / SHADOW);
      let blending = false;
      for (const d of draws) {
        const a = d.alpha ?? 1;
        if (a < 1 && !blending) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); blending = true; }
        if (a >= 1 && blending) { gl.disable(gl.BLEND); blending = false; }
        gl.uniformMatrix4fv(u.uM, false, d.model);
        gl.uniformMatrix3fv(u.uN, false, M4.normal(d.model));
        gl.uniform3fv(u.uTint, d.tint || [1, 1, 1]);
        gl.uniform1f(u.uFlash, d.flash || 0);
        gl.uniform1f(u.uEmi, d.emi ?? 1);
        gl.uniform1f(u.uAlpha, a);
        gl.bindVertexArray(d.mesh.vao);
        gl.drawArrays(gl.TRIANGLES, 0, d.mesh.count);
      }
      gl.disable(gl.BLEND);
    },

    // rings: { c:[x,y,z], r, col:[r,g,b,a] (linear), width, fill, dash }
    rings(list, time) {
      if (!list.length) return;
      gl.useProgram(ring.p);
      gl.uniformMatrix4fv(ring.u.uVP, false, S.vp);
      gl.uniform1f(ring.u.uTime, time);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
      gl.bindVertexArray(ringVao);
      for (const r of list) {
        gl.uniform3fv(ring.u.uC, r.c); gl.uniform1f(ring.u.uR, r.r);
        gl.uniform4fv(ring.u.uCol, r.col); gl.uniform1f(ring.u.uWidth, r.width ?? 0.06);
        gl.uniform1f(ring.u.uFill, r.fill ?? 0); gl.uniform1f(ring.u.uDash, r.dash ? 1 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      gl.depthMask(true); gl.disable(gl.BLEND);
    },

    // items: { p:[x,y,z], size, c:[r,g,b] (linear), a, add }
    billboards(items) {
      if (!items.length) return;
      const right = [S.view[0], S.view[4], S.view[8]], up = [S.view[1], S.view[5], S.view[9]];
      gl.useProgram(bill.p);
      gl.uniformMatrix4fv(bill.u.uVP, false, S.vp);
      gl.uniform3fv(bill.u.uRight, right); gl.uniform3fv(bill.u.uUp, up);
      gl.enable(gl.BLEND); gl.depthMask(false);
      gl.bindVertexArray(billVao);
      for (const add of [0, 1]) {
        let n = 0;
        for (const b of items) if (!!b.add === !!add) n++;
        if (!n) continue;
        if (billData.length < n * 60) billData = new Float32Array(n * 60 * 2);
        let o = 0;
        for (const b of items) {
          if (!!b.add !== !!add) continue;
          for (let k = 0; k < 6; k++) {
            const cx = k === 1 || k === 2 || k === 4 ? 1 : -1, cy = k === 2 || k === 4 || k === 5 ? 1 : -1;
            billData[o++] = b.p[0]; billData[o++] = b.p[1]; billData[o++] = b.p[2];
            billData[o++] = cx; billData[o++] = cy; billData[o++] = b.size;
            billData[o++] = b.c[0]; billData[o++] = b.c[1]; billData[o++] = b.c[2]; billData[o++] = b.a ?? 1;
          }
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, billBuf);
        gl.bufferData(gl.ARRAY_BUFFER, billData.subarray(0, o), gl.STREAM_DRAW);
        if (add) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.uniform1f(bill.u.uAdd, add);
        gl.drawArrays(gl.TRIANGLES, 0, n * 6);
      }
      gl.depthMask(true); gl.disable(gl.BLEND);
    },
  };
}
