// Lanternkeep levels. Paths are waypoint lists in grid cells (9 columns x 13 rows); the first
// point sits just off the board, and every path ends on the lantern (the last point of path 0).
// A wave is a list of groups: [enemy, count, gap seconds, start offset seconds, lane?].
// Without a lane, a wave's enemies alternate across the paths.

const L = (name, intro, def) => ({ name, intro, lives: 20, ...def });

export const LEVELS = [
  L('Moonlit Steps', 'Moths fly toward the light. Tap a mossy tile, then plant a Glowcap.', {
    towers: ['glowcap'],
    gold: 120,
    hpMul: 1,
    paths: [[[4, -1], [4, 3], [1, 3], [1, 8], [7, 8], [7, 11]]],
    waves: [
      [['moth', 5, 1.4]],
      [['moth', 8, 1.1]],
      [['moth', 10, 0.9]],
      [['moth', 14, 0.75]],
    ],
  }),
  L('Firefly Hollow', 'Fireflies are quick. A Frost Fern slows everything near it.', {
    towers: ['glowcap', 'frost'],
    gold: 150,
    hpMul: 1,
    paths: [[[1, -1], [1, 2], [7, 2], [7, 6], [1, 6], [1, 10], [4, 10], [4, 11]]],
    waves: [
      [['moth', 8, 1]],
      [['firefly', 10, 0.6]],
      [['moth', 8, 0.9], ['firefly', 8, 0.5, 4]],
      [['firefly', 18, 0.4]],
      [['moth', 14, 0.6], ['firefly', 12, 0.4, 6]],
    ],
  }),
  L('Thistle Bend', 'Swarms bunch up. Ember Thistles burst through a crowd.', {
    towers: ['glowcap', 'frost', 'ember'],
    gold: 170,
    hpMul: 1,
    paths: [[[9, 1], [2, 1], [2, 4], [6, 4], [6, 7], [2, 7], [2, 10], [6, 10], [6, 11]]],
    waves: [
      [['moth', 12, 0.7]],
      [['firefly', 20, 0.3]],
      [['moth', 10, 0.6], ['beetle', 2, 3, 3]],
      [['firefly', 16, 0.3], ['moth', 12, 0.5, 3]],
      [['beetle', 4, 2.2], ['firefly', 18, 0.3, 2]],
      [['moth', 20, 0.4], ['beetle', 4, 2, 4]],
    ],
  }),
  L('Shell Garden', 'Shell Beetles shrug off small hits. Upgrade, or hit them hard.', {
    towers: ['glowcap', 'frost', 'ember'],
    gold: 200,
    hpMul: 1.05,
    paths: [[[-1, 1], [7, 1], [7, 3], [1, 3], [1, 5], [7, 5], [7, 7], [1, 7], [1, 9], [7, 9], [7, 11]]],
    waves: [
      [['beetle', 4, 2]],
      [['moth', 14, 0.5], ['beetle', 3, 2, 2]],
      [['firefly', 24, 0.28]],
      [['beetle', 8, 1.3]],
      [['moth', 16, 0.4], ['firefly', 16, 0.3, 3], ['beetle', 4, 1.6, 6]],
      [['beetle', 12, 1]],
    ],
  }),
  L('Sunspire Rise', 'Wisps ignore frost. The Sunspire pierces armour and hunts the biggest foe.', {
    towers: ['glowcap', 'frost', 'ember', 'sunspire'],
    gold: 240,
    hpMul: 1.05,
    paths: [[[4, -1], [4, 5], [7, 5], [7, 9], [2, 9], [2, 11]]],
    waves: [
      [['wisp', 6, 1.2]],
      [['moth', 14, 0.5], ['wisp', 4, 1.2, 3]],
      [['beetle', 6, 1.3], ['wisp', 6, 1, 4]],
      [['firefly', 24, 0.25], ['wisp', 6, 0.9, 2]],
      [['beetle', 8, 1], ['moth', 16, 0.4, 3]],
      [['toad', 1, 1], ['moth', 12, 0.6, 2]],
    ],
  }),
  L('The Fork', 'Two paths, one lantern. Build where they meet.', {
    towers: ['glowcap', 'frost', 'ember', 'sunspire'],
    gold: 260,
    hpMul: 1.1,
    paths: [
      [[1, -1], [1, 5], [4, 5], [4, 11]],
      [[7, -1], [7, 5], [4, 5], [4, 11]],
    ],
    waves: [
      [['moth', 16, 0.5]],
      [['firefly', 24, 0.25], ['beetle', 4, 1.6, 3]],
      [['wisp', 10, 0.8], ['moth', 10, 0.5, 2]],
      [['beetle', 10, 0.9]],
      [['firefly', 30, 0.2], ['wisp', 8, 0.7, 3]],
      [['toad', 2, 6], ['beetle', 6, 1, 2]],
      [['moth', 24, 0.3], ['beetle', 8, 0.8, 3], ['wisp', 8, 0.7, 6]],
    ],
  }),
  L('Crosswind', 'They come from both sides now.', {
    towers: ['glowcap', 'frost', 'ember', 'sunspire'],
    gold: 320,
    hpMul: 1.05,
    paths: [
      [[-1, 2], [3, 2], [3, 8], [4, 8], [4, 11]],
      [[9, 4], [6, 4], [6, 8], [4, 8], [4, 11]],
    ],
    waves: [
      [['moth', 18, 0.45]],
      [['beetle', 8, 1.1]],
      [['wisp', 12, 0.7], ['firefly', 16, 0.3, 2]],
      [['beetle', 10, 0.8], ['moth', 14, 0.4, 3]],
      [['toad', 1, 1, 0, 0], ['toad', 1, 1, 4, 1], ['firefly', 20, 0.25, 2]],
      [['wisp', 16, 0.5], ['beetle', 8, 0.9, 4]],
      [['moth', 30, 0.25], ['beetle', 10, 0.7, 3], ['toad', 2, 5, 6]],
    ],
  }),
  L('The Spiral', 'A long road in. Use every turn.', {
    towers: ['glowcap', 'frost', 'ember', 'sunspire'],
    gold: 280,
    hpMul: 1.8,
    paths: [[[-1, 0], [8, 0], [8, 12], [0, 12], [0, 2], [6, 2], [6, 10], [2, 10], [2, 4], [4, 4], [4, 7]]],
    waves: [
      [['moth', 24, 0.4]],
      [['beetle', 12, 0.9]],
      [['firefly', 40, 0.18]],
      [['wisp', 16, 0.5], ['beetle', 8, 0.9, 3]],
      [['toad', 3, 4]],
      [['moth', 30, 0.25], ['firefly', 30, 0.2, 3], ['beetle', 10, 0.7, 5]],
      [['wisp', 20, 0.4], ['toad', 2, 5, 3]],
      [['beetle', 20, 0.5], ['toad', 3, 3, 4]],
    ],
  }),
  L('Two Gates', 'A short path and a shorter one. Watch the east gate.', {
    towers: ['glowcap', 'frost', 'ember', 'sunspire'],
    gold: 380,
    hpMul: 1.15,
    paths: [
      [[2, -1], [2, 6], [4, 6], [4, 11]],
      [[9, 8], [4, 8], [4, 11]],
    ],
    waves: [
      [['moth', 20, 0.4]],
      [['firefly', 30, 0.2], ['wisp', 6, 0.8, 2]],
      [['beetle', 12, 0.8]],
      [['wisp', 16, 0.5], ['moth', 16, 0.35, 2]],
      [['toad', 2, 4], ['firefly', 24, 0.2, 2]],
      [['beetle', 16, 0.6], ['wisp', 10, 0.6, 4]],
      [['moth', 36, 0.2], ['toad', 2, 4, 4]],
      [['beetle', 16, 0.5], ['wisp', 16, 0.4, 2], ['toad', 3, 3, 6]],
    ],
  }),
  L('Lanternfall', 'Three roads. Every creature in the garden. Hold the light.', {
    towers: ['glowcap', 'frost', 'ember', 'sunspire'],
    gold: 440,
    hpMul: 1.3,
    paths: [
      [[0, -1], [0, 4], [4, 4], [4, 11]],
      [[8, -1], [8, 4], [4, 4], [4, 11]],
      [[-1, 9], [2, 9], [2, 11], [4, 11]],
    ],
    waves: [
      [['moth', 24, 0.35]],
      [['firefly', 36, 0.18], ['beetle', 6, 1, 3]],
      [['wisp', 18, 0.45]],
      [['beetle', 18, 0.55], ['moth', 18, 0.3, 3]],
      [['toad', 3, 3], ['firefly', 30, 0.2, 2]],
      [['wisp', 20, 0.4], ['beetle', 12, 0.6, 3]],
      [['moth', 40, 0.2], ['firefly', 40, 0.15, 3], ['toad', 2, 4, 5]],
      [['beetle', 24, 0.45], ['wisp', 20, 0.35, 3]],
      [['toad', 6, 2.5], ['beetle', 16, 0.5, 4], ['wisp', 16, 0.4, 8]],
    ],
  }),
];
