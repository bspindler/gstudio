// Lanternkeep simulation: pure and deterministic. No DOM, no clock, no randomness.
// The page steps it at a fixed DT and draws whatever state it leaves behind.
// Units: grid cells. A cell's centre is (c + 0.5, r + 0.5).

export const COLS = 9;
export const ROWS = 13;
export const DT = 1 / 30;
export const BREAK_SECONDS = 12; // gap between waves; calling early pays the seconds left
export const EARLY_GOLD_PER_SECOND = 2;
export const SELL_REFUND = 0.7;

// Each tower has three tiers. tiers[0].cost is the build cost; later costs are upgrade costs.
// kind: bolt = single target, splash = area at the target, aura = pulse that slows all in range,
// beam = single target that ignores armour and prefers the toughest enemy.
export const TOWERS = {
  glowcap: {
    name: 'Glowcap', kind: 'bolt', blurb: 'Quick spores. A steady all-rounder.',
    tiers: [
      { cost: 50, dmg: 10, rate: 1.3, range: 2.3 },
      { cost: 60, dmg: 17, rate: 1.45, range: 2.5 },
      { cost: 110, dmg: 28, rate: 1.65, range: 2.8 },
    ],
  },
  frost: {
    name: 'Frost Fern', kind: 'aura', blurb: 'Chills everything nearby. Slows, barely hurts.',
    tiers: [
      { cost: 70, dmg: 3, rate: 1, range: 1.7, slow: 0.4, slowFor: 1.4 },
      { cost: 70, dmg: 5, rate: 1, range: 1.9, slow: 0.5, slowFor: 1.6 },
      { cost: 120, dmg: 9, rate: 1.1, range: 2.1, slow: 0.6, slowFor: 1.8 },
    ],
  },
  ember: {
    name: 'Ember Thistle', kind: 'splash', blurb: 'Lobs embers that burst. Great on swarms.',
    tiers: [
      { cost: 100, dmg: 16, rate: 0.6, range: 2.1, splash: 0.95 },
      { cost: 90, dmg: 27, rate: 0.65, range: 2.3, splash: 1.05 },
      { cost: 160, dmg: 44, rate: 0.7, range: 2.5, splash: 1.2 },
    ],
  },
  sunspire: {
    name: 'Sunspire', kind: 'beam', blurb: 'Slow, long sunbeam. Pierces armour, hunts the biggest.',
    tiers: [
      { cost: 150, dmg: 60, rate: 0.42, range: 4 },
      { cost: 130, dmg: 105, rate: 0.46, range: 4.4 },
      { cost: 220, dmg: 180, rate: 0.5, range: 4.8 },
    ],
  },
};
export const TOWER_ORDER = ['glowcap', 'frost', 'ember', 'sunspire'];

export const ENEMIES = {
  moth: { name: 'Moth', hp: 28, speed: 1.35, armor: 0, reward: 5, leak: 1, r: 0.22 },
  firefly: { name: 'Firefly', hp: 12, speed: 2.1, armor: 0, reward: 2, leak: 1, r: 0.15 },
  beetle: { name: 'Shell Beetle', hp: 85, speed: 0.75, armor: 4, reward: 11, leak: 1, r: 0.3 },
  wisp: { name: 'Wisp', hp: 45, speed: 1.15, armor: 0, reward: 8, leak: 1, r: 0.24, slowImmune: true },
  toad: { name: 'Gloom Toad', hp: 650, speed: 0.5, armor: 3, reward: 75, leak: 5, r: 0.42 },
};

// ---------- paths ----------

// Waypoints are cell coordinates; consecutive points must share a row or a column.
export function buildPath(points) {
  const pts = points.map(([c, r]) => ({ x: c + 0.5, y: r + 0.5 }));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y));
  }
  return { pts, cum, len: cum[cum.length - 1] };
}

export function pointAt(path, d) {
  const { pts, cum } = path;
  if (d <= 0) return { x: pts[0].x, y: pts[0].y };
  for (let i = 1; i < pts.length; i++) {
    if (d <= cum[i]) {
      const seg = cum[i] - cum[i - 1];
      const t = seg === 0 ? 0 : (d - cum[i - 1]) / seg;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
    }
  }
  const last = pts[pts.length - 1];
  return { x: last.x, y: last.y };
}

// Every in-grid cell a path passes through.
export function pathCells(points) {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const [c0, r0] = points[i - 1];
    const [c1, r1] = points[i];
    const n = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const c = c0 + Math.sign(c1 - c0) * k;
      const r = r0 + Math.sign(r1 - r0) * k;
      if (c >= 0 && c < COLS && r >= 0 && r < ROWS) out.push([c, r]);
    }
  }
  return out;
}

const key = (c, r) => `${c},${r}`;

