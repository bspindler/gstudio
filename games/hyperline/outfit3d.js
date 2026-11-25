// Outfits for the hero runner (docs/hyperline/style-guide.md): clothes painted onto the body in a shader, no textures.
// Every vertex is tagged with the body part its strongest bone belongs to (head, torso, waist, upper arms, forearms,
// hands, thighs, shins, feet), and an outfit gives each part a garment: a colour, a pattern anchored to the bind pose (so
// it moves with the body), how much it glows, and how metallic it is. Seams between garments glow as neon piping in the
// outfit's trim colour, the head is a helmet with a visor band, and a rim light in the trim colour outlines the runner.
// three.js is passed in (T); nothing here loads anything.

/** Body parts, in the order the shader indexes them. */
export const PARTS = ['head', 'torso', 'waist', 'upperArms', 'forearms', 'hands', 'thighs', 'shins', 'feet'];
const PART_OF = [
  [/^(head|neck)/i, 'head'], [/^(spine_0[23]|clavicle)/i, 'torso'], [/^(spine_01|pelvis|root)/i, 'waist'],
  [/^upperarm/i, 'upperArms'], [/^lowerarm/i, 'forearms'], [/^(hand|index|middle|ring|pinky|thumb)/i, 'hands'],
  [/^thigh/i, 'thighs'], [/^calf/i, 'shins'], [/^(foot|ball)/i, 'feet'],
];
/** The body part for a bone name (Universal Base Characters naming); torso when nothing matches. */
export function partOfBone(name) {
  const hit = PART_OF.find(([re]) => re.test(name));
  return PARTS.indexOf(hit ? hit[1] : 'torso');
}

/** Pattern ids for the shader. */
export const PATTERNS = { none: 0, hoops: 1, sideLine: 2, circuit: 3, chevrons: 4, gradient: 5, scales: 6, bands: 7 };

/**
 * Garments: which parts each one covers by default. An outfit may move a part to another garment (tall boots cover the
 * shins, a vest leaves the upper arms in the sleeves).
 */
export const GARMENTS = { helmet: ['head'], top: ['torso', 'upperArms'], belt: ['waist'], sleeves: ['forearms'], gloves: ['hands'], pants: ['thighs', 'shins'], boots: ['feet'] };

/**
 * The outfits, one per skin id (the skin's rarity, price and source are unchanged). A garment is
 * { c: colour, p?: pattern, pc?: pattern colour, glow?: 0..1, metal?: 0..1 }. `cover` moves parts between garments.
 */
