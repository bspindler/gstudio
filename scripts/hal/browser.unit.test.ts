// Browser-free (runs in npm test): a browser that cannot launch is an error, never a score.
import { describe, expect, it, vi } from 'vitest';

vi.mock('playwright', () => ({
  chromium: { launch: vi.fn(async () => { throw new Error("Executable doesn't exist at /nowhere\nmore detail"); }) },
}));

const { launchBrowser } = await import('./browser.js');
const { runGearholdPlay } = await import('./gearhold-play.js');

describe('browser unavailable', () => {
  it('launchBrowser tries gpu then swiftshader and throws "browser unavailable: ..."', async () => {
    await expect(launchBrowser()).rejects.toThrow(/^browser unavailable: gpu: Executable doesn't exist at \/nowhere; swiftshader: /);
  });

  it('runGearholdPlay rejects instead of returning records', async () => {
    await expect(runGearholdPlay({ levels: [0], seeds: 1 })).rejects.toThrow(/^browser unavailable:/);
  });
});
