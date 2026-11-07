// Tidepool Pals reef restoration. Pure functions and data, no DOM.
// The level map is a reef of pools, one per 10 levels. Clearing a pool's levels cleans it up through four stages,
// from polluted to thriving. Pools never decay or regress: progress is the set of cleared levels, which only grows.
// Everything here is deterministic. A thriving pool grants fixed pearls and its scenery unlock, once; nothing here is
// random or bought.
import * as LEVELS from './levels.js';

export const POOL_SIZE = 10;

/* ---------- which pool a level belongs to ---------- */
const lookupDefault = (n) => (typeof LEVELS.levelFor === 'function' ? LEVELS.levelFor(n) : null);
const poolCache = new Map();
/** Prefers the level's own `pool` tag (levelFor(n).pool), else levels 1-10 are pool 0, 11-20 pool 1, and so on. */
export function poolOf(n, lookup) {
  const fallback = Math.floor((n - 1) / POOL_SIZE);
  if (!lookup && poolCache.has(n)) return poolCache.get(n);
  let p = fallback;
  try {
    const tag = (lookup || lookupDefault)(n)?.pool;
    if (Number.isInteger(tag) && tag >= 0) p = tag;
  } catch { /* no tag: use the formula */ }
  if (!lookup) poolCache.set(n, p);
  return p;
}
export function poolLevels(p) { return Array.from({ length: POOL_SIZE }, (_, i) => p * POOL_SIZE + i + 1); }

/* ---------- names, palettes and scenery ---------- */
// Each pool adds one piece of scenery to the Home Pool when it thrives.
export const SCENERY = [
  { id: 'coral', name: 'Cove Coral' },
  { id: 'kelp', name: 'Hollow Kelp' },
  { id: 'rockarch', name: 'Stone Arch' },
  { id: 'glow', name: 'Glow Anemones' },
  { id: 'starshelf', name: 'Starfish Ledge' },
  { id: 'anemones', name: 'Anemone Bed' },
  { id: 'seagrass', name: 'Seagrass Tuft' },
  { id: 'clam', name: 'Moon Clam' },
];
const AUTHORED = [
  { name: 'Driftwood Cove', palette: { top: '#4FC3D9', bottom: '#176F8F', accent: '#FF8A7A' } },
  { name: 'Kelp Hollow', palette: { top: '#5FD0A8', bottom: '#14665A', accent: '#9BE15D' } },
  { name: 'Sunken Arch', palette: { top: '#5AA9E6', bottom: '#1B4F8A', accent: '#FFC93C' } },
  { name: 'Glowtide Grotto', palette: { top: '#6A7CE0', bottom: '#241F5E', accent: '#7CF3E5' } },
  { name: 'Starfish Shelf', palette: { top: '#58C9E8', bottom: '#1A5F86', accent: '#FF9F5A' } },
  { name: 'Anemone Terrace', palette: { top: '#6FD6C6', bottom: '#1C6B78', accent: '#FF7BB0' } },
  { name: 'Seagrass Meadow', palette: { top: '#7AD3A0', bottom: '#1D6650', accent: '#E8F27A' } },
  { name: 'Moonshell Lagoon', palette: { top: '#8AB8F0', bottom: '#2A3F86', accent: '#F4E9FF' } },
];
const ADJ = ['Moonlit', 'Breezy', 'Saltspray', 'Sunlit', 'Hushed', 'Rippled', 'Pebbled', 'Misty', 'Silver', 'Amber'];
const PLACE = ['Shoals', 'Basin', 'Inlet', 'Reach', 'Rockpools', 'Lagoon', 'Ledge', 'Bay', 'Narrows', 'Sound', 'Hollow'];

const hex = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
function hsl(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + hex(f(0) * 255) + hex(f(8) * 255) + hex(f(4) * 255);
}

/** Name, palette and scenery for pool p. Authored for the first eight, then generated (stable for every p). */
export function poolInfo(p) {
  const scenery = SCENERY[p % SCENERY.length];
  if (p < AUTHORED.length) return { index: p, name: AUTHORED[p].name, palette: { ...AUTHORED[p].palette }, scenery: { ...scenery }, authored: true };
  const g = p - AUTHORED.length;
  // ADJ and PLACE have coprime lengths, so every (adjective, place) pair comes up once per 110 pools; the round
  // number keeps names distinct after that.
  const round = Math.floor(g / (ADJ.length * PLACE.length));
  const name = `${ADJ[g % ADJ.length]} ${PLACE[g % PLACE.length]}${round ? ' ' + (round + 1) : ''}`;
  const h = (190 + g * 47) % 360; // stays in watery blues and greens most of the time, with the odd warm lagoon
  const hue = h > 250 && h < 330 ? (h + 80) % 360 : h;
  const palette = { top: hsl(hue, 62, 62), bottom: hsl(hue, 68, 24), accent: hsl((hue + 160) % 360, 85, 70) };
  return { index: p, name, palette, scenery: { ...scenery }, authored: false };
}

