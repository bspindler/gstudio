// Offline glTF (GLB) to data converter for game models. Runs at authoring time only (scripts/vendor/glb-to-module.ts),
// never in a game: games get a plain data module and build meshes with games/<slug>/lib/rig.js, so no glTF loader
// (and none of its network code) ships. Handles what Quaternius rigs use: node TRS, skinned meshes and rigid meshes on
// nodes (POSITION/NORMAL, JOINTS_0/WEIGHTS_0 when skinned, optional COLOR_0), and rotation/translation/scale
// animations. Morph targets and textures are dropped: our own materials supply the look.

const CTYPE = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const PATH = { rotation: 'quaternion', translation: 'position', scale: 'scale' };

/** Splits a GLB into its JSON and binary chunks. */
export function parseGlb(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2) throw new Error('glb: not a GLB 2.0 file');
  let off = 12, json = null, bin = new Uint8Array(0);
  while (off + 8 <= u8.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true), body = u8.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body));
    else if (type === 0x004e4942) bin = body;
    off += 8 + len;
  }
  if (!json) throw new Error('glb: not a GLB 2.0 file (no JSON chunk)');
  return { json, bin };
}

/**
 * A .gltf (JSON text) with its buffers: each buffer is a local file read with readUri(uri), or a base64 data: URI.
 * Anything else (a web URL, an absolute or parent path) is refused, so a model never pulls data from elsewhere.
 */
