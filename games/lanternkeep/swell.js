// Lanternkeep: a soft, brief warm swell of the lantern's light when the last creature of a wave falls.
// Purely visual; shared by the 3D and flat renderers. Reduced motion gets a gentler, steadier swell.
export const SWELL_SECONDS = 2.4;

export function createSwell() {
  let busy = false, start = -Infinity, lastT = -Infinity;
  return {
    // call once per drawn frame; returns 0..1 swell strength
    update(g, t, reduced = false) {
      if (t < lastT) start = -Infinity; // time restarted (new level)
      lastT = t;
      const fighting = g.phase === 'wave' && (g.queue.length > 0 || g.enemies.length > 0);
      if (busy && !fighting && (g.phase === 'wave' || g.phase === 'won')) start = t;
      busy = fighting;
      const q = (t - start) / SWELL_SECONDS;
      if (q < 0 || q >= 1) return 0;
      const rise = Math.min(1, q / 0.25), fall = 1 - (q - 0.25) / 0.75;
      const k = q < 0.25 ? rise * rise * (3 - 2 * rise) : fall * fall * (3 - 2 * fall);
      return reduced ? k * 0.6 : k;
    },
  };
}
