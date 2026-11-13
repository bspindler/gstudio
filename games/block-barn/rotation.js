// Which letters are on the barn floor. A seeded shuffle of a..z feeds the floor; tapped-and-stacked letters
// are replaced by the next letter in the shuffle that is not already on the floor, cycling when it runs out.
export const FLOOR = 5;

/** Small seeded PRNG (mulberry32): same seed, same numbers. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRotation(seed, floor = FLOOR) {
  const rand = mulberry32(seed);
  const order = 'abcdefghijklmnopqrstuvwxyz'.split('');
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const on = order.slice(0, floor);
  const seen = new Set(on);
  let cursor = floor % order.length;
  return {
    floor: () => [...on],
    next(taken) {
      const at = on.indexOf(taken);
      if (at < 0) return [...on];
      let pick = order[cursor];
      while (on.includes(pick)) {
        cursor = (cursor + 1) % order.length;
        pick = order[cursor];
      }
      cursor = (cursor + 1) % order.length;
      on[at] = pick;
      seen.add(pick);
      return [...on];
    },
    seen: () => new Set(seen),
  };
}
