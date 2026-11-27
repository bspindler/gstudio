// Gearhold: a faint brass arc at the screen edge facing where a hit came from. Pure helpers only; the arc is
// drawn by index.html and never changes timing, damage, maps or enemies.

export const HIT_ARC_FADE = 0.4; // seconds from first sight to gone

/** Remaining 0..1 life of the arc after `dt` more seconds. */
export function hitArcLife(life, dt) {
  return Math.max(0, life - dt / HIT_ARC_FADE);
}

/** Opacity for the arc from its life: faint, brass, easing out. */
export function hitArcOpacity(life) {
  const l = Math.min(1, Math.max(0, life));
  return 0.55 * l * l;
}
