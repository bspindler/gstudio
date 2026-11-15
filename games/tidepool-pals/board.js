// Tidepool Pals board rules. Pure functions, no DOM: the page renders whatever these return.
// Cells: { id, k:'pal', c, ice? }    a pal (ice = tangled in a net: fixed until a match next to it frees it)
//        { id, k:'sand' }            a sand block (fixed, breaks when a match touches it)
//        { id, k:'litter', v }       ocean litter: v 0 can, 1 plastic rings, 2 bottle (same rules as sand)
//        { id, k:'sp', s, c }        a special: s 'bomb'|'wave-h'|'wave-v'|'whirl'
//        { id, k:'lost' }            a stranded pal to rescue: not matchable, never destroyed, moves with gravity
//        { id, k:'bubble', hp }      a pal trapped in a bubble ('B'): fixed; each clear next to it cracks it, the last
//                                    crack frees the pal (counts as a rescue)
// A null cell is either empty (waiting for a refill), a hole in the level's mask, or a rock pool at high tide.

export const COLS = 7, ROWS = 8;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** Gravity directions as [dRow, dCol]: the way pieces fall. New pieces enter from the opposite edge. */
export const GRAVITY = { down: [1, 0], up: [-1, 0], left: [0, -1], right: [0, 1] };

/** Small seeded PRNG (mulberry32): same seed, same numbers. Used for boards and level generation, never rewards. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashSeed(x) {
  const s = String(x);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function counter(start = 1) { let n = start; return () => n++; }

const inb = (g, r, c) => r >= 0 && r < g.length && c >= 0 && c < g[r].length;
const isFreePal = (cell) => !!cell && cell.k === 'pal' && !cell.ice;
const isBlock = (cell) => !!cell && (cell.k === 'sand' || cell.k === 'litter');
/** Cells that never move with gravity: sand, litter and netted pals. */
export const isFixed = (cell) => isBlock(cell) || (!!cell && cell.k === 'bubble') || (!!cell && cell.k === 'pal' && !!cell.ice);
/** Clears next to a bubble that crack it before it frees its pal. */
export const BUBBLE_HP = 2;
const clone = (g) => g.map((row) => row.map((cell) => (cell ? { ...cell } : null)));

/* ---------- layout ---------- */
/** '.' pal, 'i' netted pal, 's' sand, 'l' litter, 'o' rock pool, 'P' stranded pal, 'B' bubble pal, 'x' hole. */
export function maskOf(def) { return def.layout.map((row) => [...row].map((ch) => ch !== 'x')); }
/** Rock pools: part of the board, but they only hold pieces at low tide. */
export function rockOf(def) { return def.layout.map((row) => [...row].map((ch) => ch === 'o')); }
/** The cells that can hold pieces in this phase: the mask, minus rock pools while the tide is high. */
export function activeMask(mask, rock, phase) {
  return mask.map((row, r) => row.map((m, c) => m && !(phase === 'high' && rock?.[r]?.[c])));
}

export function buildBoard(def, rng, newId, phase = 'high') {
  const colors = def.colors;
  const pick = () => Math.floor(rng() * colors);
  const g = def.layout.map((row, r) => [...row].map((ch, c) => {
    if (ch === 'x') return null;
    if (ch === 'o') return phase === 'high' ? null : { id: newId(), k: 'pal', c: pick() };
    if (ch === 's') return { id: newId(), k: 'sand' };
    if (ch === 'l') return { id: newId(), k: 'litter', v: (r * 3 + c * 2) % 3 };
    if (ch === 'P') return { id: newId(), k: 'lost' };
    if (ch === 'B') return { id: newId(), k: 'bubble', hp: BUBBLE_HP };
    if (ch === 'i') return { id: newId(), k: 'pal', c: pick(), ice: true };
    return { id: newId(), k: 'pal', c: pick() };
  }));
  if (!hasMoves(g)) shuffle(g, rng, colors, newId);
  return g;
}

/* ---------- groups ---------- */
export function group(g, r, c) {
  const start = inb(g, r, c) ? g[r][c] : null;
  if (!isFreePal(start)) return [];
  const out = [], seen = new Set(), st = [[r, c]];
  while (st.length) {
    const [y, x] = st.pop();
    const k = y * 100 + x;
    if (seen.has(k)) continue;
    seen.add(k);
    const cell = g[y][x];
    if (!isFreePal(cell) || cell.c !== start.c) continue;
    out.push([y, x]);
    for (const [dy, dx] of DIRS) if (inb(g, y + dy, x + dx)) st.push([y + dy, x + dx]);
  }
  return out;
}

