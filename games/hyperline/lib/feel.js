// Game-feel helpers: near-miss slow motion, the camera spring and FOV, the landing thud, the chip magnet.
// Presentation only: none of this changes the sim, so runs and ghosts replay exactly. No DOM.

/** Three near-miss clears in a row slow the world to 0.3x for 0.3 s of real time. */
export const SLOWMO = { chain: 3, scale: 0.3, dur: 0.3 };

/**
 * Advances the near-miss chain with one sim step's events. A spike clear followed by its near event extends the
 * chain; a clean clear breaks it. Returns the new chain and whether slow motion fires (the chain then restarts).
 */
export function nearChain(chain, events) {
  let slow = false;
  for (let i = 0; i < events.length; i++) {
    if (events[i].t !== 'clear') continue;
    if (events[i + 1] && events[i + 1].t === 'near') {
      i++;
      if (++chain >= SLOWMO.chain) { chain = 0; slow = true; }
    } else chain = 0;
  }
  return { chain, slow };
}

/** Camera kick: a slightly underdamped spring on a vertical offset. */
const K = 90, C = 2 * 0.55 * Math.sqrt(K);
export function springStep(s, dt) {
  const v = s.v + (-K * s.y - C * s.v) * dt;
  return { y: s.y + v * dt, v };
}
export function kick(s, impulse) { return { y: s.y, v: s.v + impulse }; }
/** Impulses: up on take-off, down on landing (more for a longer fall). */
export const KICK_JUMP = 2.5;
export const kickLand = (fall) => -(1 + 2.5 * Math.min(1, Math.max(0, fall) / 4));

/** Field of view: the base angle, widening by up to 6 degrees from start speed (9) to top speed (17.5). */
export function fovFor(speed, landscape) {
  const k = Math.min(1, Math.max(0, ((speed ?? 9) - 9) / 8.5));
  return (landscape ? 50 : 64) + 6 * k;
}

/** Landing thud frequency (Hz): lower for a longer fall, 150 Hz down to 72 Hz at 6 units or more. */
export function landPitch(fall) {
  return 150 - 13 * Math.min(6, Math.max(0, fall));
}

/** How far (0..0.6) to draw a chip toward the runner: chips ahead and within 1.8 units, stronger when closer. */
export const MAGNET_R = 1.8;
export function magnetPull(dx, dy) {
  if (dx < 0) return 0;
  const d = Math.hypot(dx, dy);
  return d >= MAGNET_R ? 0 : 0.6 * (1 - d / MAGNET_R) ** 1.5;
}
