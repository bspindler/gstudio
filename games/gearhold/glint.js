// Gearhold: the brief brass glint an enemy shows just before it attacks. Pure (no randomness, no state), so it
// only reads what the enemy is already doing and never changes timing or damage.

export const GLINT_WINDOW = 0.28;

/**
 * 0..1 strength of the wind-up glint for a walker (kind 'c' biter, 'd' shooter, anything else the gunner).
 * Rams and turrets already glow in their own wind-ups and return 0. `d` is the distance to the player and
 * `sees` whether it has line of sight. The glint only shows in the last GLINT_WINDOW seconds of the cooldown and
 * only when the attack would actually fire, so it never lights up for an enemy that is not about to strike.
 */
export function attackGlint(e, d, sees) {
  if (!e || e.dead || e.prop || e.reg || !e.awake || e.kind === 't' || e.kind === 'r') return 0;
  if (!(e.cd > 0 && e.cd <= GLINT_WINDOW)) return 0;
  let inRange;
  if (e.kind === 'c') inRange = d <= 1.3;
  else if (e.kind === 'd') inRange = !!sees && d < 15;
  else inRange = d < 1.3 || (!!sees && d < 16);
  if (!inRange) return 0;
  return Math.sin((1 - e.cd / GLINT_WINDOW) * Math.PI * 0.5) * 0.5 + 0.5 * (1 - e.cd / GLINT_WINDOW);
}
