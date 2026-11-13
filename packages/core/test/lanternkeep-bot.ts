// A plain greedy player for Lanternkeep balance tests. It is not clever: it builds on the tile
// that covers the most path, rotates through the towers it has, and upgrades when building
// stops paying. It never calls a wave early. If this bot can't win a level, a person who is
// paying attention will struggle too; if a lazy bot can win, the level is too easy.
import {
  COLS, ROWS, FLARE_RADIUS, TOWERS, buildCost, canBuild, coverage, createGame, flareCharge, needsBranch, place, step, upgrade, upgradeCost, useFlare, callWave, starsFor,
} from '../../../games/lanternkeep/lib/sim.js';

type Level = Parameters<typeof createGame>[0];
type Game = ReturnType<typeof createGame>;

export type BotResult = { won: boolean; stars: number; lives: number; wave: number; towers: number; gold: number };

function bestTile(g: Game, type: string): { c: number; r: number; cov: number } | null {
  const range = TOWERS[type as keyof typeof TOWERS].tiers[0]!.range;
  let best: { c: number; r: number; cov: number } | null = null;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!canBuild(g, c, r)) continue;
      // Prefer tiles closer to the lantern on ties: they see every enemy.
      const cov = coverage(g, c, r, range) - 0.01 * Math.hypot(c - g.lantern.c, r - g.lantern.r);
      if (!best || cov > best.cov) best = { c, r, cov };
    }
  }
  return best;
}

export function play(level: Level, opts: { maxTowers?: number; upgrades?: boolean; flare?: boolean; mods?: Parameters<typeof createGame>[1] } = {}): BotResult {
  const g = createGame(level, opts.mods);
  const flare = opts.flare ?? true;
  const maxTowers = opts.maxTowers ?? Infinity;
  const upgrades = opts.upgrades ?? true;
  const rotation = ['glowcap', 'glowcap', 'frost', 'ember', 'sunspire', 'ember', 'glowcap', 'sunspire'].filter((t) => (level.towers as string[]).includes(t));
  let k = 0;
  let wantUpgrade = false; // after the first few towers, alternate: build one, upgrade one
  const spend = () => {
    for (let guard = 0; guard < 50; guard++) {
      const type = rotation[k % rotation.length]!;
      const cost = buildCost(g, type as keyof typeof TOWERS);
      const tile = g.towers.length < maxTowers ? bestTile(g, type) : null;
      const minCov = TOWERS[type as keyof typeof TOWERS].tiers[0]!.range * 1.5;
      const canUpgrade = upgrades && g.towers.some((t) => upgradeCost(t) !== null);
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
  spend();
  callWave(g);
  let ticks = 0;
  while (g.phase === 'wave' && ticks++ < 30 * 60 * 20) {
    step(g);
    if (ticks % 15 === 0) spend();
    // Flare when three or more creatures crowd the lantern.
    if (flare && flareCharge(g) >= 1) {
      const near = g.enemies.filter((e) => Math.hypot(e.x - g.lantern.x, e.y - g.lantern.y) <= FLARE_RADIUS).length;
      if (near >= 3) useFlare(g);
    }
  }
  return { won: g.phase === 'won', stars: g.phase === 'won' ? starsFor(g) : 0, lives: g.lives, wave: g.waveIndex + 1, towers: g.towers.length, gold: g.gold };
}
