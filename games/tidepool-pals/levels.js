// Tidepool Pals levels. Pure data and a seeded generator, no DOM.
// Layout: 8 rows of 7 characters. '.' pal, 'i' pal tangled in a net, 's' sand, 'l' litter (cans, rings, bottles),
// 'o' rock pool (holds pals only at low tide), 'P' stranded pal, 'B' pal trapped in a bubble (freed by two clears
// next to it, counts as a rescue), 'x' hole (not part of the pool).
// Goals: { t:'collect', c, n } (colour index), { t:'litter' } / { t:'sand' } (clear all of it),
// { t:'ice', n? } (untangle n pals, default all), { t:'rescue', n? } (rescue n stranded pals, default all).
// Tide: { high, low, dir }: high tide for `high` moves (gravity down), then low tide for `low` moves (gravity `dir`).
// Exit: the edge stranded pals swim out through ('down', or the low tide's 'left' / 'right').
// Pool: which reef pool the level restores (reef.js reads levelFor(n).pool).
import { COLS, ROWS, atExit, hashSeed, maskOf, mulberry32 } from './board.js';

const FULL = ['.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......'];
const L = (n, moves, colors, goals, layout = FULL, extra = {}) => ({ n, moves, colors, goals, layout, ...extra });
const C = (c, n) => ({ t: 'collect', c, n });
const LITTER = { t: 'litter' };
const ICE = (n) => ({ t: 'ice', n });
const RESCUE = (n) => ({ t: 'rescue', n });
const T = (high, low, dir) => ({ high, low, dir });

/** Helpers (a pal you bring into a level) unlock at this level. */
export const HELPER_LEVEL = 4;
/** Levels 1-10 restore pool 0, 11-20 pool 1, and so on every 10 levels. */
export const poolOf = (n) => Math.floor((n - 1) / 10);

/* Hand-authored 1-20: one new idea at a time, and the tide arrives early. Colours: 0 Coral, 1 Sunstar,
   2 Droplet, 3 Gem, 4 Kelp. */
