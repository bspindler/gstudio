// Gearhold procedural art. Everything is drawn in code at load time; there are no image files.
// Textures and sprites are TS x TS pixels, drawn in a 64-unit space and scaled up.
// Pixel alpha: 0 = transparent, 255 = lit normally, 254 = emissive (glows, ignores lighting and fog).

export const TS = 128;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function rng(seed) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }

function layer(draw) {
  const c = canvas(TS, TS), g = c.getContext('2d');
  g.scale(TS / 64, TS / 64);
  draw(g);
  return c;
}
/** Base drawing plus an optional glow drawing. Returns packed RGBA pixels (alpha flags as above). */
function art(draw, glow, grain = 0, seed = 1) {
  const base = layer(draw).getContext('2d').getImageData(0, 0, TS, TS);
  const gd = glow ? layer(glow).getContext('2d').getImageData(0, 0, TS, TS).data : null;
  const d = base.data, r = rng(seed);
  for (let i = 0; i < d.length; i += 4) {
    if (grain) {
      const n = (r() - 0.5) * grain;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    }
    d[i + 3] = d[i + 3] >= 128 ? 255 : 0;
    if (gd && gd[i + 3] > 90) { d[i] = gd[i]; d[i + 1] = gd[i + 1]; d[i + 2] = gd[i + 2]; d[i + 3] = 254; }
  }
  return new Uint32Array(d.buffer);
}

// ---------- shared drawing helpers (64-unit space) ----------
function lin(g, x0, y0, x1, y1, stops) {
  const lg = g.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([o, c]) => lg.addColorStop(o, c));
  return lg;
}
function rad(g, x, y, r0, r1, stops) {
  const rg = g.createRadialGradient(x, y, r0, x, y, r1);
  stops.forEach(([o, c]) => rg.addColorStop(o, c));
  return rg;
}
function bevel(g, x, y, w, h, light = 0.16, dark = 0.4, s = 1) {
  g.fillStyle = `rgba(255,255,255,${light})`; g.fillRect(x, y, w, s); g.fillRect(x, y, s, h);
  g.fillStyle = `rgba(0,0,0,${dark})`; g.fillRect(x, y + h - s, w, s); g.fillRect(x + w - s, y, s, h);
}
function rivet(g, x, y, r = 1.4) {
  g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.arc(x + 0.5, y + 0.6, r + 0.4, 0, 7); g.fill();
  g.fillStyle = rad(g, x - r * 0.4, y - r * 0.4, 0.1, r * 1.3, [[0, '#e3e8ee'], [0.5, '#8c939b'], [1, '#3a3f45']]);
  g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
}
function grime(g, seed, amount = 1) {
  const r = rng(seed);
  for (let i = 0; i < 10 * amount; i++) {
    const x = r() * 64, y = r() * 64, s = 3 + r() * 9;
    g.fillStyle = rad(g, x, y, 0, s, [[0, `rgba(20,14,8,${0.18 + r() * 0.2})`], [1, 'rgba(20,14,8,0)']]);
    g.fillRect(x - s, y - s, s * 2, s * 2);
  }
  g.fillStyle = lin(g, 0, 40, 0, 64, [[0, 'rgba(15,10,5,0)'], [1, `rgba(15,10,5,${0.35 * amount})`]]);
  g.fillRect(0, 40, 64, 24);
}
function streaks(g, seed, color = 'rgba(120,60,20,', n = 5) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * 62, y = r() * 40, len = 8 + r() * 22;
    g.fillStyle = lin(g, 0, y, 0, y + len, [[0, `${color}0.45)`], [1, `${color}0)`]]);
    g.fillRect(x, y, 0.8 + r() * 1.4, len);
  }
}
function scratches(g, seed, n = 8) {
  const r = rng(seed);
  g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 0.35;
  for (let i = 0; i < n; i++) {
    const x = r() * 64, y = r() * 64, a = r() * Math.PI, l = 3 + r() * 8;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
}
function hazard(g, y, h) {
  g.save(); g.beginPath(); g.rect(0, y, 64, h); g.clip();
  g.fillStyle = '#17171a'; g.fillRect(0, y, 64, h);
  g.fillStyle = '#e0ad24';
  for (let x = -16; x < 80; x += 10) { g.beginPath(); g.moveTo(x, y + h); g.lineTo(x + 5, y + h); g.lineTo(x + 5 + h, y); g.lineTo(x + h, y); g.fill(); }
  g.restore();
  bevel(g, 0, y, 64, h, 0.15, 0.5, 0.6);
}
function steelPlate(g, base, seed) {
  g.fillStyle = lin(g, 0, 0, 64, 64, [[0, base[0]], [1, base[1]]]);
  g.fillRect(0, 0, 64, 64);
  scratches(g, seed, 14);
  bevel(g, 0, 0, 64, 64, 0.2, 0.55, 1.2);
  bevel(g, 3, 3, 58, 58, 0.06, 0.25, 0.6);
}
function gear(g, x, y, r1, r2, teeth) {
  g.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2, rr = i % 2 ? r1 : r2;
    g.lineTo(x + Math.cos(a - 0.12) * rr, y + Math.sin(a - 0.12) * rr);
    g.lineTo(x + Math.cos(a + 0.12) * rr, y + Math.sin(a + 0.12) * rr);
  }
  g.closePath();
}

