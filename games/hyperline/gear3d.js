// Hair and accessories for the hero runner (docs/hyperline/style-guide.md). Hair is the Quaternius hairstyles (CC0),
// converted into the Head bone's space (models/hair/*.js). Accessories are built here in code: a jetpack whose flames
// grow in the air, a cape and a scarf tail that stream with speed, headphones, a spinning halo, a neon crest and
// shoulder pads. Each is made in the body's bind-pose space (y up, the face toward +z, metres), placed from the body's
// own bone positions so it fits M and F alike, then mounted on a bone so it rides every animation. three.js is passed in.

import { attachTo } from './lib/rig.js';

/** Hairstyles (and brows), loaded on demand. Each was made for one body; on the other it sits close enough. */
export const HAIRS = {
  buzzed: () => import('./models/hair/buzzed.js'), parted: () => import('./models/hair/parted.js'), beard: () => import('./models/hair/beard.js'),
  long: () => import('./models/hair/long.js'), buns: () => import('./models/hair/buns.js'), 'buzzed-f': () => import('./models/hair/buzzed-f.js'),
  'brows-m': () => import('./models/hair/brows-m.js'), 'brows-f': () => import('./models/hair/brows-f.js'),
};
/** Skin tones the player can pick (shown when an outfit has hair instead of a helmet). */
export const SKIN_TONES = ['#F3D2B3', '#E0AC82', '#B98157', '#8D5A3B', '#5C3A26'];
/** Every accessory an outfit can list in `gear`. */
export const GEAR = ['jetpack', 'cape', 'scarf', 'headphones', 'halo', 'crest', 'shoulders'];

const cache = new Map();
/** Loads the hair modules a look needs (cached). */
export async function loadHair(names) {
  await Promise.all(names.filter((n) => n && HAIRS[n] && !cache.has(n)).map(async (n) => cache.set(n, (await HAIRS[n]()).default)));
  return Object.fromEntries(names.filter((n) => cache.has(n)).map((n) => [n, cache.get(n)]));
}

/** The hair pieces a look wants on a body: its hairstyle, a beard (M only), and brows. */
export function hairFor(look, body) {
  if (!look.hair) return [];
  const style = look.hair[body] || look.hair.m || look.hair.f;
  return [style, body === 'm' && look.beard ? 'beard' : null, body === 'f' ? 'brows-f' : 'brows-m'].filter(Boolean);
}