const RAW = [
  L(1, 18, 4, [C(0, 12)], FULL, { intro: 'Swipe a pal to swap. Make 3 in a row to pop them!' }),
  L(2, 20, 4, [C(1, 18)], FULL, { intro: 'Match 5 or more at once to make an urchin bomb. Swipe it onto a neighbour to blast the pals around it.' }),
  L(3, 22, 4, [RESCUE(1), C(2, 16)],
    ['.......', '.......', '.......', '...B...', '.......', '.......', '.......', '.......'],
    { tide: T(6, 2, 'up'),
      intro: 'A pal is trapped in a bubble! Clear pals right next to it twice to set it free. And the tide turns: after 6 moves the water drains for 2 moves, and the pals tumble up instead of down.' }),
  L(4, 22, 4, [C(0, 10), C(2, 10)], FULL, { tide: T(6, 2, 'up'),
    intro: 'Two goals this time: fill both to win. And a pal can help now: pick a helper below. It charges as you clear its colour; tap it when it glows.' }),
  L(5, 20, 4, [RESCUE(1), C(1, 16)],
    ['...P...', '.......', '.......', '.......', '.......', '.......', '.......', '.......'],
    { exit: 'down', intro: 'A pal is stranded! Clear the pals under it so it sinks to the open water at the bottom. Stranded pals can\'t be matched, and blasts never hurt them.' }),
  L(6, 7, 4, [C(3, 16)],
    ['.......', '.......', '.......', '.......', '.......', '.......', 'oo...oo', 'oo...oo'],
    { tide: T(4, 3, 'up'), intro: 'Rock pools! The dark pools only hold pals at low tide. When the tide comes back in, those pals wash out to sea, and they count toward your goals.' }),
  L(7, 7, 4, [LITTER],
    ['.......', '.......', '.......', '.......', '.......', '.......', '..lll..', '.lllll.'],
    { tide: T(6, 2, 'up'), intro: 'Litter! Clear pals right next to cans, rings and bottles to pick them up. Clean up all of it to win.' }),
  L(8, 16, 5, [C(4, 20)], FULL, { tide: T(4, 3, 'right'),
    intro: 'A sideways tide! At low tide this pool drains to the right: pals slide right and new ones wash in from the left. The arrow on the tide meter shows where the next tide pulls.' }),
  L(9, 13, 5, [RESCUE(1), C(2, 14)],
    ['x.....x', '.......', '.......', '.......', '...B...', '.......', '.......', 'x.....x'],
    { tide: T(5, 3, 'left'),
      intro: 'A pal is trapped in a bubble! Clear pals right next to it twice to crack it open and set it free. Match 7 or more for a wave: it sweeps a whole row or column.' }),
  L(10, 6, 5, [ICE(4)],
    ['.......', '.......', '.......', '.i...i.', '.......', '.i...i.', '.......', '.......'],
    { tide: T(5, 3, 'up'), intro: 'Pals tangled in nets! Clear pals next to a net to untangle them. Tangled pals stay put, whatever the tide does, until they are free.' }),
  L(11, 45, 5, [RESCUE(1), C(0, 12)],
    ['.......', '.P.....', '.......', '.......', '.......', '.......', '.......', '.......'],
    { tide: T(3, 3, 'right'), exit: 'right', intro: 'This pal needs the low tide: it drifts right as the water drains. Clear its row to let it reach the open water on the right.' }),
  L(12, 17, 5, [C(1, 24)],
    ['o.....o', 'o.....o', '.......', '.......', '.......', '.......', '.......', '.......'],
    { tide: T(4, 3, 'left'), intro: 'Match 9 or more for a whirlpool: it swirls away every pal of its colour.' }),
  L(13, 18, 5, [C(0, 16), C(3, 16)],
    ['.......', 'x.....x', 'xx...xx', 'xx...xx', 'x.....x', '.......', '.......', '.......'],
    { tide: T(5, 2, 'up'), intro: 'Swipe a special that touches another special to combine them into a bigger blast.' }),
  L(14, 42, 5, [LITTER, ICE(3)],
    ['.......', '.......', '.i...i.', '.......', '.i...i.', '.......', 'l.....l', 'll...ll'],
    { tide: T(4, 3, 'right') }),
  L(15, 34, 5, [RESCUE(1)],
    ['.P...P.', '.......', '.......', '.l...l.', '.......', '.......', '.......', '.......'],
    { tide: T(5, 2, 'up'), exit: 'down', intro: 'Two pals are stranded this time, with litter in the way: rescue either one. Careful: at low tide they float back up.' }),
  L(16, 13, 5, [C(2, 22)],
    ['.......', '.......', 'o.....o', 'o.....o', 'o.....o', 'o.....o', '.......', '.......'],
    { tide: T(4, 3, 'left') }),
  L(17, 12, 5, [ICE(10)],
    ['.......', 'i.....i', '.i...i.', '...i...', '...i...', '.i...i.', 'i.....i', '.......'],
    { tide: T(4, 3, 'up') }),
  L(18, 17, 5, [LITTER, C(2, 18)],
    ['x.....x', '.......', '.......', 'l.....l', 'll...ll', '.......', '.......', 'x.....x'],
    { tide: T(4, 3, 'right') }),
  L(19, 38, 5, [RESCUE(1), LITTER],
    ['.......', '....P..', '.......', '.......', '.......', '.......', 'll...ll', 'lll.lll'],
    { tide: T(3, 4, 'left'), exit: 'left' }),
  L(20, 23, 5, [LITTER, ICE(4), C(4, 16)],
    ['x.....x', '.......', '.i...i.', '.......', '.i...i.', 'o.....o', 'll...ll', 'lll.lll'],
    { tide: T(4, 3, 'right'), intro: 'A big one to finish the first stretch: litter, nets, a colour goal and a sideways tide.' }),
  L(21, 19, 5, [LITTER, C(3, 16)],
    ['.......', '.......', '.......', '.......', '.......', '.......', 'l.....l', 'll.l.ll'],
    { tide: T(5, 3, 'up') }),
];
export const AUTHORED = RAW.map((d) => ({ ...d, pool: poolOf(d.n) }));

