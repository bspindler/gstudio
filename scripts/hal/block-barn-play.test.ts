/// <reference lib="dom" />
// Browser tests for the Block Barn scorer's runner (HAL_BROWSER=1 npx vitest run --project hal-browser).
import { spawnSync } from 'node:child_process';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BLOCK_BARN_RULES, BLOCK_BARN_VIEWPORTS, scoreBlockBarn } from '../../packages/core/src/hal/block-barn-score.js';
import { closeAll, launchBrowser, newHalContext, repo, serveGames, type StaticServer } from './browser.js';
import { instrumentScript, runBlockBarnPlay } from './block-barn-play.js';

const AZ = 'abcdefghijklmnopqrstuvwxyz'.split('');
const PHONE = { viewports: ['390x844' as const] };
/** Replaces the hook as soon as the game installs it: `body` gets `v` (the real hook) and may wrap its methods. */
const wrapHook = (body: string): string => `
  Object.defineProperty(window, '__hal', { configurable: true, set(v) {
    ${body};
    Object.defineProperty(window, '__hal', { value: v, writable: true, configurable: true });
  } });`;
/** On the n-th real pointerup, the barn never hears it: the tap is cancelled instead (so no gesture is left open). */
const swallowUp = (n: number, after = '') => `(() => {
  let k = 0;
  window.addEventListener('pointerup', (e) => {
    if (!e.isTrusted || ++k !== ${n}) return;
    e.stopImmediatePropagation();
    document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: e.pointerId, pointerType: 'touch', isPrimary: true }));
    const x = e.clientX, y = e.clientY;
    ${after}
  }, true);
})();`;

