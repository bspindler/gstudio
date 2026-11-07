// World constants, speed curve and sectors. World space: x runs along the track, y is height,
// both in runner-sized units (1 unit = 1 m on the distance counter). No DOM.

/** Fixed simulation step. The sim always advances in these steps so runs replay exactly. */
export const STEP = 1 / 120;
/** Runner's left edge sits P units ahead of the camera anchor; runner is PS units square. */
export const P = 1.6, PS = 0.8;
export const GRAV = 62, JV = 17.6;
/** Jump pads launch at PAD_V (apex about 5.4 units). */
export const PAD_V = 26;
/** Gravity-flip zones: the runner rides the underside of a ceiling track at CEIL_Y. */
export const CEIL_Y = 3.6;
/** Low ceilings: the slab's underside is BAR_Y, and it is BAR_H tall, taller than any jump. */
export const BAR_Y = 1.05, BAR_H = 3;
/** Fall below this and the run ends. */
export const VOID_Y = -2.5;
/** Time in the air for a normal jump and for a pad launch. */
export const AIR = (2 * JV) / GRAV;
export const PAD_AIR = (2 * PAD_V) / GRAV;
/** Clear a spike with less than this much room and it counts as a near miss. */
export const NEAR = 0.28;

export const SECTOR_LEN = 250;

/** Speed in units per second at distance x. Keeps rising (slowly) past the Apex distance. */
export function speedAt(x) {
  const d = Math.max(0, x);
  const base = Math.min(14.5, 7 + d / 115);
  return d > 1500 ? base + Math.min(1.5, (d - 1500) / 600) : base;
}

export function sectorAt(x) {
  return Math.max(0, Math.floor(x / SECTOR_LEN));
}

/** Authored sectors. Each one shifts the palette; most introduce one new obstacle. */
export const SECTORS = [
  { name: 'NEON DISTRICT', hint: 'Tap to jump. Hold to keep jumping.',
    pal: { sky: ['#07030F', '#1C0A38', '#3A0F52'], sun: ['#FFE45C', '#FF2BD6'], grid: '#FF2BD6', rail: '#22F0FF', neon: '#FF2BD6', block: '#22F0FF' } },
  { name: 'LOW BRIDGE', hint: 'Low ceilings: stay on the ground. Holding jump will crash you.',
    pal: { sky: ['#020A14', '#08243A', '#0F4A5C'], sun: ['#7CFFEA', '#22A8FF'], grid: '#22F0FF', rail: '#FFE45C', neon: '#FF2BD6', block: '#7CFF6B' } },
  { name: 'LAUNCH BAY', hint: 'Jump pads fire you sky-high. Do not jump over them.',
    pal: { sky: ['#0B0414', '#2A0B2E', '#5C1A3A'], sun: ['#FFB86B', '#FF3D6E'], grid: '#FF8A3D', rail: '#22F0FF', neon: '#FF3D6E', block: '#FFE45C' } },
  { name: 'TWIN FANGS', hint: 'Double spikes: hold jump to hop twice in rhythm.',
    pal: { sky: ['#050012', '#160B3D', '#2E1A6E'], sun: ['#B98CFF', '#FF2BD6'], grid: '#B98CFF', rail: '#FF2BD6', neon: '#FF2BD6', block: '#22F0FF' } },
  { name: 'DRIFT YARD', hint: 'Moving platforms: time your landing.',
    pal: { sky: ['#020D08', '#06281A', '#0E4A2E'], sun: ['#E6FF6B', '#22FFA8'], grid: '#7CFF6B', rail: '#22F0FF', neon: '#FF2BD6', block: '#7CFF6B' } },
  { name: 'FLIP CITY', hint: 'Gravity flips: you ride the ceiling. Jump drops you down.',
    pal: { sky: ['#12020A', '#3A0820', '#6E0F2E'], sun: ['#FFE45C', '#FF2B5E'], grid: '#FF2B5E', rail: '#FFE45C', neon: '#22F0FF', block: '#FF8A3D' } },
  { name: 'HYPERCORE', hint: 'Everything at once. Faster.',
    pal: { sky: ['#000000', '#0A0A1F', '#1F0A3A'], sun: ['#FFFFFF', '#22F0FF'], grid: '#22F0FF', rail: '#FF2BD6', neon: '#FFE45C', block: '#FF2BD6' } },
];

/** Sector info for any index; past the authored list, palettes cycle under OVERDRIVE names. */
export function sectorInfo(i) {
  if (i < SECTORS.length) return SECTORS[i];
  const k = i - SECTORS.length;
  const pal = SECTORS[1 + (k % (SECTORS.length - 1))].pal;
  return { name: `OVERDRIVE ${k + 1}`, hint: 'No new tricks. Just faster.', pal };
}