/* ---------- measuring a level ---------- */
const count = (def, ch) => def.layout.reduce((a, row) => a + [...row].filter((x) => x === ch).length, 0);
export function features(def) {
  const collectGoals = def.goals.filter((g) => g.t === 'collect').length;
  return { sand: count(def, 's'), litter: count(def, 'l'), ice: count(def, 'i'), holes: count(def, 'x'),
    rock: count(def, 'o'), rescue: count(def, 'P') + count(def, 'B'), tide: !!def.tide,
    sideways: !!def.tide && def.tide.dir !== 'up', collectGoals, goals: def.goals.length, colors: def.colors };
}
/** Rough number of moves the goals take for a typical player. */
function workload(def) {
  const f = features(def);
  const parts = def.goals.map((g) => g.t === 'collect' ? g.n / 2.4 : g.t === 'sand' ? f.sand : g.t === 'litter' ? f.litter
    : g.t === 'rescue' ? 7 * (g.n ?? f.rescue) : 1.1 * (g.n ?? f.ice));
  const max = Math.max(...parts), sum = parts.reduce((a, b) => a + b, 0);
  return max + 0.6 * (sum - max);
}
/** Higher is harder: work per move, made harder by holes (fewer matches), a fifth colour and a sideways tide. */
export function difficulty(def) {
  const f = features(def);
  return (workload(def) * (1 + (f.holes / (ROWS * COLS)) * 0.6) * (def.colors === 5 ? 1.15 : 1) * (f.sideways ? 1.05 : 1)) / def.moves;
}

/* ---------- procedural levels beyond 20 ---------- */
// Hole templates, roughly in order of how much they cramp the pool.
const MASKS = [
  FULL,
  ['x.....x', '.......', '.......', '.......', '.......', '.......', '.......', 'x.....x'],
  ['.......', '.......', '.x...x.', '.......', '.......', '.x...x.', '.......', '.......'],
  ['.......', '.......', '.......', '..xxx..', '..xxx..', '.......', '.......', '.......'],
  ['xx...xx', 'x.....x', '.......', '.......', '.......', '.......', '.......', '.......'],
  ['.......', '.......', '...x...', '...x...', '...x...', '...x...', '.......', '.......'],
  ['.......', 'x.....x', 'xx...xx', 'xx...xx', 'x.....x', '.......', '.......', '.......'],
  ['xx...xx', 'x.....x', '.......', '.......', '.......', '.......', 'x.....x', 'xx...xx'],
  ['x..x..x', '.......', '.......', 'x.....x', 'x.....x', '.......', '.......', 'x..x..x'],
];
// Rock-pool templates: cells that turn into rock pools where the layout is still a plain pal.
const ROCKS = [
  [[6, 0], [6, 1], [7, 0], [7, 1], [6, 5], [6, 6], [7, 5], [7, 6]],
  [[0, 0], [1, 0], [0, 6], [1, 6]],
  [[2, 0], [3, 0], [4, 0], [5, 0], [2, 6], [3, 6], [4, 6], [5, 6]],
  [[3, 2], [3, 3], [3, 4], [4, 2], [4, 3], [4, 4]],
];
const TIDE_DIRS = ['up', 'left', 'right'];
/** Extra moves for generated levels that hard-stopped players (measured by the play scorer). */
export const MOVE_BONUS = { 25: 8, 26: 9, 28: 17 };
/** Lighter boards for generated levels that walled players: [row, replacement row] pairs, moves untouched. */
export const BOARD_EASE = { 21: [[6, '.......']], 28: [[1, '.......'], [4, '...P...']] };

