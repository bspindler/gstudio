// Lanternkeep 2D fallback renderer (used when WebGL2 is missing): draws the garden, towers, creatures and effects on one canvas.
// The look rests on one idea: the garden is dark, and only light pushes the dark back.
// Towers and the lantern cut holes in a darkness layer; the lantern's light shrinks as lives drop.
import { COLS, ROWS, stats } from './lib/sim.js';
import { createSwell } from './swell.js';
import { createFootprints } from './footprints.js';
import { createRouteGlow } from './routeglow.js';

export const COLOR = {
  night: '#1b1530',
  moss: '#24382e',
  path: '#cfc6a8',
  pathEdge: '#7d7663',
  lantern: '#ffb85c',
  glowcap: '#6ff0c6',
  frost: '#a8dcff',
  ember: '#ff7a45',
  sunspire: '#ffe27a',
  moonbell: '#c9d6ff',
  thornbriar: '#b8e07a',
  gold: '#ffd36b',
};

const TAU = Math.PI * 2;

function hash(c, r, k = 0) {
  let h = (Math.imul(c + 101, 374761393) + Math.imul(r + 31, 668265263) + Math.imul(k + 7, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------- towers (also used for tray icons) ----------

export function drawTower(ctx, type, x, y, s, tier, t, aim = 0) {
  const grow = 1 + tier * 0.12;
  ctx.save();
  ctx.translate(x, y);
  // soil
  ctx.fillStyle = 'rgba(10,8,20,0.45)';
  ctx.beginPath();
  ctx.ellipse(0, s * 0.28, s * 0.34, s * 0.12, 0, 0, TAU);
  ctx.fill();
  ctx.scale(grow, grow);
  if (type === 'glowcap') {
    const caps = [[0, 0, 1]];
    if (tier >= 1) caps.push([-0.2, 0.1, 0.55]);
    if (tier >= 2) caps.push([0.22, 0.12, 0.5]);
    for (const [ox, oy, k] of caps.slice().reverse()) {
      const cx = ox * s, cy = oy * s, w = s * 0.3 * k;
      ctx.fillStyle = '#e8e2cc';
      ctx.fillRect(cx - w * 0.22, cy - w * 0.2, w * 0.44, w * 1.3);
      ctx.fillStyle = COLOR.glowcap;
      ctx.beginPath();
      ctx.ellipse(cx, cy - w * 0.2, w, w * 0.72, 0, Math.PI, TAU);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      for (const [dx, dy] of [[-0.45, -0.45], [0.1, -0.7], [0.5, -0.4]]) {
        ctx.beginPath();
        ctx.arc(cx + dx * w, cy + dy * w * 0.72 - w * 0.2, w * 0.11, 0, TAU);
        ctx.fill();
      }
    }
  } else if (type === 'frost') {
    const fronds = 5 + tier * 2;
    ctx.strokeStyle = COLOR.frost;
    ctx.lineCap = 'round';
    for (let i = 0; i < fronds; i++) {
      const a = -Math.PI / 2 + (i / (fronds - 1) - 0.5) * 2.2 + Math.sin(t * 1.5 + i) * 0.04;
      const len = s * (0.36 + 0.06 * Math.cos(i * 1.7));
      ctx.lineWidth = s * 0.05;
      ctx.beginPath();
      ctx.moveTo(0, s * 0.22);
      const ex = Math.cos(a) * len, ey = s * 0.22 + Math.sin(a) * len;
      ctx.quadraticCurveTo(Math.cos(a) * len * 0.3, s * 0.1, ex, ey);
      ctx.stroke();
      ctx.lineWidth = s * 0.03;
      for (let k = 1; k <= 3; k++) {
        const px = ex * (k / 4), py = s * 0.22 + (ey - s * 0.22) * (k / 4);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(a - 0.9) * s * 0.07, py + Math.sin(a - 0.9) * s * 0.07);
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(a + 0.9) * s * 0.07, py + Math.sin(a + 0.9) * s * 0.07);
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#e9f7ff';
    ctx.beginPath();
    ctx.arc(0, s * 0.18, s * 0.06, 0, TAU);
    ctx.fill();
  } else if (type === 'ember') {
    ctx.strokeStyle = '#4d6b3b';
    ctx.lineWidth = s * 0.06;
    ctx.beginPath();
    ctx.moveTo(0, s * 0.26);
    ctx.lineTo(0, -s * 0.02);
    ctx.stroke();
    ctx.fillStyle = '#5f7f48';
    for (const d of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(d * s * 0.12, s * 0.16, s * 0.12, s * 0.04, d * -0.5, 0, TAU);
      ctx.fill();
    }
    const r = s * 0.17;
    const spikes = 12 + tier * 4;
    ctx.fillStyle = COLOR.ember;
    ctx.beginPath();
    for (let i = 0; i <= spikes * 2; i++) {
      const a = (i / (spikes * 2)) * TAU + aim * 0.2;
      const rr = i % 2 ? r : r * 1.45;
      ctx.lineTo(Math.cos(a) * rr, -s * 0.12 + Math.sin(a) * rr);
    }
    ctx.fill();
    ctx.fillStyle = '#ffd08a';
    ctx.beginPath();
    ctx.arc(0, -s * 0.12, r * 0.55, 0, TAU);
    ctx.fill();
  } else if (type === 'sunspire') {
    const h = s * (0.62 + tier * 0.08);
    const w = s * 0.16;
    ctx.fillStyle = '#b48a2c';
    ctx.beginPath();
    ctx.moveTo(-w, s * 0.24);
    ctx.lineTo(-w * 0.8, s * 0.24 - h * 0.75);
    ctx.lineTo(0, s * 0.24 - h);
    ctx.lineTo(w * 0.8, s * 0.24 - h * 0.75);
    ctx.lineTo(w, s * 0.24);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = COLOR.sunspire;
    ctx.beginPath();
    ctx.moveTo(-w * 0.15, s * 0.24);
    ctx.lineTo(-w * 0.1, s * 0.24 - h * 0.78);
    ctx.lineTo(0, s * 0.24 - h);
    ctx.lineTo(w * 0.8, s * 0.24 - h * 0.75);
    ctx.lineTo(w, s * 0.24);
    ctx.closePath();
    ctx.fill();
    if (tier >= 1) {
      ctx.fillStyle = '#d9a93c';
      for (const d of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(d * w * 1.1, s * 0.26);
        ctx.lineTo(d * w * 1.7, s * 0.26 - h * 0.38);
        ctx.lineTo(d * w * 2, s * 0.26);
        ctx.fill();
      }
    }
  } else if (type === 'moonbell') {
    // a pale bell hung from a curved stem; it sways very slightly
    const sway = Math.sin(t * 0.9) * 0.03;
    ctx.strokeStyle = '#4d6b5b';
    ctx.lineWidth = s * 0.05;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, s * 0.26);
    ctx.quadraticCurveTo(-s * 0.02, -s * 0.1, 0, -s * 0.2);
    ctx.stroke();
    ctx.rotate(sway);
    const w = s * (0.2 + tier * 0.02);
    ctx.fillStyle = COLOR.moonbell;
    ctx.beginPath();
    ctx.moveTo(-w, s * 0.1);
    ctx.quadraticCurveTo(-w, -s * 0.2, 0, -s * 0.24);
    ctx.quadraticCurveTo(w, -s * 0.2, w, s * 0.1);
    ctx.quadraticCurveTo(0, s * 0.16, -w, s * 0.1);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(-w * 0.4, -s * 0.06, w * 0.16, s * 0.1, 0.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#e8e2cc';
    ctx.beginPath();
    ctx.arc(0, s * 0.16, s * 0.04, 0, TAU);
    ctx.fill();
  } else if (type === 'thornbriar') {
    // a tangle of curved canes, each bristling with small thorns
    const canes = 3 + tier;
    ctx.lineCap = 'round';
    for (let i = 0; i < canes; i++) {
      const a = -Math.PI / 2 + (i / (canes - 1) - 0.5) * 1.9;
      const len = s * (0.36 + 0.05 * Math.cos(i * 2.1));
      const ex = Math.cos(a) * len, ey = s * 0.24 + Math.sin(a) * len;
      ctx.strokeStyle = '#4d6b3b';
      ctx.lineWidth = s * 0.05;
      ctx.beginPath();
      ctx.moveTo(0, s * 0.24);
      ctx.quadraticCurveTo(Math.cos(a) * len * 0.2 + (i % 2 ? 1 : -1) * s * 0.1, s * 0.1, ex, ey);
      ctx.stroke();
      ctx.fillStyle = COLOR.thornbriar;
      for (let k = 1; k <= 3; k++) {
        const px = ex * (k / 3.4), py = s * 0.24 + (ey - s * 0.24) * (k / 3.4);
        ctx.beginPath();
        ctx.moveTo(px - s * 0.03, py);
        ctx.lineTo(px + (i % 2 ? 1 : -1) * s * 0.11, py - s * 0.05);
        ctx.lineTo(px + s * 0.03, py + s * 0.02);
        ctx.fill();
      }
    }
  }
  ctx.restore();
  // tier pips
  if (tier > 0) {
    ctx.fillStyle = COLOR.gold;
    for (let i = 0; i < tier; i++) {
      ctx.beginPath();
      ctx.arc(x + (i - (tier - 1) / 2) * s * 0.14, y + s * 0.4, s * 0.045, 0, TAU);
      ctx.fill();
    }
  }
}

const TOWER_LIGHT = { glowcap: COLOR.glowcap, frost: COLOR.frost, ember: COLOR.ember, sunspire: COLOR.sunspire, moonbell: COLOR.moonbell, thornbriar: COLOR.thornbriar };

// ---------- creatures ----------

function drawEnemy(ctx, e, x, y, s, t, heading) {
  const k = e.id * 1.37;
  if (e.type === 'mothmother') { drawEnemy(ctx, { ...e, type: 'moth', slow: 0, hitFlash: 0 }, x, y, s * 2, t * 0.5, heading); ctx.fillStyle = 'rgba(255,150,230,0.8)'; ctx.beginPath(); ctx.arc(x, y, s * 0.06, 0, TAU); ctx.fill(); }
  else if (e.type === 'mossback') { drawEnemy(ctx, { ...e, type: 'beetle', slow: 0, hitFlash: 0 }, x, y, s * 1.1, t, heading); ctx.fillStyle = 'rgba(110,190,90,0.85)'; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(x + Math.cos(i * 1.3) * s * 0.1, y + Math.sin(i * 1.3) * s * 0.1, s * 0.06, 0, TAU); ctx.fill(); } }
  if (e.type === 'mole') {
    // 2D fallback: a furrow of earth while under the path, a small dark mole when up
    ctx.fillStyle = e.under ? 'rgba(90,70,50,0.55)' : '#4a3f4e';
    ctx.beginPath();
    ctx.ellipse(x, y, s * (e.under ? 0.16 : 0.2), s * (e.under ? 0.08 : 0.15), heading, 0, TAU);
    ctx.fill();
    if (!e.under) { ctx.fillStyle = '#d8a8b0'; ctx.beginPath(); ctx.arc(x + Math.cos(heading) * s * 0.2, y + Math.sin(heading) * s * 0.2, s * 0.05, 0, TAU); ctx.fill(); }
    return;
  }
  if (e.type === 'shadebearer') {
    // 2D fallback: a dark hooded flame with a faint ring of hush around it
    ctx.fillStyle = 'rgba(40,30,70,0.18)';
    ctx.beginPath(); ctx.arc(x, y, s * 0.4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2c2250';
    ctx.beginPath(); ctx.ellipse(x, y, s * 0.16, s * 0.2, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#b8a8ff';
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.arc(x + d * s * 0.06, y - s * 0.02, s * 0.025, 0, TAU); ctx.fill(); }
    return;
  }
  if (e.type === 'stag') {
    // 2D fallback: a broad dark body, a pale head and two antler prongs; lighter while charging
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading);
    ctx.fillStyle = e.charging ? '#6a5a8a' : '#4a4060';
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.34, s * 0.2, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#c8bce0';
    ctx.beginPath(); ctx.arc(s * 0.34, 0, s * 0.11, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#e8e0f8'; ctx.lineWidth = Math.max(1, s * 0.03);
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * 0.36, d * s * 0.06); ctx.lineTo(s * 0.5, d * s * 0.2); ctx.lineTo(s * 0.56, d * s * 0.14); ctx.stroke(); }
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  if (e.type === 'moth') {
    ctx.rotate(heading + Math.PI / 2);
    const flap = 0.45 + 0.55 * Math.abs(Math.sin(t * 16 + k));
    ctx.fillStyle = '#d8ccf2';
    for (const d of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(d * s * 0.13 * flap, 0, s * 0.15 * flap, s * 0.2, d * 0.35, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#4a3c5c';
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.05, s * 0.14, 0, 0, TAU);
    ctx.fill();
  } else if (e.type === 'lampmoth') {
    // soft pale wings with a warm glow at the belly
    ctx.rotate(heading + Math.PI / 2);
    const flap = 0.5 + 0.5 * Math.abs(Math.sin(t * 22 + k));
    ctx.fillStyle = 'rgba(255,246,214,0.8)';
    for (const d of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(d * s * 0.11 * flap, 0, s * 0.12 * flap, s * 0.16, d * 0.4, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#ffe9a0';
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.045, s * 0.1, 0, 0, TAU);
    ctx.fill();
  } else if (e.type === 'firefly') {
    ctx.rotate(heading + Math.PI / 2);
    const flap = 0.5 + 0.5 * Math.abs(Math.sin(t * 24 + k));
    ctx.fillStyle = 'rgba(230,240,255,0.55)';
    for (const d of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(d * s * 0.08, -s * 0.02, s * 0.08 * flap, s * 0.05, d * 0.5, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#3b3346';
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.03, s * 0.04, s * 0.07, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#eaff7a';
    ctx.beginPath();
    ctx.arc(0, s * 0.07, s * 0.05, 0, TAU);
    ctx.fill();
  } else if (e.type === 'beetle') {
    ctx.rotate(heading + Math.PI / 2);
    ctx.strokeStyle = '#1c2630';
    ctx.lineWidth = s * 0.035;
    const step = Math.sin(t * 10 + k) * s * 0.03;
    for (const d of [-1, 1]) for (const j of [-1, 0, 1]) {
      ctx.beginPath();
      ctx.moveTo(d * s * 0.15, j * s * 0.1);
      ctx.lineTo(d * s * 0.3, j * s * 0.12 + d * j * step);
      ctx.stroke();
    }
    ctx.fillStyle = '#2f4b5e';
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.22, s * 0.27, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#18242e';
    ctx.lineWidth = s * 0.03;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.2);
    ctx.lineTo(0, s * 0.26);
    ctx.stroke();
    ctx.fillStyle = 'rgba(190,230,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(-s * 0.08, -s * 0.06, s * 0.05, s * 0.12, 0.2, 0, TAU);
    ctx.fill();
  } else if (e.type === 'wisp' || e.type === 'twinwisp') {
    if (e.half) s *= 0.72; // each half of a split Twin Wisp is smaller
    const wob = Math.sin(t * 6 + k) * s * 0.03;
    ctx.fillStyle = e.type === 'twinwisp' ? 'rgba(214,190,255,0.78)' : 'rgba(182,243,255,0.75)';
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.3 + wob);
    ctx.quadraticCurveTo(s * 0.24, -s * 0.02, s * 0.12, s * 0.18);
    ctx.quadraticCurveTo(0, s * 0.26, -s * 0.12, s * 0.18);
    ctx.quadraticCurveTo(-s * 0.24, -s * 0.02, 0, -s * 0.3 - wob);
    ctx.fill();
    ctx.fillStyle = '#1b1530';
    for (const d of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(d * s * 0.05, s * 0.04, s * 0.03, 0, TAU);
      ctx.fill();
    }
  } else if (e.type === 'toad') {
    const hop = Math.abs(Math.sin(t * 3 + k)) * s * 0.06;
    ctx.translate(0, -hop);
    ctx.fillStyle = '#3d3150';
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.42, s * 0.34, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#54456b';
    ctx.beginPath();
    ctx.ellipse(0, s * 0.08, s * 0.28, s * 0.18, 0, 0, TAU);
    ctx.fill();
    for (const d of [-1, 1]) {
      ctx.fillStyle = '#3d3150';
      ctx.beginPath();
      ctx.arc(d * s * 0.2, -s * 0.24, s * 0.12, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#ffe066';
      ctx.beginPath();
      ctx.arc(d * s * 0.2, -s * 0.25, s * 0.07, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#1b1530';
      ctx.fillRect(d * s * 0.2 - s * 0.015, -s * 0.3, s * 0.03, s * 0.1);
    }
  }
  ctx.restore();
  if (e.slow > 0) {
    ctx.strokeStyle = 'rgba(168,220,255,0.8)';
    ctx.lineWidth = s * 0.04;
    ctx.beginPath();
    ctx.arc(x, y, s * 0.3, 0, TAU);
    ctx.stroke();
  }
  if (e.hitFlash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(0.6, e.hitFlash * 5)})`;
    ctx.beginPath();
    ctx.arc(x, y, s * 0.26, 0, TAU);
    ctx.fill();
  }
}

const ENEMY_R = { moth: 0.24, firefly: 0.16, beetle: 0.3, wisp: 0.26, twinwisp: 0.26, toad: 0.42, mossback: 0.32, mole: 0.28, stag: 0.4, shadebearer: 0.27, lampmoth: 0.17, mothmother: 0.46 };

// ---------- renderer ----------

export function createRenderer(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  const reduced = !!opts.reducedMotion;
  const swell = createSwell();
  let tile = 40, dpr = 1, W = 0, H = 0;
  let ground = null, dark = null, dctx = null;
  let fx = [];
  let flameLife = 1; // eased copy of lives/maxLives for the lantern flame
  let leakT = 0; // one red edge glow when creatures reach the lantern, restarted by each leak
  const prevHeading = new Map();
  const prints = createFootprints({ life: reduced ? 1.5 : 1.8 });
  const routeGlow = createRouteGlow();

  function paintGround(g) {
    const c = document.createElement('canvas');
    c.width = W * dpr;
    c.height = H * dpr;
    const x = c.getContext('2d');
    x.scale(dpr, dpr);
    for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++) {
      const v = hash(cc, r);
      x.fillStyle = `hsl(${150 + v * 8},${22 + v * 4}%,${18 + v * 2.5}%)`;
      x.fillRect(cc * tile, r * tile, tile + 1, tile + 1);
      // grass tufts and a few night flowers, never on the path
      if (g.blocked.has(`${cc},${r}`)) continue;
      x.strokeStyle = `hsla(130,30%,${30 + v * 12}%,0.6)`;
      x.lineWidth = Math.max(1, tile * 0.025);
      for (let i = 0; i < 3; i++) {
        const gx = cc * tile + hash(cc, r, i + 1) * tile, gy = r * tile + hash(cc, r, i + 9) * tile;
        x.beginPath();
        x.moveTo(gx, gy);
        x.lineTo(gx - tile * 0.04, gy - tile * 0.1);
        x.moveTo(gx, gy);
        x.lineTo(gx + tile * 0.04, gy - tile * 0.09);
        x.stroke();
      }
      if (hash(cc, r, 50) > 0.82) {
        const fx0 = cc * tile + (0.2 + hash(cc, r, 51) * 0.6) * tile, fy0 = r * tile + (0.2 + hash(cc, r, 52) * 0.6) * tile;
        x.fillStyle = hash(cc, r, 53) > 0.5 ? '#c9b8ff' : '#f3e9c6';
        for (let p = 0; p < 5; p++) {
          const a = (p / 5) * TAU;
          x.beginPath();
          x.arc(fx0 + Math.cos(a) * tile * 0.035, fy0 + Math.sin(a) * tile * 0.035, tile * 0.03, 0, TAU);
          x.fill();
        }
      }
    }
    // moonstone path
    x.lineJoin = 'round';
    x.lineCap = 'round';
    const trace = (pts) => {
      x.beginPath();
      pts.forEach((p, i) => (i ? x.lineTo(p.x * tile, p.y * tile) : x.moveTo(p.x * tile, p.y * tile)));
      x.stroke();
    };
    for (const p of g.paths) { x.strokeStyle = COLOR.pathEdge; x.lineWidth = tile * 0.9; trace(p.pts); }
    for (const p of g.paths) { x.strokeStyle = COLOR.path; x.lineWidth = tile * 0.76; trace(p.pts); }
    for (const k of g.blocked) {
      const [cc, r] = k.split(',').map(Number);
      x.fillStyle = 'rgba(90,84,66,0.28)';
      for (let i = 0; i < 4; i++) {
        x.beginPath();
        x.ellipse(cc * tile + (0.2 + hash(cc, r, 60 + i) * 0.6) * tile, r * tile + (0.2 + hash(cc, r, 70 + i) * 0.6) * tile,
          tile * (0.06 + hash(cc, r, 80 + i) * 0.06), tile * 0.04, hash(cc, r, 90 + i) * 3, 0, TAU);
        x.fill();
      }
    }
    // entry marks where creatures come in
    for (const p of g.paths) {
      const a = p.pts[0], b = p.pts[1];
      const ex = Math.min(COLS - 0.5, Math.max(0.5, a.x)), ey = Math.min(ROWS - 0.5, Math.max(0.5, a.y));
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      x.save();
      x.translate(ex * tile, ey * tile);
      x.rotate(ang);
      x.fillStyle = 'rgba(60,40,70,0.5)';
      x.beginPath();
      x.moveTo(tile * 0.18, 0);
      x.lineTo(-tile * 0.12, -tile * 0.16);
      x.lineTo(-tile * 0.12, tile * 0.16);
      x.fill();
      x.restore();
    }
    return c;
  }

  function resize(g, cssW, cssH) {
    tile = Math.max(16, Math.floor(Math.min(cssW / COLS, cssH / ROWS)));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = tile * COLS;
    H = tile * ROWS;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ground = paintGround(g);
    dark = document.createElement('canvas');
    dark.width = canvas.width;
    dark.height = canvas.height;
    dctx = dark.getContext('2d');
  }

  function cellAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const c = Math.floor((clientX - rect.left) / tile), r = Math.floor((clientY - rect.top) / tile);
    return c >= 0 && c < COLS && r >= 0 && r < ROWS ? { c, r } : null;
  }

  function addEvents(events) {
    for (const ev of events) {
      if (ev.e === 'bolt') fx.push({ k: 'bolt', x1: ev.x1, y1: ev.y1 - 0.15, x2: ev.x2, y2: ev.y2, t: 0, life: 0.14 });
      else if (ev.e === 'beam') fx.push({ k: 'beam', x1: ev.x1, y1: ev.y1 - 0.35, x2: ev.x2, y2: ev.y2, t: 0, life: 0.3 });
      else if (ev.e === 'burst') {
        fx.push({ k: 'lob', x1: ev.x1, y1: ev.y1 - 0.12, x2: ev.x2, y2: ev.y2, t: 0, life: 0.16 });
        fx.push({ k: 'burst', x: ev.x2, y: ev.y2, r: ev.splash, t: -0.12, life: 0.4 });
      } else if (ev.e === 'pulse') fx.push({ k: 'pulse', x: ev.x, y: ev.y, r: ev.range, t: 0, life: 0.5 });
      else if (ev.e === 'chime') fx.push({ k: 'pulse', x: ev.x, y: ev.y, r: ev.range, t: 0, life: 1.1, moon: true });
      else if (ev.e === 'kill') {
        if (ev.reward >= 5) fx.push({ k: 'coin', x: ev.x, y: ev.y, text: `+${ev.reward}`, t: 0, life: 0.9 });
        const n = ev.type === 'toad' ? 24 : 8;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + hash(i, ev.reward) * 0.6;
          const sp = 0.8 + hash(i, n) * 1.4;
          fx.push({ k: 'spark', x: ev.x, y: ev.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: 0.5 + hash(n, i) * 0.3 });
        }
        // moon-motes: a few soft pale specks drift up and fade (slow fade, no flashing)
        const mn = reduced ? 3 : ev.type === 'toad' || ev.type === 'mothmother' ? 7 : 4;
        for (let i = 0; i < mn; i++) {
          const a = hash(i, 77 + ev.reward) * TAU, d = 0.03 + hash(i, 31) * 0.14;
          fx.push({ k: 'mote', x: ev.x + Math.cos(a) * d, y: ev.y + Math.sin(a) * d, rise: (reduced ? 0.15 : 0.25) + hash(i, 9) * 0.2, ph: hash(i, 13) * TAU, t: 0, life: reduced ? 1.5 : 1.9 + hash(i, 17) * 0.8 });
        }
      } else if (ev.e === 'leak') leakT = 0.5;
      else if (ev.e === 'flare') fx.push({ k: 'pulse', x: ev.x, y: ev.y, r: ev.r, t: 0, life: 0.8, flare: true });
    }
  }

  function tickFx(dt) {
    leakT = Math.max(0, leakT - dt);
    for (const f of fx) {
      f.t += dt;
      if (f.k === 'spark') { f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.92; f.vy *= 0.92; }
    }
    fx = fx.filter((f) => f.t < f.life);
  }

  function clearFx() { fx = []; leakT = 0; prevHeading.clear(); prints.clear(); }

  // view: { alpha, prev: Map<id,{x,y}>, time, sel: {c,r}|null, selTower, hint: {c,r}|null, ghost: tower type | null }
  function draw(g, view) {
    const t = view.time;
    const s = tile;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(ground, 0, 0, W, H);

    const lerp = (e) => {
      const p = view.prev.get(e.id);
      if (!p) return { x: e.x, y: e.y };
      return { x: p.x + (e.x - p.x) * view.alpha, y: p.y + (e.y - p.y) * view.alpha };
    };

    // hint and selection tiles
    if (view.hint) {
      const a = 0.25 + 0.2 * Math.sin(t * 4);
      ctx.fillStyle = `rgba(255,211,107,${a})`;
      ctx.fillRect(view.hint.c * s + 2, view.hint.r * s + 2, s - 4, s - 4);
    }
    if (view.sel) {
      ctx.strokeStyle = 'rgba(255,240,200,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(view.sel.c * s + 2, view.sel.r * s + 2, s - 4, s - 4);
    }
    const ring = view.selTower ? { x: view.selTower.x, y: view.selTower.y, range: stats(view.selTower).range, type: view.selTower.type } : null;
    if (ring) {
      ctx.fillStyle = rgba(TOWER_LIGHT[ring.type], 0.08);
      ctx.strokeStyle = rgba(TOWER_LIGHT[ring.type], 0.55);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(ring.x * s, ring.y * s, ring.range * s, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // lantern
    const lx = (g.lantern.c + 0.5) * s, ly = (g.lantern.r + 0.5) * s;
    const life = g.lives / g.maxLives;
    const sw = swell.update(g, t, reduced);
    const flick = reduced ? 1 : 0.92 + 0.08 * Math.sin(t * 9) * Math.sin(t * 5.3) + (life < 0.35 ? 0.1 * Math.sin(t * 31) : 0);
    ctx.fillStyle = '#2d2416';
    ctx.fillRect(lx - s * 0.04, ly - s * 0.1, s * 0.08, s * 0.5);
    ctx.fillStyle = '#4a3a22';
    ctx.fillRect(lx - s * 0.16, ly - s * 0.44, s * 0.32, s * 0.05);
    ctx.fillStyle = rgba(COLOR.lantern, 0.6 + 0.4 * life * flick);
    ctx.beginPath();
    ctx.ellipse(lx, ly - s * 0.2, s * 0.17, s * 0.22, 0, 0, TAU);
    ctx.fill();
    // the flame inside: lower, smaller and dimmer as lives are lost (eased, never flashing)
    flameLife += (life - flameLife) * (reduced ? 1 : 0.06);
    const fl = Math.max(0.05, flameLife);
    ctx.fillStyle = rgba('#ffe2a0', 0.35 + 0.55 * fl);
    ctx.beginPath();
    ctx.ellipse(lx, ly - s * (0.14 + 0.06 * fl), s * (0.03 + 0.04 * fl), s * (0.04 + 0.09 * fl), 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#6b4f2a';
    ctx.lineWidth = 1;
    for (const d of [-0.08, 0, 0.08]) {
      ctx.beginPath();
      ctx.moveTo(lx + d * s, ly - s * 0.41);
      ctx.quadraticCurveTo(lx + d * s * 2.2, ly - s * 0.2, lx + d * s, ly + s * 0.01);
      ctx.stroke();
    }

    // towers
    for (const tw of g.towers) drawTower(ctx, tw.type, tw.x * s, tw.y * s, s, tw.tier, t, tw.aim);
    if (view.ghost && view.sel) {
      ctx.globalAlpha = 0.5;
      drawTower(ctx, view.ghost, (view.sel.c + 0.5) * s, (view.sel.r + 0.5) * s, s, 0, t);
      ctx.globalAlpha = 1;
    }

    // creatures
    const drawn = [];
    for (const e of g.enemies) {
      const p = lerp(e);
      prints.step(e, p.x, p.y, t);
      const prev = view.prev.get(e.id);
      let h = prevHeading.get(e.id) ?? Math.PI / 2;
      if (prev && (Math.abs(e.x - prev.x) + Math.abs(e.y - prev.y) > 1e-4)) h = Math.atan2(e.y - prev.y, e.x - prev.x);
      prevHeading.set(e.id, h);
      drawEnemy(ctx, e, p.x * s, p.y * s, s, t, h);
      drawn.push([e, p]);
    }
    if (prevHeading.size > 400) prevHeading.clear();
    // faint pale footprints on the path, fading in a second or two (flat fills, a handful at most)
    prints.prune(t);
    ctx.fillStyle = '#e6e0ff';
    for (const f of prints.prints) {
      ctx.globalAlpha = 0.4 * prints.fade(f, t);
      ctx.beginPath();
      ctx.ellipse(f.x * s, f.y * s, s * 0.05, s * 0.032, f.h, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const p of g.patches) {
      ctx.fillStyle = `rgba(255,110,40,${0.25 * Math.min(1, p.left)})`;
      ctx.beginPath(); ctx.arc(p.x * s, p.y * s, p.r * s, 0, TAU); ctx.fill();
    }

    // thorn patches on the path: a few green barbs, fewer as the patch is used up
    for (const p of g.thorns ?? []) {
      const n = Math.min(7, Math.max(2, p.hits));
      ctx.fillStyle = rgba(COLOR.thornbriar, 0.85 * Math.min(1, p.left / 3));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + p.id, rr = (0.12 + 0.18 * hash(i, p.id)) * s;
        const bx = p.x * s + Math.cos(a) * rr, by = p.y * s + Math.sin(a) * rr;
        ctx.beginPath();
        ctx.moveTo(bx - s * 0.04, by + s * 0.03);
        ctx.lineTo(bx, by - s * 0.14);
        ctx.lineTo(bx + s * 0.04, by + s * 0.03);
        ctx.fill();
      }
    }

    // darkness, with light cut out
    dctx.setTransform(1, 0, 0, 1, 0, 0);
    dctx.globalCompositeOperation = 'source-over';
    dctx.clearRect(0, 0, dark.width, dark.height);
    dctx.fillStyle = `rgba(14,8,32,${0.62 + 0.2 * (1 - life)})`;
    dctx.fillRect(0, 0, dark.width, dark.height);
    dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dctx.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r, a = 1) => {
      const gr = dctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(0,0,0,${a})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      dctx.fillStyle = gr;
      dctx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    hole(lx, ly - s * 0.2, s * (1.4 + 3.2 * life) * flick, 1);
    for (const tw of g.towers) hole(tw.x * s, tw.y * s, s * (1.1 + 0.25 * tw.tier), 0.85);
    for (const [e, p] of drawn) if (e.type === 'firefly' || e.type === 'wisp' || e.type === 'twinwisp') hole(p.x * s, p.y * s, s * 0.6, 0.5);
    for (const f of fx) {
      const k = 1 - f.t / f.life;
      if (f.k === 'burst' && f.t > 0) hole(f.x * s, f.y * s, s * f.r * 1.6, 0.8 * k);
      if (f.k === 'beam') hole(f.x2 * s, f.y2 * s, s * 1.2, 0.8 * k);
    }
    ctx.drawImage(dark, 0, 0, W, H);

    // light on top
    ctx.globalCompositeOperation = 'lighter';
    const glow = (x, y, r, color, a) => {
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, rgba(color, a));
      gr.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = gr;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    // the creature path glows faintly, like moonlit stone, with a slow breath
    // when a wave starts it swells a little for a couple of seconds, showing the route ahead
    const pathGlow = () => {
      const route = routeGlow.update(g, t);
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = rgba('#a89cff', 0.07 + 0.025 * Math.sin(t * 1.2) + 0.09 * route);
      ctx.lineWidth = s * 0.6;
      for (const p of g.paths) {
        ctx.beginPath();
        p.pts.forEach((q, i) => (i ? ctx.lineTo(q.x * s, q.y * s) : ctx.moveTo(q.x * s, q.y * s)));
        ctx.stroke();
      }
      ctx.restore();
    };
    pathGlow();
    glow(lx, ly - s * 0.2, s * (0.6 + 0.9 * life) * flick * (1 + 0.4 * sw), COLOR.lantern, Math.min(0.85, 0.55 + 0.25 * sw));
    for (const tw of g.towers) {
      const ready = tw.cd < 0.15 ? 1 : 0.6;
      glow(tw.x * s, tw.y * s - s * 0.1, s * 0.55, TOWER_LIGHT[tw.type], 0.22 * ready + 0.06 * tw.tier);
    }
    for (const [e, p] of drawn) {
      if (e.type === 'firefly') glow(p.x * s, p.y * s, s * 0.3, '#eaff7a', 0.6);
      else if (e.type === 'wisp') glow(p.x * s, p.y * s, s * 0.4, '#b6f3ff', 0.35);
      else if (e.type === 'twinwisp') glow(p.x * s, p.y * s, s * (e.half ? 0.3 : 0.4), '#d6beff', 0.35);
      else if (e.type === 'toad') glow(p.x * s, p.y * s - s * 0.25, s * 0.25, '#ffe066', 0.3);
    }
    // between waves, a few fireflies drift in to the lantern, then fade as the next wave nears
    if (!reduced && g.countdown !== null && g.countdown !== undefined) {
      const calmK = Math.max(0, Math.min(1, (12 - g.countdown) / 1.5, g.countdown / 1.5));
      for (let i = 0; i < 7 && calmK > 0; i++) {
        const q = (t / 5 + i / 7) % 1, ang = i * 2.4 + 0.7, rad = (2.2 + hash(i, 5) * 1.6) * s;
        const e = q * q * (3 - 2 * q), sx = lx + Math.cos(ang) * rad, sy = ly - s * 0.2 + Math.sin(ang) * rad;
        const px = sx + (lx - sx) * e + Math.sin(t * 1.3 + i) * s * 0.25 * (1 - e);
        const py = sy + (ly - s * 0.2 - sy) * e + Math.cos(t * 1.1 + i) * s * 0.25 * (1 - e);
        glow(px, py, s * 0.22, '#eaff7a', 0.7 * Math.sin(q * Math.PI) * calmK);
      }
    }
    for (const f of fx) {
      const k = 1 - Math.max(0, f.t) / f.life;
      if (f.k === 'bolt') {
        ctx.strokeStyle = rgba(COLOR.glowcap, k);
        ctx.lineWidth = s * 0.07;
        ctx.lineCap = 'round';
        const q = Math.min(1, f.t / (f.life * 0.6));
        ctx.beginPath();
        ctx.moveTo((f.x1 + (f.x2 - f.x1) * q * 0.6) * s, (f.y1 + (f.y2 - f.y1) * q * 0.6) * s);
        ctx.lineTo((f.x1 + (f.x2 - f.x1) * q) * s, (f.y1 + (f.y2 - f.y1) * q) * s);
        ctx.stroke();
      } else if (f.k === 'beam') {
        ctx.strokeStyle = rgba(COLOR.sunspire, k);
        ctx.lineWidth = s * 0.12 * k;
        ctx.beginPath();
        ctx.moveTo(f.x1 * s, f.y1 * s);
        ctx.lineTo(f.x2 * s, f.y2 * s);
        ctx.stroke();
        glow(f.x2 * s, f.y2 * s, s * 0.5, COLOR.sunspire, 0.7 * k);
      } else if (f.k === 'lob') {
        const q = f.t / f.life;
        const x = f.x1 + (f.x2 - f.x1) * q, y = f.y1 + (f.y2 - f.y1) * q - Math.sin(q * Math.PI) * 0.6;
        glow(x * s, y * s, s * 0.22, COLOR.ember, 0.9);
      } else if (f.k === 'burst' && f.t > 0) {
        glow(f.x * s, f.y * s, s * f.r * (0.6 + 0.6 * (1 - k)), COLOR.ember, 0.6 * k);
      } else if (f.k === 'pulse') {
        ctx.strokeStyle = rgba(f.flare ? COLOR.lantern : f.moon ? COLOR.moonbell : COLOR.frost, (f.moon ? 0.4 : 0.6) * k);
        ctx.lineWidth = s * 0.05;
        ctx.beginPath();
        ctx.arc(f.x * s, f.y * s, f.r * s * (1 - k * 0.7), 0, TAU);
        ctx.stroke();
      } else if (f.k === 'mote') {
        const q = f.t / f.life, m = Math.sin(Math.min(1, q * 4) * Math.PI / 2) * (1 - q) * (1 - q);
        const sway = reduced ? 0 : Math.sin(f.t * 2.2 + f.ph) * 0.04;
        glow((f.x + sway) * s, (f.y - f.rise * f.t) * s, s * 0.1, '#cfe0ff', 0.7 * m);
      } else if (f.k === 'spark') {
        ctx.fillStyle = rgba(COLOR.gold, k);
        ctx.beginPath();
        ctx.arc(f.x * s, f.y * s, s * 0.04, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    // health bars and coin text
    for (const [e, p] of drawn) {
      if (e.hp >= e.maxHp) continue;
      const w = s * (e.type === 'toad' ? 0.8 : 0.5), y = (p.y - ENEMY_R[e.type] - 0.14) * s;
      ctx.fillStyle = 'rgba(20,12,30,0.8)';
      ctx.fillRect(p.x * s - w / 2, y, w, s * 0.07);
      ctx.fillStyle = e.hp / e.maxHp > 0.4 ? '#9df08a' : '#ff8a6b';
      ctx.fillRect(p.x * s - w / 2, y, (w * Math.max(0, e.hp)) / e.maxHp, s * 0.07);
    }
    ctx.font = `700 ${Math.round(s * 0.3)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    for (const f of fx) {
      if (f.k === 'coin') {
        const k = 1 - f.t / f.life;
        ctx.fillStyle = rgba(COLOR.gold, k);
        ctx.fillText(f.text, f.x * s, (f.y - 0.3 - f.t * 0.6) * s);
      }
    }
    if (leakT > 0) {
      const gr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7);
      gr.addColorStop(0, 'rgba(255,70,50,0)');
      gr.addColorStop(1, `rgba(255,70,50,${(reduced ? 0.25 : 0.45) * (leakT / 0.5)})`);
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function project(x, y, z) { return { x: x * tile, y: z * tile }; }
  function snapshot(type, form, target) { paintIcon(target, type); }
  return {
    kind: '2d', resize, cellAt, draw, addEvents, tickFx, clearFx, project, snapshot,
    intro() {}, skipIntro() {}, get introDone() { return true; }, setTitle() {}, setFocus() {}, setLowFx() {},
    get tile() { return tile; },
  };
}

// A tray icon: the tower drawn on a small canvas.
export function paintIcon(canvas, type) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = canvas.clientWidth || 44;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const c = canvas.getContext('2d');
  c.scale(dpr, dpr);
  const gr = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, rgba(TOWER_LIGHT[type], 0.35));
  gr.addColorStop(1, rgba(TOWER_LIGHT[type], 0));
  c.fillStyle = gr;
  c.fillRect(0, 0, size, size);
  drawTower(c, type, size / 2, size * 0.52, size * 0.95, 0, 0);
}