/* ---------- restoration ---------- */
export const STAGES = [
  { id: 'polluted', name: 'Polluted', at: 0 },
  { id: 'cleaning', name: 'Cleaning up', at: 0.3 },
  { id: 'recovering', name: 'Recovering', at: 0.7 },
  { id: 'thriving', name: 'Thriving', at: 1 },
];
/** 0-2 of 10 cleared: polluted; 3-6: cleaning up; 7-9: recovering; all 10: thriving. */
export function stageFor(fraction) {
  let s = 0;
  for (let i = 0; i < STAGES.length; i++) if (fraction >= STAGES[i].at - 1e-9) s = i;
  return s;
}

/** Restoration of pool p: cleared levels (any stars), stars earned, stage, and whether it is open or current. */
export function poolProgress(S, p) {
  const levels = poolLevels(p);
  let cleared = 0, stars = 0;
  for (const n of levels) { const st = S.stars[n] || 0; if (st > 0) { cleared++; stars += st; } }
  const fraction = cleared / levels.length;
  return { pool: p, levels, cleared, total: levels.length, fraction, stars, maxStars: levels.length * 3,
    stage: stageFor(fraction), unlocked: levels[0] <= S.level, current: poolOf(S.level) === p };
}

/** Every pool reached so far, plus one locked pool ahead. */
export function reefPools(S) {
  const last = Math.max(poolOf(S.level), ...Object.keys(S.stars).map((n) => poolOf(+n)));
  return Array.from({ length: last + 2 }, (_, p) => poolProgress(S, p));
}

/** Gives a save its reef fields. A save from before the reef (seen: null) starts with today's stages already seen. */
export function initReef(S) {
  if (!S.reef || typeof S.reef !== 'object') S.reef = { claimed: {}, seen: null };
  if (!S.reef.claimed) S.reef.claimed = {};
  if (!S.reef.seen) {
    S.reef.seen = {};
    for (const x of reefPools(S)) if (x.stage > 0) S.reef.seen[x.pool] = x.stage;
  }
  return S;
}

/** Stage-ups since last time, highest new stage per pool. Marks them seen, so each is reported once. */
export function takeStageUps(S) {
  initReef(S);
  const ups = [];
  for (const x of reefPools(S)) {
    const from = S.reef.seen[x.pool] || 0;
    if (x.stage > from) { ups.push({ pool: x.pool, from, to: x.stage }); S.reef.seen[x.pool] = x.stage; }
  }
  return ups;
}

/* ---------- thriving rewards ---------- */
/** Fixed for each pool: pearls (rising gently, capped) and the pool's scenery for the Home Pool. */
export function thrivingReward(p) { return { pearls: 200 + 50 * Math.min(p, 6), decor: SCENERY[p % SCENERY.length].id }; }
/** Thriving pools whose reward has not been claimed yet. */
export function pendingThriving(S) {
  initReef(S);
  return reefPools(S).filter((x) => x.stage === 3 && !S.reef.claimed[x.pool]).map((x) => x.pool);
}
/** Grants a thriving pool's reward once. Returns the reward, or null if not thriving or already claimed. */
export function claimThriving(S, p) {
  initReef(S);
  if (S.reef.claimed[p] || poolProgress(S, p).stage !== 3) return null;
  const r = thrivingReward(p);
  S.reef.claimed[p] = true;
  S.pearls += r.pearls;
  return r;
}
/** Scenery unlocked in the Home Pool, one entry per claimed pool, in pool order. */
export function homeScenery(S) {
  const claimed = Object.keys(S.reef?.claimed || {}).filter((k) => S.reef.claimed[k]).map(Number).sort((a, b) => a - b);
  return claimed.map((p) => ({ pool: p, id: thrivingReward(p).decor, accent: poolInfo(p).palette.accent, name: SCENERY[p % SCENERY.length].name }));
}

/* ---------- residents ---------- */
// Each pal's favourite pool, by what its real-life cousin likes: rocky shallows, kelp, caves, the dark.
export const PAL_HOME = {
  pebbin: 0, fizz: 0, snapjaw: 0, marlo: 1,
  bloop: 2, tango: 5, spindle: 4, coralie: 0,
  gloam: 3, wisp: 7, lumen: 3, abyssa: 2,
};
/** Owned pals living in each thriving pool. A pal lives in its favourite pool once that pool thrives, otherwise in
 *  the first thriving pool. `order` is the canonical pal order, so the result never depends on album order. */
