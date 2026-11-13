// npm run build:three: bundles the parts of three.js the games may use (scripts/vendor/three-entry.js) into
// packages/sdk/vendor/three.module.js, served to every game at ../sdk/vendor/three.module.js like the SDK, and copies
// three's MIT license beside it. Run it after changing the
// entry or the three version in package.json; the bundle is committed, so games keep needing no build step.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}packages/sdk/vendor/three.module.js`;
const version = JSON.parse(readFileSync(`${root}node_modules/three/package.json`, 'utf8')).version;
mkdirSync(`${root}packages/sdk/vendor`, { recursive: true });
await build({
  entryPoints: [`${root}scripts/vendor/three-entry.js`],
  bundle: true, format: 'esm', minify: true, treeShaking: true, target: 'es2020', legalComments: 'none',
  outfile: out,
  banner: { js: `/* three.js r${version.split('.')[1]} (${version}), MIT License, Copyright 2010-2026 three.js authors. See three.LICENSE.txt. Bundled by scripts/build-three.ts. */` },
});
copyFileSync(`${root}node_modules/three/LICENSE`, `${root}packages/sdk/vendor/three.LICENSE.txt`);
const src = readFileSync(out, 'utf8');
for (const bad of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource']) {
  if (src.includes(bad)) throw new Error(`build-three: the bundle contains ${bad}; drop whatever pulls it in`);
}
writeFileSync(`${root}packages/sdk/vendor/SOURCES.md`, `# Vendored code\n\n- \`three.module.js\`: three.js ${version} (https://threejs.org), MIT License (\`three.LICENSE.txt\`). A tree-shaken bundle of the parts listed in \`scripts/vendor/three-entry.js\`, built by \`npm run build:three\`. MIT allows commercial use and sale; keep the license file with the code.\n`);
console.log(`three ${version}: ${(src.length / 1024).toFixed(0)} KB -> ${out}`);
