// Builds a skinned, animated model from a data module (games/hyperline/models/*.js, made offline by
// scripts/vendor/glb-to-module.ts). three.js is passed in, so this file has no imports and runs under tests with the
// npm package. No loader and no network: the model's arrays are already in the module.

const ARR = { f32: Float32Array, u16: Uint16Array, u32: Uint32Array };

/** Base64 to a typed array. */
export function decode(s, type) {
  const bin = atob(s), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new ARR[type](u8.buffer);
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
      g.setAttribute('position', new T.BufferAttribute(decode(p.pos, 'f32'), 3));
      g.setAttribute('normal', new T.BufferAttribute(decode(p.nrm, 'f32'), 3));
      if (p.col) g.setAttribute('color', new T.BufferAttribute(decode(p.col, 'f32'), 4));
      g.setIndex(new T.BufferAttribute(decode(p.idx, p.idx32 ? 'u32' : 'u16'), 1));
      let mesh;
      if (m.skin >= 0) {
        g.setAttribute('skinIndex', new T.BufferAttribute(decode(p.j, 'u16'), 4));
        g.setAttribute('skinWeight', new T.BufferAttribute(decode(p.w, 'f32'), 4));
        mesh = new T.SkinnedMesh(g, mat(p.mat));
        host.add(mesh);
        mesh.bind(skeletons[m.skin], host.matrixWorld);
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
