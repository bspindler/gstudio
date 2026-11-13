// Lantern perks: the long-term reason to earn stars. Every star earned is one spark; sparks unlock
// perks. Perks can be reset for free at any time. Nothing here is ever sold.
export const PERKS = [
  { id: 'wick', name: 'Long Wick', desc: '+3 lives in every level.', cost: 3, mods: { lives: 3 } },
  { id: 'purse', name: 'Moth Purse', desc: '+40 gold at the start of every level.', cost: 3, mods: { gold: 40 } },
  { id: 'spores', name: 'Spore Bed', desc: 'Glowcaps cost 20% less to plant.', cost: 4, mods: { glowcapDiscount: 0.2 } },
  { id: 'kindle', name: 'Quick Kindle', desc: 'The Flare charges 30% faster.', cost: 4, mods: { flareCooldown: 0.7 } },
  { id: 'blaze', name: 'Bright Blaze', desc: 'The Flare hits 60% harder.', cost: 5, mods: { flareDamage: 1.6 } },
  { id: 'rime', name: 'Deep Rime', desc: 'Frost lasts 40% longer.', cost: 5, mods: { frostDuration: 1.4 } },
  { id: 'compost', name: 'Compost', desc: 'Selling returns 85% instead of 70%.', cost: 4, mods: { refund: 0.15 } },
  { id: 'dawn', name: 'Early Riser', desc: 'Calling a wave early pays 50% more.', cost: 4, mods: { earlyGold: 1 } },
];

export function sparksSpent(owned) {
  return PERKS.filter((p) => owned.includes(p.id)).reduce((s, p) => s + p.cost, 0);
}

export function sparksFree(totalStars, owned) {
  return totalStars - sparksSpent(owned);
}

export function canTake(totalStars, owned, id) {
  const p = PERKS.find((x) => x.id === id);
  return !!p && !owned.includes(id) && sparksFree(totalStars, owned) >= p.cost;
}

// Combines owned perks into the mods createGame() takes.
export function modsFor(owned) {
  const m = {};
  for (const p of PERKS) {
    if (!owned.includes(p.id)) continue;
    for (const [k, v] of Object.entries(p.mods)) m[k] = v;
  }
  return m;
}
