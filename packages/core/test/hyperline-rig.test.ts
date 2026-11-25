import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { buildRig, decode, decodePrim } from '../../../games/hyperline/lib/rig.js';
import { attachPrims, extractRig, normalizeWeights, parseGlb, parseGltf, reduceKeys, toModuleSource } from '../../../scripts/vendor/glb.js';

// ---- a tiny skinned GLB, built by hand ----
// Two bones (Hips > Spine), one triangle skinned to them, and an animation that turns Spine.
type Acc = { data: ArrayLike<number>; ctype: number; type: string; count: number; normalized?: boolean };
function glb(opts: { withMesh: boolean; anims: { name: string; times: number[]; quats: number[][] }[]; extraNode?: string; rigid?: boolean }): Uint8Array {
  const accs: Acc[] = [];
  const add = (a: Acc) => accs.push(a) - 1;
  const nodes: Record<string, unknown>[] = [
    { name: 'Armature', children: [1], scale: [0.5, 0.5, 0.5] },
    { name: 'Hips', children: [2], translation: [0, 1, 0] },
    { name: opts.extraNode ?? 'Spine', translation: [0, 0.5, 0] },
  ];
  const json: Record<string, unknown> = { asset: { version: '2.0' }, scene: 0, nodes };
  const sceneNodes = [0];
  if (opts.withMesh) {
    const pos = add({ data: [0, 0, 0, 1, 0, 0, 0, 1, 0], ctype: 5126, type: 'VEC3', count: 3 });
    const nrm = add({ data: [0, 0, 1, 0, 0, 1, 0, 0, 1], ctype: 5126, type: 'VEC3', count: 3 });
    const idx = add({ data: [0, 1, 2], ctype: 5123, type: 'SCALAR', count: 3 });
    const j = add({ data: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], ctype: 5121, type: 'VEC4', count: 3 });
    const w = add({ data: [255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0], ctype: 5121, type: 'VEC4', count: 3, normalized: true });
    const ibm = add({ data: [...new THREE.Matrix4().makeTranslation(0, -0.5, 0).toArray(), ...new THREE.Matrix4().makeTranslation(0, -0.75, 0).toArray()], ctype: 5126, type: 'MAT4', count: 2 });
    if (opts.rigid) (nodes[2] as Record<string, unknown>).mesh = 0; // a part riding on the Spine bone, no skin
    else { nodes.push({ name: 'Body', mesh: 0, skin: 0 }); sceneNodes.push(3); }
    json.meshes = [{ name: 'Body', primitives: [{ attributes: { POSITION: pos, NORMAL: nrm, JOINTS_0: j, WEIGHTS_0: w }, indices: idx, material: 0 }] }];
    json.materials = [{ name: 'Suit' }];
    json.skins = [{ joints: [1, 2], inverseBindMatrices: ibm }];
  }
  json.animations = opts.anims.map((a) => {
    const t = add({ data: a.times, ctype: 5126, type: 'SCALAR', count: a.times.length });
    const v = add({ data: a.quats.flat(), ctype: 5126, type: 'VEC4', count: a.quats.length });
    return { name: a.name, samplers: [{ input: t, output: v, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 2, path: 'rotation' } }] };
  });
  json.scenes = [{ nodes: sceneNodes }];
  // pack accessors into one buffer, each 4-byte aligned
  const parts: Uint8Array[] = [];
  let off = 0;
  const views: Record<string, number>[] = [];
  json.accessors = accs.map((a, i) => {
    const Arr = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[a.ctype as 5121]!;
    const bytes = new Uint8Array(new Arr(Array.from(a.data)).buffer);
    const pad = (4 - (bytes.length % 4)) % 4;
    parts.push(bytes, new Uint8Array(pad));
    views.push({ buffer: 0, byteOffset: off, byteLength: bytes.length });
    off += bytes.length + pad;
    const acc: Record<string, unknown> = { bufferView: i, componentType: a.ctype, count: a.count, type: a.type };
    if (a.normalized) acc.normalized = true;
    return acc;
  });
  json.bufferViews = views;
  json.buffers = [{ byteLength: off }];
  const bin = new Uint8Array(off);
  let o = 0;
  for (const p of parts) { bin.set(p, o); o += p.length; }
  let js = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (js.length % 4)) % 4;
  js = new Uint8Array([...js, ...new Array(jpad).fill(0x20)]);
  const total = 12 + 8 + js.length + 8 + bin.length;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, js.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(js, 20);
  dv.setUint32(20 + js.length, bin.length, true); dv.setUint32(24 + js.length, 0x004e4942, true); out.set(bin, 28 + js.length);
  return out;
}