// ---------- game ----------

export function createGame(level) {
  const paths = level.paths.map(buildPath);
  const blocked = new Set();
  for (const p of level.paths) for (const [c, r] of pathCells(p)) blocked.add(key(c, r));
  const end = level.paths[0][level.paths[0].length - 1];
  return {
    level,
    paths,
    blocked,
    lantern: { c: end[0], r: end[1] },
    gold: level.gold,
    lives: level.lives,
    maxLives: level.lives,
    waveIndex: -1,
    waveCount: level.waves.length,
    queue: [], // pending spawns: { t, type, lane }
    countdown: null, // seconds until the next wave, while between waves
    t: 0,
    phase: 'ready', // ready | wave | won | lost
    towers: [],
    enemies: [],
    nextId: 1,
    stats: { kills: 0, leaks: 0, earned: 0, earlyBonus: 0, built: 0 },
  };
}

export function canBuild(g, c, r) {
  if (g.phase === 'won' || g.phase === 'lost') return false;
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
  if (g.blocked.has(key(c, r))) return false;
  return !g.towers.some((t) => t.c === c && t.r === r);
}

export function towerAt(g, c, r) {
  return g.towers.find((t) => t.c === c && t.r === r) ?? null;
}

export function stats(t) {
  return TOWERS[t.type].tiers[t.tier];
}

export function upgradeCost(t) {
  const next = TOWERS[t.type].tiers[t.tier + 1];
  return next ? next.cost : null;
}

export function refundFor(g, t) {
  return g.phase === 'ready' ? t.spent : Math.floor(t.spent * SELL_REFUND);
}

// Returns '' on success, or a short reason the player can read.
export function place(g, type, c, r) {
  if (!g.level.towers.includes(type)) return 'locked';
  if (!canBuild(g, c, r)) return 'blocked';
  const cost = TOWERS[type].tiers[0].cost;
  if (g.gold < cost) return 'gold';
  g.gold -= cost;
  g.towers.push({ id: g.nextId++, type, c, r, x: c + 0.5, y: r + 0.5, tier: 0, cd: 0, spent: cost, aim: 0 });
  g.stats.built += 1;
  return '';
}

export function upgrade(g, id) {
  const t = g.towers.find((x) => x.id === id);
  if (!t) return 'missing';
  const cost = upgradeCost(t);
  if (cost === null) return 'max';
  if (g.gold < cost) return 'gold';
  g.gold -= cost;
  t.tier += 1;
  t.spent += cost;
  return '';
}

export function sell(g, id) {
  const i = g.towers.findIndex((x) => x.id === id);
  if (i < 0) return 0;
  const refund = refundFor(g, g.towers[i]);
  g.gold += refund;
  g.towers.splice(i, 1);
  return refund;
}

// The next wave can be called once the current one has finished spawning.
export function canCallWave(g) {
  if (g.phase === 'ready') return true;
  return g.phase === 'wave' && g.queue.length === 0 && g.waveIndex < g.waveCount - 1;
}

// Starts the next wave. Returns the early-call bonus paid (0 when not early).
export function callWave(g) {
  if (!canCallWave(g)) return 0;
  let bonus = 0;
  if (g.countdown !== null && g.countdown > 0) {
    bonus = Math.ceil(g.countdown) * EARLY_GOLD_PER_SECOND;
    g.gold += bonus;
    g.stats.earlyBonus += bonus;
  }
  g.countdown = null;
  g.phase = 'wave';
  g.waveIndex += 1;
  const wave = g.level.waves[g.waveIndex];
  const lanes = g.paths.length;
  let n = 0;
  for (const [type, count, gap, at = 0, lane] of wave) {
    for (let i = 0; i < count; i++) {
      g.queue.push({ t: g.t + at + i * gap, type, lane: lane ?? n % lanes });
      n += 1;
    }
  }
  g.queue.sort((a, b) => a.t - b.t);
  return bonus;
}

function spawn(g, type, lane) {
  const def = ENEMIES[type];
  const hp = Math.round(def.hp * (g.level.hpMul ?? 1) * (1 + 0.04 * Math.max(0, g.waveIndex)));
  const p = pointAt(g.paths[lane], 0);
  g.enemies.push({ id: g.nextId++, type, lane, hp, maxHp: hp, d: 0, x: p.x, y: p.y, slow: 0, slowLeft: 0, hitFlash: 0 });
}

function hurt(g, e, dmg, ignoreArmor, events) {
  if (e.hp <= 0) return;
  const armor = ignoreArmor ? 0 : ENEMIES[e.type].armor;
  e.hp -= Math.max(1, dmg - armor);
  e.hitFlash = 0.12;
  if (e.hp <= 0) {
    const reward = ENEMIES[e.type].reward;
    g.gold += reward;
    g.stats.kills += 1;
    g.stats.earned += reward;
    events.push({ e: 'kill', type: e.type, x: e.x, y: e.y, reward });
  }
}

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

