// Ghost runs: sample the runner at a fixed rate, store compactly, replay with interpolation.
// No DOM; tested in packages/core/test/hyperline-meta.test.ts.

export const GHOST_HZ = 20;
/** About five minutes of running. */
export const GHOST_MAX = 6000;

export function createGhostRecorder() {
  return { xs: [], ys: [], fl: [], next: 0 };
}

/** Call every sim step with the run clock t (seconds) and the runner's x, y and flip state. */
export function recordGhost(g, t, x, y, flip) {
  while (t >= g.next / GHOST_HZ - 1e-9 && g.xs.length < GHOST_MAX) {
    g.xs.push(x); g.ys.push(y); g.fl.push(flip ? 1 : 0);
    g.next++;
  }
}

/** Compact, JSON-safe ghost: x as deltas in centi-units, y in centi-units, flip as toggle indices. */
export function finishGhost(g) {
  const dx = [], ys = [], fl = [];
  let prev = 0, f = 0;
  for (let i = 0; i < g.xs.length; i++) {
    const xi = Math.round(g.xs[i] * 100);
    dx.push(xi - prev); prev = xi;
    ys.push(Math.round(g.ys[i] * 100));
    if (g.fl[i] !== f) { fl.push(i); f = g.fl[i]; }
  }
  return { hz: GHOST_HZ, n: g.xs.length, dx, ys, fl };
}

function decoded(g) {
  if (!g._x) {
    const x = new Float64Array(g.n), flip = new Uint8Array(g.n);
    let acc = 0, f = 0, k = 0;
    for (let i = 0; i < g.n; i++) {
      acc += g.dx[i]; x[i] = acc / 100;
      if (g.fl[k] === i) { f = 1 - f; k++; }
      flip[i] = f;
    }
    Object.defineProperty(g, '_x', { value: { x, flip }, enumerable: false });
  }
  return g._x;
}

/** Ghost position at run time t, or null once the ghost's run has ended. */
export function ghostAt(g, t) {
  if (!g || !g.n) return null;
  const f = t * g.hz;
  if (f < 0 || f > g.n - 1) return null;
  const { x, flip } = decoded(g);
  const i = Math.min(g.n - 1, Math.floor(f)), j = Math.min(g.n - 1, i + 1), a = f - i;
  return { x: x[i] + (x[j] - x[i]) * a, y: (g.ys[i] + (g.ys[j] - g.ys[i]) * a) / 100, flip: flip[i] === 1 };
}

/** Does this look like a ghost we wrote? Guards against damaged storage. */
export function validGhost(g) {
  return !!g && typeof g === 'object' && Number.isInteger(g.n) && g.n > 0 && g.n <= GHOST_MAX && g.hz === GHOST_HZ
    && Array.isArray(g.dx) && g.dx.length === g.n && Array.isArray(g.ys) && g.ys.length === g.n && Array.isArray(g.fl);
}
