// Browser tests for the Block Barn scorer's runner (HAL_BROWSER=1 npx vitest run --project hal-browser).
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { BLOCK_BARN_VIEWPORTS, scoreBlockBarn } from '../../packages/core/src/hal/block-barn-score.js';
import { repo } from './browser.js';
import { runBlockBarnPlay } from './block-barn-play.js';

const AZ = 'abcdefghijklmnopqrstuvwxyz'.split('');

describe('runBlockBarnPlay', () => {
  it('taps every kind of target at both viewports with no errors; the barn scores 100 on all five; two runs score the same', async () => {
    const a = await runBlockBarnPlay();
    expect(a.errors).toEqual([]);
    for (const v of BLOCK_BARN_VIEWPORTS) {
      const kinds = new Set(a.records.filter((r) => r.viewport === v).map((r) => r.kind));
      expect([...kinds].sort(), v).toEqual(['animal', 'block', 'corner', 'floor', 'tower']);
    }
    expect([...a.page.letters].sort()).toEqual(AZ);
    expect([...a.page.voiced].sort()).toEqual(AZ);
    expect([...a.page.pictured].sort()).toEqual(AZ);
    expect(a.page.leftBarn).toBe(false);
    expect(a.page.masterGain).toBeGreaterThan(0); // the sound effects really played
    const ra = scoreBlockBarn(a.records, a.page);
    expect(ra.hardFailures).toEqual([]);
    expect(ra.measures).toEqual({ responsive: 100, noDeadEnds: 100, bigTargets: 100, alphabet: 100, calm: 100 });

    const b = await runBlockBarnPlay();
    expect(b.errors).toEqual([]);
    const rb = scoreBlockBarn(b.records, b.page);
    expect(rb.measures).toEqual(ra.measures);
    // Same taps on the same targets, in the same order (only the measured milliseconds may differ).
    const shape = (rs: typeof a.records) => rs.map(({ ms: _ms, ...r }) => r);
    expect(shape(b.records)).toEqual(shape(a.records));
    expect(b.page).toEqual(a.page);
  }, 300_000);

  it('a tap that does nothing is a dead end; a fast flash breaks calm', async () => {
    // Swallow the pointerup of the first tap (on the hay of a fresh barn) before the barn hears it, and make every puff a 100 ms opacity blink.
    const initScript = `(() => {
      let n = 0;
      window.addEventListener('pointerup', (e) => { if (++n === 1) e.stopImmediatePropagation(); }, true);
      document.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style');
        s.textContent = '@keyframes blink { 50% { opacity: 0; } } .puff { animation: blink .1s linear 6 !important; }';
        document.head.append(s);
      });
    })();`;
    const r = await runBlockBarnPlay({ viewports: ['390x844'], alphabetSteps: 0, initScript });
    expect(r.errors).toEqual([]);
    expect(r.records.filter((x) => !x.changed)).toHaveLength(1);
    expect(r.page.flashes).toBeGreaterThan(0);
  }, 120_000);

  it('a page error is a hard failure, not a score', async () => {
    const r = await runBlockBarnPlay({ viewports: ['390x844'], alphabetSteps: 0, initScript: "setTimeout(() => { throw new Error('injected boom'); }, 50);" });
    expect(r.errors).toEqual([expect.stringMatching(/390x844: page error: .*injected boom/)]);
  }, 120_000);
});

describe('npm run hal -- score --game block-barn', () => {
  it('prints a score report with the five measures', () => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/hal.ts', 'score', '--game', 'block-barn'], { cwd: repo, encoding: 'utf8', timeout: 280_000 });
    expect(r.stderr).not.toMatch(/error|unknown game/i);
    expect(r.status).toBe(0);
    for (const m of ['responsive', 'noDeadEnds', 'bigTargets', 'alphabet', 'calm']) expect(r.stdout).toMatch(new RegExp(`^${m}: 100\\.0$`, 'm'));
    expect(r.stdout).toMatch(/^fitness: 100\.0$/m);
  }, 300_000);
});