export function largestGroup(g) {
  let best = [];
  const seen = new Set();
  for (let r = 0; r < g.length; r++) for (let c = 0; c < g[r].length; c++) {
    if (seen.has(r * 100 + c)) continue;
    const grp = group(g, r, c);
    for (const [y, x] of grp) seen.add(y * 100 + x);
    if (grp.length >= 2 && grp.length > best.length) best = grp;
  }
  return best;
}

/** 5-6 urchin bomb, 7-8 wave (row if the group is wider than tall, else column), 9+ whirlpool. */
export function specialForGroup(cells) {
  const n = cells.length;
  if (n >= 9) return 'whirl';
  if (n >= 7) {
    const rows = new Set(cells.map(([r]) => r)).size, cols = new Set(cells.map(([, c]) => c)).size;
    return cols >= rows ? 'wave-h' : 'wave-v';
  }
  if (n >= 5) return 'bomb';
  return null;
}

/* ---------- effects ----------
   An effect is { box?: radius, rows?: row offsets, cols?: col offsets, colors?: [c], all?: true,
   rect?: [r0, r1, c0, c1] offsets, only?: colour (limits the hit to free or netted pals of that colour) }. */
export function effectFor(sp) {
  switch (sp.s) {
    case 'bomb': return { box: 1 };
    case 'wave-h': return { rows: [0] };
    case 'wave-v': return { cols: [0] };
    case 'whirl': return { colors: [sp.c] };
  }
  return {};
}

/** The bigger effect when the player taps a special that touches other specials. */
export function comboEffect(specials) {
  const n = (pred) => specials.filter(pred).length;
  const whirls = specials.filter((s) => s.s === 'whirl');
  const bombs = n((s) => s.s === 'bomb'), waves = n((s) => s.s === 'wave-h' || s.s === 'wave-v');
  if (whirls.length >= 2) return { all: true };
  const e = {};
  if (whirls.length === 1) {
    e.colors = [whirls[0].c];
    if (bombs) e.box = 2;
    if (waves) { e.rows = [0]; e.cols = [0]; }
    return e;
  }
  if (bombs && waves) return { rows: [-1, 0, 1], cols: [-1, 0, 1] };
  if (waves) return { rows: [0], cols: [0] };
  return { box: 2 };
}

/** Every occupied cell an effect centred on (r, c) touches. Holes and empty cells are skipped. */
export function cellsInEffect(g, r, c, e) {
  const out = [];
  for (let y = 0; y < g.length; y++) for (let x = 0; x < g[y].length; x++) {
    const cell = g[y][x];
    if (!cell) continue;
    if (e.only != null && !(cell.k === 'pal' && cell.c === e.only)) continue;
    const hit = e.all
      || (e.box != null && Math.abs(y - r) <= e.box && Math.abs(x - c) <= e.box)
      || (e.rect && y - r >= e.rect[0] && y - r <= e.rect[1] && x - c >= e.rect[2] && x - c <= e.rect[3])
      || (e.rows && e.rows.includes(y - r))
      || (e.cols && e.cols.includes(x - c))
      || (e.colors && cell.k === 'pal' && e.colors.includes(cell.c));
    if (hit) out.push([y, x]);
  }
  return out;
}

