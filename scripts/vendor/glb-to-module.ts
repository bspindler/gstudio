// npm run model -- <model.glb> [--list] [--clips <library.glb> --pick run=Sprint_Loop,jump=Jump_Start]
//                  --out games/<slug>/models/<name>.js --source "<pack name and URL>" --license CC0
// Converts a CC0 glTF character (for example Quaternius) into a data-only ES module that games/<slug>/lib/rig.js turns
// into a SkinnedMesh with our own materials. --list prints the file's materials, bones, clips and triangle count.
// Read downloaded packs from their own folder and never run anything that came with them.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

import { extractRig, type Glb, parseGlb, parseGltf, toModuleSource } from './glb.js';

/** A .glb, or a .gltf whose buffers are files beside it. */
const load = (f: string): Glb => (f.endsWith('.gltf') ? parseGltf(readFileSync(f, 'utf8'), (uri) => readFileSync(join(dirname(f), uri))) : parseGlb(readFileSync(f)));

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: { list: { type: 'boolean' }, clips: { type: 'string' }, pick: { type: 'string' }, out: { type: 'string' },
    source: { type: 'string' }, license: { type: 'string' } },
});
const file = positionals[0];
if (!file) throw new Error('usage: npm run model -- <model.glb> [--list] [--clips lib.glb --pick a=A,b=B] --out x.js --source "..." --license CC0');
const model = load(file);

if (o.list) {
  const files: [string, string, Glb][] = [['model', file, model]];
  if (o.clips) files.push(['clips', o.clips, load(o.clips)]);
  for (const [label, path, g] of files) {
    const J = g.json;
    console.log(`${label}: ${path}`);
    console.log(`  materials: ${(J.materials || []).map((m: { name?: string }) => m.name).join(', ')}`);
    console.log(`  nodes: ${(J.nodes || []).length}, skins: ${(J.skins || []).length}, meshes: ${(J.meshes || []).length}`);
    console.log(`  clips (${(J.animations || []).length}): ${(J.animations || []).map((a: { name: string }) => a.name).join(', ')}`);
  }
  process.exit(0);
}

if (!o.out || !o.source || o.license !== 'CC0') throw new Error('--out, --source and --license CC0 are required (only CC0 models go in a game)');
const pick = Object.fromEntries((o.pick || '').split(',').filter(Boolean).map((kv) => kv.split('=') as [string, string]));
const clips = o.clips ? [{ from: load(o.clips), pick }] : Object.keys(pick).length ? [{ from: model, pick }] : [];
const rig = extractRig(model, { clips, optimize: true, quantize: true });
const src = toModuleSource(rig, { source: o.source, license: o.license });
writeFileSync(o.out, src);
console.log(`${o.out}: ${(src.length / 1024).toFixed(0)} KB, ${rig.tris} triangles, ${rig.meshes.length} meshes, clips ${rig.clips.map((c) => c.name).join(', ')}`);
