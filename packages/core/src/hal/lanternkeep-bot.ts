// A plain greedy Lanternkeep player, used by the balance tests and Hal's scorer. It is not clever: it builds on
// a tile that covers a lot of path, rotates through the plants it has, grows plants instead of spreading once it
// has a few, picks branches by plant, and fires the Flare when creatures crowd the lantern. Once every plant is
// fully grown and gold piles up, it plants again past its style's cap rather than hoarding. It never calls a wave
// early. The game itself has no randomness, so variety comes from `style` (how many plants it will keep) and
// `seed` (which of the best few tiles it picks). If no style can win a night, an attentive person will struggle
// too; if doing nothing wins, the night is broken.
import {
  COLS, FLARE_RADIUS, ROWS, TOWERS, buildCost, callWave, canBuild, coverage, createGame, flareCharge, needsBranch,
  place, starsFor, step, upgrade, upgradeCost, useFlare,
  type Game, type Level, type Mods, type TowerType,
} from '../../../../games/lanternkeep/lib/sim.js';

export type LanternkeepBotOptions = {
  /** Most plants it keeps; Infinity spreads wide, a small number grows a few plants tall. 0 plants nothing. */
  maxTowers?: number;
  upgrades?: boolean;
  flare?: boolean;
  /** 0 always takes the best tile; other seeds pick among the best few, so each seed plays a little differently. */
  seed?: number;
  mods?: Mods;
  /** Safety stop, in simulated seconds. */
  maxSeconds?: number;
};

export type LanternkeepPlay = {
  won: boolean; stars: number; lives: number; maxLives: number;
  /** Waves started (Night Watch: how far the night got). */
  wave: number; towers: number; gold: number; flares: number;
};

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function pickTile(g: Game, type: TowerType, rnd: (() => number) | null): { c: number; r: number; cov: number } | null {
  const range = TOWERS[type].tiers[0]!.range;
  const all: { c: number; r: number; cov: number }[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!canBuild(g, c, r)) continue;
      // Prefer tiles closer to the lantern on ties: they see every creature.
      all.push({ c, r, cov: coverage(g, c, r, range) - 0.01 * Math.hypot(c - g.lantern.c, r - g.lantern.r) });
    }
  }
  if (!all.length) return null;
  all.sort((a, b) => b.cov - a.cov);
  if (!rnd) return all[0]!;
  // One of the best three, as long as it is nearly as good as the best.
  const top = all.slice(0, 3).filter((t) => t.cov >= all[0]!.cov - 1.5);
  return top[Math.floor(rnd() * top.length)]!;
}

/** Overflow planting starts when gold exceeds this many times the next plant's cost. */
export const OVERFLOW_GOLD = 2;

const ROTATION: TowerType[] = ['glowcap', 'glowcap', 'frost', 'ember', 'sunspire', 'ember', 'glowcap', 'sunspire'];

export function playLanternkeep(level: Level, opts: LanternkeepBotOptions = {}): LanternkeepPlay {
  const g = createGame(level, opts.mods);
  const maxTowers = opts.maxTowers ?? Infinity;
  const upgrades = opts.upgrades ?? true;
  const flare = opts.flare ?? true;
  const rnd = opts.seed ? mulberry(opts.seed) : null;
  const rotation = ROTATION.filter((t) => level.towers.includes(t));
  let k = 0;
  let wantUpgrade = false; // after the first few plants, alternate: build one, grow one
  const spend = () => {
    for (let guard = 0; guard < 50; guard++) {
      const type = rotation[k % rotation.length]!;
      const cost = buildCost(g, type);
      const canUpgrade = upgrades && g.towers.some((t) => upgradeCost(t) !== null);
      // A person doesn't sit on a pile of gold while the garden falls: once every plant is fully grown and gold
      // is plentiful, plant again, past the style's cap and on thinner tiles (measurement v2 P2).
      const overflow = upgrades && g.towers.length > 0 && !canUpgrade && g.gold > OVERFLOW_GOLD * cost;
      const tile = g.towers.length < maxTowers || overflow ? pickTile(g, type, rnd) : null;
      const minCov = overflow ? 1 : TOWERS[type].tiers[0]!.range * 1.5;
      if (tile && tile.cov >= minCov && !(wantUpgrade && canUpgrade)) {
        if (g.gold < cost) return;
        place(g, type, tile.c, tile.r);
        k += 1;
        wantUpgrade = g.towers.length >= 3;
        continue;
      }
      if (!upgrades) return;
      wantUpgrade = false;
      const cheapest = g.towers
        .filter((t) => upgradeCost(t) !== null)
        .sort((a, b) => (upgradeCost(a) ?? 0) - (upgradeCost(b) ?? 0))[0];
      if (!cheapest || g.gold < (upgradeCost(cheapest) ?? Infinity)) return;
      upgrade(g, cheapest.id, needsBranch(cheapest) ? (cheapest.id % 2 ? 'a' : 'b') : undefined);
    }
  };
  if (maxTowers > 0) spend();
  callWave(g);
  const maxTicks = 30 * (opts.maxSeconds ?? 60 * 40);
  let ticks = 0;
  while (g.phase === 'wave' && ticks++ < maxTicks) {
    step(g);
    if (ticks % 15 === 0 && maxTowers > 0) spend();
    if (flare && flareCharge(g) >= 1) {
      const near = g.enemies.filter((e) => Math.hypot(e.x - g.lantern.x, e.y - g.lantern.y) <= FLARE_RADIUS).length;
      if (near >= 3) useFlare(g);
    }
  }
  const won = g.phase === 'won';
  return { won, stars: won ? starsFor(g) : 0, lives: g.lives, maxLives: g.maxLives, wave: g.waveIndex + 1, towers: g.towers.length, gold: g.gold, flares: g.stats.flares };
}

/** The play styles the scorer and balance tests use: spread wide, or a few plants grown tall. */
export const LANTERNKEEP_STYLES: LanternkeepBotOptions[] = [{}, { maxTowers: 4 }, { maxTowers: 6 }, { maxTowers: 8 }];