/* ---------- a tap ---------- */
const K = (y, x) => y * 100 + x;
function newResult(g, kind) {
  return { ok: true, kind, grid: g, cleared: [], broke: [], freed: [], cracked: [], released: [], spawned: null, effects: [],
    recolored: [], counts: { collect: {}, sand: 0, ice: 0, litter: 0, rescue: 0 } };
}
function clearAt(res, y, x) {
  const g = res.grid, cl = g[y][x];
  g[y][x] = null;
  res.cleared.push({ r: y, c: x, cell: cl });
  if (cl.k === 'pal') res.counts.collect[cl.c] = (res.counts.collect[cl.c] || 0) + 1;
}
/** Sand and litter break, netted pals are freed (and stay). Returns true if (y, x) was an obstacle. */
function hitObstacle(res, y, x) {
  const g = res.grid, cl = g[y][x];
  if (!cl) return false;
  if (isBlock(cl)) {
    g[y][x] = null; res.broke.push({ r: y, c: x, cell: cl });
    if (cl.k === 'sand') res.counts.sand++; else res.counts.litter++;
    return true;
  }
  if (cl.k === 'bubble') {
    // Each hit cracks the bubble; the last one frees the pal inside, which swims off and counts as a rescue.
    if (cl.hp > 1) { cl.hp--; res.cracked.push({ r: y, c: x, cell: { ...cl } }); return true; }
    g[y][x] = null; res.released.push({ r: y, c: x, cell: cl }); res.counts.rescue++;
    return true;
  }
  if (cl.k === 'pal' && cl.ice) { cl.ice = false; res.freed.push({ r: y, c: x, cell: { ...cl } }); res.counts.ice++; return true; }
  return false;
}
/** Blasts: pals clear, netted pals are freed, sand and litter break, specials go off in turn, stranded pals are safe. */
function runBlasts(res, queue, done) {
  const g = res.grid;
  while (queue.length) {
    const { r: br, c: bc, effect } = queue.shift();
    for (const [y, x] of cellsInEffect(g, br, bc, effect)) {
      if (done.has(K(y, x))) continue;
      done.add(K(y, x));
      const cl = g[y][x];
      if (!cl || cl.k === 'lost') continue;
      if (hitObstacle(res, y, x)) continue;
      if (cl.k === 'sp') {
        const e = effectFor(cl);
        res.effects.push({ r: y, c: x, kind: cl.s, effect: e, color: cl.c });
        clearAt(res, y, x);
        queue.push({ r: y, c: x, effect: e });
      } else clearAt(res, y, x);
    }
  }
}

/**
 * Works out everything one tap does, on a copy of the grid.
 * Returns { ok:false } for a tap that does nothing, otherwise
 * { ok, kind:'group'|'special'|'combo', grid, cleared:[{r,c,cell}], broke:[...], freed:[...],
 *   spawned:{r,c,cell}|null, effects:[{r,c,kind,effect}], counts:{collect,sand,ice,litter} }.
 */
export function resolveTap(src, r, c, newId) {
  const cell = inb(src, r, c) ? src[r][c] : null;
  if (!cell || isBlock(cell) || cell.k === 'lost' || cell.k === 'bubble' || (cell.k === 'pal' && cell.ice)) return { ok: false };
  const g = clone(src);
  const res = newResult(g, 'group');
  const done = new Set();

  if (cell.k === 'pal') {
    const grp = group(g, r, c);
    if (grp.length < 2) return { ok: false };
    for (const [y, x] of grp) { done.add(K(y, x)); clearAt(res, y, x); }
    for (const [y, x] of grp) for (const [dy, dx] of DIRS) {
      const yy = y + dy, xx = x + dx;
      if (!inb(g, yy, xx) || done.has(K(yy, xx))) continue;
      if (hitObstacle(res, yy, xx)) done.add(K(yy, xx));
    }
    const sp = specialForGroup(grp);
    if (sp) {
      const nc = { id: newId(), k: 'sp', s: sp, c: cell.c };
      g[r][c] = nc;
      res.spawned = { r, c, cell: nc };
    }
    return res;
  }

  // A special: it combines with every special it touches (orthogonally, transitively).
  const combo = [], st = [[r, c]], seen = new Set();
  while (st.length) {
    const [y, x] = st.pop();
    if (seen.has(K(y, x))) continue;
    seen.add(K(y, x));
    const cl = g[y][x];
    if (!cl || cl.k !== 'sp') continue;
    combo.push({ r: y, c: x, cell: cl });
    for (const [dy, dx] of DIRS) if (inb(g, y + dy, x + dx)) st.push([y + dy, x + dx]);
  }
  const queue = [];
  if (combo.length >= 2) {
    res.kind = 'combo';
    const effect = comboEffect(combo.map((s) => s.cell));
    res.effects.push({ r, c, kind: 'combo', effect, parts: combo.map((s) => s.cell.s) });
    for (const s of combo) { done.add(K(s.r, s.c)); clearAt(res, s.r, s.c); }
    queue.push({ r, c, effect });
  } else {
    res.kind = 'special';
    const effect = effectFor(cell);
    res.effects.push({ r, c, kind: cell.s, effect, color: cell.c });
    done.add(K(r, c));
    clearAt(res, r, c);
    queue.push({ r, c, effect });
  }
  runBlasts(res, queue, done);
  return res;
}