describe('runBlockBarnPlay', () => {
  it('taps every kind of target at both viewports with no errors; the barn scores 100 on all five; two runs are identical', async () => {
    const a = await runBlockBarnPlay();
    expect(a.errors).toEqual([]);
    for (const v of BLOCK_BARN_VIEWPORTS) {
      const kinds = new Set(a.records.filter((r) => r.viewport === v).map((r) => r.kind));
      expect([...kinds].sort(), v).toEqual(['animal', 'block', 'corner', 'floor', 'tower']);
      expect(a.page.targets.filter((t) => t.viewport === v).length, `${v}: every target measured before every tap`).toBeGreaterThan(5 * a.records.filter((r) => r.viewport === v).length);
    }
    expect([...a.page.letters].sort()).toEqual(AZ);
    expect([...a.page.voiced].sort()).toEqual(AZ);
    expect([...a.page.pictured].sort()).toEqual(AZ);
    expect(a.page.leftBarn).toBe(false);
    expect(a.page.masterGain).toBe(0.5); // the sound effects really played, through their master stage
    expect(a.page.peakGain).toBeGreaterThan(0.05);
    expect(a.page.peakGain).toBeLessThanOrEqual(BLOCK_BARN_RULES.peakCap);
    for (const r of a.records) expect(r.ms, `${r.viewport} ${r.kind}`).toBeLessThan(50);
    const ra = scoreBlockBarn(a.records, a.page);
    expect(ra.hardFailures).toEqual([]);
    expect(ra.measures).toEqual({ responsive: 100, noDeadEnds: 100, bigTargets: 100, alphabet: 100, calm: 100 });

    const b = await runBlockBarnPlay();
    expect(b.errors).toEqual([]);
    expect(scoreBlockBarn(b.records, b.page).measures).toEqual(ra.measures);
    // Same taps on the same targets, in the same order (only the measured milliseconds may differ).
    const shape = (rs: typeof a.records) => rs.map(({ ms: _ms, ...r }) => r);
    expect(shape(b.records)).toEqual(shape(a.records));
    expect(b.page).toEqual(a.page);
  }, 400_000);

  it('a tap answered only 300 ms later (by a timer) is not answered at all', async () => {
    // The first tap (the hay of a fresh barn) reaches the barn again 300 ms later, as an untrusted re-dispatch.
    const later = `setTimeout(() => { const el = document.elementFromPoint(x, y);
      for (const type of ['pointerdown', 'pointerup']) el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 77, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y })); }, 300);`;
    const r = await runBlockBarnPlay({ ...PHONE, alphabetSteps: 0, initScript: swallowUp(1, later) });
    expect(r.errors).toEqual([]);
    expect(r.records[0]).toMatchObject({ kind: 'floor', changed: false });
    expect(r.records.slice(1).every((x) => x.changed)).toBe(true);
  }, 200_000);

  it('a dead tap among the pending timers of earlier taps is dead, the same way in two runs', async () => {
    // Tap 9 is the first animal, right after five blocks were named (their moves, reactions and friends are pending).
    const run = () => runBlockBarnPlay({ ...PHONE, alphabetSteps: 0, initScript: swallowUp(9) });
    const [a, b] = [await run(), await run()];
    for (const r of [a, b]) {
      expect(r.errors).toEqual([]);
      expect(r.records[8]).toMatchObject({ kind: 'animal', changed: false });
      expect(r.records.filter((x) => !x.changed)).toHaveLength(1);
      expect(scoreBlockBarn(r.records, r.page).measures.noDeadEnds).toBeLessThan(100);
    }
    expect(b.records.map((x) => x.changed)).toEqual(a.records.map((x) => x.changed));
  }, 300_000);

  it('a target of a new kind is measured in every state and tapped; at 40 px it lowers bigTargets', async () => {
    const r = await runBlockBarnPlay({ ...PHONE, alphabetSteps: 0, initScript: wrapHook("const t = v.targets; v.targets = () => [...t(), { kind: 'bell', x: 175, y: 120, w: 40, h: 40 }]") });
    expect(r.errors).toEqual([]);
    expect(r.page.targets.filter((t) => t.kind === 'bell').length).toBeGreaterThan(30);
    expect(r.records.filter((x) => x.kind === 'bell')).toHaveLength(1);
    const s = scoreBlockBarn(r.records, r.page);
    expect(s.hardFailures.filter((h) => !h.includes('1024x768'))).toEqual([]); // a phone-only run
    expect(s.levels[0]!.bigTargets).toBeLessThan(100);
    expect(s.levels[0]!.kinds).toContain('bell');
  }, 200_000);

  it('the alphabet walk does not care which slot a new letter lands in; a letter whose voice says another letter is not voiced', async () => {
    // The hook lists the floor in alphabetical order (so the new letter is rarely first), and the device voice says
    // "Z." when the barn asks it to say "Q.".
    const init = `${wrapHook("const s = v.state; v.state = () => { const x = s(); x.floor = [...x.floor].sort(); return x; }")}
      const U = window.SpeechSynthesisUtterance;
      window.SpeechSynthesisUtterance = function (t) { return new U(t === 'Q.' ? 'Z.' : t); };`;
    const r = await runBlockBarnPlay({ ...PHONE, initScript: init });
    expect(r.errors).toEqual([]);
    expect(r.page.letters).toEqual(AZ);
    expect(r.page.pictured).toEqual(AZ);
    expect(r.page.voiced).toEqual(AZ.filter((l) => l !== 'q'));
  }, 300_000);

  it('a hung page rejects the score at the deadline instead of stalling', async () => {
    const t0 = Date.now();
    const r = await runBlockBarnPlay({ ...PHONE, alphabetSteps: 0, deadlineMs: 8000, initScript: wrapHook('let n = 0; const t = v.targets; v.targets = () => { if (++n === 4) for (;;) {} return t(); }') });
    expect(r.errors).toContainEqual(expect.stringMatching(/^390x844: hang: the tap script took over 8 s wall$/));
    expect(Date.now() - t0).toBeLessThan(60_000);
  }, 120_000);

  it('a page error is a hard failure, not a score', async () => {
    const r = await runBlockBarnPlay({ ...PHONE, alphabetSteps: 0, initScript: "setTimeout(() => { throw new Error('injected boom'); }, 50);" });
    expect(r.errors).toEqual([expect.stringMatching(/390x844: page error: .*injected boom/)]);
  }, 200_000);
});

