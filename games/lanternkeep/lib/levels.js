// Lanternkeep levels: sixteen nights in three regions. Paths are waypoint lists in grid cells
// (9 columns x 13 rows); the first point sits just off the board, and every path ends on the lantern
// (the last point of path 0). A wave is a list of groups: [enemy, count, gap seconds, start offset, lane?].
// Without a lane, a wave's enemies alternate across the paths. Each early level teaches one new thing.

const FOUR = ['glowcap', 'frost', 'ember', 'sunspire'];
const FIVE = [...FOUR, 'moonbell']; // the Moonbell joins from night 6
const ALL = [...FIVE, 'thornbriar']; // the Thornbriar joins from night 7
const L = (name, intro, def) => ({ name, intro, lives: 20, hpMul: 1, ...def });

export const REGIONS = [
  { id: 'moon', name: 'Moon Garden', from: 0, blurb: 'Where the moths first came.' },
  { id: 'frost', name: 'Frostmere', from: 5, blurb: 'A frozen lake garden. The cold carries strange things.' },
  { id: 'ember', name: 'Ember Marsh', from: 10, blurb: 'Warm reeds and glowing water. The night is thickest here.' },
];

export const LEVELS = [
  // ---------- Moon Garden ----------
  L('Moonlit Steps', 'Moths fly toward the light. Plant a Glowcap beside the path.', {
    region: 'moon', towers: ['glowcap'], gold: 110, flareStart: 0.55,
    paths: [[[4, -1], [4, 3], [1, 3], [1, 8], [7, 8], [7, 11]]],
    waves: [
      [['moth', 4, 1.6]],
      [['moth', 8, 0.9]],
      [['moth', 10, 0.7], ['moth', 6, 0.35, 6]],
    ],
  }),
  L('Firefly Hollow', 'Fireflies are quick. A Frost Fern slows everything near it.', {
    region: 'moon', towers: ['glowcap', 'frost'], gold: 150,
    paths: [[[1, -1], [1, 2], [7, 2], [7, 6], [1, 6], [1, 10], [4, 10], [4, 11]]],
    waves: [
      [['moth', 8, 1]],
      [['firefly', 10, 0.6]],
      [['moth', 8, 0.9], ['firefly', 10, 0.45, 4]],
      [['firefly', 20, 0.35]],
    ],
  }),
  L('Thistle Bend', 'Swarms bunch up. Ember Thistles burst through a crowd.', {
    region: 'moon', towers: ['glowcap', 'frost', 'ember'], gold: 180,
    paths: [[[9, 1], [2, 1], [2, 4], [6, 4], [6, 7], [2, 7], [2, 10], [6, 10], [6, 11]]],
    waves: [
      [['moth', 12, 0.6]],
      [['firefly', 22, 0.28]],
      [['moth', 14, 0.45], ['firefly', 14, 0.3, 3]],
      [['moth', 20, 0.35], ['firefly', 20, 0.25, 4]],
      [['firefly', 40, 0.18]],
    ],
  }),
  L('Shell Garden', 'Shell Beetles shrug off small hits. Grow a plant all the way to choose its branch.', {
    region: 'moon', towers: ['glowcap', 'frost', 'ember'], gold: 260,
    paths: [[[-1, 1], [7, 1], [7, 3], [1, 3], [1, 5], [7, 5], [7, 7], [1, 7], [1, 9], [7, 9], [7, 11]]],
    waves: [
      [['beetle', 4, 2]],
      [['moth', 14, 0.5], ['beetle', 3, 2, 2]],
      [['firefly', 24, 0.28]],
      [['beetle', 8, 1.3]],
      [['moth', 16, 0.4], ['firefly', 16, 0.3, 3], ['beetle', 6, 1.4, 6]],
    ],
  }),
  L('Sunspire Rise', 'A Gloom Toad comes tonight. The Sunspire pierces armour and hunts the biggest.', {
    region: 'moon', towers: FOUR, gold: 300,
    paths: [[[4, -1], [4, 5], [7, 5], [7, 9], [2, 9], [2, 11]]],
    waves: [
      [['moth', 14, 0.5]],
      [['beetle', 6, 1.3], ['firefly', 14, 0.3, 3]],
      [['moth', 16, 0.4], ['beetle', 4, 1.5, 3]],
      [['firefly', 28, 0.22], ['beetle', 6, 1, 3]],
      [['beetle', 10, 0.9], ['moth', 16, 0.35, 3]],
      [['toad', 1, 1], ['moth', 14, 0.5, 2]],
    ],
  }),

  // ---------- Frostmere ----------
  L('The Fork', 'Two paths, one lantern. Wisps ignore frost; a Moonbell stills them. Build where the paths meet.', {
    region: 'frost', towers: FIVE, gold: 280, hpMul: 1.62,
    paths: [
      [[1, -1], [1, 5], [4, 5], [4, 11]],
      [[7, -1], [7, 5], [4, 5], [4, 11]],
    ],
    waves: [
      [['moth', 16, 0.5]],
      [['wisp', 8, 0.9]],
      [['firefly', 24, 0.25], ['beetle', 4, 1.6, 3]],
      [['wisp', 12, 0.7], ['moth', 10, 0.5, 2]],
      [['beetle', 10, 0.9]],
      [['toad', 2, 6], ['wisp', 10, 0.6, 2]],
    ],
  }),
  L('Mossy Ford', 'Mossbacks heal the creatures around them. Hit them first, and hit them hard.', {
    region: 'frost', towers: ALL, gold: 340, hpMul: 1.25,
    paths: [[[-1, 3], [3, 3], [3, 9], [7, 9], [7, 4], [5, 4]]],
    waves: [
      [['moth', 10, 0.5], ['mossback', 1, 1, 2]],
      [['beetle', 6, 1], ['mossback', 2, 3, 1]],
      [['firefly', 24, 0.22], ['mossback', 2, 2, 2]],
      [['wisp', 12, 0.6], ['mossback', 3, 2, 1]],
      [['beetle', 10, 0.8], ['mossback', 3, 2.5, 2]],
      [['toad', 1, 1], ['mossback', 4, 1.5, 1], ['moth', 16, 0.35, 3]],
    ],
  }),
  L('Crosswind', 'They come from both sides now.', {
    region: 'frost', towers: ALL, gold: 320, hpMul: 1.15,
    paths: [
      [[-1, 2], [3, 2], [3, 8], [4, 8], [4, 11]],
      [[9, 4], [6, 4], [6, 8], [4, 8], [4, 11]],
    ],
    waves: [
      [['moth', 18, 0.45]],
      [['beetle', 8, 1.1]],
      [['wisp', 12, 0.7], ['firefly', 16, 0.3, 2]],
      [['beetle', 10, 0.8], ['mossback', 2, 3, 2]],
      [['toad', 1, 1, 0, 0], ['toad', 1, 1, 4, 1], ['firefly', 20, 0.25, 2]],
      [['wisp', 16, 0.5], ['beetle', 8, 0.9, 4]],
      [['moth', 30, 0.25], ['beetle', 10, 0.7, 3], ['toad', 2, 5, 6]],
    ],
  }),
  L('The Spiral', 'A long road in. Use every turn.', {
    region: 'frost', towers: ALL, gold: 280, hpMul: 1.9,
    paths: [[[-1, 0], [8, 0], [8, 12], [0, 12], [0, 2], [6, 2], [6, 10], [2, 10], [2, 4], [4, 4], [4, 7]]],
    waves: [
      [['moth', 24, 0.4]],
      [['beetle', 12, 0.9]],
      [['firefly', 40, 0.18]],
      [['wisp', 16, 0.5], ['mossback', 3, 2, 3]],
      [['toad', 3, 4]],
      [['moth', 30, 0.25], ['firefly', 30, 0.2, 3], ['beetle', 10, 0.7, 5]],
      [['wisp', 20, 0.4], ['toad', 2, 5, 3]],
      [['beetle', 20, 0.5], ['toad', 3, 3, 4], ['mossback', 4, 2, 2]],
    ],
  }),
  L("Mothmother's Nest", 'The Mothmother is coming. When she falls, her brood scatters. Save your Flare for it.', {
    region: 'frost', towers: ALL, gold: 360, hpMul: 1.55,
    paths: [[[4, -1], [4, 2], [1, 2], [1, 6], [7, 6], [7, 10], [1, 10], [1, 11]]],
    waves: [
      [['moth', 20, 0.35]],
      [['beetle', 10, 0.8], ['wisp', 8, 0.7, 3]],
      [['mossback', 4, 1.5], ['firefly', 24, 0.22, 2]],
      [['moth', 30, 0.25], ['wisp', 12, 0.5, 3]],
      [['toad', 2, 4], ['beetle', 10, 0.7, 2]],
      [['mothmother', 1, 1], ['moth', 16, 0.4, 3]],
      [['mothmother', 1, 1], ['mossback', 3, 2, 1], ['beetle', 8, 0.8, 4]],
    ],
  }),

  // ---------- Ember Marsh ----------
  L('Two Gates', 'A short path and a shorter one. Watch the east gate.', {
    region: 'ember', towers: ALL, gold: 400, hpMul: 1.5,
    paths: [
      [[2, -1], [2, 6], [4, 6], [4, 11]],
      [[9, 8], [4, 8], [4, 11]],
    ],
    waves: [
      [['moth', 20, 0.4]],
      [['firefly', 30, 0.2], ['wisp', 6, 0.8, 2]],
      [['beetle', 12, 0.8]],
      [['wisp', 16, 0.5], ['mossback', 3, 2, 2]],
      [['toad', 2, 4], ['firefly', 24, 0.2, 2]],
      [['beetle', 16, 0.6], ['wisp', 10, 0.6, 4]],
      [['moth', 36, 0.2], ['toad', 2, 4, 4]],
      [['beetle', 16, 0.5], ['wisp', 16, 0.4, 2], ['mothmother', 1, 1, 6]],
    ],
  }),
  L('Reedmaze', 'The marsh path winds back and forth. Long reach wins here.', {
    region: 'ember', towers: ALL, gold: 380, hpMul: 1.25,
    paths: [[[9, 1], [1, 1], [1, 3], [7, 3], [7, 5], [1, 5], [1, 7], [7, 7], [7, 9], [1, 9], [1, 11], [4, 11]]],
    waves: [
      [['moth', 24, 0.35]],
      [['beetle', 14, 0.7]],
      [['wisp', 20, 0.4], ['mossback', 3, 2, 2]],
      [['firefly', 50, 0.14]],
      [['toad', 3, 3], ['beetle', 10, 0.7, 2]],
      [['mossback', 6, 1.2], ['moth', 30, 0.25, 2]],
      [['mothmother', 1, 1], ['wisp', 20, 0.35, 3]],
      [['beetle', 24, 0.4], ['toad', 3, 3, 3], ['mossback', 4, 1.5, 5]],
    ],
  }),
  L('Three Fires', 'Three roads, one short walk to the lantern. Every plant has to count.', {
    region: 'ember', towers: ALL, gold: 460, hpMul: 1.5,
    paths: [
      [[4, -1], [4, 11]],
      [[-1, 6], [4, 6], [4, 11]],
      [[9, 6], [4, 6], [4, 11]],
    ],
    waves: [
      [['moth', 24, 0.3]],
      [['firefly', 36, 0.18], ['beetle', 6, 1, 2]],
      [['wisp', 18, 0.4], ['mossback', 3, 1.5, 2]],
      [['beetle', 18, 0.5]],
      [['toad', 3, 3], ['moth', 24, 0.3, 2]],
      [['wisp', 24, 0.3], ['beetle', 12, 0.6, 3]],
      [['mothmother', 2, 5], ['firefly', 30, 0.2, 2]],
      [['beetle', 24, 0.4], ['mossback', 6, 1.2, 2], ['toad', 3, 3, 5]],
    ],
  }),
  L('Ashen Loop', 'The path circles the whole garden before it turns home.', {
    region: 'ember', towers: ALL, gold: 360, hpMul: 1.3,
    paths: [[[-1, 11], [1, 11], [1, 1], [7, 1], [7, 11], [3, 11]]],
    waves: [
      [['moth', 30, 0.3]],
      [['beetle', 16, 0.6]],
      [['firefly', 50, 0.14], ['wisp', 10, 0.5, 3]],
      [['mossback', 6, 1.2], ['beetle', 12, 0.6, 2]],
      [['toad', 4, 2.5]],
      [['wisp', 30, 0.3], ['moth', 30, 0.25, 2]],
      [['mothmother', 2, 4], ['mossback', 4, 1.5, 2]],
      [['beetle', 30, 0.35], ['firefly', 40, 0.15, 2]],
      [['toad', 4, 2], ['mothmother', 1, 1, 6], ['mossback', 6, 1, 3]],
    ],
  }),
  L('Lanternfall', 'Three roads. Every creature in the garden. Hold the light.', {
    region: 'ember', towers: ALL, gold: 480, hpMul: 1.6,
    paths: [
      [[0, -1], [0, 4], [4, 4], [4, 11]],
      [[8, -1], [8, 4], [4, 4], [4, 11]],
      [[-1, 9], [2, 9], [2, 11], [4, 11]],
    ],
    waves: [
      [['moth', 24, 0.35]],
      [['firefly', 36, 0.18], ['beetle', 6, 1, 3]],
      [['wisp', 18, 0.45], ['mossback', 3, 1.5, 2]],
      [['beetle', 18, 0.55], ['moth', 18, 0.3, 3]],
      [['toad', 3, 3], ['firefly', 30, 0.2, 2]],
      [['wisp', 20, 0.4], ['beetle', 12, 0.6, 3]],
      [['mothmother', 1, 1], ['moth', 40, 0.2, 2], ['firefly', 40, 0.15, 3]],
      [['beetle', 24, 0.45], ['wisp', 20, 0.35, 3], ['mossback', 4, 1.5, 4]],
      [['toad', 6, 2.5], ['beetle', 16, 0.5, 4], ['wisp', 16, 0.4, 8]],
      [['mothmother', 2, 6], ['toad', 3, 3, 3], ['mossback', 6, 1, 4]],
    ],
  }),
  L('Burrowing Dark', 'Hollow Moles dive under the path where no plant can reach them. Cover the whole road.', {
    region: 'ember', towers: ALL, gold: 380, hpMul: 1.75,
    paths: [[[-1, 2], [7, 2], [7, 5], [1, 5], [1, 8], [7, 8], [7, 11], [4, 11]]],
    waves: [
      [['moth', 16, 0.4], ['mole', 4, 1.6, 2]],
      [['mole', 14, 0.8]],
      [['wisp', 14, 0.5], ['mole', 12, 0.7, 2]],
      [['beetle', 14, 0.7], ['mole', 12, 0.7, 3]],
      [['firefly', 36, 0.18], ['mole', 20, 0.45, 2]],
      [['toad', 3, 3], ['mole', 18, 0.5, 2], ['mossback', 4, 2, 4]],
      [['mothmother', 1, 1], ['mole', 24, 0.4, 2], ['beetle', 12, 0.6, 3]],
      [['mole', 36, 0.3], ['wisp', 20, 0.35, 2], ['toad', 4, 3, 5]],
    ],
  }),
  L('Lamplit Orchard', 'Lampmoths leave the path and dive at your brightest plant, dazzling it. Guard it with its neighbours.', {
    region: 'ember', towers: ALL, gold: 420, hpMul: 1.5,
    paths: [[[4, -1], [4, 2], [1, 2], [1, 6], [7, 6], [7, 10], [4, 10], [4, 11]]],
    waves: [
      [['moth', 14, 0.45], ['lampmoth', 3, 1.2, 4]],
      [['beetle', 8, 0.9], ['lampmoth', 4, 1, 3]],
      [['wisp', 12, 0.55], ['lampmoth', 6, 0.6, 4]],
      [['mossback', 3, 1.5], ['lampmoth', 7, 0.5, 2], ['firefly', 16, 0.28, 3]],
      [['toad', 2, 4], ['lampmoth', 8, 0.5, 3]],
      [['beetle', 10, 0.7], ['lampmoth', 9, 0.45, 2], ['wisp', 8, 0.55, 4]],
      [['mothmother', 1, 1], ['lampmoth', 10, 0.4, 3], ['mossback', 3, 1.5, 3]],
      [['toad', 3, 3], ['lampmoth', 12, 0.4, 2], ['beetle', 10, 0.6, 4]],
    ],
  }),
  L('Mirror Mist', 'Twin Wisps split in two when struck, each half with half the health. Bursts and beams catch both.', {
    region: 'ember', towers: ALL, gold: 400, hpMul: 1.5,
    paths: [
      [[1, -1], [1, 5], [4, 5], [4, 11]],
      [[7, -1], [7, 5], [4, 5], [4, 11]],
    ],
    waves: [
      [['moth', 12, 0.5], ['twinwisp', 4, 1.2, 3]],
      [['twinwisp', 10, 0.8]],
      [['beetle', 8, 0.9], ['twinwisp', 8, 0.7, 2]],
      [['mossback', 3, 1.5], ['twinwisp', 12, 0.55, 2], ['firefly', 14, 0.3, 3]],
      [['toad', 2, 5], ['twinwisp', 12, 0.5, 2]],
      [['twinwisp', 16, 0.4], ['beetle', 10, 0.7, 3]],
      [['mothmother', 1, 1], ['twinwisp', 14, 0.45, 3], ['mossback', 3, 1.5, 3]],
      [['toad', 3, 4], ['twinwisp', 20, 0.35, 2], ['beetle', 10, 0.6, 4]],
    ],
  }),
];
