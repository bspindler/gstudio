// Browser-free: screens refuses an --out that would delete game sources (the check runs before any browser launches).
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('playwright', () => ({ chromium: { launch: vi.fn(async () => { throw new Error('should not launch'); }) } }));
const { runScreens } = await import('./screens.js');
const { repo } = await import('./browser.js');

describe('runScreens --out', () => {
  it('refuses the repo root and anything inside games/', async () => {
    for (const out of [repo, join(repo, 'games'), join(repo, 'games', 'gearhold'), join(repo, 'games', '..', 'games')])
      await expect(runScreens({ outDir: out }), out).rejects.toThrow(/refusing --out/);
  });
});
