// Gearhold levels. One character per map cell; each map is a sealed grid.
// Each level also has a lighting mood: ambient light, ceiling lamp colour and distance haze.
//   Walls:  # brick   M plate   P pipes   X exit panel (walk up to it to finish)
//   Doors:  D door (opens when you walk up)   K locked door (needs the gear key)
//   Things: S start   k gear key   h repair kit   a bolt pack   w scatter cannon
//           o explosive canister (shoot it; chains)
//           d drone (shoots)   c crawler (bites up close)   b smelter brute (tough, shoots spreads)
// packages/core/test/gearhold-levels.test.ts checks that every level is sealed and finishable.

export const WALLS = '#MPX';
export const FLOOR_THINGS = 'khawdcbo';

export const LEVELS = [
  {
    name: 'Loading Dock',
    mood: { ambient: [0.2, 0.22, 0.27], lamp: [1.05, 0.97, 0.85], haze: [14, 18, 26] },
    hint: 'Scrap the rogue machines and reach the green exit panel.',
    map: [
      '####################',
      '#S..#.....a..o.#...#',
      '#...#..........D.h.#',
      '#...D....c.....#...#',
      '#...#..........#.d.#',
      '##D###MMMMDMMMMM...#',
      '#....M........oM.a.#',
      '#.h..M..d...c..D...#',
      '#....M.........M####',
      '#....D.........M...#',
      '#....M....a....M.w.X',
      '#..c.Mo........D...#',
      '####################',
    ],
  },
  {
    name: 'Smelter Floor',
    mood: { ambient: [0.22, 0.16, 0.12], lamp: [1.1, 0.78, 0.48], haze: [34, 19, 10] },
    hint: 'The exit is sealed. Find the gear key to open the locked door.',
    map: [
      '########################',
      '#S...#.......c...o#....#',
      '#....#............#.h..#',
      '#....D....PP..PP..D....#',
      '#....#....PP..PP..#.d..#',
      '#.a..#............#....#',
      '##D#####MMMDMMMMMM##D###',
      '#......#.........#.....#',
      '#..c...#..d...d..#..k..#',
      '#......D.........#.....#',
      '#..h...#....a...o#..c..#',
      '#......#.........#.....#',
      '###D####MMMMMMMMMM######',
      '#.....o...#....w...#...#',
      '#..d...c..D........K.a.X',
      '########################',
    ],
  },
  {
    name: 'Core Furnace',
    mood: { ambient: [0.24, 0.11, 0.08], lamp: [1.15, 0.6, 0.38], haze: [42, 13, 8] },
    hint: 'A smelter brute guards the furnace. Grab the key, then take it down.',
    map: [
      '##########################',
      '#S..#........#...........#',
      '#...D...d....#....c..c...X',
      '#...#........#...........#',
      '#.a.#..PP....#####D#######',
      '##D##..PP....#...........#',
      '#....#.......#..h.....ao.#',
      '#.c..#####D###...........#',
      '#....#.......#....b......#',
      '#.h..D...d...#.o.........#',
      '#....#.......#...........#',
      '###D##MMMMMMM###MMKMMMMMM#',
      '#.......#....k...o.#.....#',
      '#..d....D..........D..w..#',
      '#.......#....c.....#.....#',
      '#..a....#..........#....h#',
      '##########################',
    ],
  },
];
