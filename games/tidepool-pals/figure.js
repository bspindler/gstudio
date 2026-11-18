// The 3D prize pal: a soft cartoon figure built from ellipsoids and cones, mirroring creatureSVG (same shape, colour and feature).
// This file is pure maths (no three.js); index.html turns the parts into meshes. Units: 1 = 10 SVG units, y up, +z toward the viewer.
const SHAPES = { round: [3, 2.7, 2.6], tall: [2.4, 3.2, 2.3], wide: [3.5, 2.3, 2.5] };

export function figureParts(cr) {
  const [rx, ry, rz] = SHAPES[cr.shape] || SHAPES.round;
  const f = cr.col, parts = [];
  const add = (g, p, s, col, extra) => parts.push({ g, p, s, col, ...extra });
  const top = ry; // body centre is the origin
  // body, drawn first
  add('sphere', [0, 0, 0], [rx, ry, rz], f);
  add('sphere', [0, -ry * 0.4, rz * 0.12], [rx * 0.62, ry * 0.42, rz * 0.9], '#ffffff', { soft: true }); // pale belly
  switch (cr.feat) {
    case 'fins':
      for (const s of [-1, 1]) add('sphere', [s * (rx + 0.5), -0.1, 0], [1, 0.75, 0.25], f, { rot: s * 0.5 });
      add('cone', [0, top + 0.5, 0], [0.7, 1.1, 0.35], f);
      break;
    case 'claws':
      for (const s of [-1, 1]) { add('sphere', [s * (rx + 0.7), 0.9, 0.2], [0.55, 0.55, 0.55], f); add('sphere', [s * (rx + 1.1), 1.8, 0.2], [1, 1, 0.8], f); }
      break;
    case 'spikes':
      for (let i = 0; i < 5; i++) { const a = ((200 + 35 * i) * Math.PI) / 180;
        add('cone', [Math.cos(a) * rx * 0.95, -Math.sin(a) * ry * 0.95, -rz * 0.2], [0.45, 0.9, 0.45], f, { rot: -(a + Math.PI / 2) }); }
      break;
    case 'tentacles':
      for (const dx of [-1.8, -0.6, 0.6, 1.8]) add('sphere', [dx * (rx / 3), -ry - 0.5, 0], [0.55, 1.3, 0.55], f);
      break;
    case 'lure':
      add('sphere', [0.8, top + 0.5, 0], [0.3, 1.1, 0.3], f, { rot: -0.4 });
      add('sphere', [1.5, top + 1.3, 0], [0.65, 0.65, 0.65], '#FFF6A8', { glow: true });
      break;
    case 'crown':
      for (const [x, dy] of [[-1.2, 0.4], [0, 0.9], [1.2, 0.4]]) add('sphere', [x, top + dy, 0], [0.55, 0.55, 0.55], '#FFD98A', { glow: true });
      break;
    case 'shell':
      add('sphere', [0, ry * 0.3, -rz * 0.3], [rx * 0.85, ry * 0.75, rz * 0.8], '#C9763A');
      break;
  }
  // face: on the front of the body
  const ex = Math.min(rx * 0.38, 1.3), ey = ry * 0.12 - (cr.feat === 'shell' ? 0.6 : 0);
  const front = (x, y) => rz * Math.sqrt(Math.max(0, 1 - (x / rx) ** 2 - (y / ry) ** 2));
  for (const s of [-1, 1]) {
    const x = s * ex, z = front(x, ey);
    add('sphere', [s * (ex + 0.6), ey - 0.8, front(s * (ex + 0.6), ey - 0.8) * 0.97], [0.45, 0.3, 0.15], '#FF8FA3');
    add('sphere', [x, ey, z * 0.98], [0.75, 0.75, 0.4], '#ffffff');
    add('sphere', [x + 0.1, ey - 0.1, z + 0.28], [0.42, 0.42, 0.2], '#14202B');
  }
  add('sphere', [0, ey - 0.95, front(0, ey - 0.95) * 0.99], [0.35, 0.14, 0.1], '#14202B');
  return parts;
}

/** A camera that holds the whole pal inside a card of the given aspect (width / height), with margin on every side, even turned a little. */
export function figureCamera(parts, aspect, fovDeg = 30) {
  const t = Math.tan((fovDeg * Math.PI) / 360);
  let minY = Infinity, maxY = -Infinity;
  for (const p of parts) { const r = Math.max(...p.s); minY = Math.min(minY, p.p[1] - r); maxY = Math.max(maxY, p.p[1] + r); }
  const centreY = (minY + maxY) / 2, halfH = (maxY - minY) / 2;
  let halfW = 0, reachZ = 0;
  for (const p of parts) { const r = Math.max(...p.s), d = Math.hypot(p.p[0], p.p[2]); halfW = Math.max(halfW, d + r); reachZ = Math.max(reachZ, d); }
  // Margin: the figure fills at most ~80% of the card either way. Distance is measured to the figure's centre column; parts that are
  // nearer the lens look bigger, so add their reach.
  const need = Math.max(halfH / t, halfW / (t * aspect)) / 0.8;
  return { fov: fovDeg, distance: need + reachZ, centreY };
}
