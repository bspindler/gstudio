// Gearhold levels. One character per map cell; each map is a sealed grid.
//   Walls:  # brick   M plate   P pipes   X exit panel (walk up to it to finish)
//   Doors:  D door (opens when you walk up)   K locked door (needs the gear key)
//   Things: S start   k gear key   h repair kit   a bolt pack   w scatter cannon
//           d drone (shoots)   c crawler (bites up close)   b smelter brute (tough, shoots spreads)
// packages/core/test/gearhold-levels.test.ts checks that every level is sealed and finishable.

export const WALLS = '#MPX';
export const FLOOR_THINGS = 'khawdcb';

export const LEVELS = [
  {
    name: 'Loading Dock',
    hint: 'Scrap the rogue machines and reach the green exit panel.',
    map: [
      '####################',
      '#S..#.....a....#...#',
      '#...#..........D.h.#',
      '#...D....c.....#...#',
      '#...#..........#.d.#',
      '##D###MMMMDMMMMM...#',
      '#....M.........M.a.#',
      '#.h..M..d...c..D...#',
      '#....M.........M####',
      '#....D.........M...#',
      '#....M....a....M.w.X',
      '#..c.M.........D...#',
      '####################',
    ],
  },
  {
    name: 'Smelter Floor',
    hint: 'The exit is sealed. Find the gear key to open the locked door.',
    map: [
      '########################',
      '#S...#.......c....#....#',
      '#....#............#.h..#',
      '#....D....PP..PP..D....#',
      '#....#....PP..PP..#.d..#',
      '#.a..#............#....#',
      '##D#####MMMDMMMMMM##D###',
      '#......#.........#.....#',
      '#..c...#..d...d..#..k..#',
      '#......D.........#.....#',
      '#..h...#....a....#..c..#',
      '#......#.........#.....#',
      '###D####MMMMMMMMMM######',
      '#.........#....w...#...#',
      '#..d...c..D........K.a.X',
      '########################',
    ],
  },
  {
    name: 'Core Furnace',
    hint: 'A smelter brute guards the furnace. Grab the key, then take it down.',
    map: [
      '##########################',
      '#S..#........#...........#',
      '#...D...d....#....c..c...X',
      '#...#........#...........#',
      '#.a.#..PP....#####D#######',
      '##D##..PP....#...........#',
      '#....#.......#..h.....a..#',
      '#.c..#####D###...........#',
      '#....#.......#....b......#',
      '#.h..D...d...#...........#',
      '#....#.......#...........#',
      '###D##MMMMMMM###MMKMMMMMM#',
      '#.......#....k.....#.....#',
      '#..d....D..........D..w..#',
      '#.......#....c.....#.....#',
      '#..a....#..........#....h#',
      '##########################',
    ],
  },
];
