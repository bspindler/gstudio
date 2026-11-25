// Builds a skinned, animated model from a data module (games/hyperline/models/*.js, made offline by
// scripts/vendor/glb-to-module.ts). three.js is passed in, so this file has no imports and runs under tests with the
// npm package. No loader and no network: the model's arrays are already in the module.

const ARR = { f32: Float32Array, u16: Uint16Array, u32: Uint32Array, i16: Int16Array, i8: Int8Array, u8: Uint8Array };

/** Base64 to a typed array. */
export function decode(s, type) {
  const bin = atob(s), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new ARR[type](u8.buffer);
}

/** A primitive's arrays as floats (and joint indices as u16), whichever form the module stored them in. */
export function decodePrim(p) {
  let pos, nrm, j = null, w = null;
  if (p.posQ) {
    const q = decode(p.pos, 'i16'), [x0, y0, z0, x1, y1, z1] = p.posQ, mn = [x0, y0, z0], r = [x1 - x0 || 1, y1 - y0 || 1, z1 - z0 || 1];
    pos = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) pos[i] = mn[i % 3] + ((q[i] + 32768) / 65535) * r[i % 3];
  } else pos = decode(p.pos, 'f32');
  if (p.nrm8) {
    const q = decode(p.nrm, 'i8'); nrm = new Float32Array(q.length);
    for (let i = 0; i < q.length; i += 3) { const x = q[i] / 127, y = q[i + 1] / 127, z = q[i + 2] / 127, l = Math.hypot(x, y, z) || 1; nrm[i] = x / l; nrm[i + 1] = y / l; nrm[i + 2] = z / l; }
  } else nrm = decode(p.nrm, 'f32');
  if (p.j) {
    j = p.j8 ? Uint16Array.from(decode(p.j, 'u8')) : decode(p.j, 'u16');
    if (p.w8) {
      const q = decode(p.w, 'u8'); w = new Float32Array(q.length);
      for (let i = 0; i < q.length; i += 4) { const s = q[i] + q[i + 1] + q[i + 2] + q[i + 3] || 1; for (let k = 0; k < 4; k++) w[i + k] = q[i + k] / s; }
    } else w = decode(p.w, 'f32');
  }
  return { pos, nrm, j, w };
}

/**
 * Returns { root, meshes, mixer, actions }; meshes are SkinnedMesh or, for rigid parts on a node, Mesh. matFor(materialName) supplies our own material for each material name in
 * the model, so the look (neon, emissive, skin colours) stays ours. Called once per distinct name.
 */
export function buildRig(T, data, matFor) {
  const joints = new Set(data.skins.flatMap((k) => k.joints));
  const objs = data.nodes.map((n, i) => {
    const o = joints.has(i) ? new T.Bone() : new T.Object3D();
    o.name = n.name;
    o.position.fromArray(n.t); o.quaternion.fromArray(n.r); o.scale.fromArray(n.s);
    return o;
  });
  const root = new T.Group();
  data.nodes.forEach((n, i) => (n.parent >= 0 ? objs[n.parent] : root).add(objs[i]));
  root.updateMatrixWorld(true);

  const mats = new Map();
  const mat = (name) => { if (!mats.has(name)) mats.set(name, matFor(name)); return mats.get(name); };
  const skeletons = data.skins.map((k) => {
    const ibm = decode(k.ibm, 'f32');
    return new T.Skeleton(k.joints.map((j) => objs[j]), k.joints.map((_, i) => new T.Matrix4().fromArray(ibm, i * 16)));
  });
  const meshes = [];
  for (const m of data.meshes) {
    const host = objs[m.node];
    for (const p of m.prims) {
      const g = new T.BufferGeometry();
      const d = decodePrim(p);
      g.setAttribute('position', new T.BufferAttribute(d.pos, 3));
      g.setAttribute('normal', new T.BufferAttribute(d.nrm, 3));
      if (p.col) g.setAttribute('color', new T.BufferAttribute(decode(p.col, 'f32'), 4));
      g.setIndex(new T.BufferAttribute(decode(p.idx, p.idx32 ? 'u32' : 'u16'), 1));
      let mesh;
      if (m.skin >= 0) {
        g.setAttribute('skinIndex', new T.BufferAttribute(d.j, 4));
        g.setAttribute('skinWeight', new T.BufferAttribute(d.w, 4));
        mesh = new T.SkinnedMesh(g, mat(p.mat));
        host.add(mesh);
        // Identity bind matrix: glTF ignores a skinned mesh's own node transform (the joints place every vertex), as three's
        // GLTFLoader does. Binding to the node's world matrix applied the robot armature's 100x scale twice, so its hands
        // were thrown dozens of units off the body and swept across the screen as the arms swung.
        mesh.bind(skeletons[m.skin], new T.Matrix4());
      } else {
        mesh = new T.Mesh(g, mat(p.mat));
        host.add(mesh);
      }
      mesh.name = p.mat;
      meshes.push(mesh);
    }
  }

  const mixer = new T.AnimationMixer(root);
  const actions = {};
  for (const c of data.clips) {
    const tracks = c.tracks.map((tr) => {
      const Track = tr.path === 'quaternion' ? T.QuaternionKeyframeTrack : T.VectorKeyframeTrack;
      const track = new Track(`${data.nodes[tr.node].name}.${tr.path}`, decode(tr.times, 'f32'), decode(tr.values, 'f32'));
      if (tr.interp === 'step') track.setInterpolation(T.InterpolateDiscrete);
      return track;
    });
    actions[c.name] = mixer.clipAction(new T.AnimationClip(c.name, c.dur, tracks));
  }
  return { root, meshes, mixer, actions };
}

/**
 * Adds a rigid attachment (an `npm run model -- --attach` module: hair, a prop) to its bone in a built rig, in our
 * material. Returns the mesh, or null when the rig has no such bone.
 */
export function attachTo(T, root, att, material) {
  const bone = root.getObjectByName(att.attach);
  if (!bone) return null;
  const group = new T.Group();
  for (const p of att.prims) {
    const d = decodePrim(p), g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(d.pos, 3));
    g.setAttribute('normal', new T.BufferAttribute(d.nrm, 3));
    g.setIndex(new T.BufferAttribute(decode(p.idx, p.idx32 ? 'u32' : 'u16'), 1));
    const m = new T.Mesh(g, material); m.frustumCulled = false; group.add(m);
  }
  bone.add(group);
  return group;
}
