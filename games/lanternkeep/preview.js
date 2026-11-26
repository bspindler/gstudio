// A quiet planning aid: small moonlit silhouettes of the creature kinds in the wave that is coming.
// Visual only: reads the game state, never changes it. No text and no timer.
const TAU = Math.PI * 2;

// Distinct creature kinds of the next wave, in the order they first appear. Empty while a wave is
// still arriving, once the last wave has started, or when the game is over.
export function previewKinds(g) {
  if (!g || !g.level) return [];
  const between = g.phase === 'ready' || (g.phase === 'wave' && g.queue.length === 0);
  if (!between) return [];
  const next = g.level.waves[g.waveIndex + 1];
  if (!next) return [];
  const kinds = [];
  for (const entry of next) if (!kinds.includes(entry[0])) kinds.push(entry[0]);
  return kinds;
}

const ell = (c, x, y, rx, ry, rot = 0) => { c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, TAU); c.fill(); };

// Draws one silhouette centred in a box of side `s` (any 2D context). Plain shapes, drawn in code.
export function drawSilhouette(c, type, s) {
  c.save();
  c.translate(s / 2, s / 2);
  c.fillStyle = '#cfc6ff';
  c.strokeStyle = '#cfc6ff';
  c.lineWidth = Math.max(1, s * 0.07);
  c.lineCap = 'round';
  const u = s / 10;
  switch (type) {
    case 'moth': case 'lampmoth': case 'mothmother': {
      const k = type === 'mothmother' ? 1.15 : 1;
      ell(c, -2.4 * u * k, -0.8 * u * k, 2.6 * u * k, 1.6 * u * k, -0.5); ell(c, 2.4 * u * k, -0.8 * u * k, 2.6 * u * k, 1.6 * u * k, 0.5);
      ell(c, -1.8 * u * k, 1.4 * u * k, 1.6 * u * k, 1 * u * k, 0.4); ell(c, 1.8 * u * k, 1.4 * u * k, 1.6 * u * k, 1 * u * k, -0.4);
      ell(c, 0, 0.4 * u, 0.7 * u, 2 * u);
      if (type === 'lampmoth') { c.fillStyle = '#ffffff'; c.beginPath(); c.arc(0, 2.6 * u, 0.9 * u, 0, TAU); c.fill(); }
      break;
    }
    case 'firefly': ell(c, 0, 0.6 * u, 1.4 * u, 2 * u); ell(c, 0, -2 * u, 1 * u, 1 * u); ell(c, -2 * u, -0.6 * u, 1.8 * u, 0.8 * u, -0.5); ell(c, 2 * u, -0.6 * u, 1.8 * u, 0.8 * u, 0.5); break;
    case 'beetle': case 'mossback': { const k = type === 'mossback' ? 1.15 : 1; ell(c, 0, 0.4 * u, 3.4 * u * k, 3 * u * k); ell(c, 0, -3 * u * k, 1.4 * u, 1.1 * u); break; }
    case 'wisp': c.beginPath(); c.moveTo(0, -4.2 * u); c.quadraticCurveTo(3.6 * u, 0.5 * u, 0, 3.6 * u); c.quadraticCurveTo(-3.6 * u, 0.5 * u, 0, -4.2 * u); c.fill(); break;
    case 'twinwisp':
      for (const d of [-1, 1]) { c.beginPath(); c.moveTo(d * 2.4 * u, -3 * u); c.quadraticCurveTo(d * 4.8 * u, 0.5 * u, d * 2.4 * u, 3 * u); c.quadraticCurveTo(d * 0.2 * u, 0.5 * u, d * 2.4 * u, -3 * u); c.fill(); }
      break;
    case 'shadebearer': ell(c, 0, 0.8 * u, 2.4 * u, 3.4 * u); c.beginPath(); c.moveTo(-2 * u, -1.5 * u); c.lineTo(0, -4.4 * u); c.lineTo(2 * u, -1.5 * u); c.fill(); break;
    case 'mole': case 'burrower': ell(c, 0, 1 * u, 3.4 * u, 2.4 * u); ell(c, 3 * u, 0.2 * u, 1.3 * u, 1.1 * u); c.beginPath(); c.moveTo(-4.5 * u, 3.8 * u); c.lineTo(4.5 * u, 3.8 * u); c.stroke(); break;
    case 'toad': ell(c, 0, 1 * u, 3.6 * u, 2.4 * u); c.beginPath(); c.arc(-1.6 * u, -1.6 * u, 1 * u, 0, TAU); c.arc(1.6 * u, -1.6 * u, 1 * u, 0, TAU); c.fill(); break;
    case 'stag':
      ell(c, -1 * u, 1.6 * u, 3.4 * u, 2 * u); ell(c, 3 * u, -0.6 * u, 1.3 * u, 1.1 * u);
      for (const d of [0, 1.8]) { c.beginPath(); c.moveTo((2.6 + d * 0.3) * u, -1.4 * u); c.lineTo((2.2 + d) * u, -4.2 * u); c.lineTo((3.4 + d) * u, -4.6 * u); c.stroke(); }
      break;
    default: ell(c, 0, 0, 3 * u, 3 * u);
  }
  c.restore();
}