/* ---------- gravity ---------- */
/**
 * Moves pals, specials and stranded pals toward `dir` along each line (columns for up and down, rows for left
 * and right) and refills from the opposite edge (mutates g). Sand, litter and netted pals are fixed; cells
 * outside the mask are skipped over, so pieces slide past them. The part of a line beyond a fixed cell refills
 * on its own. Returns the new cells with where they slide in from (one step outside the edge per new piece):
 * { spawned:[{id,r,c,fromR,fromC}] }.
 */
export function collapse(g, mask, rng, colors, newId, dir = 'down') {
  const [dr, dc] = GRAVITY[dir] || GRAVITY.down;
  const spawned = [];
  const rows = g.length, cols = g[0].length;
  const vertical = dc === 0, forward = dr + dc > 0;
  const lines = vertical ? cols : rows, len = vertical ? rows : cols;
  for (let L = 0; L < lines; L++) {
    // positions from the entry edge to the settling edge
    const segs = [[]];
    for (let k = 0; k < len; k++) {
      const t = forward ? k : len - 1 - k;
      const r = vertical ? t : L, c = vertical ? L : t;
      if (!mask[r][c]) continue;
      if (isFixed(g[r][c])) { segs.push([]); continue; }
      segs[segs.length - 1].push([r, c]);
    }
    for (const seg of segs) {
      if (!seg.length) continue;
      const movers = seg.map(([r, c]) => g[r][c]).filter(Boolean);
      const m = seg.length - movers.length;
      const [r0, c0] = seg[0];
      seg.forEach(([r, c], i) => {
        if (i < m) {
          const cell = { id: newId(), k: 'pal', c: Math.floor(rng() * colors) };
          g[r][c] = cell;
          const back = m - i;
          spawned.push({ id: cell.id, r, c, fromR: r0 - dr * back, fromC: c0 - dc * back });
        } else g[r][c] = movers[i - m];
      });
    }
  }
  return { spawned };
}

/* ---------- tides ----------
   A level's tide is { high, low, dir }: high tide for `high` moves (gravity down), then low tide for `low` moves
   (gravity `dir`: 'up', 'left' or 'right'), and round again. Turn-based only: nothing here knows about time. */
/** Where the tide stands after `made` moves: { phase, dir, left (moves until it turns), total, nextDir }. */
export function tidePhase(tide, made) {
  if (!tide) return { phase: 'high', dir: 'down', left: Infinity, total: Infinity, nextDir: null };
  const cycle = tide.high + tide.low, t = ((made % cycle) + cycle) % cycle;
  if (t < tide.high) return { phase: 'high', dir: 'down', left: tide.high - t, total: tide.high, nextDir: tide.dir };
  return { phase: 'low', dir: tide.dir, left: cycle - t, total: tide.low, nextDir: 'down' };
}
/** True when move number `made` (moves made so far, after the move) is the one that turns the tide. */
export function tideTurns(tide, made) { return !!tide && made > 0 && tidePhase(tide, made).phase !== tidePhase(tide, made - 1).phase; }

/**
 * Rising tide: pieces in rock pools wash out to sea (mutates g). Washed-out pals and specials count toward
 * collect goals of their colour (a special counts as one of its colour and does not go off).
 * Returns { washed:[{r,c,cell}], counts }.
 */
export function washOut(g, rock) {
  const washed = [], counts = { collect: {}, sand: 0, ice: 0, litter: 0 };
  for (let r = 0; r < g.length; r++) for (let c = 0; c < g[r].length; c++) {
    if (!rock[r][c] || !g[r][c]) continue;
    const cell = g[r][c];
    g[r][c] = null;
    washed.push({ r, c, cell });
    if (cell.k === 'pal' || cell.k === 'sp') counts.collect[cell.c] = (counts.collect[cell.c] || 0) + 1;
  }
  return { washed, counts };
}

/**
 * Turns the tide (mutates g): on a rising tide, rock pools wash out first; then everything slides toward the
 * new gravity and the board refills. Returns { phase, dir, washed, counts, spawned }.
 */