// ---------- walls, floor, ceiling ----------
export const TEX = {
  '#': art((g) => {
    const r = rng(7);
    g.fillStyle = '#1e1310'; g.fillRect(0, 0, 64, 64);
    for (let row = 0; row < 8; row++) {
      const off = row % 2 ? 8 : 0;
      for (let bx = -8; bx < 64; bx += 16) {
        const x = bx + off + 0.6, y = row * 8 + 0.6;
        const l = 22 + r() * 13, h = 6 + r() * 12, s = 35 + r() * 20;
        g.fillStyle = lin(g, x, y, x, y + 7, [[0, `hsl(${h},${s}%,${l + 6}%)`], [1, `hsl(${h},${s}%,${l - 5}%)`]]);
        g.fillRect(x, y, 14.8, 6.8);
        bevel(g, x, y, 14.8, 6.8, 0.14, 0.45, 0.6);
        if (r() < 0.15) { g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 0.4; g.beginPath(); g.moveTo(x + 3 + r() * 8, y); g.lineTo(x + 4 + r() * 6, y + 3.5); g.lineTo(x + 2 + r() * 10, y + 6.8); g.stroke(); }
      }
    }
    grime(g, 21, 1.1);
  }, null, 14, 3),
  M: art((g) => {
    steelPlate(g, ['#7b848e', '#4a5059'], 5);
    g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 31.4, 64, 1.2);
    g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, 32.6, 64, 0.6);
    for (const [x, y] of [[6, 6], [32, 6], [58, 6], [6, 26], [58, 26], [6, 38], [58, 38], [6, 58], [32, 58], [58, 58]]) rivet(g, x, y);
    streaks(g, 41, 'rgba(130,62,22,', 7);
    g.fillStyle = 'rgba(230,180,40,.55)'; g.font = 'bold 6px monospace'; g.fillText('B-7', 40, 49);
    grime(g, 23, 0.7);
  }, null, 8, 5),
  P: art((g) => {
    g.fillStyle = '#121418'; g.fillRect(0, 0, 64, 64);
    for (const x of [4, 25, 46]) {
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(x + 2, 0, 15, 64);
      g.fillStyle = lin(g, x, 0, x + 14, 0, [[0, '#3a1d0a'], [0.3, '#b8733a'], [0.45, '#f2bb7d'], [0.6, '#b06a33'], [1, '#2e1607']]);
      g.fillRect(x, 0, 14, 64);
      for (const y of [10, 44]) {
        g.fillStyle = lin(g, x - 1.5, 0, x + 15.5, 0, [[0, '#2a1506'], [0.45, '#9a6232'], [1, '#2a1506']]);
        g.fillRect(x - 1.5, y, 17, 5);
        rivet(g, x + 1, y + 2.5, 0.9); rivet(g, x + 13, y + 2.5, 0.9);
      }
    }
    streaks(g, 51, 'rgba(60,140,110,', 4);
    grime(g, 27, 0.8);
  }, (g) => {
    for (const x of [19.5, 40.5]) {
      g.fillStyle = lin(g, x, 0, x + 4, 0, [[0, 'rgba(255,120,30,0)'], [0.5, '#ff8a2a'], [1, 'rgba(255,120,30,0)']]);
      g.fillRect(x, 0, 4, 64);
    }
  }, 8, 9),
  X: art((g) => {
    steelPlate(g, ['#646d77', '#3b4048'], 11);
    g.fillStyle = '#05140c'; g.fillRect(9, 10, 46, 32);
    bevel(g, 9, 10, 46, 32, 0.08, 0.6, 1);
    for (const [x, y] of [[5, 5], [59, 5], [5, 59], [59, 59]]) rivet(g, x, y);
    g.fillStyle = '#1b2025'; g.fillRect(18, 48, 28, 9);
    bevel(g, 18, 48, 28, 9, 0.15, 0.5, 0.6);
  }, (g) => {
    g.strokeStyle = '#3dffa0'; g.lineWidth = 1.2; g.strokeRect(11.5, 12.5, 41, 27);
    g.fillStyle = '#8affc8'; g.font = 'bold 11px monospace'; g.textAlign = 'center'; g.fillText('EXIT', 32, 29);
    g.fillStyle = '#3dffa0';
    g.beginPath(); g.moveTo(26, 33); g.lineTo(38, 33); g.lineTo(38, 31); g.lineTo(42, 34.5); g.lineTo(38, 38); g.lineTo(38, 36); g.lineTo(26, 36); g.fill();
    g.fillStyle = '#1aff8a'; g.fillRect(21, 51, 22, 3);
  }, 6, 11),
  D: art((g) => {
    g.fillStyle = '#4c5158'; g.fillRect(0, 0, 64, 64);
    for (let y = 10; y < 54; y += 6) {
      g.fillStyle = lin(g, 0, y, 0, y + 6, [[0, '#8b929a'], [0.5, '#656b73'], [1, '#3a3e44']]);
      g.fillRect(2, y, 60, 6);
    }
    hazard(g, 0, 10); hazard(g, 54, 10);
    g.fillStyle = '#25282d'; g.fillRect(24, 27, 16, 10);
    bevel(g, 24, 27, 16, 10, 0.2, 0.6, 0.8);
    scratches(g, 13, 10);
    grime(g, 29, 0.6);
  }, (g) => {
    g.fillStyle = '#4dff9a'; g.fillRect(27, 31, 3, 2); g.fillRect(34, 31, 3, 2);
  }, 8, 13),
  K: art((g) => {
    g.fillStyle = '#4c5158'; g.fillRect(0, 0, 64, 64);
    for (let y = 10; y < 54; y += 6) {
      g.fillStyle = lin(g, 0, y, 0, y + 6, [[0, '#8b929a'], [0.5, '#656b73'], [1, '#3a3e44']]);
      g.fillRect(2, y, 60, 6);
    }
    hazard(g, 0, 10); hazard(g, 54, 10);
    g.fillStyle = '#1d1f23'; g.beginPath(); g.arc(32, 32, 15, 0, 7); g.fill();
    grime(g, 31, 0.6);
  }, (g) => {
    g.fillStyle = '#ff9a2a'; gear(g, 32, 32, 9.5, 13, 8); g.fill();
    g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(32, 32, 4.5, 0, 7); g.fill();
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#ff4030'; g.fillRect(6, 30, 4, 4); g.fillRect(54, 30, 4, 4);
  }, 8, 15),
  floor: art((g) => {
    g.fillStyle = '#2a2d32'; g.fillRect(0, 0, 64, 64);
    for (const [px, py] of [[0, 0], [32, 0], [0, 32], [32, 32]]) {
      g.fillStyle = lin(g, px, py, px + 32, py + 32, [[0, '#3d4249'], [1, '#2a2d33']]);
      g.fillRect(px + 0.8, py + 0.8, 30.4, 30.4);
      bevel(g, px + 0.8, py + 0.8, 30.4, 30.4, 0.1, 0.5, 0.8);
      g.fillStyle = 'rgba(255,255,255,.07)';
      for (let y = 4; y < 30; y += 5) for (let x = 4 + ((y / 5) % 2) * 2.5; x < 30; x += 5) { g.save(); g.translate(px + x, py + y); g.rotate(0.7); g.fillRect(-1.6, -0.45, 3.2, 0.9); g.restore(); }
      for (const [x, y] of [[3, 3], [29, 3], [3, 29], [29, 29]]) rivet(g, px + x, py + y, 0.9);
    }
    grime(g, 33, 1.2);
    streaks(g, 61, 'rgba(10,8,4,', 3);
  }, null, 12, 17),
  ceil: art((g) => {
    g.fillStyle = '#16181d'; g.fillRect(0, 0, 64, 64);
    for (const [px, py] of [[0, 0], [32, 0], [0, 32], [32, 32]]) {
      g.fillStyle = '#1f2228'; g.fillRect(px + 1, py + 1, 30, 30);
      bevel(g, px + 1, py + 1, 30, 30, 0.06, 0.5, 0.8);
    }
    g.fillStyle = '#0b0c0f';
    for (let x = 6; x < 26; x += 3) g.fillRect(x, 40, 1.4, 16);
  }, null, 8, 19),
  lamp: art((g) => {
    g.fillStyle = '#16181d'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#2a2e35'; g.fillRect(14, 14, 36, 36);
    bevel(g, 14, 14, 36, 36, 0.12, 0.6, 1.2);
  }, (g) => {
    g.fillStyle = lin(g, 0, 18, 0, 46, [[0, '#fff8e8'], [0.5, '#ffe9c0'], [1, '#ffd79a']]);
    g.fillRect(18, 18, 28, 28);
    g.fillStyle = '#d6b987'; for (let x = 24; x < 46; x += 7) g.fillRect(x, 18, 1, 28);
  }, 6, 37),
};