/** A cloth strip (cape, scarf tail) that streams back with speed and flutters; its top edge stays pinned. */
function clothMaterial(T, base) {
  const m = new T.MeshStandardMaterial({ roughness: 0.55, metalness: 0.15, side: T.DoubleSide, ...base });
  m.userData.cloth = { uT: { value: 0 }, uWind: { value: 0 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.cloth);
    sh.vertexShader = 'uniform float uT; uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float k = 1.0 - uv.y; // 0 at the pinned top, 1 at the free end
      transformed.z -= k * k * (0.12 + 0.45 * uWind);
      transformed.y += k * k * 0.14 * uWind;
      transformed.z += sin(uT * 9.0 + k * 7.0 + position.x * 9.0) * 0.035 * k * (0.4 + uWind);`);
  };
  return m;
}

/**
 * Dresses a built hero rig (in its bind pose, root unscaled) with a look's hair and gear. look: { hair?, hairColor?,
 * beard?, gear?: [...] }. hair: the loaded hair modules (loadHair). Returns { update({ t, speed, air, trim, glow }),
 * parts } — update animates the flames, cloth and halo each frame.
 */
export function dress(T, rig, look, body, hair, headTop) {
  const root = rig.root;
  root.updateMatrixWorld(true);
  const bone = (n) => root.getObjectByName(n);
  const at = (n) => { const b = bone(n); return b ? new T.Vector3().setFromMatrixPosition(b.matrixWorld) : new T.Vector3(); };
  const mount = (obj, n) => { const b = bone(n); if (!b) return null; obj.applyMatrix4(b.matrixWorld.clone().invert()); b.add(obj); obj.traverse((o) => { o.frustumCulled = false; }); return obj; };

  const shell = new T.MeshStandardMaterial({ color: '#5A5478', roughness: 0.3, metalness: 0.6 }); // light enough to read on the night track
  const glow = new T.MeshBasicMaterial({ color: '#FFFFFF', toneMapped: false });
  const hairMat = new T.MeshStandardMaterial({ color: look.hairColor || '#1A1410', roughness: 0.6, metalness: 0.1 });
  const browMat = new T.MeshStandardMaterial({ color: new T.Color(look.hairColor || '#1A1410').multiplyScalar(0.6), roughness: 0.7 });
  const parts = [], flames = [], cloth = [];
  let halo = null;

  for (const name of hairFor(look, body)) if (hair[name]) { const g = attachTo(T, root, hair[name], name.startsWith('brows') ? browMat : hairMat); if (g) { g.traverse((o) => { o.frustumCulled = false; }); parts.push(g); } }

  const neck = at('neck_01'), chest = at('spine_03'), head = at('Head'), top = headTop || head.y + 0.15;
  const headMidY = top - 0.11;
  for (const kind of look.gear || []) {
    const g = new T.Group();
    if (kind === 'jetpack') {
      const y = chest.y - 0.02, z = chest.z - 0.17;
      const plate = new T.Mesh(new T.BoxGeometry(0.22, 0.3, 0.06), shell); plate.position.set(0, y, z + 0.03); g.add(plate);
      for (const x of [-0.075, 0.075]) {
        const tank = new T.Mesh(new T.CylinderGeometry(0.055, 0.055, 0.3, 14), shell); tank.position.set(x, y, z - 0.03); g.add(tank);
        const band = new T.Mesh(new T.TorusGeometry(0.056, 0.007, 6, 18), glow); band.rotation.x = Math.PI / 2; band.position.set(x, y + 0.08, z - 0.03); g.add(band);
        const nozzle = new T.Mesh(new T.ConeGeometry(0.05, 0.07, 14, 1, true), shell); nozzle.position.set(x, y - 0.18, z - 0.03); g.add(nozzle);
        // wide at the nozzle, tapering down to a point; it scales from the nozzle
        const flame = new T.Mesh(new T.ConeGeometry(0.045, 0.3, 12).rotateX(Math.PI).translate(0, -0.15, 0), glow);
        flame.position.set(x, y - 0.21, z - 0.03); g.add(flame); flames.push(flame);
      }
    } else if (kind === 'cape' || kind === 'scarf') {
      const cape = kind === 'cape', w = cape ? 0.46 : 0.11, h = cape ? 0.95 : 0.5;
      const m = clothMaterial(T, { color: '#1A1030' });
      const strip = new T.Mesh(new T.PlaneGeometry(w, h, cape ? 6 : 2, 14).translate(cape ? 0 : 0.06, -h / 2, 0), m);
      strip.position.set(0, neck.y - (cape ? 0.06 : 0.02), neck.z - (cape ? 0.12 : 0.09)); g.add(strip); cloth.push(m);
      if (!cape) { const ring = new T.Mesh(new T.TorusGeometry(0.075, 0.028, 8, 20), m); ring.rotation.x = Math.PI / 2; ring.position.set(0, neck.y - 0.02, neck.z); g.add(ring); }
      else { const clasp = new T.Mesh(new T.BoxGeometry(0.42, 0.025, 0.03), glow); clasp.position.set(0, neck.y - 0.06, neck.z - 0.1); g.add(clasp); }
    } else if (kind === 'headphones') {
      const band = new T.Mesh(new T.TorusGeometry(0.118, 0.013, 8, 28, Math.PI), shell); band.position.set(0, headMidY, head.z + 0.005); g.add(band);
      for (const x of [-0.112, 0.112]) {
        const cup = new T.Mesh(new T.CylinderGeometry(0.048, 0.048, 0.045, 18), shell); cup.rotation.z = Math.PI / 2; cup.position.set(x, headMidY - 0.01, head.z + 0.005); g.add(cup);
        const ring = new T.Mesh(new T.TorusGeometry(0.04, 0.007, 6, 20), glow); ring.rotation.y = Math.PI / 2; ring.position.set(x * 1.21, headMidY - 0.01, head.z + 0.005); g.add(ring);
      }
    } else if (kind === 'halo') {
      halo = new T.Mesh(new T.TorusGeometry(0.11, 0.008, 8, 40), glow); halo.rotation.x = Math.PI / 2; halo.position.set(0, top + 0.08, head.z); g.add(halo);
    } else if (kind === 'crest') {
      for (let i = 0; i < 5; i++) {
        const fh = 0.04 + 0.025 * Math.sin((i / 4) * Math.PI) + i * 0.006;
        const fin = new T.Mesh(new T.BoxGeometry(0.012, fh, 0.045), glow); fin.position.set(0, top + fh / 2 - 0.012, head.z + 0.06 - i * 0.045); fin.rotation.x = -0.35; g.add(fin);
      }
    } else if (kind === 'shoulders') {
      for (const side of ['l', 'r']) {
        const p = at(`upperarm_${side}`), pad = new T.Group();
        const dome = new T.Mesh(new T.SphereGeometry(0.085, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), shell); dome.scale.set(1.05, 0.65, 1.15); pad.add(dome);
        const rim = new T.Mesh(new T.TorusGeometry(0.087, 0.008, 6, 24), glow); rim.rotation.x = Math.PI / 2; rim.scale.set(1.05, 1.15, 1); pad.add(rim);
        pad.position.set(p.x, p.y + 0.035, p.z); mount(pad, `upperarm_${side}`); parts.push(pad);
      }
      continue;
    }
    mount(g, kind === 'jetpack' || kind === 'cape' ? 'spine_03' : kind === 'scarf' ? 'neck_01' : 'Head');
    parts.push(g);
  }

  return {
    parts,
    /** t: seconds; speed: track speed; air: airborne; trim: glow colour (a three Color or a CSS colour). */
    update({ t = 0, speed = 0, air = false, trim = '#FFFFFF' }) {
      glow.color.set(trim); shell.emissive.set(trim).multiplyScalar(0.14);
      const wind = Math.max(0, Math.min(1, (speed - 4) / 14));
      for (const c of cloth) { c.userData.cloth.uT.value = t; c.userData.cloth.uWind.value = wind; c.color.set(trim).multiplyScalar(0.35); c.emissive.set(trim).multiplyScalar(0.18); }
      for (const f of flames) f.scale.set(1, (air ? 1 : 0.35) * (0.85 + 0.15 * Math.sin(t * 40 + f.position.x * 50)), 1);
      if (halo) halo.rotation.z = t * 1.6;
    },
    dispose() { for (const p of parts) { p.parent && p.parent.remove(p); p.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); } },
  };
}
