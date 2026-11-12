// Which way the player faces at the start of a level: down the longest open straight line from the
// start cell, so the first view is the citadel hall and not a wall corner. Pure, so it can be tested
// without a browser. Walls and doors (closed at level start) block the view.

const DIRS = [[1, 0, 0], [0, 1, Math.PI / 2], [-1, 0, Math.PI], [0, -1, -Math.PI / 2]]; // east, south, west, north

/** Open cells in a straight line from (sx, sy) in direction (dx, dy). */
export function openRun(map, sx, sy, dx, dy, blocks) {
  let n = 0;
  for (let x = sx + dx, y = sy + dy; ; x += dx, y += dy) {
    const c = map[y]?.[x] ?? '#';
    if (blocks.includes(c)) return n;
    n++;
  }
}

/** Starting yaw (radians, the game's P.a) for the start cell: the longest open run; ties keep E, S, W, N order. */
export function spawnYaw(map, sx, sy, blocks) {
  let best = 0, bestRun = -1;
  for (const [dx, dy, a] of DIRS) {
    const run = openRun(map, sx, sy, dx, dy, blocks);
    if (run > bestRun) { best = a; bestRun = run; }
  }
  return best;
}