// ---------- enemies ----------
function droneBase(frame, attack) {
  return (g) => {
    g.fillStyle = '#23272d'; g.fillRect(6, 21, 52, 3);
    bevel(g, 6, 21, 52, 3, 0.2, 0.4, 0.5);
    g.fillStyle = 'rgba(190,200,215,.65)';
    const w = frame ? 13 : 7;
    for (const cx of [9, 55]) { g.beginPath(); g.ellipse(cx, 19.5, w, 1.6, 0, 0, 7); g.fill(); g.fillStyle = '#444b53'; g.fillRect(cx - 1.5, 18, 3, 4); g.fillStyle = 'rgba(190,200,215,.65)'; }
    g.fillStyle = rad(g, 26, 24, 2, 22, [[0, '#d8dfe6'], [0.45, '#808a95'], [1, '#2a2f36']]);
    g.beginPath(); g.ellipse(32, 32, 18, 13, 0, 0, 7); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 0.6;
    g.beginPath(); g.ellipse(32, 32, 18, 13, 0, 0.1, Math.PI - 0.1); g.stroke();
    g.beginPath(); g.moveTo(15, 32); g.lineTo(49, 32); g.stroke();
    g.fillStyle = '#15181c'; g.beginPath(); g.arc(32, 34, 8.5, 0, 7); g.fill();
    g.strokeStyle = '#59616b'; g.lineWidth = 1; g.beginPath(); g.arc(32, 34, 8.5, 0, 7); g.stroke();
    g.fillStyle = '#2b3036'; g.fillRect(30.5, 44, 3, 9);
    g.fillStyle = '#ff6a3d'; g.fillRect(31, 52, 2, 2);
    if (attack) { g.fillStyle = 'rgba(255,200,120,.2)'; g.beginPath(); g.arc(32, 34, 12, 0, 7); g.fill(); }
  };
}
function droneGlow(attack) {
  return (g) => {
    g.fillStyle = attack ? '#fff4b8' : '#ff3b2a';
    g.beginPath(); g.arc(32, 34, attack ? 6.2 : 4.6, 0, 7); g.fill();
    g.fillStyle = '#ffd0c0'; g.beginPath(); g.arc(30.5, 32.5, 1.3, 0, 7); g.fill();
    g.fillStyle = '#ff6a3d'; g.fillRect(31, 52, 2, 2);
  };
}
function crawlerBase(frame, attack) {
  return (g) => {
    for (let i = 0; i < 3; i++) {
      const lift = (i + frame) % 2 ? 3.5 : 0;
      for (const s of [-1, 1]) {
        const kx = 32 + s * (20 + i * 2), fx = 32 + s * (24 - i * 6);
        g.strokeStyle = '#1e211a'; g.lineWidth = 3.2;
        g.beginPath(); g.moveTo(32 + s * 6, 44); g.lineTo(kx, 38 - lift); g.lineTo(fx, 62 - lift); g.stroke();
        g.strokeStyle = '#6b6f4d'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(32 + s * 6, 43.5); g.lineTo(kx, 37.5 - lift); g.lineTo(fx, 61.5 - lift); g.stroke();
      }
    }
    g.fillStyle = rad(g, 28, 38, 1, 20, [[0, '#c3c78c'], [0.5, '#767b48'], [1, '#2b2e18']]);
    g.beginPath(); g.ellipse(32, 45, 16, 10.5, 0, 0, 7); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 0.6;
    for (const y of [41, 46]) { g.beginPath(); g.moveTo(18, y); g.quadraticCurveTo(32, y - 4, 46, y); g.stroke(); }
    const o = attack ? 7 : 2;
    g.strokeStyle = '#dadbb8'; g.lineWidth = 1.8;
    g.beginPath(); g.moveTo(26, 51); g.quadraticCurveTo(24 - o, 55, 28 - o * 0.4, 59); g.stroke();
    g.beginPath(); g.moveTo(38, 51); g.quadraticCurveTo(40 + o, 55, 36 + o * 0.4, 59); g.stroke();
  };
}
function crawlerGlow() {
  return (g) => {
    g.fillStyle = '#ff4030';
    for (const x of [26, 30, 34, 38]) { g.beginPath(); g.arc(x, 42, x === 30 || x === 34 ? 1.7 : 1.1, 0, 7); g.fill(); }
  };
}
function bruteBase(frame, attack) {
  return (g) => {
    g.fillStyle = lin(g, 0, 44, 0, 64, [[0, '#3f444b'], [1, '#17191c']]);
    g.fillRect(18, 44, 10, 20 - frame * 2); g.fillRect(36, 44, 10, 18 + frame * 2);
    g.fillStyle = '#25282d'; g.fillRect(16, 60 - frame * 2, 14, 4); g.fillRect(34, 60, 14, 4);
    const arm = (x, y) => {
      g.fillStyle = lin(g, x, 0, x + 11, 0, [[0, '#24272c'], [0.5, '#6d747d'], [1, '#24272c']]);
      g.fillRect(x, y, 11, 28);
      g.fillStyle = '#1b1d21'; g.fillRect(x - 1, y + 24, 13, 8);
      bevel(g, x - 1, y + 24, 13, 8, 0.2, 0.5, 0.6);
    };
    arm(2, attack ? 4 : 16); arm(51, 16);
    g.fillStyle = lin(g, 0, 10, 0, 50, [[0, '#7c838c'], [0.4, '#4a4f57'], [1, '#1f2226']]);
    g.beginPath(); g.moveTo(12, 14); g.lineTo(52, 14); g.lineTo(48, 48); g.lineTo(16, 48); g.closePath(); g.fill();
    bevel(g, 12, 14, 40, 34, 0.18, 0.35, 0.8);
    for (const [x, y] of [[15, 17], [49, 17], [18, 45], [46, 45]]) rivet(g, x, y, 1.2);
    g.fillStyle = '#120804'; g.fillRect(19, 22, 26, 16);
    g.fillStyle = lin(g, 0, 0, 0, 13, [[0, '#6b7279'], [1, '#2b2f35']]);
    g.fillRect(23, 1, 18, 13);
    bevel(g, 23, 1, 18, 13, 0.2, 0.5, 0.6);
    g.fillStyle = '#3a1205'; g.fillRect(26, 5, 12, 4);
  };
}
function bruteGlow(attack) {
  return (g) => {
    g.fillStyle = attack ? '#fff3c4' : '#ff7a1a';
    g.fillRect(20, 23, 24, 14);
    g.fillStyle = attack ? '#ffd06a' : '#ffb14a';
    g.fillRect(24, 26, 16, 8);
    g.fillStyle = '#ff3b2a'; g.fillRect(27, 6, 10, 2);
  };
}
function bruteBars(g) { g.fillStyle = '#1a0a03'; for (let x = 22.5; x < 44; x += 5) g.fillRect(x, 22, 1.6, 16); }

