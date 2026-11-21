// A soft, brief swell of the path's moonlit glow when a wave begins, so players see the route
// the creatures will walk. Visual only: reads the game state, never changes it.
// Pure bookkeeping (no drawing, no DOM) so both renderers share it and it can be tested.
export const SWELL_SECONDS = 2.6; // how long the swell lasts

// 0..1: rises quickly, then eases out smoothly
export function swellShape(age, len = SWELL_SECONDS) {
  if (!(age >= 0) || age >= len) return 0;
  const rise = 0.35;
  if (age < rise) { const q = age / rise; return q * q * (3 - 2 * q); }
  const q = (age - rise) / (len - rise);
  return (1 - q) * (1 - q);
}

export function createRouteGlow({ len = SWELL_SECONDS } = {}) {
  let seen = null; // waveIndex last seen while a wave was running
  let start = -Infinity;
  return {
    len,
    // call once per drawn frame; returns the extra glow strength, 0 when idle
    update(g, t) {
      if (g.phase === 'wave') {
        if (g.waveIndex !== seen) { seen = g.waveIndex; start = t; }
      } else {
        seen = null;
      }
      if (t < start) start = -Infinity; // the clock restarted
      return swellShape(t - start, len);
    },
  };
}
