// Faint pale footprints left on the moonlit path by creatures that walk, fading in a second or two.
// Pure bookkeeping (no drawing, no DOM) so both renderers share it and it can be tested.
// Positions are in tiles, time is in seconds. Flyers (moths, fireflies, wisps) leave none.
export const WALKERS = new Set(['beetle', 'toad', 'mossback', 'mole', 'burrower']);
export const STRIDE = 0.4; // tiles walked between prints
export const SIDE = 0.1; // sideways offset of each foot, in tiles
export const CAP = 90; // most prints alive at once, so many creatures stay cheap

export function createFootprints({ life = 1.8, cap = CAP } = {}) {
  let prints = [];
  const last = new Map(); // enemy id -> { x, y, d, side }

  return {
    life,
    // call once per drawn frame for each creature, with its drawn position
    step(e, x, y, t) {
      if (!WALKERS.has(e.type) || e.under) { last.delete(e.id); return; }
      const l = last.get(e.id);
      if (!l) { last.set(e.id, { x, y, d: 0, side: e.id % 2 ? 1 : -1 }); return; }
      const dx = x - l.x, dy = y - l.y, m = Math.hypot(dx, dy);
      if (m < 1e-4) return;
      l.x = x; l.y = y; l.d += m;
      if (l.d < STRIDE) return;
      l.d = 0;
      l.side = -l.side;
      const h = Math.atan2(dy, dx);
      prints.push({ x: x - Math.sin(h) * SIDE * l.side, y: y + Math.cos(h) * SIDE * l.side, h, t });
      if (prints.length > cap) prints.shift();
    },
    // drop old prints; call once per frame after stepping. Also copes with the clock restarting.
    prune(t) {
      prints = prints.filter((p) => t >= p.t && t - p.t < life);
      if (last.size > 400) last.clear();
    },
    // 1 when new, 0 when gone
    fade(p, t) { const k = Math.max(0, 1 - (t - p.t) / life); return k * k; },
    get prints() { return prints; },
    clear() { prints = []; last.clear(); },
  };
}