const half = [0, 0, Math.SQRT1_2, Math.SQRT1_2]; // 90 degrees about z
const model = glb({ withMesh: true, anims: [{ name: 'Idle', times: [0, 1], quats: [[0, 0, 0, 1], [0, 0, 0, 1]] }] });
const library = glb({ withMesh: false, anims: [
  { name: 'Sprint_Loop', times: [0, 1], quats: [[0, 0, 0, 1], half] },
  { name: 'Jump_Start', times: [0, 0.5], quats: [[0, 0, 0, 1], half] },
] });

describe('glb: parse and extract a skinned rig (offline, scripts/vendor)', () => {
  it('parses the header and both chunks, and rejects anything that is not GLB 2', () => {
    const g = parseGlb(model);
    expect((g.json as { asset: { version: string } }).asset.version).toBe('2.0');
    expect(g.bin.byteLength).toBeGreaterThan(0);
    expect(() => parseGlb(new Uint8Array(40))).toThrow(/not a GLB/);
  });

  it('reads a .gltf with its buffer in a separate file the same as the .glb', () => {
    const g = parseGlb(model);
    const json = structuredClone(g.json) as { buffers: { uri?: string; byteLength: number }[] };
    json.buffers[0]!.uri = 'model.bin';
    const files: Record<string, Uint8Array> = { 'model.bin': g.bin };
    const fromGltf = parseGltf(JSON.stringify(json), (uri: string) => files[uri]!);
    expect(extractRig(fromGltf, { clips: [] })).toEqual(extractRig(g, { clips: [] }));
    expect(() => parseGltf(JSON.stringify({ ...json, buffers: [{ uri: 'https://example.com/x.bin', byteLength: 4 }] }), () => new Uint8Array(4))).toThrow(/local/);
  });

  it('keeps the node tree, the skin, normalized weights as floats, and the material name', () => {
    const rig = extractRig(parseGlb(model), { clips: [] });
    expect(rig.nodes.map((n) => n.name)).toEqual(['Armature', 'Hips', 'Spine', 'Body']);
    expect(rig.nodes[1]!.parent).toBe(0);
    expect(rig.nodes[0]!.s).toEqual([0.5, 0.5, 0.5]);
    expect(rig.skins[0]!.joints).toEqual([1, 2]);
    expect(rig.meshes).toHaveLength(1);
    const m = rig.meshes[0]!, p = m.prims[0]!;
    expect([m.node, m.skin]).toEqual([3, 0]);
    expect(p.mat).toBe('Suit');
    expect(Array.from(decode(p.w!, 'f32'))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    expect(Array.from(decode(p.j!, 'u16'))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]);
    expect(rig.tris).toBe(1);
  });

  it('keeps rigid parts that ride on a node, with no skin data', () => {
    const rig = extractRig(parseGlb(glb({ withMesh: true, rigid: true, anims: [] })), { clips: [] });
    expect(rig.meshes.map((m) => [m.node, m.skin])).toEqual([[2, -1]]);
    expect(rig.meshes[0]!.prims[0]!.j).toBeUndefined();
    const r = buildRig(THREE, rig, () => new THREE.MeshBasicMaterial());
    const part = r.root.getObjectByName('Spine')!.children[0];
    expect(part.isMesh && !part.isSkinnedMesh).toBe(true);
  });

  it('takes clips from a second file by name, renames them, and maps tracks by node name', () => {
    const rig = extractRig(parseGlb(model), { clips: [{ from: parseGlb(library), pick: { run: 'Sprint_Loop', jump: 'Jump_Start' } }] });
    expect(rig.clips.map((c) => c.name)).toEqual(['run', 'jump']);
    expect(rig.clips[1]!.dur).toBeCloseTo(0.5);
    expect(rig.clips[0]!.tracks).toEqual([expect.objectContaining({ node: 2, path: 'quaternion' })]);
  });

  it('fails loudly on a clip name that is not in the file, listing what is', () => {
    expect(() => extractRig(parseGlb(model), { clips: [{ from: parseGlb(library), pick: { run: 'Nope' } }] }))
      .toThrow(/Nope.*Sprint_Loop/);
  });

  it('normalizes skin weights to sum to 1 (unnormalized ones fling vertices: the robot hands summed to 1.76)', () => {
    const w = normalizeWeights([0.73, 0.6, 0.31, 0.11, 0, 0, 0, 0]);
    [0.73 / 1.75, 0.6 / 1.75, 0.31 / 1.75, 0.11 / 1.75, 1, 0, 0, 0].forEach((v, i) => expect(w[i]).toBeCloseTo(v, 9));
  });

  it('every skinned vertex of the shipped robot has weights summing to 1', async () => {
    const robot = (await import('../../../games/hyperline/models/robot.js')).default;
    for (const m of robot.meshes.filter((x) => x.skin >= 0)) for (const p of m.prims) {
      const w = decodePrim(p).w!;
      for (let i = 0; i < w.length; i += 4) expect(w[i]! + w[i + 1]! + w[i + 2]! + w[i + 3]!).toBeCloseTo(1, 4);
    }
  });

  it('the shipped robot stays in one piece through its run cycle (skinned hands were flung off the body)', async () => {
    const robot = (await import('../../../games/hyperline/models/robot.js')).default;
    const r = buildRig(THREE, robot, () => new THREE.MeshBasicMaterial());
    r.actions.run!.play();
    const v = new THREE.Vector3();
    for (let k = 0; k < 12; k++) {
      r.mixer.update(0.08); r.root.updateMatrixWorld(true);
      r.root.traverse((m: { isSkinnedMesh?: boolean; skeleton: { update(): void }; geometry: { attributes: { position: { count: number } } }; getVertexPosition(i: number, v: unknown): void; matrixWorld: unknown }) => {
        if (!m.isSkinnedMesh) return;
        m.skeleton.update();
        for (let i = 0; i < m.geometry.attributes.position.count; i++) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld as never); expect(v.length()).toBeLessThan(6); }
      });
    }
  });

  it('quantized geometry decodes to within a hair of the original, and stays a valid skin', () => {
    const full = extractRig(parseGlb(model), { clips: [] }), q = extractRig(parseGlb(model), { clips: [], quantize: true });
    const fp = full.meshes[0]!.prims[0]!, qp = q.meshes[0]!.prims[0]!;
    expect(qp.posQ).toHaveLength(6);
    const a = decodePrim(fp), b = decodePrim(qp);
    a.pos.forEach((v: number, i: number) => expect(b.pos[i]).toBeCloseTo(v, 3));
    a.nrm.forEach((v: number, i: number) => expect(Math.abs(b.nrm[i]! - v)).toBeLessThan(0.02));
    const bw = b.w!;
    for (let i = 0; i < bw.length; i += 4) expect(bw[i]! + bw[i + 1]! + bw[i + 2]! + bw[i + 3]!).toBeCloseTo(1, 5);
    expect(Array.from(b.j!)).toEqual(Array.from(a.j!));
  });

  it('attachPrims puts a rigid part into a bone\'s local space, so it rides that bone on the body', () => {
    // the model's Spine sits at y = (1 + 0.5) * 0.5 = 0.75 (Armature scale 0.5); a part made at y = 0.75 sits on it
    const part = glb({ withMesh: true, rigid: true, anims: [] });
    const att = attachPrims(parseGlb(part), parseGlb(model), 'Spine', {});
    expect(att.attach).toBe('Spine');
    const r = buildRig(THREE, extractRig(parseGlb(model), { clips: [] }), () => new THREE.MeshBasicMaterial());
    const bone = r.root.getObjectByName('Spine')!;
    const d = decodePrim(att.prims[0]!);
    // the part's first vertex (0,0,0) at its node Spine (0.75 up) lands back on the bone origin in bone space, scaled by 1/0.5
    r.root.updateMatrixWorld(true);
    const v = new THREE.Vector3(d.pos[0], d.pos[1], d.pos[2]).applyMatrix4(bone.matrixWorld);
    expect(v.y).toBeCloseTo(0.75, 4);
    expect(() => attachPrims(parseGlb(part), parseGlb(model), 'Nope', {})).toThrow(/Nope/);
  });

  it('dropMats leaves out primitives whose material matches (interiors, heavy trim)', () => {
    const all = extractRig(parseGlb(model), { clips: [] });
    expect(all.meshes[0]!.prims.map((p) => p.mat)).toEqual(['Suit']);
    const none = extractRig(parseGlb(model), { clips: [], dropMats: /^Suit$/ });
    expect(none.meshes).toEqual([]);
    expect(none.tris).toBe(0);
  });

  it('keyframe reduction keeps the ends and every key that interpolation cannot reproduce', () => {
    // a straight line in 5 keys collapses to its ends; a bend keeps the corner
    expect(reduceKeys([0, 1, 2, 3, 4], [0, 1, 2, 3, 4], 1, 1e-4)).toEqual({ times: [0, 4], values: [0, 4] });
    expect(reduceKeys([0, 1, 2, 3, 4], [0, 1, 2, 1, 0], 1, 1e-4)).toEqual({ times: [0, 2, 4], values: [0, 2, 0] });
    // vec3: a key differing in any component stays
    expect(reduceKeys([0, 1, 2], [0, 0, 0, 1, 1, 5, 2, 2, 2], 3, 1e-4).times).toEqual([0, 1, 2]);
  });

  it('optimize drops tracks that never move from the bind pose, and shrinks the rest', () => {
    const still = glb({ withMesh: false, anims: [{ name: 'Still', times: [0, 0.5, 1], quats: [[0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1]] }] });
    const turn = glb({ withMesh: false, anims: [{ name: 'Turn', times: [0, 0.5, 1], quats: [[0, 0, 0, 1], [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)], [0, 0, Math.SQRT1_2, Math.SQRT1_2]] }] });
    const rig = extractRig(parseGlb(model), { clips: [{ from: parseGlb(still), pick: { still: 'Still' } }, { from: parseGlb(turn), pick: { turn: 'Turn' } }], optimize: true });
    expect(rig.clips[0]!.tracks).toEqual([]);
    expect(rig.clips[0]!.dur).toBeCloseTo(1); // the clip keeps its length
    expect(rig.clips[1]!.tracks).toHaveLength(1);
    const r = buildRig(THREE, rig, () => new THREE.MeshBasicMaterial());
    r.actions.turn!.play(); r.mixer.update(0.5);
    expect(r.root.getObjectByName('Spine')!.quaternion.z).toBeCloseTo(Math.sin(Math.PI / 8), 3); // slerp-close after reduction
  });

  it('drops tracks for bones the model does not have', () => {
    const odd = glb({ withMesh: false, extraNode: 'Tail', anims: [{ name: 'Wag', times: [0, 1], quats: [[0, 0, 0, 1], half] }] });
    const rig = extractRig(parseGlb(model), { clips: [{ from: parseGlb(odd), pick: { wag: 'Wag' } }] });
    expect(rig.clips[0]!.tracks).toEqual([]);
  });

  it('writes a data-only ES module (no imports, no code that could reach the network)', () => {
    const src = toModuleSource(extractRig(parseGlb(model), { clips: [] }), { source: 'test', license: 'CC0' });
    expect(src).toMatch(/^\/\/ /);
    expect(src).toContain('export default ');
    expect(src).not.toMatch(/\bimport\b|fetch|XMLHttpRequest/);
    expect(src).toContain('CC0');
  });
});