function wreck(color, seed, ember = true) {
  return art((g) => {
    const r = rng(seed);
    g.fillStyle = 'rgba(10,10,12,.9)'; g.beginPath(); g.ellipse(32, 58, 24, 5, 0, 0, 7); g.fill();
    for (let i = 0; i < 9; i++) {
      const w = 5 + r() * 11, h = 3 + r() * 5, x = 12 + r() * 36, y = 49 + r() * 8;
      g.save(); g.translate(x, y); g.rotate((r() - 0.5) * 0.8);
      g.fillStyle = lin(g, 0, -h, 0, h, [[0, color], [1, '#16181b']]);
      g.fillRect(-w / 2, -h / 2, w, h);
      bevel(g, -w / 2, -h / 2, w, h, 0.2, 0.4, 0.5);
      g.restore();
    }
  }, ember ? (g) => { g.fillStyle = '#ff8a2a'; g.fillRect(30, 52, 3, 2); g.fillRect(40, 55, 2, 1.5); } : null, 10, seed);
}

const frames = (base, glow, post) => [0, 1].map((f) => art((g) => { base(f, 0)(g); post?.(g); }, glow(0)));
export const ENEMY_ART = {
  d: { frames: frames(droneBase, droneGlow), attack: art(droneBase(0, 1), droneGlow(1)), dead: wreck('#8a939d', 71) },
  c: { frames: frames(crawlerBase, crawlerGlow), attack: art(crawlerBase(0, 1), crawlerGlow()), dead: wreck('#7a7f4a', 73) },
  b: {
    frames: [0, 1].map((f) => art(bruteBase(f, 0), (g) => { bruteGlow(0)(g); bruteBars(g); })),
    attack: art(bruteBase(0, 1), (g) => { bruteGlow(1)(g); bruteBars(g); }),
    dead: wreck('#5d636c', 79),
  },
};