// The instrumentation alone, on the game's page (no taps): what it records from injected audio and animations.
describe('block barn instrumentation', () => {
  let server: StaticServer, browser: Browser;
  beforeAll(async () => { server = await serveGames(); browser = await launchBrowser(); });
  afterAll(async () => { await closeAll(browser, server); });
  const inPage = async <T>(code: string, read: string, settle = 0): Promise<T> => {
    const { context } = await newHalContext(browser);
    try {
      await context.addInitScript({ content: instrumentScript() });
      const page = await context.newPage();
      await page.goto(`${server.origin}/block-barn/index.html`);
      await page.evaluate(code);
      if (settle) await page.waitForTimeout(settle);
      return await page.evaluate(read) as T;
    } finally { await context.close(); }
  };
  const audio = (code: string) => inPage<{ masterGain: number; peakGain: number }>(`(() => { const c = new AudioContext(); const t = c.currentTime;
    const osc = (to, at = 0, dur = 0.3) => { const o = c.createOscillator(); o.connect(to); o.start(t + at); o.stop(t + at + dur); return o; };
    ${code} })()`, 'window.__bbPlay.audio()');

  it("a sound like the game's (envelope 0.12 through a 0.5 master and a compressor) is 0.06; the master stage is 0.5", async () => {
    const a = await audio(`const comp = c.createDynamicsCompressor(); comp.connect(c.destination);
      const m = c.createGain(); m.gain.value = 0.5; m.connect(comp);
      for (const at of [0, 1]) { const g = c.createGain(); g.connect(m);
        g.gain.setValueAtTime(0.0001, t + at); g.gain.exponentialRampToValueAtTime(0.12, t + at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.09);
        osc(g, at, 0.14); }`);
    expect(a.masterGain).toBeCloseTo(0.5, 6);
    expect(a.peakGain).toBeCloseTo(0.06, 6);
  });
  it('a gain of 0.4 straight to the speakers is over the cap', async () => {
    expect((await audio('const g = c.createGain(); g.gain.value = 0.4; g.connect(c.destination); osc(g);')).peakGain).toBeCloseTo(0.4, 6);
  });
  it('a gain made with new GainNode(ctx, { gain: 0.4 }) is recorded', async () => {
    expect((await audio('const g = new GainNode(c, { gain: 0.4 }); g.connect(c.destination); osc(g);')).peakGain).toBeCloseTo(0.4, 6);
  });
  it('a gain node never set plays at its default 1; an oscillator straight to the speakers too', async () => {
    expect((await audio('const g = c.createGain(); g.connect(c.destination); osc(g);')).peakGain).toBeCloseTo(1, 6);
    expect((await audio('osc(c.destination);')).peakGain).toBeCloseTo(1, 6);
  });
  it('a five-tone chord at 0.12 each sums to 0.6', async () => {
    expect((await audio('for (let i = 0; i < 5; i++) { const g = c.createGain(); g.gain.value = 0.12; g.connect(c.destination); osc(g); }')).peakGain).toBeCloseTo(0.6, 6);
  });
  it('a sound wired past the master is judged by its own full path, not as the master', async () => {
    const a = await audio(`const comp = c.createDynamicsCompressor(); comp.connect(c.destination);
      const m = c.createGain(); m.gain.value = 0.5; m.connect(comp);
      for (const at of [0, 1]) { const g = c.createGain(); g.gain.value = 0.1; g.connect(m); osc(g, at); }
      const loud = c.createGain(); loud.gain.value = 0.4; loud.connect(comp); osc(loud, 2);`);
    expect(a.masterGain).toBeCloseTo(0.5, 6);
    expect(a.peakGain).toBeCloseTo(0.4, 6);
  });
  it('a master stage turned up to 0.8 is over its cap', async () => {
    const a = await audio(`const m = c.createGain(); m.gain.setValueAtTime(0.8, t); m.connect(c.destination);
      for (const at of [0, 1]) { const g = c.createGain(); g.gain.value = 0.1; g.connect(m); osc(g, at); }`);
    expect(a.masterGain).toBeCloseTo(0.8, 6);
    expect(a.peakGain).toBeCloseTo(0.08, 6);
  });

  const flashes = (css: string, html = '<div class="x" style="width:50px;height:50px;background:#fc0"></div>') =>
    inPage<string[]>(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; document.head.append(s);
      document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(html)}); })()`, 'window.__bbPlay.flashes', 900);
  it('a fast repeating brightness change is a flash; so is a fast back-and-forth inside one iteration', async () => {
    expect(await flashes('@keyframes b { 50% { opacity: 0; } } .x { animation: b .1s linear 6; }')).toHaveLength(1);
    expect(await flashes('@keyframes b { 0% { opacity: 1; } 30% { opacity: 0; } 60% { opacity: 1; } } .x { animation: b .5s linear 1; }')).toHaveLength(1);
    expect(await inPage<string[]>("document.body.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(3)' }, { filter: 'brightness(1)' }], 400)", 'window.__bbPlay.flashes')).toHaveLength(1);
  });
  it('a single quick fade, a slow glow and a fast wiggle are not flashes', async () => {
    expect(await flashes('@keyframes f { from { opacity: 0; } to { opacity: 1; } } .x { animation: f .2s ease-out 1; }')).toEqual([]);
    expect(await flashes('@keyframes g { 50% { box-shadow: 0 0 18px 10px #fff; } } .x { animation: g 2.4s ease-in-out infinite; }')).toEqual([]);
    expect(await flashes('@keyframes w { 50% { transform: rotate(-24deg); } } .x { animation: w .3s ease-in-out 3; }')).toEqual([]);
  });
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
