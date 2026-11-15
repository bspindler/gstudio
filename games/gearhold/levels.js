// Gearhold levels. One character per map cell; each map is a sealed grid.
// Gearhold is a clockwork citadel floating above a sea of clouds. Each level has a mood: sky colours,
// sun direction and colour, ambient light from sky and ground, lantern and crystal colours, fog.
// Colours are written as display (sRGB) values from 0 to 1; sunColor may go above 1 (brightness).
//   Walls:  # ivory stone   M lacquered panel   P crystal conduit   X exit arch (walk into it to finish)
//   Doors:  D door (opens when you walk up)   K locked door (needs the gear key)
//   Things: S start   k gear key   h repair crystal   a shell pack   w scatter cannon
//           o volatile energy cell (shoot it; chains)
//           u gear press (floor plate that thumps on a fixed beat; see press.js)
//           d wisp drone (shoots)   c tick crawler (bites up close)   b kilnwarden (tough, shoots spreads)
// packages/core/test/gearhold-levels.test.ts checks that every level is sealed and finishable.

export const WALLS = '#MPX';
export const FLOOR_THINGS = 'khawdcbou';

export const LEVELS = [
  {
    name: 'Terrace of Dials',
    hint: 'Scrap the rogue machines and step through the glowing exit arch.',
    mood: {
      skyTop: [0.27, 0.46, 0.8], skyHorizon: [1.0, 0.8, 0.62], cloud: [1.0, 0.9, 0.84],
      sunDir: [-0.55, 0.42, -0.35], sunColor: [1.7, 1.3, 0.95],
      ambient: [0.5, 0.58, 0.78], ground: [0.42, 0.33, 0.28], lamp: [1.0, 0.78, 0.48], crystal: [0.35, 0.95, 0.9],
      fog: 0.018, stars: 0,
    },
    map: [
      '####################',
      '#S..#..u..a.uo.#...#',
      '#...#..u....u..D.h.#',
      '#...D..u.c..u..#...#',
      '#...#..u....u..#.d.#',
      '##D###MMMMDMMMMM...#',
      '#....M.u.....uoM.a.#',
      '#....M.ud...cu.D...#',
      '#....M.u.....u.M####',
      '#....D.u...h.u.M...#',
      '#....M.u..a..u.M.w.X',
      '#..c.Mou.....u.D...#',
      '####################',
    ],
  },
  {
    name: 'The Orrery',
    hint: 'The exit is sealed. Find the gear key to open the locked door.',
    mood: {
      skyTop: [0.16, 0.42, 0.78], skyHorizon: [0.74, 0.9, 0.96], cloud: [0.97, 0.98, 1.0],
      sunDir: [0.35, 0.78, -0.25], sunColor: [1.65, 1.6, 1.5],
      ambient: [0.5, 0.62, 0.8], ground: [0.36, 0.36, 0.34], lamp: [1.0, 0.85, 0.6], crystal: [0.4, 0.7, 1.0],
      fog: 0.016, stars: 0,
    },
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
    name: 'Kiln Heart',
    hint: 'A kilnwarden guards the heart of the citadel. Grab the key, then take it down.',
    mood: {
      skyTop: [0.05, 0.04, 0.14], skyHorizon: [0.95, 0.38, 0.2], cloud: [0.55, 0.28, 0.32],
      sunDir: [0.6, 0.16, 0.5], sunColor: [1.5, 0.62, 0.35],
      ambient: [0.26, 0.24, 0.42], ground: [0.3, 0.16, 0.12], lamp: [1.0, 0.6, 0.3], crystal: [1.0, 0.5, 0.25],
      fog: 0.02, stars: 1,
    },
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
      '#.......#..........#.....#',
      '#..a....#..........#....h#',
      '##########################',
    ],
  },
  {
    name: 'Press Gallery',
    hint: 'Brass presses thump in a steady wave. Cross while one rests; a hot glow means it is about to slam.',
    mood: {
      skyTop: [0.12, 0.2, 0.42], skyHorizon: [0.92, 0.7, 0.42], cloud: [0.95, 0.82, 0.7],
      sunDir: [-0.4, 0.3, 0.55], sunColor: [1.6, 1.15, 0.7],
      ambient: [0.46, 0.5, 0.66], ground: [0.4, 0.3, 0.2], lamp: [1.0, 0.72, 0.38], crystal: [0.95, 0.75, 0.3],
      fog: 0.017, stars: 0,
    },
    map: [
      '################################################',
      '#S...#MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM#.h....#',
      '#....#...u...u...u.h.u...u...u...u..u...#......#',
      '#.w..D...u.d.u...u.c.u...u.d.u.c.u..u...D..d...X',
      '#....#...u...u...u...u...u...u...u..u...#......#',
      '#.a..#MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM#....a.#',
      '################################################',
    ],
  },
];