describe('rig: build a skinned, animated runner from the data module (runtime, three injected)', () => {
  const rig = extractRig(parseGlb(model), { clips: [{ from: parseGlb(library), pick: { run: 'Sprint_Loop', jump: 'Jump_Start' } }] });

  it('builds a SkinnedMesh bound to a two-bone skeleton, with our own material per material name', () => {
    const made: string[] = [];
    const r = buildRig(THREE, rig, (name: string) => { made.push(name); return new THREE.MeshBasicMaterial(); });
    expect(made).toEqual(['Suit']);
    type Skinned = { isSkinnedMesh?: boolean; skeleton: { bones: { name: string }[] } };
    const meshes: Skinned[] = [];
    r.root.traverse((o: Skinned) => { if (o.isSkinnedMesh) meshes.push(o); });
    expect(meshes).toHaveLength(1);
    expect(meshes[0]!.skeleton.bones.map((b) => b.name)).toEqual(['Hips', 'Spine']);
    expect(Object.keys(r.actions)).toEqual(['run', 'jump']);
  });

  it('playing a clip turns the bone', () => {
    const r = buildRig(THREE, rig, () => new THREE.MeshBasicMaterial());
    const spine = r.root.getObjectByName('Spine')!;
    r.actions.run!.play();
    r.mixer.update(0.5); // halfway through a 90 degree turn
    expect(spine.quaternion.z).toBeCloseTo(Math.sin(Math.PI / 8), 3);
  });
});