export const PROP_ART = {
  o: {
    whole: art((g) => {
      g.fillStyle = lin(g, 18, 0, 46, 0, [[0, '#4a0e0a'], [0.35, '#c8321f'], [0.5, '#f0634a'], [0.7, '#a12616'], [1, '#3a0a07']]);
      g.fillRect(19, 24, 26, 38);
      g.fillStyle = lin(g, 18, 0, 46, 0, [[0, '#2a2d31'], [0.5, '#9aa2ab'], [1, '#2a2d31']]);
      g.fillRect(18, 22, 28, 4); g.fillRect(18, 40, 28, 3); g.fillRect(18, 59, 28, 4);
      g.fillStyle = '#e8c23a'; g.fillRect(24, 30, 16, 7);
      g.fillStyle = '#1a1a1a'; g.beginPath(); g.moveTo(32, 30.8); g.lineTo(37, 36.2); g.lineTo(27, 36.2); g.fill();
      g.fillStyle = '#e8c23a'; g.fillRect(31.4, 32.4, 1.2, 2.2);
      scratches(g, 83, 6);
    }, (g) => { g.fillStyle = '#ffb04a'; g.fillRect(30, 46, 4, 8); }, 8, 81),
    dead: wreck('#8a2a1a', 85),
  },
};

// ---------- pickups ----------
export const ITEM_ART = {
  h: art((g) => {
    g.fillStyle = 'rgba(0,0,0,.5)'; g.beginPath(); g.ellipse(32, 61, 22, 3, 0, 0, 7); g.fill();
    g.fillStyle = lin(g, 0, 26, 0, 60, [[0, '#f2f4f6'], [1, '#9aa1a9']]); g.fillRect(10, 27, 44, 33);
    bevel(g, 10, 27, 44, 33, 0.4, 0.4, 1);
    g.fillStyle = '#6e757d'; g.fillRect(10, 27, 44, 5); g.fillRect(25, 21, 14, 6);
    g.fillStyle = '#1c1f23'; g.fillRect(28, 23, 8, 3);
  }, (g) => { g.fillStyle = '#2bff8a'; g.fillRect(28.5, 35, 7, 21); g.fillRect(21.5, 42, 21, 7); }, 6, 91),
  a: art((g) => {
    g.fillStyle = 'rgba(0,0,0,.5)'; g.beginPath(); g.ellipse(32, 61, 24, 3, 0, 0, 7); g.fill();
    for (let x = 13; x < 50; x += 8) {
      g.fillStyle = lin(g, x, 0, x + 6, 0, [[0, '#8a3d10'], [0.5, '#ff9a4a'], [1, '#7a330c']]); g.fillRect(x, 16, 6, 18);
      g.fillStyle = lin(g, x, 0, x + 6, 0, [[0, '#6a5420'], [0.5, '#f0d27a'], [1, '#5a4418']]); g.fillRect(x, 30, 6, 5);
    }
    g.fillStyle = lin(g, 0, 32, 0, 60, [[0, '#6e5230'], [1, '#3a2914']]); g.fillRect(8, 32, 48, 28);
    bevel(g, 8, 32, 48, 28, 0.25, 0.5, 1);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(8, 44, 48, 1.2);
    g.fillStyle = '#e8c23a'; g.font = 'bold 7px monospace'; g.fillText('SHELL', 20, 54);
  }, null, 8, 93),
  k: art(() => {}, (g) => {
    g.fillStyle = '#ffc53d'; gear(g, 32, 32, 17, 24, 10); g.fill();
    g.fillStyle = '#c8860f'; g.beginPath(); g.arc(32, 32, 11, 0, 7); g.fill();
    g.fillStyle = '#ffe08a'; g.beginPath(); g.arc(28, 27, 3, 0, 7); g.fill();
    g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(32, 32, 5.5, 0, 7); g.fill();
  }),
  w: art((g) => {
    g.fillStyle = 'rgba(0,0,0,.5)'; g.beginPath(); g.ellipse(32, 61, 26, 3, 0, 0, 7); g.fill();
    g.fillStyle = lin(g, 0, 28, 0, 46, [[0, '#8f98a2'], [0.5, '#4a5058'], [1, '#22252a']]);
    g.fillRect(4, 29, 46, 15);
    g.fillStyle = lin(g, 0, 29, 0, 37, [[0, '#a7b0ba'], [1, '#3a3f46']]);
    g.fillRect(48, 29, 12, 6); g.fillRect(48, 37, 12, 6);
    g.fillStyle = '#0a0b0d'; g.fillRect(58, 30, 2, 4); g.fillRect(58, 38, 2, 4);
    hazardBand(g, 12, 33, 28, 4);
    g.fillStyle = lin(g, 0, 44, 0, 60, [[0, '#3a2414'], [1, '#1a0f08']]);
    g.beginPath(); g.moveTo(10, 44); g.lineTo(20, 44); g.lineTo(16, 60); g.lineTo(6, 60); g.fill();
  }, (g) => { g.fillStyle = '#ffa030'; g.fillRect(40, 31, 3, 2); g.fillRect(44, 31, 3, 2); }, 8, 95),
};
function hazardBand(g, x, y, w, h) {
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = '#17171a'; g.fillRect(x, y, w, h);
  g.fillStyle = '#ff8a2a';
  for (let i = x - h; i < x + w; i += 4) { g.beginPath(); g.moveTo(i, y + h); g.lineTo(i + 2, y + h); g.lineTo(i + 2 + h, y); g.lineTo(i + h, y); g.fill(); }
  g.restore();
}