export function parseGltf(text, readUri) {
  const json = JSON.parse(text);
  const buffers = (json.buffers || []).map((b) => {
    const uri = b.uri || '';
    if (uri.startsWith('data:')) return new Uint8Array(Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64'));
    if (!uri || /^[a-z]+:/i.test(uri) || uri.startsWith('/') || uri.split(/[\\/]/).includes('..')) throw new Error(`gltf: buffer "${uri}" is not a local file beside the model`);
    return readUri(decodeURIComponent(uri));
  });
  return { json, bin: buffers[0] || new Uint8Array(0), buffers };
}

/** Reads an accessor as a flat array; normalized integers become floats in 0..1 (or -1..1), as glTF defines. */
function read(g, i) {
  const a = g.json.accessors[i];
  if (a.sparse) throw new Error('glb: sparse accessors are not supported');
  const Arr = CTYPE[a.componentType], n = SIZE[a.type], v = g.json.bufferViews[a.bufferView];
  const base = (v.byteOffset || 0) + (a.byteOffset || 0), el = Arr.BYTES_PER_ELEMENT, stride = v.byteStride || n * el;
  const buf = g.buffers ? g.buffers[v.buffer] : g.bin;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const get = { 1: (o) => (Arr === Int8Array ? dv.getInt8(o) : dv.getUint8(o)), 2: (o) => (Arr === Int16Array ? dv.getInt16(o, true) : dv.getUint16(o, true)),
    4: (o) => (Arr === Float32Array ? dv.getFloat32(o, true) : dv.getUint32(o, true)) }[el];
  const out = new Array(a.count * n);
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = get(base + k * stride + c * el);
  if (a.normalized) { const d = NORM[a.componentType]; for (let k = 0; k < out.length; k++) out[k] = Math.max(-1, out[k] / d); }
  return out;
}

/**
 * Skin weights scaled so each vertex's four sum to 1, as three's GLTFLoader does on load. Some exports (FBX2GLTF, for
 * one) write weights that don't, and unnormalized weights fling vertices far away as the bones move.
 */
export function normalizeWeights(w) {
  const out = w.slice();
  for (let i = 0; i < out.length; i += 4) {
    const s = out[i] + out[i + 1] + out[i + 2] + out[i + 3];
    if (s > 0) for (let k = 0; k < 4; k++) out[i + k] /= s;
    else { out[i] = 1; out[i + 1] = out[i + 2] = out[i + 3] = 0; }
  }
  return out;
}

const b64 = (Arr, data) => Buffer.from(new Uint8Array(new Arr(data).buffer)).toString('base64');

/**
 * The rig as plain data: the node tree (TRS), the skin, each primitive's arrays (base64), and the picked clips.
 * opts.clips: [{ from: parsed GLB, pick: { ourName: 'NameInFile' } }]. Clip tracks map onto model nodes by name.
 */
export function extractRig(g, opts = { clips: [] }) {
  opts = { clips: [], ...opts };
  const J = g.json;
  const parent = new Array(J.nodes.length).fill(-1);
  J.nodes.forEach((n, i) => (n.children || []).forEach((c) => { parent[c] = i; }));
  const nodes = J.nodes.map((n, i) => {
    if (n.matrix) throw new Error(`glb: node ${n.name} uses a matrix; export with TRS`);
    return { name: n.name || `node${i}`, parent: parent[i], t: n.translation || [0, 0, 0], r: n.rotation || [0, 0, 0, 1], s: n.scale || [1, 1, 1] };
  });
  let tris = 0;
  const prim = (p, skinned) => {
    const A = p.attributes;
    for (const k of ['POSITION', 'NORMAL', ...(skinned ? ['JOINTS_0', 'WEIGHTS_0'] : [])]) if (A[k] === undefined) throw new Error(`glb: primitive is missing ${k}`);
    const idx = p.indices !== undefined ? read(g, p.indices) : [...Array(J.accessors[A.POSITION].count).keys()];
    tris += idx.length / 3;
    const big = J.accessors[A.POSITION].count > 65535;
    const pos = read(g, A.POSITION), nrm = read(g, A.NORMAL);
    const joints = skinned ? read(g, A.JOINTS_0) : null, weights = skinned ? normalizeWeights(read(g, A.WEIGHTS_0)) : null;
    const q = opts.quantize ? quantizePrim(pos, nrm, joints, weights) : null;
    return {
      mat: p.material !== undefined ? J.materials[p.material].name || `mat${p.material}` : 'default',
      ...(q ? { pos: q.pos, posQ: q.posQ, nrm: q.nrm, nrm8: true } : { pos: b64(Float32Array, pos), nrm: b64(Float32Array, nrm) }),
      idx: b64(big ? Uint32Array : Uint16Array, idx), idx32: big,
      ...(skinned ? (q ? { j: q.j, j8: q.j8, w: q.w, w8: true } : { j: b64(Uint16Array, joints), w: b64(Float32Array, weights) }) : {}),
      ...(A.COLOR_0 !== undefined && J.accessors[A.COLOR_0].type === 'VEC4' ? { col: b64(Float32Array, read(g, A.COLOR_0)) } : {}),
    };
  };
  // Every mesh in the file: skinned ones deform with their skin, the rest ride rigidly on their node (robot parts).
  const meshes = J.nodes.flatMap((n, node) => (n.mesh === undefined ? [] : [{
    node, skin: n.skin ?? -1, prims: J.meshes[n.mesh].primitives.map((p) => prim(p, n.skin !== undefined)) }]));
  if (!meshes.length) throw new Error('glb: no meshes');
  const skins = (J.skins || []).map((k) => ({ joints: k.joints, ibm: b64(Float32Array, read(g, k.inverseBindMatrices)) }));
  const byName = new Map(nodes.map((n, i) => [n.name, i]));
  const clips = [];
  for (const src of opts.clips) {
    const anims = src.from.json.animations || [];
    for (const [ours, theirs] of Object.entries(src.pick)) {
      const a = anims.find((x) => x.name === theirs);
      if (!a) throw new Error(`glb: no clip "${theirs}" in the file. It has: ${anims.map((x) => x.name).join(', ')}`);
      let dur = 0;
      const tracks = [];
      for (const ch of a.channels) {
        const path = PATH[ch.target.path];
        const node = byName.get(src.from.json.nodes[ch.target.node]?.name);
        if (!path || node === undefined) continue;
        const s = a.samplers[ch.sampler];
        let times = read(src.from, s.input), values = read(src.from, s.output);
        dur = Math.max(dur, times[times.length - 1] || 0);
        if (opts.optimize && s.interpolation !== 'STEP') {
          const stride = path === 'quaternion' ? 4 : 3, bind = path === 'quaternion' ? nodes[node].r : path === 'position' ? nodes[node].t : nodes[node].s;
          const mag = Math.max(1, ...bind.map(Math.abs)), eps = path === 'quaternion' ? 5e-4 : 1e-4 * mag;
          if (atBind(values, stride, bind, eps, path === 'quaternion')) continue; // never moves: the bind pose already says it
          ({ times, values } = reduceKeys(times, values, stride, eps));
        }
        tracks.push({ node, path, interp: s.interpolation === 'STEP' ? 'step' : 'linear',
          times: b64(Float32Array, times), values: b64(Float32Array, values) });
      }
      clips.push({ name: ours, dur, tracks });
    }
  }
  return { nodes, meshes, skins, clips, tris };
}

/**
 * Smaller downloads: positions as 16-bit steps across the primitive's bounds (posQ = [min xyz, max xyz]), normals and
 * weights as 8-bit, joint indices as 8-bit when every index fits. rig.js decodes them back to floats on load.
 */
function quantizePrim(pos, nrm, joints, weights) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) { const c = i % 3; if (pos[i] < mn[c]) mn[c] = pos[i]; if (pos[i] > mx[c]) mx[c] = pos[i]; }
  const qp = pos.map((v, i) => { const c = i % 3, r = mx[c] - mn[c] || 1; return Math.round(((v - mn[c]) / r) * 65535) - 32768; });
  const out = { pos: b64(Int16Array, qp), posQ: [...mn, ...mx], nrm: b64(Int8Array, nrm.map((v) => Math.round(Math.max(-1, Math.min(1, v)) * 127))) };
  if (joints) {
    out.j8 = joints.every((v) => v < 256);
    out.j = b64(out.j8 ? Uint8Array : Uint16Array, joints);
    out.w = b64(Uint8Array, weights.map((v) => Math.round(v * 255)));
  }
  return out;
}