export function generateLevel(n) {
  const rng = mulberry32(hashSeed('tidepool:' + n));
  const int = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const t = Math.max(1, n - 20);
  const tier = Math.min(9, Math.floor((t - 1) / 10)); // a new step every 10 levels, flat after level 120

  // 1. Shape: more cramped templates unlock as tiers go up.
  const maskIx = tier === 0 && rng() < 0.5 ? 0 : int(0, Math.min(MASKS.length - 1, 1 + tier));
  const cells = MASKS[maskIx].map((row) => [...row]);
  const open = (r, c) => cells[r][c] === '.';

  // 2. Which goals: more of them, mixed together, as tiers go up.
  const kinds = ['collect', 'litter', 'ice'];
  for (let i = kinds.length - 1; i > 0; i--) { const j = int(0, i); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
  let k = 1;
  if (rng() < Math.min(0.85, 0.3 + 0.12 * tier)) k++;
  if (tier >= 3 && rng() < Math.min(0.6, 0.12 * (tier - 2))) k++;
  const chosen = kinds.slice(0, k);

  const goals = [];
  // Obstacles never crowd out the plain pals you match with; three-goal levels get lighter obstacles.
  let budget = cells.flat().filter((ch) => ch === '.').length - 26;
  const lighten = (x) => Math.min(budget, k === 3 ? Math.round(x * 0.7) : x);
  // 3. Litter fills up from the bottom in mirrored pairs; sand can also show up as a plain obstacle later on.
  const goalLitter = chosen.includes('litter');
  const wantBlock = lighten(goalLitter ? Math.min(16, 6 + Math.floor(tier * 1.1) + int(0, 3))
    : tier >= 2 && rng() < 0.35 ? int(3, 6) : 0);
  const ch = goalLitter ? 'l' : 's';
  let blocks = 0;
  const band = tier >= 4 && rng() < 0.4 ? [4, 3, 5] : [7, 6, 5, 4];
  for (const r of band) {
    for (let c = 0; c <= 3 && blocks < wantBlock; c++) {
      const m = COLS - 1 - c;
      if (!open(r, c) || !open(r, m)) continue;
      if (c === m) { cells[r][c] = ch; blocks++; } else if (wantBlock - blocks >= 2) { cells[r][c] = ch; cells[r][m] = ch; blocks += 2; }
    }
  }
  budget -= blocks;
  if (goalLitter && blocks > 0) goals.push(LITTER);

  // 4. Netted pals in mirrored pairs in the middle rows.
  if (chosen.includes('ice')) {
    const wantIce = lighten(Math.min(12, 3 + Math.floor(tier * 0.8) + int(0, 2)));
    let ice = 0, guard = 0;
    while (ice < wantIce && guard++ < 200) {
      const r = int(1, 5), c = int(0, 3), m = COLS - 1 - c;
      if (!open(r, c) || !open(r, m)) continue;
      cells[r][c] = 'i'; ice++;
      if (c !== m && ice < wantIce) { cells[r][m] = 'i'; ice++; }
    }
    if (ice > 0) goals.push(ICE(ice));
  }

  // 5. Colour goals; a two-colour goal gets likelier with tiers.
  if (chosen.includes('collect') || goals.length === 0) {
    const base = Math.min(34, 14 + 2 * tier + int(0, 6));
    const c1 = int(0, 4);
    if (rng() < 0.3 + 0.05 * tier) {
      const c2 = (c1 + int(1, 4)) % 5;
      goals.push(C(c1, Math.round(base * 0.65)), C(c2, Math.round(base * 0.65)));
    } else goals.push(C(c1, base));
  }
  // Keep goals within the 3 the HUD shows: a two-colour goal next to two obstacle goals drops its second colour.
  while (goals.length > 3) goals.pop();

  // 6. Tides: most levels breathe; the low tide pulls up or sideways.
  const extra = {};
  if (rng() < Math.min(0.9, 0.7 + 0.03 * tier)) {
    extra.tide = T(int(3, 6), int(2, 4), TIDE_DIRS[int(0, 2)]);
  }
  // 7. A rescue now and then (it replaces the last goal when the HUD is full), else maybe rock pools.
  if (rng() < Math.min(0.4, 0.22 + 0.02 * tier)) {
    const pals = tier >= 4 && rng() < 0.4 ? 2 : 1;
    const exit = extra.tide && extra.tide.dir !== 'up' && rng() < 0.5 ? extra.tide.dir : 'down';
    let placed = 0, guard = 0;
    const m = cells.map((row) => row.map((x) => x !== 'x'));
    while (placed < pals && guard++ < 200) {
      const r = exit === 'down' ? int(0, 2) : int(0, 5);
      const c = exit === 'down' ? int(1, 5) : exit === 'right' ? int(0, 2) : int(4, 6);
      if (!open(r, c) || atExit(m, r, c, exit)) continue;
      cells[r][c] = 'P'; placed++;
    }
    if (placed) {
      if (goals.length >= 3) goals.pop();
      goals.unshift(RESCUE(placed));
      extra.exit = exit;
    }
  } else if (extra.tide && rng() < 0.4) {
    for (const [r, c] of ROCKS[int(0, ROCKS.length - 1)]) if (open(r, c)) cells[r][c] = 'o';
  }

  const def = { n, moves: 0, colors: 5, goals, layout: cells.map((row) => row.join('')), ...extra, pool: poolOf(n) };
  // 8. Moves: the goals' workload times a slack that tightens tier by tier.
  const slack = Math.max(1.12, 1.55 - 0.045 * tier);
  const holesFactor = 1 + (features(def).holes / (ROWS * COLS)) * 0.6;
  // Swiping matches clears about three a move plus chains, so budgets run about 40% under the tap-era ones.
  def.moves = Math.max(12, Math.min(40, Math.round(workload(def) * holesFactor * slack * 0.62) + 4));
  // 9. A few generated levels proved to wall players: they get extra moves, nothing else changes.
  if (MOVE_BONUS[n]) def.moves = Math.min(45, def.moves + MOVE_BONUS[n]);
  // 10. Others get a lighter board instead (fewer obstacles), with the moves they already had.
  for (const [r, row] of BOARD_EASE[n] ?? []) def.layout[r] = row;
  return def;
}

/* Hand-authored levels past the generated stretch: level 23 is a five-point starfish with a pal bubbled in the middle. */
const SPECIAL = {
  23: { ...L(23, 15, 5, [RESCUE(1), C(1, 16)],
    ['xxx.xxx', 'xx...xx', '.......', '...B...', '.......', 'x.....x', 'x..x..x', 'x..x..x'],
    { tide: T(5, 3, 'up'),
      intro: 'A starfish pool! The bubbled pal sits in the middle: clear pals right next to it twice to set it free.' }),
    pool: poolOf(23) },
  24: { ...L(24, 8, 5, [LITTER],
    ['.x...x.', '.......', '.......', '.......', '.l...l.', '..lll..', 'xl.l.lx', 'x.x.x.x'],
    { tide: T(4, 3, 'up'),
      intro: 'A crab pool! Clean the litter out of its shell and from between its legs. Only 8 moves, so make each swipe count.' }),
    pool: poolOf(24) },
  25: { ...L(25, 22, 5, [RESCUE(1), C(2, 12)],
    ['xx...xx', 'x.....x', 'xx.....', 'xx.P...', 'xx.....', 'xx.....', 'x......', '..xx...'],
    { exit: 'down',
      intro: 'A seahorse pool! The stranded pal floats in its belly: clear the pals under it so it sinks down to the open water at the tail.' }),
    pool: poolOf(25) },
};
export function levelDef(n) { return n >= 1 && n <= AUTHORED.length ? AUTHORED[n - 1] : SPECIAL[n] ?? generateLevel(n); }
/** The level for number n, with its `pool` index. Same as levelDef; reef.js reads levelFor(n).pool. */
export const levelFor = levelDef;
/** `?level=N` in the page address: a whole number from 1 to the level count, otherwise null (ignored). */
export function levelFromSearch(search) {
  const v = new URLSearchParams(search || '').get('level');
  if (v === null || !/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= Math.max(AUTHORED.length, ...Object.keys(SPECIAL).map(Number)) ? n : null;
}

/**
 * The level with tides switched off (the `tides` flag): high tide only. Rock pools stay water for good, so
 * they become holes, and a stranded pal's exit moves to the bottom edge (the only way high tide carries it).
 */
export function withoutTides(def) {
  if (!def.tide) return def;
  const { tide, ...rest } = def;
  return { ...rest, layout: def.layout.map((row) => row.replace(/o/g, 'x')), ...(def.exit ? { exit: 'down' } : {}) };
}

/* ---------- validation: what makes a level playable at all ---------- */
export function validateLevel(def) {
  const e = [];
  if (!Number.isInteger(def.n) || def.n < 1) e.push('n must be a positive integer');
  if (!Array.isArray(def.layout) || def.layout.length !== ROWS) { e.push(`layout needs ${ROWS} rows`); return e; }
  def.layout.forEach((row, r) => {
    if (row.length !== COLS) e.push(`row ${r} needs ${COLS} cells`);
    if (/[^.sixloPB]/.test(row)) e.push(`row ${r} has an unknown cell`);
  });
  const f = features(def);
  const playable = ROWS * COLS - f.holes, plain = count(def, '.');
  if (playable < 36) e.push('too few playable cells');
  if (playable - f.rock < 32) e.push('too few playable cells at high tide');
  if (plain < 20) e.push('too few plain pals to make matches');
  // every playable cell connects to every other one
  const seen = new Set(), start = [];
  def.layout.forEach((row, r) => [...row].forEach((ch, c) => { if (ch !== 'x' && !start.length) start.push([r, c]); }));
  const st = [...start];
  while (st.length) {
    const [r, c] = st.pop(), k = r * COLS + c;
    if (seen.has(k) || r < 0 || r >= ROWS || c < 0 || c >= COLS || def.layout[r][c] === 'x') continue;
    seen.add(k);
    st.push([r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]);
  }
  if (seen.size !== playable) e.push('playable cells are not all connected');
  if (def.colors !== 4 && def.colors !== 5) e.push('colors must be 4 or 5');
  if (!(def.moves >= 6 && def.moves <= 45)) e.push('moves out of range');
  if (!def.goals.length || def.goals.length > 3) e.push('1 to 3 goals');
  const cs = def.goals.filter((g) => g.t === 'collect').map((g) => g.c);
  if (new Set(cs).size !== cs.length) e.push('collect goals must use different colours');
  for (const g of def.goals) {
    if (g.t === 'collect') {
      if (!(g.c >= 0 && g.c < def.colors)) e.push('collect colour not in play');
      if (!(g.n >= 1 && g.n <= def.moves * 2.5)) e.push('collect target out of reach');
    } else if (g.t === 'sand') { if (f.sand < 1) e.push('sand goal without sand'); }
    else if (g.t === 'litter') { if (f.litter < 1) e.push('litter goal without litter'); }
    else if (g.t === 'ice') { if (f.ice < 1 || (g.n ?? f.ice) > f.ice || (g.n ?? 1) < 1) e.push('ice goal does not match the netted pals'); }
    else if (g.t === 'rescue') { if (f.rescue < 1 || (g.n ?? f.rescue) > f.rescue || (g.n ?? 1) < 1) e.push('rescue goal does not match the stranded pals'); }
    else e.push('unknown goal');
  }
  for (const t of ['sand', 'litter', 'ice', 'rescue']) if (def.goals.filter((g) => g.t === t).length > 1) e.push('duplicate goal');
  if (f.sand + f.litter > 18) e.push('too much sand and litter');
  // tides
  if (def.tide) {
    const { high, low, dir } = def.tide;
    if (!(Number.isInteger(high) && high >= 2 && high <= 10)) e.push('high tide must last 2-10 moves');
    if (!(Number.isInteger(low) && low >= 1 && low <= 8)) e.push('low tide must last 1-8 moves');
    if (!TIDE_DIRS.includes(dir)) e.push('low tide pulls up, left or right');
  }
  if (f.rock && !def.tide) e.push('rock pools need a tide');
  // rescue
  const hasRescue = def.goals.some((g) => g.t === 'rescue');
  if (f.rescue && !hasRescue) e.push('stranded pals without a rescue goal');
  if (hasRescue && count(def, 'P')) {
    if (!['down', 'left', 'right'].includes(def.exit)) e.push('a rescue needs an exit edge');
    else {
      if (def.exit !== 'down' && def.tide?.dir !== def.exit) e.push('a side exit needs a low tide that pulls that way');
      const mask = maskOf(def);
      def.layout.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === 'P' && atExit(mask, r, c, def.exit)) e.push('a stranded pal starts at the exit'); }));
    }
    if (f.rock) e.push('rescue levels have no rock pools');
  }
  return e;
}