export const OUTFITS = {
  volt: { name: 'Track Suit', trim: '#22F0FF', visor: '#22F0FF', g: {
    helmet: { c: '#10142A', metal: 0.6 }, top: { c: '#1C6BFF', p: 'sideLine', pc: '#E8FCFF', glow: 0.15 }, belt: { c: '#0A0E1E' },
    sleeves: { c: '#1C6BFF', p: 'sideLine', pc: '#E8FCFF' }, gloves: { c: '#0A0E1E' }, pants: { c: '#0C1430', p: 'sideLine', pc: '#22F0FF', glow: 0.1 }, boots: { c: '#E8FCFF', glow: 0.2 } } },
  ember: { name: 'Firewalker', trim: '#FF8A3D', visor: '#FF8A3D', g: {
    helmet: { c: '#1A0A08', metal: 0.5 }, top: { c: '#2A0C08', p: 'chevrons', pc: '#FF5A1F', glow: 0.5 }, belt: { c: '#FF8A3D', glow: 0.4 },
    sleeves: { c: '#2A0C08' }, gloves: { c: '#FF2B5E', glow: 0.25 }, pants: { c: '#120606', p: 'gradient', pc: '#FF2B5E' }, boots: { c: '#FF2B5E', glow: 0.2 } } },
  mint: { name: 'Courier', trim: '#7CFF6B', visor: '#7CFF6B', cover: { upperArms: 'sleeves' }, g: {
    helmet: { c: '#0E1A14', metal: 0.3 }, top: { c: '#11B989', p: 'bands', pc: '#0A3A2A' }, belt: { c: '#7CFF6B', glow: 0.35 },
    sleeves: { c: '#16222A' }, gloves: { c: '#7CFF6B', glow: 0.2 }, pants: { c: '#1E2A2E', p: 'circuit', pc: '#11B989', glow: 0.05 }, boots: { c: '#0E1A14' } } },
  vapor: { name: 'Vaporwave', trim: '#FF2BD6', visor: '#FF2BD6', g: {
    helmet: { c: '#2A0A3A', metal: 0.4 }, top: { c: '#7A2BFF', p: 'gradient', pc: '#FF2BD6', glow: 0.25 }, belt: { c: '#22F0FF', glow: 0.4 },
    sleeves: { c: '#FF2BD6', glow: 0.15 }, gloves: { c: '#2A0A3A' }, pants: { c: '#2A0A3A', p: 'hoops', pc: '#FF2BD6', glow: 0.2 }, boots: { c: '#22F0FF', glow: 0.2 } } },
  hexa: { name: 'Hexline', trim: '#B98CFF', visor: '#22F0FF', g: {
    helmet: { c: '#1A1030', metal: 0.7 }, top: { c: '#2A1850', p: 'circuit', pc: '#22F0FF', glow: 0.35 }, belt: { c: '#B98CFF', glow: 0.3 },
    sleeves: { c: '#2A1850', p: 'circuit', pc: '#22F0FF', glow: 0.35 }, gloves: { c: '#B98CFF', glow: 0.2 }, pants: { c: '#1A1030', p: 'circuit', pc: '#B98CFF', glow: 0.3 }, boots: { c: '#B98CFF' } } },
  aurum: { name: 'Gold Standard', trim: '#FFE45C', visor: '#FFE45C', cover: { shins: 'boots' }, g: {
    helmet: { c: '#C8A030', metal: 1 }, top: { c: '#D8B040', p: 'bands', pc: '#7A5A10', metal: 1 }, belt: { c: '#0A0806' },
    sleeves: { c: '#0A0806' }, gloves: { c: '#D8B040', metal: 1 }, pants: { c: '#0A0806' }, boots: { c: '#D8B040', p: 'bands', pc: '#7A5A10', metal: 1 } } },
  glitch: { name: 'Glitch', trim: '#FFFFFF', visor: '#8A8AFF', fx: 'glitch', g: {
    helmet: { c: '#E8E8FF', metal: 0.2 }, top: { c: '#E8E8FF', p: 'hoops', pc: '#8A8AFF', glow: 0.1 }, belt: { c: '#8A8AFF', glow: 0.3 },
    sleeves: { c: '#E8E8FF' }, gloves: { c: '#20203A' }, pants: { c: '#20203A', p: 'hoops', pc: '#E8E8FF', glow: 0.1 }, boots: { c: '#E8E8FF' } } },
  serpent: { name: 'Chrome Serpent', trim: '#E6E9FF', visor: '#E6E9FF', fx: 'rainbow', g: {
    helmet: { c: '#C8CCE8', metal: 1 }, top: { c: '#B8BCD8', p: 'scales', pc: '#FFFFFF', metal: 1, glow: 0.1 }, belt: { c: '#8C93C7', metal: 1 },
    sleeves: { c: '#B8BCD8', p: 'scales', pc: '#FFFFFF', metal: 1 }, gloves: { c: '#8C93C7', metal: 1 }, pants: { c: '#A0A4C8', p: 'scales', pc: '#FFFFFF', metal: 1 }, boots: { c: '#C8CCE8', metal: 1 } } },
  apex: { name: 'Apex', trim: '#FFE45C', visor: '#FFE45C', fx: 'rainbow', g: {
    helmet: { c: '#0A0610', metal: 0.8 }, top: { c: '#0A0610', p: 'sideLine', pc: '#FF2BD6', glow: 0.4 }, belt: { c: '#FFE45C', glow: 0.5 },
    sleeves: { c: '#0A0610', p: 'sideLine', pc: '#FFE45C', glow: 0.4 }, gloves: { c: '#FF2BD6', glow: 0.3 }, pants: { c: '#0A0610', p: 'sideLine', pc: '#FF2BD6', glow: 0.4 }, boots: { c: '#FFE45C', glow: 0.3 } } },
};

/** Per-part garment settings for an outfit: [{ c, p, pc, glow, metal }] in PARTS order. */
export function partGarments(outfit) {
  const garmentOf = {};
  for (const [g, parts] of Object.entries(GARMENTS)) for (const p of parts) garmentOf[p] = g;
  Object.assign(garmentOf, outfit.cover || {});
  return PARTS.map((p) => ({ glow: 0, metal: 0, p: 'none', pc: '#FFFFFF', ...outfit.g[garmentOf[p]] }));
}

/**
 * Adds the per-vertex body part (`part`) and bind-pose position and normal (`bindPos`, `bindNrm`) to a skinned mesh.
 * Returns the top of the head (bind-pose y), which places the visor band on each body.
 */
export function tagParts(T, mesh) {
  const g = mesh.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, n = g.attributes.position.count;
  const partOfJoint = mesh.skeleton.bones.map((b) => partOfBone(b.name));
  const part = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let best = 0, w = -1;
    for (let k = 0; k < 4; k++) { const wk = sw.getComponent(i, k); if (wk > w) { w = wk; best = si.getComponent(i, k); } }
    part[i] = partOfJoint[best] ?? 1;
  }
  g.setAttribute('part', new T.BufferAttribute(part, 1));
  let headTop = -Infinity;
  for (let i = 0; i < n; i++) if (part[i] === 0) headTop = Math.max(headTop, g.attributes.position.getY(i));
  g.setAttribute('bindPos', g.attributes.position.clone());
  g.setAttribute('bindNrm', g.attributes.normal.clone());
  return headTop;
}

/** Puts the visor band at eye height for a head whose top is at headTop (bind pose). */
export function setVisor(m, headTop) { m.userData.outfit.oVisorY.value.set(headTop - 0.16, headTop - 0.085); }

