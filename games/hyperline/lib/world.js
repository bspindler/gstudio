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
/**
 * Slot gates: a post from the track up to GATE_LO and a slab from GATE_HI up, GATE_W wide. The
 * gap fits the runner on the rise or the fall of a jump, but a jump's apex is too tall for it.
 */
export const GATE_LO = 0.75, GATE_HI = 3.15, GATE_W = 0.5;
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
  const base = Math.min(17.5, 9 + d / 90);
  return d > 1500 ? base + Math.min(3, (d - 1500) / 400) : base;
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
  { name: 'SLOT GATES', hint: 'Slot gates: jump through the gap. Too early or too late and you clip it.',
    pal: { sky: ['#01060F', '#061A33', '#0A3A5C'], sun: ['#FFE45C', '#22F0FF'], grid: '#22A8FF', rail: '#FF2BD6', neon: '#FFE45C', block: '#22F0FF' } },
  { name: 'SWEEP COLUMNS', hint: 'Columns in a row: thread each slot, then jump again in rhythm.',
    pal: { sky: ['#0A0210', '#2A0845', '#5A1070'], sun: ['#22F0FF', '#FF2BD6'], grid: '#22F0FF', rail: '#FFE45C', neon: '#22F0FF', block: '#FF2BD6' } },
  { name: 'PULSE RAILS', hint: 'Rails that blink to a beat: stay in the air while they glow, land when they go dark.',
    pal: { sky: ['#050212', '#14083A', '#2A0F5E'], sun: ['#FF2BD6', '#22F0FF'], grid: '#FF2BD6', rail: '#7CFFEA', neon: '#FF2B5E', block: '#B98CFF' } },
  { name: 'CRUMBLE TRACK', hint: 'Panels glow, then fall away: leap each hole, land, and jump again.',
    pal: { sky: ['#0F0404', '#3A1208', '#6E2A0F'], sun: ['#FFE45C', '#FF8A3D'], grid: '#FF8A3D', rail: '#FFB86B', neon: '#FF2B5E', block: '#FFE45C' } },
  { name: 'BOOST PADS', hint: 'Pads throw you over the walls: land on the strip, then tap before the edge.',
    pal: { sky: ['#020812', '#0A2440', '#14508A'], sun: ['#7CFF6B', '#22F0FF'], grid: '#22F0FF', rail: '#7CFF6B', neon: '#FFE45C', block: '#22A8FF' } },
  { name: 'RISER STEPS', hint: 'Hop up onto the step, then jump again before the edge.',
    pal: { sky: ['#0A0214', '#2A0A40', '#5A1A78'], sun: ['#FF8A3D', '#FF2BD6'], grid: '#B98CFF', rail: '#FFE45C', neon: '#7CFF6B', block: '#FF8A3D' } },
  { name: 'STAGGER SPIKES', hint: 'Spike pairs at uneven gaps: read each gap, do not tap to a beat.',
    pal: { sky: ['#020A0A', '#06303A', '#0C5A5E'], sun: ['#FFE45C', '#7CFFEA'], grid: '#7CFFEA', rail: '#FF2BD6', neon: '#FFE45C', block: '#22F0FF' } },
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
