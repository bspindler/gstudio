// Lanternkeep simulation: pure and deterministic. No DOM, no clock, no randomness.
// The page steps it at a fixed DT and draws whatever state it leaves behind.
// Units: grid cells. A cell's centre is (c + 0.5, r + 0.5).

export const COLS = 9;
export const ROWS = 13;
export const DT = 1 / 30;
export const BREAK_SECONDS = 12; // gap between waves; calling early pays the seconds left
export const EARLY_GOLD_PER_SECOND = 2;
export const SELL_REFUND = 0.7;

// The lantern's own power: a burst of light around it that hurts and stuns. It charges during waves.
export const FLARE_COOLDOWN = 30;
export const FLARE_RADIUS = 2.6;
export const FLARE_DAMAGE = 40;
export const FLARE_STUN = 1.2;

// Each plant grows twice in a line (tiers), then once more into one of two branches.
// kind: bolt = single target, splash = area at the target, aura = pulse that slows all in range,
// beam = single target that ignores armour and prefers the toughest creature.
// Optional stats: multi (targets per shot), stunEvery/stunFor, burn {dps, dur, r}, pierce (line width),
// ramp (extra damage per consecutive hit on one target, up to 3 stacks).
export const TOWERS = {
  glowcap: {
    name: 'Glowcap', kind: 'bolt', blurb: 'Quick spores. A steady all-rounder.',
    tiers: [
      { cost: 50, dmg: 10, rate: 1.3, range: 2.3 },
      { cost: 60, dmg: 17, rate: 1.45, range: 2.5 },
    ],
    branches: {
      a: { name: 'Spore Storm', blurb: 'Hits up to three creatures at once.', cost: 120, dmg: 20, rate: 1.6, range: 2.7, multi: 3 },
      b: { name: 'Deepcap', blurb: 'Heavy spores. Every fourth one stuns.', cost: 120, dmg: 46, rate: 1.1, range: 2.9, stunEvery: 4, stunFor: 0.7 },
    },
  },
  frost: {
    name: 'Frost Fern', kind: 'aura', blurb: 'Chills everything nearby. Slows, barely hurts.',
    tiers: [
      { cost: 70, dmg: 3, rate: 1, range: 1.7, slow: 0.4, slowFor: 1.4 },
      { cost: 70, dmg: 5, rate: 1, range: 1.9, slow: 0.5, slowFor: 1.6 },
    ],
    branches: {
      a: { name: 'Hoarfrost', blurb: 'A deep, wide chill.', cost: 130, dmg: 6, rate: 1, range: 2.4, slow: 0.68, slowFor: 2.2 },
      b: { name: 'Icicle', blurb: 'Sharp cold that really hurts.', cost: 130, dmg: 16, rate: 1.25, range: 2, slow: 0.45, slowFor: 1.4 },
    },
  },
  ember: {
    name: 'Ember Thistle', kind: 'splash', blurb: 'Lobs embers that burst. Great on swarms.',
    tiers: [
      { cost: 100, dmg: 16, rate: 0.6, range: 2.1, splash: 0.95 },
      { cost: 90, dmg: 27, rate: 0.65, range: 2.3, splash: 1.05 },
    ],
    branches: {
      a: { name: 'Wildfire', blurb: 'Huge bursts.', cost: 170, dmg: 50, rate: 0.7, range: 2.5, splash: 1.6 },
      b: { name: 'Cinder', blurb: 'Bursts leave the ground burning.', cost: 170, dmg: 32, rate: 0.7, range: 2.5, splash: 1.05, burn: { dps: 22, dur: 2.5, r: 0.9 } },
    },
  },
  sunspire: {
    name: 'Sunspire', kind: 'beam', blurb: 'Slow, long sunbeam. Pierces armour, hunts the biggest.',
    tiers: [
      { cost: 150, dmg: 60, rate: 0.42, range: 4 },
      { cost: 130, dmg: 105, rate: 0.46, range: 4.4 },
    ],
    branches: {
      a: { name: 'Solar Lance', blurb: 'The beam runs through every creature in its line.', cost: 230, dmg: 150, rate: 0.48, range: 5.2, pierce: 0.42 },
      b: { name: 'Daybreak', blurb: 'A fast beam that burns hotter on the same target.', cost: 230, dmg: 70, rate: 1, range: 4.6, ramp: 0.4 },
    },
  },
  moonbell: {
    name: 'Moonbell', kind: 'chime', blurb: 'A slow, soft chime. Everything near it stops still for a moment.',
    tiers: [
      { cost: 90, dmg: 2, rate: 0.3, range: 1.9, stunFor: 0.6 },
      { cost: 80, dmg: 3, rate: 0.33, range: 2.1, stunFor: 0.8 },
    ],
    branches: {
      a: { name: 'Lullaby Bell', blurb: 'A wide, long hush over the path.', cost: 150, dmg: 3, rate: 0.33, range: 2.7, stunFor: 0.9 },
      b: { name: 'Tollbell', blurb: 'A deep toll that stuns and really hurts.', cost: 150, dmg: 14, rate: 0.36, range: 2.2, stunFor: 0.7 },
    },
  },
  thornbriar: {
    name: 'Thornbriar', kind: 'thorn', blurb: 'Seeds thorns on the path. Walkers that cross them are cut, a few times each patch.',
    tiers: [
      { cost: 80, dmg: 14, rate: 0.5, range: 2.2, patches: 1, hits: 4 },
      { cost: 70, dmg: 20, rate: 0.6, range: 2.4, patches: 2, hits: 6 },
    ],
    branches: {
      a: { name: 'Bramble Hedge', blurb: 'More thorn patches, each with more bite left in it.', cost: 140, dmg: 24, rate: 0.7, range: 2.6, patches: 3, hits: 9 },
      b: { name: 'Barbed Snare', blurb: 'Fewer patches that hit hard and hold the creature a moment.', cost: 140, dmg: 42, rate: 0.55, range: 2.4, patches: 2, hits: 5, stunFor: 0.6 },
    },
  },
};
// Moonbell stuns bosses for half as long, and a creature it has just stilled shrugs off the next chime for a while.
export const CHIME_BOSS_FACTOR = 0.5;
export const CHIME_REST = 1.5;
// Thornbriar: a thorn patch is one path tile. It cuts each walker once, has a limited number of hits, and withers after a while.
export const THORN_RADIUS = 0.5;
export const THORN_LIFE = 30;
export const TOWER_ORDER = ['glowcap', 'frost', 'ember', 'sunspire', 'moonbell', 'thornbriar'];