export function residents(S, order) {
  const thriving = new Set(reefPools(S).filter((x) => x.stage === 3).map((x) => x.pool));
  if (!thriving.size) return {};
  const first = Math.min(...thriving);
  const out = {};
  for (const id of order) {
    if (!S.album[id]) continue;
    const fav = PAL_HOME[id];
    const home = thriving.has(fav) ? fav : first;
    (out[home] ||= []).push(id);
  }
  return out;
}

/* ---------- field notes (real animals that inspired each pal; short, well-established facts) ---------- */
export const FIELD_NOTES = {
  pebbin: { animal: 'Hermit crab', lines: [
    'Hermit crabs have soft bodies, so they live in empty shells left by sea snails such as periwinkles.',
    'When a hermit crab grows, it moves into a bigger shell.',
  ] },
  fizz: { animal: 'Tidepool sculpin', lines: [
    'Sculpins are small fish that rest on the bottom of rock pools.',
    'Their speckled colours help them hide against rocks and seaweed.',
  ] },
  snapjaw: { animal: 'Shore crab', lines: [
    'Crabs have ten legs, and the front two are claws.',
    'To grow, a crab sheds its whole hard shell and makes a new, bigger one. This is called moulting.',
    'A crab that loses a leg can grow it back over a few moults.',
  ] },
  marlo: { animal: 'Sea urchin', lines: [
    'Sea urchins walk on hundreds of tiny tube feet between their spines.',
    'Underneath, an urchin has a mouth with five teeth for scraping algae off rocks.',
  ] },
  bloop: { animal: 'Octopus', lines: [
    'An octopus has eight arms, and its suckers can taste what they touch.',
    'It has three hearts and blue blood.',
    'It can change colour in a blink to blend in.',
  ] },
  tango: { animal: 'Clownfish', lines: [
    'Clownfish live among the stinging tentacles of sea anemones.',
    'A slimy coating on their skin helps protect them from the stings.',
  ] },
  spindle: { animal: 'Sea star', lines: [
    'Sea stars are not fish. They move on hundreds of tiny tube feet.',
    'Many sea stars can regrow a lost arm.',
    'Many have a simple eye spot at the tip of each arm.',
  ] },
  coralie: { animal: 'Coral polyp', lines: [
    'Coral reefs are built by tiny animals called polyps, one stony cup at a time.',
    'Many corals get food from tiny algae living inside them, which also give them their colour.',
    'If the water gets too warm, corals can lose their algae and turn white. This is called bleaching.',
  ] },
  gloam: { animal: 'Anglerfish', lines: [
    'Deep-sea anglerfish have a glowing lure on their heads.',
    'The glow comes from bacteria living inside the lure, and it draws in small prey in the dark.',
  ] },
  wisp: { animal: 'Moon jelly', lines: [
    'Jellyfish have no brain, no heart and no bones.',
    'A moon jelly\'s body is mostly water.',
    'Sea turtles can mistake floating plastic bags for jellyfish, which is one reason litter matters.',
  ] },
  lumen: { animal: 'Lanternfish', lines: [
    'Lanternfish have rows of glowing spots along their bodies. Making light like this is called bioluminescence.',
    'Many swim up toward the surface at night to feed, then sink back down by day.',
  ] },
  abyssa: { animal: 'Nautilus', lines: [
    'A nautilus lives in a coiled shell split into chambers.',
    'It rises and sinks by changing the gas and liquid inside those chambers.',
    'Nautiluses and their relatives have lived in the sea for hundreds of millions of years.',
  ] },
};

/* ---------- did you know (one per pool stage, two to rotate through by pool) ---------- */
export const DID_YOU_KNOW = [
  [ // polluted
    'Plastic doesn\'t rot away in the sea. It breaks into smaller and smaller bits called microplastics.',
    'Scientists estimate a drink can may last around 200 years in the sea, and a plastic bottle around 450.',
  ],
  [ // cleaning up
    'Six-pack rings and lost fishing line can tangle seabirds, seals and turtles. Snipping the rings helps.',
    'Beach clean-ups really help: every piece picked up is one less that can wash back into the sea.',
  ],
  [ // recovering
    'When litter and pollution ease off, seaweed, snails and crabs can move back into rock pools.',
    'Seaweed and seagrass give young fish a safe place to hide and grow.',
  ],
  [ // thriving
    'Sea otters eat sea urchins. Where otters have come back, kelp forests that urchins had eaten can regrow.',
    'Healthy reefs and rock pools are full of life: one small pool can hold crabs, snails, anemones and fish.',
  ],
];
export function didYouKnow(p, stage) { const list = DID_YOU_KNOW[stage] || DID_YOU_KNOW[0]; return list[p % list.length]; }
