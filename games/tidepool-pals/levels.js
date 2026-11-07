// Tidepool Pals levels. Pure data and a seeded generator, no DOM.
// Layout: 8 rows of 7 characters. '.' pal, 'i' frozen pal, 's' sand, 'x' hole (not part of the pool).
// Goals: { t:'collect', c, n } (colour index), { t:'sand' } (clear all of it), { t:'ice', n? } (free n pals, default all).
import { COLS, ROWS, hashSeed, mulberry32 } from './board.js';

const FULL = ['.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......'];
const L = (n, moves, colors, goals, layout = FULL, intro) => ({ n, moves, colors, goals, layout, ...(intro ? { intro } : {}) });
const C = (c, n) => ({ t: 'collect', c, n });
const SAND = { t: 'sand' };
const ICE = (n) => ({ t: 'ice', n });

/* Hand-authored 1-20: one new idea at a time. Colours: 0 Coral, 1 Sunstar, 2 Droplet, 3 Gem, 4 Kelp. */
export const AUTHORED = [
  L(1, 18, 4, [C(0, 12)], FULL, 'Tap two or more matching pals that touch.'),
  L(2, 20, 4, [C(1, 18)], FULL, 'Clear 5 or more at once to make an urchin bomb. Tap it to blast the pals around it.'),
  L(3, 22, 4, [C(0, 10), C(2, 10)], FULL, 'Two goals this time. Fill both bars to win.'),
  L(4, 20, 4, [SAND],
    ['.......', '.......', '.......', '.......', '.......', '.......', '..sss..', '.sssss.'],
    'Sand! Clear pals right next to sand to break it. Break all the sand to win.'),
  L(5, 22, 4, [C(2, 22)],
    ['x.....x', '.......', '.......', '.......', '.......', '.......', '.......', 'x.....x'],
    'Pools come in all shapes. Clear 7 or more for a wave: it sweeps a whole row or column.'),
  L(6, 26, 4, [SAND, C(3, 14)],
    ['x.....x', '.......', '.......', '.......', '.......', 'ss...ss', 's.....s', 'ss...ss']),
  L(7, 22, 5, [ICE(4)],
    ['.......', '.......', '.......', '.i...i.', '.......', '.i...i.', '.......', '.......'],
    'Frozen pals! Clear pals next to the ice to free them. Frozen pals stay put until they thaw.'),
  L(8, 24, 5, [C(1, 24)], FULL, 'Clear 9 or more for a whirlpool: it swirls away every pal of its colour.'),
  L(9, 26, 5, [ICE(4), SAND],
    ['.......', '.......', '..i.i..', '.......', '..i.i..', '.......', 'sss.sss', '.......']),
  L(10, 26, 5, [C(0, 16), C(3, 16)],
    ['.......', 'x.....x', 'xx...xx', 'xx...xx', 'x.....x', '.......', '.......', '.......'],
    'Tap a special that touches another special to combine them into a bigger blast.'),
  L(11, 26, 5, [SAND],
    ['x.....x', '.......', '.......', '.......', 's.....s', 'ss...ss', 'sss.sss', 'x.....x']),
  L(12, 26, 5, [ICE(8), C(2, 18)],
    ['.......', '.......', '..iii..', '..i.i..', '..iii..', '.......', '.......', '.......']),
  L(13, 28, 5, [C(0, 15), C(4, 15), SAND],
    ['.......', '.......', '.......', '.......', '.......', '.......', 's.....s', 'ss...ss']),
  L(14, 26, 5, [C(3, 28)],
    ['.......', '.......', '.......', '..xxx..', '..xxx..', '.......', '.......', '.......']),
  L(15, 26, 5, [ICE(10)],
    ['.......', 'i.....i', '.i...i.', '...i...', '...i...', '.i...i.', 'i.....i', '.......']),
  L(16, 28, 5, [SAND, ICE(4)],
    ['.......', '.......', '.i...i.', '.......', '.i...i.', '.......', 'ss...ss', 'sss.sss']),
  L(17, 26, 5, [C(1, 14), C(3, 14)],
    ['xx...xx', 'x.....x', '.......', '.......', '.......', '.......', 'x.....x', 'xx...xx']),
  L(18, 28, 5, [SAND, C(2, 18)],
    ['x.....x', '.......', '.......', 's.....s', 'ss...ss', '.......', '.......', 'x.....x']),
  L(19, 28, 5, [ICE(6), C(0, 18)],
    ['.......', '.x...x.', '..i.i..', '...i...', '..i.i..', '.x...x.', '...i...', '.......']),
  L(20, 32, 5, [SAND, ICE(4), C(4, 16)],
    ['x.....x', '.......', '.i...i.', '.......', '.i...i.', '.......', 'ss...ss', 'sss.sss'],
    'A big one to finish the first stretch: sand, ice and a colour goal all at once.'),
];