export const ENEMIES = {
  moth: { name: 'Moth', hp: 28, speed: 1.35, armor: 0, reward: 5, leak: 1, r: 0.22, tip: 'Drawn to light. Easy to stop alone, not in a crowd.' },
  firefly: { name: 'Firefly', hp: 12, speed: 2.1, armor: 0, reward: 2, leak: 1, r: 0.15, tip: 'Fast and fragile. Frost Ferns slow them down.' },
  beetle: { name: 'Shell Beetle', hp: 85, speed: 0.75, armor: 4, reward: 11, leak: 1, r: 0.3, tip: 'Armour shrugs off small hits. Upgrade, or use a Sunspire.' },
  wisp: { name: 'Wisp', hp: 45, speed: 1.15, armor: 0, reward: 8, leak: 1, r: 0.24, slowImmune: true, tip: 'Frost does not touch them.' },
  mossback: { name: 'Mossback', hp: 120, speed: 0.7, armor: 1, reward: 14, leak: 1, r: 0.32, heal: { r: 1.4, pct: 0.06 }, tip: 'Heals creatures near it. Take it out first.' },
  toad: { name: 'Gloom Toad', hp: 650, speed: 0.5, armor: 3, reward: 75, leak: 5, r: 0.42, tip: 'A boss. Costs five lives if it reaches the lantern.' },
  mole: { name: 'Hollow Mole', hp: 70, speed: 0.95, armor: 1, reward: 10, leak: 1, r: 0.28, dive: { up: 2.4, down: 1.6 }, tip: 'Dives under the path for a stretch. Nothing can hit it down there, so cover the whole road.' },
  burrower: { name: 'Dusk Burrower', hp: 80, speed: 0.9, armor: 1, reward: 10, leak: 1, r: 0.28, burrow: { from: 1.5, len: 1.8, every: 6, fast: 1.4 }, tip: 'Digs under a short stretch of the road, out of reach, and pops up further on. Spread your plants along the whole road.' },
  stag: { name: 'Gloam Stag', hp: 380, speed: 0.55, armor: 2, reward: 40, leak: 3, r: 0.4, charge: { speed: 2.1, minRun: 3, margin: 0.5 }, tip: 'Walks slowly, then charges down the long straights of the path. Slow it before the road runs straight.' },
  lampmoth: { name: 'Lampmoth', hp: 16, speed: 2.5, armor: 0, reward: 3, leak: 1, r: 0.17, lamp: { dazzle: 3.2, reach: 0.32 }, tip: 'Leaves the path and dives at your brightest plant. It dazzles that plant until it burns out, then flits for the lantern.' },
  twinwisp: { name: 'Twin Wisp', hp: 60, speed: 1.1, armor: 0, reward: 4, leak: 1, r: 0.24, twin: true, tip: 'Splits in two the first time it is struck, each half with half the health. Bursts and beams catch both.' },
  shadebearer: { name: 'Shadebearer', hp: 100, speed: 0.85, armor: 1, reward: 9, leak: 1, r: 0.27, shade: { r: 1.35, slow: 0.45, for: 2 }, tip: 'Carries a hush of shadow. Plants beside its path fire slower for a moment, so spread your plants out instead of stacking them.' },
  mothmother: { name: 'Mothmother', hp: 900, speed: 0.45, armor: 2, reward: 90, leak: 5, r: 0.46, split: { type: 'moth', n: 6 }, tip: 'A boss. She bursts into moths when she falls.' },
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

// mods come from the player's lantern perks: { lives, gold, glowcapDiscount, flareCooldown (multiplier),
// flareDamage (multiplier), frostDuration (multiplier), refund (extra fraction), earlyGold (extra per second) }.
export function createGame(level, mods = {}) {
  const paths = level.paths.map(buildPath);
  const blocked = new Set();
  for (const p of level.paths) for (const [c, r] of pathCells(p)) blocked.add(key(c, r));
  const end = level.paths[0][level.paths[0].length - 1];
  const lives = level.lives + (mods.lives ?? 0);
  const flareMax = FLARE_COOLDOWN * (mods.flareCooldown ?? 1);
  return {
    level,
    mods,
    paths,
    blocked,
    lantern: { c: end[0], r: end[1], x: end[0] + 0.5, y: end[1] + 0.5 },
    gold: level.gold + (mods.gold ?? 0),
    lives,
    maxLives: lives,
    waveIndex: -1,
    waveCount: level.waves.length,
    queue: [], // pending spawns: { t, type, lane }
    countdown: null, // seconds until the next wave, while between waves
    t: 0,
    phase: 'ready', // ready | wave | won | lost
    towers: [],
    enemies: [],
    patches: [], // burning ground: { x, y, r, dps, left }
    thorns: [], // thorn patches: { id, tid, x, y, dmg, hits, left, seen: [enemy ids already cut], stunFor }
    flareMax,
    flareCd: flareMax * (1 - (level.flareStart ?? 0)), // a level can start with the Flare part-charged
    pending: [], // events raised outside step(), reported by the next step
    nextId: 1,
    stats: { kills: 0, leaks: 0, earned: 0, earlyBonus: 0, built: 0, flares: 0 },
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
  const def = TOWERS[t.type];
  return t.tier < def.tiers.length ? def.tiers[t.tier] : def.branches[t.branch];
}

export function buildCost(g, type) {
  const base = TOWERS[type].tiers[0].cost;
  return type === 'glowcap' && g.mods.glowcapDiscount ? Math.round(base * (1 - g.mods.glowcapDiscount)) : base;
}

// The cost of the next growth, or null when fully grown. Both branches cost the same.
export function upgradeCost(t) {
  const def = TOWERS[t.type];
  if (t.tier + 1 < def.tiers.length) return def.tiers[t.tier + 1].cost;
  if (t.tier + 1 === def.tiers.length) return def.branches.a.cost;
  return null;
}

export function needsBranch(t) {
  return t.tier + 1 === TOWERS[t.type].tiers.length;
}

export function refundFor(g, t) {
  if (g.phase === 'ready') return t.spent;
  return Math.floor(t.spent * Math.min(0.95, SELL_REFUND + (g.mods.refund ?? 0)));
}

// Returns '' on success, or a short reason the player can read.
export function place(g, type, c, r) {
  if (!g.level.towers.includes(type)) return 'locked';
  if (!canBuild(g, c, r)) return 'blocked';
  const cost = buildCost(g, type);
  if (g.gold < cost) return 'gold';
  g.gold -= cost;
  g.towers.push({ id: g.nextId++, type, c, r, x: c + 0.5, y: r + 0.5, tier: 0, branch: null, cd: 0, spent: cost, aim: 0, shots: 0, focusId: 0, focus: 0 });
  g.stats.built += 1;
  return '';
}

export function upgrade(g, id, branch) {
  const t = g.towers.find((x) => x.id === id);
  if (!t) return 'missing';
  const cost = upgradeCost(t);
  if (cost === null) return 'max';
  if (needsBranch(t) && branch !== 'a' && branch !== 'b') return 'branch';
  if (g.gold < cost) return 'gold';
  g.gold -= cost;
  if (needsBranch(t)) t.branch = branch;
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

export function earlyBonus(g) {
  if (g.countdown === null || g.countdown <= 0) return 0;
  return Math.ceil(g.countdown) * (EARLY_GOLD_PER_SECOND + (g.mods.earlyGold ?? 0));
}

// Starts the next wave. Returns the early-call bonus paid (0 when not early).
export function callWave(g) {
  if (!canCallWave(g)) return 0;
  const bonus = earlyBonus(g);
  g.gold += bonus;
  g.stats.earlyBonus += bonus;
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

export function flareCharge(g) {
  return Math.max(0, Math.min(1, 1 - g.flareCd / g.flareMax));
}

export function useFlare(g) {
  if (g.phase !== 'wave') return 'idle';
  if (g.flareCd > 0) return 'charging';
  g.flareCd = g.flareMax;
  g.stats.flares += 1;
  const dmg = FLARE_DAMAGE * (g.mods.flareDamage ?? 1);
  const r2 = FLARE_RADIUS * FLARE_RADIUS;
  let hits = 0;
  for (const e of g.enemies) {
    if (e.hp <= 0 || e.under || dist2(e, g.lantern) > r2) continue;
    hits += 1;
    e.stunLeft = Math.max(e.stunLeft, FLARE_STUN);
    hurt(g, e, dmg, true, g.pending);
  }
  g.pending.push({ e: 'flare', x: g.lantern.x, y: g.lantern.y, r: FLARE_RADIUS, hits });
  return '';
}

function spawn(g, type, lane, d = 0) {
  const def = ENEMIES[type];
  const hp = Math.round(def.hp * (g.level.hpMul ?? 1) * (1 + 0.04 * Math.max(0, g.waveIndex)));
  const p = pointAt(g.paths[lane], d);
  const e = { id: g.nextId++, type, lane, hp, maxHp: hp, d, x: p.x, y: p.y, slow: 0, slowLeft: 0, stunLeft: 0, chimeRest: 0, hitFlash: 0, healed: 0, under: false };
  if (def.lamp) { e.mode = 'dive'; e.dazzleLeft = 0; e.tid = 0; }
  g.enemies.push(e);
  return e;
}

// The brightest plant: the most grown one (it has put the most light into the garden); the oldest wins a tie.
function brightest(g) {
  let best = null;
  for (const t of g.towers) if (!best || t.spent > best.spent) best = t;
  return best;
}

// A Lampmoth leaves its path: dive at the brightest plant, dazzle it, then flit straight for the lantern.
// Returns true when it has leaked.
function moveLamp(g, e, def, events) {
  const sp = def.speed * (1 - e.slow) * DT;
  const toward = (tx, ty) => {
    const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
    if (d > 1e-6) { const k = Math.min(1, sp / d); e.x += dx * k; e.y += dy * k; }
    return d;
  };
  if (e.mode === 'dive') {
    const t = brightest(g);
    if (!t) { // no plants to dive at: stay on the path
      e.d += sp;
      const p = pointAt(g.paths[e.lane], e.d);
      e.x = p.x; e.y = p.y;
      return e.d >= g.paths[e.lane].len;
    }
    e.tid = t.id;
    if (toward(t.x, t.y) <= def.lamp.reach) { e.mode = 'dazzle'; e.dazzleLeft = def.lamp.dazzle; t.dazzled = true; }
    return false;
  }
  if (e.mode === 'dazzle') {
    const t = g.towers.find((x) => x.id === e.tid);
    if (!t) { e.mode = 'dive'; return false; }
    t.dazzled = true;
    const a = g.t * 7 + e.id * 1.9;
    e.x = t.x + Math.cos(a) * 0.3;
    e.y = t.y + Math.sin(a) * 0.3;
    e.dazzleLeft -= DT;
    if (e.dazzleLeft <= 0) e.mode = 'home';
    return false;
  }
  return toward(g.lantern.x, g.lantern.y) <= 0.15;
}

// A charger rushes while it is inside a straight stretch at least minRun long, clear of the corners by margin.
function charging(path, d, c) {
  const { cum } = path;
  for (let i = 1; i < cum.length; i++) {
    if (d < cum[i]) {
      const len = cum[i] - cum[i - 1], into = d - cum[i - 1];
      return len >= c.minRun && into >= c.margin && into <= len - c.margin;
    }
  }
  return false;
}

function killed(g, e, events) {
  const def = ENEMIES[e.type];
  g.gold += def.reward;
  g.stats.kills += 1;
  g.stats.earned += def.reward;
  events.push({ e: 'kill', type: e.type, x: e.x, y: e.y, reward: def.reward });
  if (def.split) {
    for (let i = 0; i < def.split.n; i++) spawn(g, def.split.type, e.lane, Math.max(0, e.d - 0.1 - i * 0.16));
  }
}

function hurt(g, e, dmg, ignoreArmor, events) {
  if (e.hp <= 0) return;
  const armor = ignoreArmor ? 0 : ENEMIES[e.type].armor;
  e.hp -= Math.max(1, dmg - armor);
  e.hitFlash = 0.12;
  if (e.hp <= 0) killed(g, e, events);
  else if (ENEMIES[e.type].twin && !e.half) splitTwin(g, e, events);
}

// A Twin Wisp that is struck and survives parts in two: each half keeps half the hurt body's health and never splits again.
function splitTwin(g, e, events) {
  const hp = Math.max(1, Math.floor(e.hp / 2));
  e.half = true;
  e.hp = Math.max(1, Math.ceil(e.hp / 2));
  const d = Math.max(0, e.d - 0.3);
  const p = pointAt(g.paths[e.lane], d);
  g.enemies.push({ ...e, id: g.nextId++, d, x: p.x, y: p.y, hp, hitFlash: 0 });
  events.push({ e: 'split', x: e.x, y: e.y });
}

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
// A creature that has dived under the path can't be hit by plants, bursts, embers, beams or the Flare.
const hittable = (e) => e.hp > 0 && !e.under;

function inRange(g, t, range) {
  const r2 = range * range;
  return g.enemies.filter((e) => hittable(e) && dist2(e, t) <= r2);
}

function pickTarget(list, prefer) {
  let best = null;
  for (const e of list) {
    if (!best) best = e;
    else if (prefer === 'strong' ? e.hp > best.hp || (e.hp === best.hp && e.d > best.d) : e.d > best.d) best = e;
  }
  return best;
}

// Thornbriar seeds a patch on the nearest path tile in reach that has no thorns yet, up to its patch cap.
function seedThorns(g, t, s, events) {
  if (g.thorns.reduce((n, p) => n + (p.tid === t.id ? 1 : 0), 0) >= s.patches) return false;
  const r2 = s.range * s.range;
  let best = null, bd = Infinity;
  for (const k of g.blocked) {
    const [c, r] = k.split(',').map(Number);
    const at = { x: c + 0.5, y: r + 0.5 };
    const d = dist2(at, t);
    if (d > r2 || d >= bd) continue;
    if (g.thorns.some((p) => p.x === at.x && p.y === at.y)) continue;
    best = at; bd = d;
  }
  if (!best) return false;
  g.thorns.push({ id: g.nextId++, tid: t.id, x: best.x, y: best.y, dmg: s.dmg, hits: s.hits, left: THORN_LIFE, seen: [], stunFor: s.stunFor ?? 0 });
  events.push({ e: 'thorn', id: t.id, x1: t.x, y1: t.y, x2: best.x, y2: best.y });
  return true;
}

function fire(g, t, events) {
  const s = stats(t);
  const kind = TOWERS[t.type].kind;
  if (kind === 'thorn') return seedThorns(g, t, s, events);
  const near = inRange(g, t, s.range);
  if (near.length === 0) return false;
  if (kind === 'aura') {
    const slowFor = s.slowFor * (g.mods.frostDuration ?? 1);
    for (const e of near) {
      if (!ENEMIES[e.type].slowImmune && s.slow >= e.slow) { e.slow = s.slow; e.slowLeft = slowFor; }
      hurt(g, e, s.dmg, false, events);
    }
    events.push({ e: 'pulse', id: t.id, x: t.x, y: t.y, range: s.range });
    return true;
  }
  if (kind === 'chime') {
    for (const e of near) {
      if (e.chimeRest <= 0) {
        const f = ENEMIES[e.type].leak >= 5 ? CHIME_BOSS_FACTOR : 1;
        e.stunLeft = Math.max(e.stunLeft, s.stunFor * f);
        e.chimeRest = s.stunFor * f + CHIME_REST;
      }
      hurt(g, e, s.dmg, false, events);
    }
    events.push({ e: 'chime', id: t.id, x: t.x, y: t.y, range: s.range });
    return true;
  }
  const target = pickTarget(near, kind === 'beam' ? 'strong' : 'first');
  t.aim = Math.atan2(target.y - t.y, target.x - t.x);
  if (kind === 'splash') {
    const r2 = s.splash * s.splash;
    const at = { x: target.x, y: target.y };
    for (const e of g.enemies) if (hittable(e) && dist2(e, at) <= r2) hurt(g, e, s.dmg, false, events);
    if (s.burn) g.patches.push({ x: at.x, y: at.y, r: s.burn.r, dps: s.burn.dps, left: s.burn.dur });
    events.push({ e: 'burst', id: t.id, x1: t.x, y1: t.y, x2: at.x, y2: at.y, splash: s.splash, burn: !!s.burn });
  } else if (kind === 'beam') {
    let dmg = s.dmg;
    if (s.ramp) {
      t.focus = t.focusId === target.id ? Math.min(3, t.focus + 1) : 0;
      t.focusId = target.id;
      dmg *= 1 + s.ramp * t.focus;
    }
    let hits = 1;
    let end = { x: target.x, y: target.y };
    if (s.pierce) {
      const dx = target.x - t.x, dy = target.y - t.y, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      end = { x: t.x + ux * s.range, y: t.y + uy * s.range };
      hits = 0;
      for (const e of g.enemies) {
        if (!hittable(e)) continue;
        const ex = e.x - t.x, ey = e.y - t.y;
        const along = ex * ux + ey * uy;
        if (along < 0 || along > s.range || Math.abs(ex * uy - ey * ux) > s.pierce) continue;
        hits += 1;
        hurt(g, e, dmg, true, events);
      }
    } else {
      hurt(g, target, dmg, true, events);
    }
    events.push({ e: 'beam', id: t.id, x1: t.x, y1: t.y, x2: end.x, y2: end.y, hits, heat: t.focus });
  } else {
    const targets = s.multi ? near.slice().sort((a, b) => b.d - a.d).slice(0, s.multi) : [target];
    for (const e of targets) {
      t.shots += 1;
      if (s.stunEvery && t.shots % s.stunEvery === 0) e.stunLeft = Math.max(e.stunLeft, s.stunFor);
      hurt(g, e, s.dmg, false, events);
      events.push({ e: 'bolt', id: t.id, x1: t.x, y1: t.y, x2: e.x, y2: e.y, heavy: !!s.stunEvery });
    }
  }
  return true;
}

// Advances the game by one fixed step. Returns what happened, for sound and effects.
export function step(g) {
  const events = g.pending;
  g.pending = [];
  if (g.phase !== 'wave') return events;
  g.t += DT;
  if (g.flareCd > 0) g.flareCd = Math.max(0, g.flareCd - DT);

  while (g.queue.length && g.queue[0].t <= g.t) {
    const s = g.queue.shift();
    spawn(g, s.type, s.lane);
  }

  for (const t of g.towers) t.dazzled = false;
  for (const e of g.enemies) {
    if (e.hp <= 0) continue;
    const def = ENEMIES[e.type];
    if (e.slowLeft > 0) { e.slowLeft -= DT; if (e.slowLeft <= 0) e.slow = 0; }
    if (e.hitFlash > 0) e.hitFlash -= DT;
    if (e.chimeRest > 0) e.chimeRest -= DT;
    if (e.healed > 0) e.healed -= DT;
    if (e.stunLeft > 0) { e.stunLeft = Math.max(0, e.stunLeft - DT); continue; }
    if (def.lamp) {
      if (moveLamp(g, e, def, events)) {
        e.hp = 0;
        e.leaked = true;
        g.lives = Math.max(0, g.lives - def.leak);
        g.stats.leaks += def.leak;
        events.push({ e: 'leak', type: e.type, lives: g.lives });
      }
      continue;
    }
    const path = g.paths[e.lane];
    let speed = def.speed;
    if (def.charge) { e.charging = charging(path, e.d, def.charge); if (e.charging) speed = def.charge.speed; }
    if (def.burrow && e.under) speed *= def.burrow.fast; // tunnelling is quick, so it surfaces further on
    e.d += speed * (1 - e.slow) * DT;
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
    if (def.dive) e.under = e.d % (def.dive.up + def.dive.down) >= def.dive.up;
    if (def.burrow) e.under = e.d >= def.burrow.from && (e.d - def.burrow.from) % def.burrow.every < def.burrow.len;
  }

  // healers mend their neighbours
  for (const h of g.enemies) {
    const heal = ENEMIES[h.type].heal;
    if (!heal || h.hp <= 0) continue;
    const r2 = heal.r * heal.r;
    for (const e of g.enemies) {
      if (e === h || e.hp <= 0 || e.hp >= e.maxHp || dist2(e, h) > r2) continue;
      e.hp = Math.min(e.maxHp, e.hp + heal.pct * e.maxHp * DT);
      e.healed = 0.3;
    }
  }

  // burning ground
  for (const p of g.patches) {
    p.left -= DT;
    const r2 = p.r * p.r;
    for (const e of g.enemies) {
      if (!hittable(e) || dist2(e, p) > r2) continue;
      e.hp -= p.dps * DT;
      if (e.hp <= 0) killed(g, e, events);
    }
  }
  g.patches = g.patches.filter((p) => p.left > 0);

  // thorn patches: each walker is cut once per patch, the patch has a limited number of hits
  for (const p of g.thorns) {
    p.left -= DT;
    for (const e of g.enemies) {
      if (p.hits <= 0) break;
      if (!hittable(e) || ENEMIES[e.type].lamp || p.seen.includes(e.id)) continue;
      if (Math.hypot(e.x - p.x, e.y - p.y) > THORN_RADIUS) continue;
      p.seen.push(e.id);
      p.hits -= 1;
      if (p.stunFor) e.stunLeft = Math.max(e.stunLeft, p.stunFor * (ENEMIES[e.type].leak >= 5 ? CHIME_BOSS_FACTOR : 1));
      hurt(g, e, p.dmg, false, events);
      events.push({ e: 'thornhit', x: p.x, y: p.y });
    }
  }
  g.thorns = g.thorns.filter((p) => p.left > 0 && p.hits > 0);

  // a Shadebearer dims every plant it passes: for a moment after, the plant fires slower
  for (const t of g.towers) {
    if (t.dimLeft > 0) t.dimLeft = Math.max(0, t.dimLeft - DT);
    for (const e of g.enemies) {
      const sh = ENEMIES[e.type].shade;
      if (sh && e.hp > 0 && dist2(e, t) <= sh.r * sh.r) { t.dimLeft = sh.for; t.dimBy = sh.slow; }
    }
  }

  for (const t of g.towers) {
    t.cd -= DT;
    if (t.cd < 0) t.cd = 0;
    if (t.dazzled) continue; // a plant a Lampmoth is dazzling can't fire
    if (t.cd <= 0 && fire(g, t, events)) t.cd = 1 / (stats(t).rate * (t.dimLeft > 0 ? 1 - t.dimBy : 1));
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