export function turnTide(g, mask, rock, phase, dir, rng, colors, newId) {
  const out = phase === 'high' ? washOut(g, rock) : { washed: [], counts: { collect: {}, sand: 0, ice: 0, litter: 0 } };
  const { spawned } = collapse(g, activeMask(mask, rock, phase), rng, colors, newId, dir);
  return { phase, dir, washed: out.washed, counts: out.counts, spawned };
}

/* ---------- rescue ---------- */
/** True when nothing in the mask lies past (r, c) toward the exit: the pal is at the open-water edge. */
export function atExit(mask, r, c, exit) {
  const [dr, dc] = GRAVITY[exit];
  for (let y = r + dr, x = c + dc; y >= 0 && y < mask.length && x >= 0 && x < mask[0].length; y += dr, x += dc) {
    if (mask[y][x]) return false;
  }
  return true;
}
/** Stranded pals that reached the exit edge swim off (mutates g). Returns [{r,c,cell}]. */
export function rescueLost(g, mask, exit) {
  const out = [];
  if (!exit) return out;
  for (let r = 0; r < g.length; r++) for (let c = 0; c < g[r].length; c++) {
    const cell = g[r][c];
    if (cell?.k === 'lost' && atExit(mask, r, c, exit)) { g[r][c] = null; out.push({ r, c, cell }); }
  }
  return out;
}

/**
 * Safety net for bubble rescue goals (mutates g): if fewer bubble pals are on the board than the goal still needs
 * (missing at level start, or lost in a collapse), a fresh one is placed where the level put it, or on the nearest
 * free pal. Only for levels with bubbles and no stranded pals. Returns [{r,c,cell}] for the bubbles placed.
 */
export function ensureBubbles(g, def, mask, p) {
  const placed = [];
  if (countIn(def, 'B') === 0 || countIn(def, 'P') > 0) return placed;
  const rescue = goalStatus(def, p).find((s) => s.t === 'rescue');
  if (!rescue || rescue.done) return placed;
  let onBoard = 0;
  for (const row of g) for (const cell of row) if (cell?.k === 'bubble') onBoard++;
  const homes = [];
  def.layout.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === 'B') homes.push([r, c]); }));
  for (let missing = rescue.need - rescue.got - onBoard; missing > 0; missing--) {
    const spots = [];
    for (let r = 0; r < g.length; r++) for (let c = 0; c < g[r].length; c++) if (mask[r][c] && isFreePal(g[r][c])) spots.push([r, c]);
    if (!spots.length) break;
    const [hr, hc] = homes[0] || [0, 0];
    spots.sort((a, b) => Math.abs(a[0] - hr) + Math.abs(a[1] - hc) - Math.abs(b[0] - hr) - Math.abs(b[1] - hc));
    const [r, c] = spots[0];
    const cell = { id: Math.max(0, ...g.flat().map((x) => x?.id ?? 0)) + 1, k: 'bubble', hp: BUBBLE_HP };
    g[r][c] = cell;
    placed.push({ r, c, cell });
  }
  return placed;
}

/* ---------- moves and shuffles ---------- */
export function hasMoves(g) {
  for (let r = 0; r < g.length; r++) for (let c = 0; c < g[r].length; c++) {
    const cell = g[r][c];
    if (!cell) continue;
    if (cell.k === 'sp') return true;
    if (!isFreePal(cell)) continue;
    const right = g[r][c + 1], down = g[r + 1]?.[c];
    if (isFreePal(right) && right.c === cell.c) return true;
    if (isFreePal(down) && down.c === cell.c) return true;
  }
  return false;
}

/** Recolours free pals until there is a move. If that cannot work (almost no free pals), a pal becomes a bomb. */
export function shuffle(g, rng, colors, newId) {
  const free = [];
  for (let r = 0; r < g.length; r++) for (let c = 0; c < g[r].length; c++) if (isFreePal(g[r][c])) free.push([r, c]);
  for (let tries = 0; tries < 60; tries++) {
    for (const [r, c] of free) g[r][c].c = Math.floor(rng() * colors);
    if (hasMoves(g)) return;
  }
  for (const [r, c] of free) {
    for (const [dy, dx] of [[0, 1], [1, 0]]) {
      const o = g[r + dy]?.[c + dx];
      if (isFreePal(o)) { o.c = g[r][c].c; return; }
    }
  }
  if (free.length) { const [r, c] = free[0]; g[r][c] = { id: newId(), k: 'sp', s: 'bomb', c: g[r][c].c }; }
}