/* ---------- measuring a level ---------- */
const count = (def, ch) => def.layout.reduce((a, row) => a + [...row].filter((x) => x === ch).length, 0);
export function features(def) {
  const collectGoals = def.goals.filter((g) => g.t === 'collect').length;
  return { sand: count(def, 's'), ice: count(def, 'i'), holes: count(def, 'x'), collectGoals, goals: def.goals.length, colors: def.colors };
}
/** Rough number of moves the goals take for a typical player. */
function workload(def) {
  const f = features(def);
  const parts = def.goals.map((g) => g.t === 'collect' ? g.n / 2.4 : g.t === 'sand' ? f.sand : 1.1 * (g.n ?? f.ice));
  const max = Math.max(...parts), sum = parts.reduce((a, b) => a + b, 0);
  return max + 0.6 * (sum - max);
}
/** Higher is harder: work per move, made harder by holes (fewer matches) and a fifth colour. */
export function difficulty(def) {
  const f = features(def);
  return (workload(def) * (1 + (f.holes / (ROWS * COLS)) * 0.6) * (def.colors === 5 ? 1.15 : 1)) / def.moves;
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
  const kinds = ['collect', 'sand', 'ice'];
  for (let i = kinds.length - 1; i > 0; i--) { const j = int(0, i); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
  let k = 1;
  if (rng() < Math.min(0.85, 0.3 + 0.12 * tier)) k++;
  if (tier >= 3 && rng() < Math.min(0.6, 0.12 * (tier - 2))) k++;
  const chosen = kinds.slice(0, k);

  const goals = [];
  // Obstacles never crowd out the plain pals you match with; three-goal levels get lighter obstacles.
  let budget = cells.flat().filter((ch) => ch === '.').length - 26;
  const lighten = (x) => Math.min(budget, k === 3 ? Math.round(x * 0.7) : x);
  // 3. Sand fills up from the bottom in mirrored pairs; it can also show up as a plain obstacle later on.
  const wantSand = lighten(chosen.includes('sand') ? Math.min(16, 6 + Math.floor(tier * 1.1) + int(0, 3))
    : tier >= 2 && rng() < 0.35 ? int(3, 6) : 0);
  let sand = 0;
  const band = tier >= 4 && rng() < 0.4 ? [4, 3, 5] : [7, 6, 5, 4];
  for (const r of band) {
    for (let c = 0; c <= 3 && sand < wantSand; c++) {
      const m = COLS - 1 - c;
      if (!open(r, c) || !open(r, m)) continue;
      if (c === m) { cells[r][c] = 's'; sand++; } else if (wantSand - sand >= 2) { cells[r][c] = 's'; cells[r][m] = 's'; sand += 2; }
    }
  }
  budget -= sand;
  if (chosen.includes('sand') && sand > 0) goals.push(SAND);

  // 4. Frozen pals in mirrored pairs in the middle rows.
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

  const def = { n, moves: 0, colors: 5, goals, layout: cells.map((row) => row.join('')) };
  // 6. Moves: the goals' workload times a slack that tightens tier by tier.
  const slack = Math.max(1.12, 1.55 - 0.045 * tier);
  const holesFactor = 1 + (features(def).holes / (ROWS * COLS)) * 0.6;
  def.moves = Math.max(16, Math.min(40, Math.round(workload(def) * holesFactor * slack) + 5));
  return def;
}

export function levelDef(n) { return n >= 1 && n <= AUTHORED.length ? AUTHORED[n - 1] : generateLevel(n); }

/* ---------- validation: what makes a level playable at all ---------- */
export function validateLevel(def) {
  const e = [];
  if (!Number.isInteger(def.n) || def.n < 1) e.push('n must be a positive integer');
  if (!Array.isArray(def.layout) || def.layout.length !== ROWS) { e.push(`layout needs ${ROWS} rows`); return e; }
  def.layout.forEach((row, r) => {
    if (row.length !== COLS) e.push(`row ${r} needs ${COLS} cells`);
    if (/[^.six]/.test(row)) e.push(`row ${r} has an unknown cell`);
  });
  const f = features(def);
  const playable = ROWS * COLS - f.holes, plain = count(def, '.');
  if (playable < 36) e.push('too few playable cells');
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
  if (!(def.moves >= 14 && def.moves <= 45)) e.push('moves out of range');
  if (!def.goals.length || def.goals.length > 3) e.push('1 to 3 goals');
  const cs = def.goals.filter((g) => g.t === 'collect').map((g) => g.c);
  if (new Set(cs).size !== cs.length) e.push('collect goals must use different colours');
  for (const g of def.goals) {
    if (g.t === 'collect') {
      if (!(g.c >= 0 && g.c < def.colors)) e.push('collect colour not in play');
      if (!(g.n >= 1 && g.n <= def.moves * 2.5)) e.push('collect target out of reach');
    } else if (g.t === 'sand') { if (f.sand < 1) e.push('sand goal without sand'); }
    else if (g.t === 'ice') { if (f.ice < 1 || (g.n ?? f.ice) > f.ice || (g.n ?? 1) < 1) e.push('ice goal does not match the frozen pals'); }
    else e.push('unknown goal');
  }
  if (def.goals.filter((g) => g.t === 'sand').length > 1 || def.goals.filter((g) => g.t === 'ice').length > 1) e.push('duplicate goal');
  if (f.sand > 18) e.push('too much sand');
  return e;
}