/** The outfit material: MeshStandardMaterial plus garments, patterns, glowing seams, a visor band and a rim light. */
export function outfitMaterial(T) {
  const N = PARTS.length;
  const u = {
    oCol: { value: Array.from({ length: N }, () => new T.Color()) }, oPat: { value: new Array(N).fill(0) },
    oPc: { value: Array.from({ length: N }, () => new T.Color()) }, oGlow: { value: new Array(N).fill(0) },
    oMetal: { value: new Array(N).fill(0) }, oTrim: { value: new T.Color() }, oVisor: { value: new T.Color() },
    oVisorY: { value: new T.Vector2(1.55, 1.63) }, oTime: { value: 0 }, oFx: { value: 0 },
  };
  const m = new T.MeshStandardMaterial({ roughness: 0.45, metalness: 0.2, transparent: true });
  m.userData.outfit = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'attribute float part; attribute vec3 bindPos; attribute vec3 bindNrm;\nvarying float vPart; flat varying int vPartF; varying vec3 vBind; varying vec3 vBN;\n'
      + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vPart = part; vPartF = int(part + 0.5); vBind = bindPos; vBN = bindNrm;');
    sh.fragmentShader = `uniform vec3 oCol[${N}]; uniform float oPat[${N}]; uniform vec3 oPc[${N}]; uniform float oGlow[${N}]; uniform float oMetal[${N}];
uniform vec3 oTrim; uniform vec3 oVisor; uniform vec2 oVisorY; uniform float oTime; uniform float oFx;
varying float vPart; flat varying int vPartF; varying vec3 vBind; varying vec3 vBN;
float oPattern(float id, vec3 p, vec3 n) {
  if (id < 0.5) return 0.0;
  if (id < 1.5) return step(0.6, fract(p.y * 14.0));                                   // hoops
  if (id < 2.5) return smoothstep(0.82, 0.9, abs(n.x));                                // side line (down the sides)
  if (id < 3.5) { vec2 q = fract(vec2(p.y * 9.0, (p.x + p.z) * 9.0)); float l = step(q.x, 0.07) + step(q.y, 0.07);
    float gap = step(0.35, fract(sin(dot(floor(vec2(p.y * 9.0, (p.x + p.z) * 9.0)), vec2(12.9898, 78.233))) * 43758.5453)); return min(1.0, l) * gap; } // circuit
  if (id < 4.5) return step(0.55, fract(p.y * 7.0 + abs(p.x) * 7.0));                  // chevrons
  if (id < 5.5) return smoothstep(-0.25, 0.35, p.y - 1.0);                             // gradient, darker down the body
  if (id < 6.5) { vec2 q = vec2(p.y * 18.0, (p.x + p.z) * 18.0 + floor(p.y * 18.0) * 0.5); float d = length(fract(q) - 0.5); return smoothstep(0.42, 0.48, d); } // scales
  return step(0.82, fract(p.y * 5.0));                                                 // bands
}
` + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
  int pi = vPartF;
  vec3 gc = oCol[pi]; float pat = oPattern(oPat[pi], vBind, vBN);
  if (oFx > 1.5) { float g = step(0.6, fract(vBind.y * 30.0 + floor(oTime * 11.0) * 0.37)); gc = mix(gc, g > 0.5 ? vec3(0.13, 0.94, 1.0) : vec3(1.0, 0.17, 0.84), 0.25 * g); } // glitch scanlines
  diffuseColor.rgb = mix(gc, oPc[pi], pat);`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = max(metalnessFactor, oMetal[vPartF]);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  float seam = smoothstep(0.08, 0.3, abs(vPart - floor(vPart + 0.5)));                 // where the part changes: neon piping
  float visor = (vPartF == 0 && vBind.y > oVisorY.x && vBind.y < oVisorY.y && vBN.z > 0.15) ? 1.0 : 0.0;
  vec3 trim = oTrim;
  if (oFx > 0.5 && oFx < 1.5) trim = 0.6 + 0.4 * cos(6.2832 * (oTime * 0.35 + vBind.y * 0.8 + vec3(0.0, 0.33, 0.67))); // rainbow
  totalEmissiveRadiance += diffuseColor.rgb * oGlow[vPartF] * (0.4 + 0.6 * oPattern(oPat[vPartF], vBind, vBN))
    + trim * seam * 1.4 + oVisor * visor * 2.2
    + trim * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.4) * 0.9;`);
  };
  return m;
}

/** Points the outfit material at an outfit; t (seconds) drives rainbow and glitch effects. */
export function applyOutfit(m, outfit, t = 0) {
  const u = m.userData.outfit, gs = partGarments(outfit);
  gs.forEach((g, i) => {
    u.oCol.value[i].set(g.c); u.oPc.value[i].set(g.pc); u.oPat.value[i] = PATTERNS[g.p] ?? 0;
    u.oGlow.value[i] = g.glow; u.oMetal.value[i] = g.metal;
  });
  u.oTrim.value.set(outfit.trim); u.oVisor.value.set(outfit.visor);
  u.oFx.value = outfit.fx === 'rainbow' ? 1 : outfit.fx === 'glitch' ? 2 : 0;
  u.oTime.value = t;
}