/* ---------- helpers: your pals in play ----------
   Each pal charges by clearing pieces of its colour (tc), then the player taps it to use its ability once.
   Charge needs scale with rarity; abilities within a rarity are roughly equal. Marlo's bombs use the level's
   seeded board RNG: abilities are gameplay, never a reward. */
export const ABILITIES = {
  pebbin: { name: 'Shell Bash', tc: 1, charge: 10, target: false, desc: 'Breaks the 3 lowest blockers: litter, sand or nets.' },
  fizz: { name: 'Fizz Pop', tc: 2, charge: 10, target: true, desc: 'Pops a 2x2 square where you tap.' },
  bloop: { name: 'Ink Cloud', tc: 3, charge: 10, target: true, desc: 'Inks a 2x2 square into the colour you tap.' },
  tango: { name: 'Twirl', tc: 0, charge: 10, target: true, desc: 'Turns a plus shape into the colour you tap.' },
  gloam: { name: 'Lure', tc: 4, charge: 10, target: true, desc: 'Clears every pal of the tapped colour in its row and column.' },
  wisp: { name: 'Glow Up', tc: 2, charge: 10, target: true, desc: 'Turns the tapped pal into an urchin bomb.' },
  snapjaw: { name: 'Snap', tc: 0, charge: 14, target: true, desc: 'Clears the column you tap.' },
  spindle: { name: 'Spike Burst', tc: 4, charge: 14, target: true, desc: 'Blasts a 3x3 square where you tap.' },
  lumen: { name: 'Bright Idea', tc: 2, charge: 14, target: false, desc: 'Lights up the best move. That move counts double.' },
  marlo: { name: 'Urchin Party', tc: 1, charge: 18, target: false, desc: 'Turns 3 pals into urchin bombs.' },
  coralie: { name: 'Royal Cross', tc: 0, charge: 18, target: true, desc: 'Clears the row and column you tap.' },
  abyssa: { name: 'Deep Whirl', tc: 3, charge: 18, target: true, desc: 'Turns the tapped pal into a whirlpool.' },
};
/** Charge a helper gains from one move's counts (pals of its colour cleared or washed out). */
export function helperCharge(counts, id) { const a = ABILITIES[id]; return a ? counts.collect?.[a.tc] || 0 : 0; }
/** A copy of counts with collect doubled (Lumen's lit move). */
export function doubleCounts(counts) {
  const collect = {};
  for (const [c, n] of Object.entries(counts.collect || {})) collect[c] = n * 2;
  return { ...counts, collect };
}

/**
 * Uses a helper's ability on a copy of the grid. Targeted abilities need (r, c); others ignore it.
 * Returns { ok:false } when it would do nothing, otherwise the same shape as resolveTap with kind 'helper',
 * plus recolored:[{r,c,cell}], highlight:[[r,c]] and double:true for Lumen.
 */