// ---------- effects ----------
export const FX_ART = {
  orb: art(() => {}, (g) => {
    g.fillStyle = rad(g, 32, 32, 1, 18, [[0, '#fffbe6'], [0.35, '#ffc060'], [0.7, '#ff6a1a'], [1, 'rgba(255,60,0,0)']]);
    g.beginPath(); g.arc(32, 32, 18, 0, 7); g.fill();
  }),
  ember: art(() => {}, (g) => { g.fillStyle = rad(g, 32, 32, 2, 30, [[0, '#ffffff'], [0.5, '#ffd36a'], [1, 'rgba(255,140,30,0)']]); g.beginPath(); g.arc(32, 32, 26, 0, 7); g.fill(); }),
  cyan: art(() => {}, (g) => { g.fillStyle = rad(g, 32, 32, 2, 30, [[0, '#ffffff'], [0.5, '#8ff6ff'], [1, 'rgba(60,220,255,0)']]); g.beginPath(); g.arc(32, 32, 26, 0, 7); g.fill(); }),
  smoke: art((g) => {
    const r = rng(97);
    for (let i = 0; i < 7; i++) {
      const x = 20 + r() * 24, y = 20 + r() * 24, s = 10 + r() * 10;
      g.fillStyle = rad(g, x - s * 0.3, y - s * 0.3, 1, s, [[0, '#8d8a86'], [1, '#3a3836']]);
      g.beginPath(); g.arc(x, y, s, 0, 7); g.fill();
    }
  }),
  debris: art((g) => {
    g.fillStyle = lin(g, 0, 18, 0, 46, [[0, '#9aa2ab'], [1, '#2a2d31']]);
    g.beginPath(); g.moveTo(14, 22); g.lineTo(48, 16); g.lineTo(52, 40); g.lineTo(20, 48); g.closePath(); g.fill();
  }),
  boom: art(() => {}, (g) => {
    const r = rng(99);
    for (let i = 0; i < 9; i++) {
      const x = 22 + r() * 20, y = 22 + r() * 20, s = 10 + r() * 12;
      g.fillStyle = rad(g, x, y, 1, s, [[0, '#fffbe0'], [0.4, '#ffb040'], [0.8, 'rgba(230,80,20,.9)'], [1, 'rgba(120,30,0,0)']]);
      g.beginPath(); g.arc(x, y, s, 0, 7); g.fill();
    }
  }),
};