/** Whether every key equals the bind value (a quaternion also matches its negation, the same rotation). */
function atBind(values, stride, bind, eps, quat) {
  for (let i = 0; i < values.length; i += stride) {
    let d = 0, dn = 0;
    for (let c = 0; c < stride; c++) { d = Math.max(d, Math.abs(values[i + c] - bind[c])); dn = Math.max(dn, Math.abs(values[i + c] + bind[c])); }
    if (d > eps && !(quat && dn <= eps)) return false;
  }
  return true;
}

/**
 * Keyframe reduction: drops each key that linear interpolation between the last kept key and the next key reproduces
 * within eps in every component. The first and last keys always stay.
 */
export function reduceKeys(times, values, stride, eps) {
  const n = times.length;
  if (n <= 2) return { times: [...times], values: [...values] };
  const keep = [0];
  for (let i = 1; i < n - 1; i++) {
    const a = keep[keep.length - 1], b = i + 1, k = (times[i] - times[a]) / (times[b] - times[a]);
    let ok = true;
    for (let c = 0; c < stride && ok; c++) {
      const va = values[a * stride + c], vb = values[b * stride + c];
      if (Math.abs(va + (vb - va) * k - values[i * stride + c]) > eps) ok = false;
    }
    if (!ok) keep.push(i);
  }
  keep.push(n - 1);
  return { times: keep.map((i) => times[i]), values: keep.flatMap((i) => values.slice(i * stride, i * stride + stride)) };
}

/** The rig as an ES module of data only: no imports and no code. */
export function toModuleSource(rig, meta) {
  return `// ${meta.source}. License: ${meta.license}. Generated by scripts/vendor/glb-to-module.ts; do not edit by hand.\n`
    + `// ${rig.tris} triangles, ${rig.meshes.length} meshes, ${rig.skins.length} skins, clips: ${rig.clips.map((c) => c.name).join(', ') || 'none'}.\n`
    + `export default ${JSON.stringify(rig)};\n`;
}
