// Night Watch: an endless garden. Waves are generated from a fixed seed, so every player and every
// run faces the same nights; only your plants and timing differ. The best wave reached is kept locally.
const WAVES = 60;
const RAMP_FROM = 14; // waves up to here (0-based) are unchanged
const RAMP = 1.045; // extra growth per wave after that

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// The creatures that can appear from a given wave (0-based) onward.
const POOL = [
  ['moth', 0, 28], ['firefly', 1, 12], ['beetle', 3, 85], ['wisp', 5, 45], ['mossback', 8, 120],
];

export function endlessLevel() {
  const rnd = lcg(0x1a77e2);
  const waves = [];
  for (let i = 0; i < WAVES; i++) {
    let budget = 260 * Math.pow(1.13, i); // total creature health to send this wave
    if (i > RAMP_FROM) budget *= Math.pow(RAMP, i - RAMP_FROM); // the late nights swell faster
    const pool = POOL.filter(([, from]) => i >= from);
    const wave = [];
    if (i > 0 && i % 10 === 9) { wave.push(['mothmother', 1 + Math.floor(i / 20), 4, 2]); budget *= 0.5; }
    else if (i > 0 && i % 5 === 4) { wave.push(['toad', 1 + Math.floor(i / 10), 3.5, 2]); budget *= 0.6; }
    const kinds = Math.min(pool.length, 1 + Math.floor(rnd() * 3));
    let at = 0;
    for (let k = 0; k < kinds; k++) {
      const [type, , hp] = pool[Math.floor(rnd() * pool.length)];
      const count = Math.max(3, Math.round(budget / kinds / hp));
      const gap = Math.max(i > RAMP_FROM ? 0.06 : 0.15, Math.min(1.2, 14 / count)) // late waves also arrive denser, so they press harder without lasting for hours;
      wave.push([type, count, Math.round(gap * 100) / 100, at]);
      at += 2 + rnd() * 3;
    }
    waves.push(wave);
  }
  return {
    name: 'Night Watch',
    intro: 'The night does not end. How long can you keep the light?',
    endless: true,
    lives: 20,
    gold: 320,
    hpMul: 1,
    towers: ['glowcap', 'frost', 'ember', 'sunspire', 'moonbell'],
    region: 'moon',
    paths: [
      [[-1, 2], [6, 2], [6, 6], [2, 6], [2, 10], [4, 10], [4, 11]],
      [[9, 8], [6, 8], [6, 11], [4, 11]],
    ],
    waves,
  };
}