export function applyAbility(src, id, r, c, rng, newId) {
  const ab = ABILITIES[id];
  if (!ab) return { ok: false };
  const g = clone(src);
  const res = newResult(g, 'helper');
  res.helper = id;
  const at = inb(g, r, c) ? g[r][c] : null;
  if (ab.target && !inb(g, r, c)) return { ok: false };
  const blast = (effect) => {
    const total = () => res.cleared.length + res.broke.length + res.freed.length + res.cracked.length + res.released.length;
    const before = total();
    res.effects.push({ r, c, kind: 'helper', effect });
    runBlasts(res, [{ r, c, effect }], new Set());
    return total() > before;
  };
  const recolor = (cells, colour) => {
    for (const [y, x] of cells) {
      const cl = inb(g, y, x) ? g[y][x] : null;
      if (!isFreePal(cl) || cl.c === colour) continue;
      cl.c = colour;
      res.recolored.push({ r: y, c: x, cell: { ...cl } });
    }
    return res.recolored.length > 0;
  };
  const convert = (s) => {
    if (!isFreePal(at)) return false;
    const nc = { id: newId(), k: 'sp', s, c: at.c };
    g[r][c] = nc;
    res.cleared.push({ r, c, cell: at });
    res.spawned = { r, c, cell: nc };
    return true;
  };
  let ok = false;
  switch (id) {
    case 'pebbin': {
      const blocks = [];
      for (let y = 0; y < g.length; y++) for (let x = 0; x < g[y].length; x++) if (isFixed(g[y][x])) blocks.push([y, x]);
      blocks.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      for (const [y, x] of blocks.slice(0, 3)) hitObstacle(res, y, x);
      ok = blocks.length > 0;
      break;
    }
    case 'fizz': {
      const r0 = Math.min(r, g.length - 2), c0 = Math.min(c, g[0].length - 2);
      ok = blast({ rect: [r0 - r, r0 - r + 1, c0 - c, c0 - c + 1] });
      break;
    }
    case 'bloop': {
      if (!isFreePal(at)) break;
      const r0 = Math.min(r, g.length - 2), c0 = Math.min(c, g[0].length - 2);
      ok = recolor([[r0, c0], [r0, c0 + 1], [r0 + 1, c0], [r0 + 1, c0 + 1]], at.c);
      break;
    }
    case 'tango':
      if (!isFreePal(at)) break;
      ok = recolor(DIRS.map(([dy, dx]) => [r + dy, c + dx]), at.c);
      break;
    case 'gloam':
      if (!isFreePal(at)) break;
      ok = blast({ rows: [0], cols: [0], only: at.c });
      break;
    case 'wisp': ok = convert('bomb'); break;
    case 'abyssa': ok = convert('whirl'); break;
    case 'snapjaw': ok = blast({ cols: [0] }); break;
    case 'spindle': ok = blast({ box: 1 }); break;
    case 'coralie': ok = blast({ rows: [0], cols: [0] }); break;
    case 'lumen': {
      const best = largestGroup(g);
      if (!best.length) break;
      res.highlight = best; res.double = true; ok = true;
      break;
    }
    case 'marlo': {
      const free = [];
      for (let y = 0; y < g.length; y++) for (let x = 0; x < g[y].length; x++) if (isFreePal(g[y][x])) free.push([y, x]);
      const picks = [];
      while (picks.length < 3 && free.length) picks.push(free.splice(Math.floor(rng() * free.length), 1)[0]);
      res.made = [];
      for (const [y, x] of picks) {
        const old = g[y][x], nc = { id: newId(), k: 'sp', s: 'bomb', c: old.c };
        g[y][x] = nc;
        res.cleared.push({ r: y, c: x, cell: old });
        res.made.push({ r: y, c: x, cell: nc });
      }
      ok = picks.length > 0;
      break;
    }
  }
  // Converting a pal (Wisp, Abyssa, Marlo) turns it into a special: listed in cleared for the page, never counted.
  return ok ? res : { ok: false };
}

/* ---------- goals ---------- */
export function newProgress() { return { collect: {}, sand: 0, ice: 0, litter: 0, rescue: 0 }; }
export function addProgress(p, counts) {
  for (const [c, n] of Object.entries(counts.collect || {})) p.collect[c] = (p.collect[c] || 0) + n;
  p.sand += counts.sand || 0;
  p.ice += counts.ice || 0;
  p.litter = (p.litter || 0) + (counts.litter || 0);
  p.rescue = (p.rescue || 0) + (counts.rescue || 0);
  return p;
}
const countIn = (def, ch) => def.layout.reduce((a, row) => a + [...row].filter((x) => x === ch).length, 0);
/**
 * One row per goal: { t, c?, need, got, done }. Sand and litter mean all of it; ice means `n` netted pals
 * (default all); rescue means `n` stranded pals (default all).
 */
export function goalStatus(def, p) {
  return def.goals.map((goal) => {
    let need, got;
    if (goal.t === 'collect') { need = goal.n; got = p.collect[goal.c] || 0; }
    else if (goal.t === 'sand') { need = countIn(def, 's'); got = p.sand; }
    else if (goal.t === 'litter') { need = countIn(def, 'l'); got = p.litter || 0; }
    else if (goal.t === 'rescue') { need = goal.n ?? countIn(def, 'P') + countIn(def, 'B'); got = p.rescue || 0; }
    else { need = goal.n ?? countIn(def, 'i'); got = p.ice; }
    got = Math.min(got, need);
    return { ...goal, need, got, done: got >= need };
  });
}
export function goalsMet(def, p) { return goalStatus(def, p).every((g) => g.done); }
export function starsFor(movesLeft, moves) {
  const f = movesLeft / moves;
  return f >= 0.25 ? 3 : f >= 0.1 ? 2 : 1;
}
