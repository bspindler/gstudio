// Tidepool Pals board rules. Pure functions, no DOM: the page renders whatever these return.
// Cells: { id, k:'pal', c, ice? } | { id, k:'sand' } | { id, k:'sp', s:'bomb'|'wave-h'|'wave-v'|'whirl', c }.
// A null cell is either empty (waiting for a refill) or a hole in the level's mask.

export const COLS = 7, ROWS = 8;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

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
const clone = (g) => g.map((row) => row.map((cell) => (cell ? { ...cell } : null)));

/* ---------- layout ---------- */
/** '.' pal, 'i' frozen pal, 's' sand, 'x' hole. */
export function maskOf(def) { return def.layout.map((row) => [...row].map((ch) => ch !== 'x')); }

export function buildBoard(def, rng, newId) {
  const colors = def.colors;
  const pick = () => Math.floor(rng() * colors);
  const g = def.layout.map((row) => [...row].map((ch) => {
    if (ch === 'x') return null;
    if (ch === 's') return { id: newId(), k: 'sand' };
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
   An effect is { box?: radius, rows?: row offsets, cols?: col offsets, colors?: [c], all?: true }. */
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
    const hit = e.all
      || (e.box != null && Math.abs(y - r) <= e.box && Math.abs(x - c) <= e.box)
      || (e.rows && e.rows.includes(y - r))
      || (e.cols && e.cols.includes(x - c))
      || (e.colors && cell.k === 'pal' && e.colors.includes(cell.c));
    if (hit) out.push([y, x]);
  }
  return out;
}

const effectKind = (sp) => sp.s;

/* ---------- a tap ---------- */
/**
 * Works out everything one tap does, on a copy of the grid.
 * Returns { ok:false } for a tap that does nothing, otherwise
 * { ok, kind:'group'|'special'|'combo', grid, cleared:[{r,c,cell}], broke:[...], freed:[...],
 *   spawned:{r,c,cell}|null, effects:[{r,c,kind,effect}], counts:{collect,sand,ice} }.
 */
export function resolveTap(src, r, c, newId) {
  const cell = inb(src, r, c) ? src[r][c] : null;
  if (!cell || cell.k === 'sand' || (cell.k === 'pal' && cell.ice)) return { ok: false };
  const g = clone(src);
  const res = { ok: true, kind: 'group', grid: g, cleared: [], broke: [], freed: [], spawned: null, effects: [],
    counts: { collect: {}, sand: 0, ice: 0 } };
  const done = new Set();
  const K = (y, x) => y * 100 + x;

  const clearAt = (y, x) => {
    const cl = g[y][x];
    g[y][x] = null;
    res.cleared.push({ r: y, c: x, cell: cl });
    if (cl.k === 'pal') res.counts.collect[cl.c] = (res.counts.collect[cl.c] || 0) + 1;
  };
  const hitObstacle = (y, x) => {
    const cl = g[y][x];
    if (!cl) return false;
    if (cl.k === 'sand') { g[y][x] = null; res.broke.push({ r: y, c: x, cell: cl }); res.counts.sand++; return true; }
    if (cl.k === 'pal' && cl.ice) { cl.ice = false; res.freed.push({ r: y, c: x, cell: { ...cl } }); res.counts.ice++; return true; }
    return false;
  };

  if (cell.k === 'pal') {
    const grp = group(g, r, c);
    if (grp.length < 2) return { ok: false };
    for (const [y, x] of grp) { done.add(K(y, x)); clearAt(y, x); }
    for (const [y, x] of grp) for (const [dy, dx] of DIRS) {
      const yy = y + dy, xx = x + dx;
      if (!inb(g, yy, xx) || done.has(K(yy, xx))) continue;
      if (hitObstacle(yy, xx)) done.add(K(yy, xx));
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
    for (const s of combo) { done.add(K(s.r, s.c)); clearAt(s.r, s.c); }
    queue.push({ r, c, effect });
  } else {
    res.kind = 'special';
    const effect = effectFor(cell);
    res.effects.push({ r, c, kind: effectKind(cell), effect, color: cell.c });
    done.add(K(r, c));
    clearAt(r, c);
    queue.push({ r, c, effect });
  }
  // Blasts: pals clear, frozen pals thaw (and stay), sand breaks, other specials go off in turn.
  while (queue.length) {
    const { r: br, c: bc, effect } = queue.shift();
    for (const [y, x] of cellsInEffect(g, br, bc, effect)) {
      if (done.has(K(y, x))) continue;
      done.add(K(y, x));
      const cl = g[y][x];
      if (hitObstacle(y, x)) continue;
      if (cl.k === 'sp') {
        const e = effectFor(cl);
        res.effects.push({ r: y, c: x, kind: effectKind(cl), effect: e, color: cl.c });
        clearAt(y, x);
        queue.push({ r: y, c: x, effect: e });
      } else clearAt(y, x);
    }
  }
  return res;
}

/* ---------- gravity ---------- */
/**
 * Drops pals and specials down each column and refills from the top (mutates g). Sand and frozen pals are
 * fixed; holes are skipped over, so pals fall past them. The part of a column under a fixed cell refills on
 * its own. Returns the new cells with the row they fall from: { spawned:[{id,r,c,fromR}] }.
 */
export function collapse(g, mask, rng, colors, newId) {
  const spawned = [];
  const rows = g.length, cols = g[0].length;
  for (let c = 0; c < cols; c++) {
    const segs = [[]];
    for (let r = 0; r < rows; r++) {
      if (!mask[r][c]) continue;
      const cell = g[r][c];
      if (cell && (cell.k === 'sand' || (cell.k === 'pal' && cell.ice))) { segs.push([]); continue; }
      segs[segs.length - 1].push(r);
    }
    for (const seg of segs) {
      if (!seg.length) continue;
      const movers = seg.map((r) => g[r][c]).filter(Boolean);
      const m = seg.length - movers.length;
      seg.forEach((r, i) => {
        if (i < m) {
          const cell = { id: newId(), k: 'pal', c: Math.floor(rng() * colors) };
          g[r][c] = cell;
          spawned.push({ id: cell.id, r, c, fromR: seg[0] - m + i });
        } else g[r][c] = movers[i - m];
      });
    }
  }
  return { spawned };
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

/* ---------- goals ---------- */
export function newProgress() { return { collect: {}, sand: 0, ice: 0 }; }
export function addProgress(p, counts) {
  for (const [c, n] of Object.entries(counts.collect || {})) p.collect[c] = (p.collect[c] || 0) + n;
  p.sand += counts.sand || 0;
  p.ice += counts.ice || 0;
  return p;
}
const countIn = (def, ch) => def.layout.reduce((a, row) => a + [...row].filter((x) => x === ch).length, 0);
/** One row per goal: { t, c?, need, got, done }. Sand means all of it; ice means `n` frozen pals (default all). */
export function goalStatus(def, p) {
  return def.goals.map((goal) => {
    let need, got;
    if (goal.t === 'collect') { need = goal.n; got = p.collect[goal.c] || 0; }
    else if (goal.t === 'sand') { need = countIn(def, 's'); got = p.sand; }
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