function inRange(g, t, range) {
  const r2 = range * range;
  return g.enemies.filter((e) => e.hp > 0 && dist2(e, t) <= r2);
}

function pickTarget(list, prefer) {
  let best = null;
  for (const e of list) {
    if (!best) best = e;
    else if (prefer === 'strong' ? e.hp > best.hp || (e.hp === best.hp && e.d > best.d) : e.d > best.d) best = e;
  }
  return best;
}

function fire(g, t, events) {
  const s = stats(t);
  const kind = TOWERS[t.type].kind;
  const near = inRange(g, t, s.range);
  if (near.length === 0) return false;
  if (kind === 'aura') {
    for (const e of near) {
      if (!ENEMIES[e.type].slowImmune && s.slow >= e.slow) { e.slow = s.slow; e.slowLeft = s.slowFor; }
      hurt(g, e, s.dmg, false, events);
    }
    events.push({ e: 'pulse', id: t.id, x: t.x, y: t.y, range: s.range });
    return true;
  }
  const target = pickTarget(near, kind === 'beam' ? 'strong' : 'first');
  t.aim = Math.atan2(target.y - t.y, target.x - t.x);
  if (kind === 'splash') {
    const r2 = s.splash * s.splash;
    const at = { x: target.x, y: target.y };
    for (const e of g.enemies) if (e.hp > 0 && dist2(e, at) <= r2) hurt(g, e, s.dmg, false, events);
    events.push({ e: 'burst', id: t.id, x1: t.x, y1: t.y, x2: at.x, y2: at.y, splash: s.splash });
  } else {
    hurt(g, target, s.dmg, kind === 'beam', events);
    events.push({ e: kind === 'beam' ? 'beam' : 'bolt', id: t.id, x1: t.x, y1: t.y, x2: target.x, y2: target.y });
  }
  return true;
}

// Advances the game by one fixed step. Returns what happened, for sound and effects.
export function step(g) {
  const events = [];
  if (g.phase !== 'wave') return events;
  g.t += DT;

  while (g.queue.length && g.queue[0].t <= g.t) {
    const s = g.queue.shift();
    spawn(g, s.type, s.lane);
  }

  for (const e of g.enemies) {
    const def = ENEMIES[e.type];
    if (e.slowLeft > 0) { e.slowLeft -= DT; if (e.slowLeft <= 0) e.slow = 0; }
    if (e.hitFlash > 0) e.hitFlash -= DT;
    e.d += def.speed * (1 - e.slow) * DT;
    const path = g.paths[e.lane];
    if (e.d >= path.len) {
      e.hp = 0;
      e.leaked = true;
      g.lives = Math.max(0, g.lives - def.leak);
      g.stats.leaks += def.leak;
      events.push({ e: 'leak', type: e.type, lives: g.lives });
      continue;
    }
    const p = pointAt(path, e.d);
    e.x = p.x;
    e.y = p.y;
  }

  for (const t of g.towers) {
    t.cd -= DT;
    if (t.cd <= 0 && fire(g, t, events)) t.cd = 1 / stats(t).rate;
    if (t.cd < 0) t.cd = 0;
  }

  g.enemies = g.enemies.filter((e) => e.hp > 0);

  if (g.lives <= 0) {
    g.phase = 'lost';
    events.push({ e: 'lost' });
    return events;
  }

  const last = g.waveIndex >= g.waveCount - 1;
  if (g.queue.length === 0) {
    if (last) {
      if (g.enemies.length === 0) { g.phase = 'won'; events.push({ e: 'won', stars: starsFor(g) }); }
    } else if (g.countdown === null) {
      g.countdown = BREAK_SECONDS;
    } else {
      g.countdown -= DT;
      if (g.countdown <= 0) { g.countdown = null; callWave(g); events.push({ e: 'wave', n: g.waveIndex + 1 }); }
    }
  }
  return events;
}

export function starsFor(g) {
  const f = g.lives / g.maxLives;
  if (f >= 0.9) return 3;
  if (f >= 0.5) return 2;
  return g.lives > 0 ? 1 : 0;
}

// How much of the paths a tower at (c, r) with this range would cover, in path cells. Used for hints.
export function coverage(g, c, r, range) {
  const at = { x: c + 0.5, y: r + 0.5 };
  const r2 = range * range;
  let n = 0;
  for (const k of g.blocked) {
    const [pc, pr] = k.split(',').map(Number);
    if (dist2({ x: pc + 0.5, y: pr + 0.5 }, at) <= r2) n += 1;
  }
  return n;
}
