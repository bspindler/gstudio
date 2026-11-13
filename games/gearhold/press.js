// Gearhold gear presses: brass plates in the Press Gallery that thump to a fixed, learnable beat.
// No randomness. Each press rests, glows hot as a warning, then slams briefly. Columns are offset in time,
// so the beat travels down the gallery like a wave.
export const PRESS = { period: 4.0, warn: 0.65, down: 0.35, dmg: 20 };

/** Seconds of delay for a press in column x: a quarter second per column. */
export const pressOffset = (x) => x * 0.25;

/** 'open' (safe, most of the cycle), 'warn' (glowing hot, about to slam) or 'down' (slamming, hurts). */
export function pressState(t, x) {
  const c = (((t + pressOffset(x)) % PRESS.period) + PRESS.period) % PRESS.period;
  if (c >= PRESS.period - PRESS.down) return 'down';
  if (c >= PRESS.period - PRESS.down - PRESS.warn) return 'warn';
  return 'open';
}
