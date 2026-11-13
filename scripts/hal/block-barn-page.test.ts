/// <reference lib="dom" />
// Block Barn in a phone browser (390x844, touch), driven through real taps and the ?hal hook.
// Speech is replaced with a fake that records what was said and holds each line until released,
// so "speaking" is deterministic; the invitation's 8 s idle runs on the hook's idle clock, not real time.
import type { Browser, CDPSession, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAll, launchBrowser, newHalContext, serveGames, type HalContext, type StaticServer } from './browser.js';

type Target = { kind: 'block' | 'animal' | 'tower' | 'floor' | 'corner'; letter?: string; x: number; y: number; w: number; h: number };
type State = { floor: string[]; named: string[]; tower: string[]; corner: boolean; speaking: string | null; invited: string | null };

let server: StaticServer, browser: Browser;
const opened: HalContext[] = [];
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const TABLET = { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true };

beforeAll(async () => {
  server = await serveGames();
  browser = await launchBrowser();
});
afterAll(async () => {
  for (const h of opened) await h.context.close().catch(() => {});
  await closeAll(browser, server);
});

function fakeSpeech(): void {
  const log: string[] = [];
  let hold = true;
  const pending: any[] = [];
  const w = window as any;
  const calls: { text: string; volume: number; sync: boolean; rate: number; pitch: number }[] = [];
  const times: { text: string; start: number; end: number | null }[] = [];
  const plays: { src: string; sync: boolean }[] = [];
  const realPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) { plays.push({ src: this.src, sync: w.__sync === true }); return realPlay.call(this); };
  const fake = {
    speak(u: any) {
      calls.push({ text: u.text, volume: u.volume, sync: w.__sync === true, rate: u.rate, pitch: u.pitch });
      if (u.text.trim() === '') return; // the silent priming utterance
      const t = { text: u.text, start: performance.now(), end: null as number | null };
      times.push(t);
      const end = u.onend;
      u.onend = (e: unknown) => { t.end = performance.now(); end?.call(u, e); };
      log.push(u.text); pending.push(u); if (!hold) setTimeout(() => u.onend?.(), 10);
    },
    cancel() { log.push('<cancel>'); pending.length = 0; },
    getVoices: () => [], addEventListener() {}, removeEventListener() {}, pause() {}, resume() {},
  };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, get: () => fake });
  (window as any).__fakeSpeech = { log, calls, plays, times, release() { hold = false; for (const u of pending.splice(0)) u.onend?.(); } };
}

async function open(query = '?hal', contextOptions = PHONE): Promise<{ page: Page; hal: HalContext }> {
  const hal = await newHalContext(browser, { contextOptions });
  opened.push(hal);
  await hal.context.addInitScript(fakeSpeech);
  const page = await hal.context.newPage();
  page.on('pageerror', (e) => hal.consoleErrors.push(String(e)));
  await page.goto(`${server.origin}/block-barn/index.html${query}`);
  if (query.includes('hal')) await page.waitForFunction(() => !!(window as any).__hal, null, { timeout: 5000 });
  return { page, hal };
}

const state = (page: Page): Promise<State> => page.evaluate(() => (window as any).__hal.state());
const targets = (page: Page): Promise<Target[]> => page.evaluate(() => (window as any).__hal.targets());
const idle = (page: Page, ms: number) => page.evaluate((n) => (window as any).__hal.idle(n), ms);
const said = (page: Page): Promise<string[]> => page.evaluate(() => [...(window as any).__fakeSpeech.log]);
const center = (t: Target) => ({ x: t.x + t.w / 2, y: t.y + t.h / 2 });

async function find(page: Page, kind: Target['kind'], letter?: string): Promise<Target> {
  const t = (await targets(page)).find((x) => x.kind === kind && (letter === undefined || x.letter === letter));
  if (!t) throw new Error(`no ${kind} target${letter ? ` for ${letter}` : ''}`);
  return t;
}
async function tap(page: Page, t: Target) { const c = center(t); await page.touchscreen.tap(c.x, c.y); }
async function tapBlock(page: Page, letter: string) { await tap(page, await find(page, 'block', letter)); }

/** Seeds the barn until `letter` is on the floor. */
async function seedWith(page: Page, letter: string): Promise<void> {
  for (let n = 1; n < 500; n++) {
    await page.evaluate((s) => (window as any).__hal.seed(s), n);
    if ((await state(page)).floor.includes(letter)) return;
  }
  throw new Error(`no seed puts ${letter} on the floor`);
}

async function touch(page: Page, cdp: CDPSession, type: 'touchStart' | 'touchEnd', points: { x: number; y: number }[]) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
}

/** Dispatches a synthetic pointer event on the barn (or `on`), with window.__sync true only while it runs. */
async function pointer(page: Page, type: 'pointerdown' | 'pointerup' | 'pointercancel', id: number, at: { x: number; y: number }, on = '#barn') {
  await page.evaluate(({ type, id, at, on }) => {
    const w = window as any;
    w.__sync = true;
    document.querySelector(on)!.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, isPrimary: true, pointerType: 'touch', clientX: at.x, clientY: at.y }));
    w.__sync = false;
  }, { type, id, at, on });
}

function overlaps(a: Target, b: Target): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('block barn page', () => {
  it('loads with no console errors and no request outside its origin', async () => {
    const { page, hal } = await open();
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await tapBlock(page, (await state(page)).floor[0]!);
    await page.waitForTimeout(300);
    expect(hal.consoleErrors).toEqual([]);
    expect(hal.blockedRequests).toEqual([]);
    for (const u of requests) expect(u.startsWith(server.origin) || u.startsWith('data:') || u.startsWith('blob:'), u).toBe(true);
  });

  it('has no hook without ?hal', async () => {
    const { page, hal } = await open('');
    await page.waitForSelector('[data-letter]');
    expect(await page.evaluate(() => typeof (window as any).__hal)).toBe('undefined');
    expect(hal.consoleErrors).toEqual([]);
  });

  for (const [name, opts] of [['phone 390x844', PHONE], ['tablet 1024x768', TABLET]] as const) {
    it(`shows 5 floor blocks, every target at least 88 px, inside the screen and clear of the corner (${name})`, async () => {
      const { page } = await open('?hal', opts);
      const s = await state(page);
      expect(s.floor).toHaveLength(5);
      expect(new Set(s.floor).size).toBe(5);
      // Name two so their animals are targets too.
      for (const l of s.floor.slice(0, 2)) await tapBlock(page, l);
      const ts = await targets(page);
      expect(ts.filter((t) => t.kind === 'block').map((t) => t.letter).sort()).toEqual([...s.floor].sort());
      expect(ts.filter((t) => t.kind === 'animal')).toHaveLength(2);
      const corner = ts.find((t) => t.kind === 'corner')!;
      expect(corner).toBeTruthy();
      for (const t of ts) {
        expect(t.x, `${t.kind} ${t.letter ?? ''} x`).toBeGreaterThanOrEqual(0);
        expect(t.y).toBeGreaterThanOrEqual(0);
        expect(t.x + t.w).toBeLessThanOrEqual(opts.viewport.width + 0.5);
        expect(t.y + t.h).toBeLessThanOrEqual(opts.viewport.height + 0.5);
        if (t.kind === 'corner') continue;
        expect(Math.min(t.w, t.h), `${t.kind} ${t.letter ?? ''} size`).toBeGreaterThanOrEqual(88);
        expect(overlaps(t, corner), `${t.kind} ${t.letter ?? ''} overlaps the corner`).toBe(false);
      }
      const blocks = ts.filter((t) => t.kind === 'block');
      for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) expect(overlaps(blocks[i]!, blocks[j]!)).toBe(false);
    });
  }

  // Task 11 (Brian's playtest): "the blocks and the animal pics are too small; 80% of the barn is unfilled".
  const SIZES = [
    ['phone', 390, 844], ['phone', 375, 667], ['phone', 430, 932],
    ['tablet', 1024, 768], ['tablet', 768, 1024],
    ['desktop', 1280, 720], ['desktop', 1440, 900], ['desktop', 1920, 1080],
  ] as const;
  type Box = { x: number; y: number; w: number; h: number };
  /** What is actually drawn, in screen px: each block, each animal's art (its drawing's getBBox mapped to the
   *  screen) and the tower's bale, stack and animal art. */
  const drawn = (page: Page) => page.evaluate(() => {
    const box = (r: DOMRect) => ({ x: r.left, y: r.top, w: r.width, h: r.height });
    const art = (svg: Element | null) => {
      const g = svg?.querySelector('.art') as SVGGraphicsElement | null;
      if (!g) return null;
      const bb = g.getBBox(), m = g.getScreenCTM()!;
      return { x: m.a * bb.x + m.e, y: m.d * bb.y + m.f, w: m.a * bb.width, h: m.d * bb.height };
    };
    const slots = Array.from(document.querySelectorAll('.slot')).map((el) => ({
      letter: (el as HTMLElement).dataset.letter!,
      block: box(el.querySelector('.block')!.getBoundingClientRect()),
      art: art(el.querySelector('.animal .pic')),
    }));
    const stack = box(document.querySelector('#tower .stack')!.getBoundingClientRect());
    const tower = [box(document.querySelector('#tower .bale')!.getBoundingClientRect()), stack, art(document.querySelector('#tower .tanimal .pic'))]
      .filter((r): r is { x: number; y: number; w: number; h: number } => !!r && r.w > 0 && r.h > 0);
    const blocks = Array.from(document.querySelectorAll('#tower .stack .tblock')).map((b) => box(b.getBoundingClientRect()));
    const ta = document.querySelector('#tower .tanimal');
    return { slots, tower, stackBlocks: blocks, towerAnimalBox: ta ? box(ta.getBoundingClientRect()) : null, wall: document.getElementById('floor')!.getBoundingClientRect().top };
  });

  for (const [kind, W, H] of SIZES) {
    it(`fills the barn at ${W}x${H} (${kind}): drawn content covers half the floor with no empty band; big blocks, animals and tower`, async () => {
      const contextOptions = kind === 'desktop'
        ? { viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: false }
        : { viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: true };
      const { page, hal } = await open('?hal', contextOptions);
      for (const seed of [1, 2]) {
        await page.evaluate((n) => (window as any).__hal.seed(n), seed);
        // The floor as it looks on screen: the hook's floor target is a real empty spot, and a tap there puffs.
        const t0 = await targets(page);
        const floor = t0.find((t) => t.kind === 'floor')!;
        expect(Math.min(floor.w, floor.h), 'floor area size').toBeGreaterThanOrEqual(88);
        const fc = center(floor);
        for (const t of t0.filter((x) => x.kind !== 'floor')) {
          const dx = Math.max(t.x - fc.x, 0, fc.x - (t.x + t.w)), dy = Math.max(t.y - fc.y, 0, fc.y - (t.y + t.h));
          expect(Math.hypot(dx, dy), `floor centre is clear of ${t.kind} ${t.letter ?? ''}`).toBeGreaterThan(44);
        }

        // A full tower (five; the sixth tumbles), then all five floor blocks named: the fullest the barn gets.
        for (let i = 0; i < 5; i++) {
          const l = (await state(page)).floor[0]!;
          if (!(await state(page)).named.includes(l)) await tapBlock(page, l);
          await tapBlock(page, l);
        }
        expect((await state(page)).tower).toHaveLength(5);
        for (const l of (await state(page)).floor) await tapBlock(page, l);
        expect((await state(page)).named).toHaveLength(5);
        await page.waitForTimeout(2500); // the pop, the move, the wobble and any pair reaction are over (boxes include transforms)
        const d = await drawn(page);
        const where = `seed ${seed}`;
        expect(d.wall, 'barn wall height').toBeLessThanOrEqual(0.15 * H + 0.5);

        // Drawn content covers at least half the floor (4 px sampling) ...
        const rects: Box[] = [...d.slots.map((x) => x.block), ...d.slots.map((x) => x.art!), ...d.tower];
        let hit = 0, all = 0;
        for (let y = d.wall + 2; y < H; y += 4) for (let x = 2; x < W; x += 4) {
          all++;
          if (rects.some((t) => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h)) hit++;
        }
        expect(hit / all, `${where}: share of the floor drawn on`).toBeGreaterThanOrEqual(0.5);
        // ... and no horizontal band of bare hay taller than 20% of the floor.
        let run = 0, worst = 0;
        for (let y = d.wall; y < H; y += 2) {
          if (rects.some((t) => y >= t.y && y < t.y + t.h)) run = 0; else { run += 2; worst = Math.max(worst, run); }
        }
        expect(worst, `${where}: tallest empty band`).toBeLessThanOrEqual(0.2 * (H - d.wall));

        for (const sl of d.slots) {
          const b = sl.block;
          if (kind === 'phone') expect(b.w, `block ${sl.letter} width`).toBeGreaterThanOrEqual(0.3 * W);
          else expect(b.w, `block ${sl.letter} width`).toBeGreaterThanOrEqual(0.2 * Math.min(W, H));
          expect(b.h / b.w, `block ${sl.letter} shape`).toBeGreaterThanOrEqual(0.99);
          expect(b.h / b.w, `block ${sl.letter} shape`).toBeLessThanOrEqual(1.41);
          // Each animal's drawing is big: its larger side at least 90% of its block's width.
          expect(Math.max(sl.art!.w, sl.art!.h), `${where}: animal ${sl.letter} drawn size`).toBeGreaterThanOrEqual(0.9 * b.w);
        }

        const ts = await targets(page);
        expect(ts.filter((t) => t.kind === 'block')).toHaveLength(5);
        expect(ts.filter((t) => t.kind === 'animal')).toHaveLength(5);
        const corner = ts.find((t) => t.kind === 'corner')!;
        const taps = ts.filter((t) => t.kind !== 'floor');
        for (const t of taps) {
          const what = `${t.kind} ${t.letter ?? ''}`;
          expect(t.x, `${what} x`).toBeGreaterThanOrEqual(0);
          expect(t.y, `${what} y`).toBeGreaterThanOrEqual(0);
          expect(t.x + t.w, `${what} right`).toBeLessThanOrEqual(W + 0.5);
          expect(t.y + t.h, `${what} bottom`).toBeLessThanOrEqual(H + 0.5);
          if (t.kind === 'corner') continue;
          expect(Math.min(t.w, t.h), `${what} size`).toBeGreaterThanOrEqual(88);
          expect(overlaps(t, corner), `${what} overlaps the corner`).toBe(false);
        }
        for (let i = 0; i < taps.length; i++) for (let j = i + 1; j < taps.length; j++) {
          expect(overlaps(taps[i]!, taps[j]!), `${taps[i]!.kind} ${taps[i]!.letter ?? ''} overlaps ${taps[j]!.kind} ${taps[j]!.letter ?? ''}`).toBe(false);
        }
        // The tower's tap target is the tower itself (its stack on its bale), not its whole column.
        const tower = ts.find((t) => t.kind === 'tower')!;
        const stackBox = d.tower[1]!;
        expect(tower.x).toBeLessThanOrEqual(stackBox.x + 0.5);
        expect(tower.y).toBeLessThanOrEqual(stackBox.y + 0.5);
        const parts = [...d.tower, ...(d.towerAnimalBox ? [d.towerAnimalBox] : [])];
        const towerTop = Math.min(...parts.map((r) => r.y)), towerBottom = Math.max(...parts.map((r) => r.y + r.h));
        expect(tower.y, 'tower target hugs the drawn tower').toBeGreaterThanOrEqual(Math.min(towerTop, towerBottom - 88) - 1);
        expect(d.stackBlocks).toHaveLength(5);
        for (const b of d.stackBlocks) {
          expect(Math.min(b.w, b.h), 'tower block size').toBeGreaterThanOrEqual(56);
          expect(b.y).toBeGreaterThanOrEqual(d.wall - 0.5);
          expect(b.y + b.h).toBeLessThanOrEqual(H + 0.5);
        }
      }
      expect(hal.consoleErrors).toEqual([]);
    });
  }

  it('a tap on the hay beside a short tower puffs instead of knocking it down', async () => {
    const { page } = await open();
    const l = (await state(page)).floor[0]!;
    await tapBlock(page, l); await tapBlock(page, l);
    expect((await state(page)).tower).toEqual([l]);
    const tw = await find(page, 'tower');
    const col = await page.evaluate(() => { const r = document.getElementById('tower')!.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    expect(tw.y - col.y, 'hay above the tower').toBeGreaterThan(200);
    await page.touchscreen.tap(col.x + col.w / 2, col.y + 30);
    expect((await state(page)).tower).toEqual([l]);
  });

  it('tapping block C names it and starts speaking within 100 ms: "C." (once), then "cow", then "moo", 700 ms apart, slow and natural', async () => {
    const { page } = await open();
    await seedWith(page, 'c');
    await page.evaluate(() => {
      const w = window as any;
      w.__t = {};
      document.addEventListener('pointerup', () => {
        w.__t.up = performance.now();
        const poll = () => {
          const s = w.__hal.state();
          if (s.named.includes('c') && (s.speaking === 'letter-c' || s.speaking === 'name-c')) w.__t.ok = performance.now();
          else requestAnimationFrame(poll);
        };
        poll();
      }, { capture: true, once: true });
    });
    await tapBlock(page, 'c');
    await page.waitForFunction(() => (window as any).__t.ok !== undefined, null, { timeout: 2000 });
    const t = await page.evaluate(() => (window as any).__t);
    expect(t.ok - t.up).toBeLessThan(100);
    expect((await said(page)).filter((x) => x !== '<cancel>')).toEqual(['C.']); // the capital on its own; the rest waits for it to end
    await page.evaluate(() => (window as any).__fakeSpeech.release());
    await page.waitForFunction(() => (window as any).__fakeSpeech.log.includes('moo'), null, { timeout: 5000 });
    expect((await said(page)).filter((x) => x !== '<cancel>')).toEqual(['C.', 'cow', 'moo']); // the small letter is shown, not spoken
    const times: { text: string; start: number; end: number }[] = await page.evaluate(() => (window as any).__fakeSpeech.times);
    for (let i = 1; i < times.length; i++) expect(times[i]!.start - times[i - 1]!.end, `gap before ${times[i]!.text}`).toBeGreaterThanOrEqual(700);
    const calls: { text: string; rate: number; pitch: number }[] = await page.evaluate(() => (window as any).__fakeSpeech.calls);
    for (const c of calls.filter((x) => x.text.trim() !== '')) { expect(c.rate).toBeCloseTo(0.7, 5); expect(c.pitch).toBeCloseTo(1, 5); } // the browser keeps them as float32
  });

  it('a new tap during a gap cancels the rest of the old line', async () => {
    const { page } = await open();
    await seedWith(page, 'c');
    await page.evaluate(() => (window as any).__fakeSpeech.release()); // speech ends by itself from here on
    await tapBlock(page, 'c');
    await page.waitForFunction(() => (window as any).__fakeSpeech.times.some((t: any) => t.text === 'C.' && t.end !== null));
    const other = (await state(page)).floor.find((l) => l !== 'c')!;
    await tapBlock(page, other); // inside the 700 ms gap before "cow"
    await page.waitForFunction((l) => (window as any).__fakeSpeech.log.includes(`${l.toUpperCase()}.`), other, { timeout: 5000 });
    await page.waitForTimeout(2500);
    const log = (await said(page)).filter((x) => x !== '<cancel>');
    expect(log[0]).toBe('C.');
    expect(log).not.toContain('cow');
    expect(log).not.toContain('moo');
    expect(log).toContain(`${other.toUpperCase()}.`);
  });

  it('a tap near a block (not on it) still answers', async () => {
    const { page } = await open();
    const l = (await state(page)).floor[0]!;
    const b = await find(page, 'block', l);
    await page.touchscreen.tap(b.x + b.w / 2, b.y + b.h + 12);
    expect((await state(page)).named).toContain(l);
  });

  it('a named block hops onto the tower; the 6th tumbles it', async () => {
    const { page } = await open();
    for (let i = 1; i <= 6; i++) {
      const l = (await state(page)).floor[0]!;
      await tapBlock(page, l);
      expect((await state(page)).named).toContain(l);
      await tapBlock(page, l);
      const s = await state(page);
      expect(s.floor).toHaveLength(5);
      expect(s.floor).not.toContain(l);
      if (i < 6) expect(s.tower).toHaveLength(i);
      if (i < 6) expect(s.tower.at(-1)).toBe(l);
      else expect(s.tower).toEqual([]);
    }
  });

  it('a tap on the tower tumbles it', async () => {
    const { page } = await open();
    for (let i = 0; i < 2; i++) { const l = (await state(page)).floor[0]!; await tapBlock(page, l); await tapBlock(page, l); }
    expect((await state(page)).tower).toHaveLength(2);
    await tap(page, await find(page, 'tower'));
    expect((await state(page)).tower).toEqual([]);
  });

  it('two fingers at once count as one tap', async () => {
    const { page } = await open();
    const l = (await state(page)).floor[0]!;
    const c = center(await find(page, 'block', l));
    const cdp = await page.context().newCDPSession(page);
    await touch(page, cdp, 'touchStart', [c, { x: c.x + 20, y: c.y + 10 }]);
    await touch(page, cdp, 'touchEnd', []);
    const s = await state(page);
    expect(s.named).toContain(l);
    expect(s.tower).toEqual([]);
  });

  it('a tap on empty floor changes something visible', async () => {
    const { page } = await open();
    const f = await find(page, 'floor');
    const c = center(f);
    const clip = { x: Math.max(0, c.x - 60), y: Math.max(0, c.y - 60), width: 120, height: 120 };
    const before = await page.screenshot({ clip });
    const s0 = await state(page);
    await page.touchscreen.tap(c.x, c.y);
    await page.waitForTimeout(120);
    const after = await page.screenshot({ clip });
    expect(after.equals(before)).toBe(false);
    const s1 = await state(page);
    expect(s1.floor).toEqual(s0.floor);
    expect(s1.named).toEqual(s0.named);
  });

  it('after 8 s idle it invites once with a floor animal, and any tap clears it', async () => {
    const { page } = await open();
    await idle(page, 7000);
    expect((await state(page)).invited).toBeNull();
    await idle(page, 1100);
    const s = await state(page);
    expect(s.invited).not.toBeNull();
    expect(s.floor).toContain(s.invited);
    const asks = async () => (await said(page)).filter((x) => /^Where/.test(x)).length;
    expect(await asks()).toBe(1);
    await page.evaluate(() => (window as any).__fakeSpeech.release());
    await idle(page, 30000);
    expect((await state(page)).invited).toBe(s.invited);
    expect(await asks()).toBe(1);
    await tap(page, await find(page, 'floor'));
    expect((await state(page)).invited).toBeNull();
  });

  it('a 3 s hold on the corner opens it; a short tap or a 1 s hold does not', async () => {
    const { page } = await open();
    const corner = await find(page, 'corner');
    const c = center(corner);
    await page.touchscreen.tap(c.x, c.y);
    expect((await state(page)).corner).toBe(false);
    const cdp = await page.context().newCDPSession(page);
    await touch(page, cdp, 'touchStart', [c]);
    await page.waitForTimeout(1000);
    await touch(page, cdp, 'touchEnd', []);
    await page.waitForTimeout(2500);
    expect((await state(page)).corner).toBe(false);
    await touch(page, cdp, 'touchStart', [c]);
    await page.waitForTimeout(3200);
    await touch(page, cdp, 'touchEnd', []);
    expect((await state(page)).corner).toBe(true);
    await expect(page.getByRole('dialog').isVisible()).resolves.toBe(true);
    await page.getByRole('button', { name: /back to the barn/i }).tap();
    expect((await state(page)).corner).toBe(false);
  });

  it('the first tap primes speech and one audio element synchronously in its pointerup; later taps do not re-prime', async () => {
    const { page } = await open();
    const l = (await state(page)).floor[0]!;
    const c = center(await find(page, 'block', l));
    const fake = () => page.evaluate(() => { const f = (window as any).__fakeSpeech; return { calls: [...f.calls], plays: [...f.plays] }; });
    await pointer(page, 'pointerdown', 11, c);
    expect((await fake()).calls).toHaveLength(0); // nothing primes on the way down
    await pointer(page, 'pointerup', 11, c);
    const first = await fake();
    const primes = first.calls.filter((x) => x.text.trim() === '');
    expect(primes).toHaveLength(1);
    expect(primes[0]).toMatchObject({ sync: true, volume: 0 });
    expect(first.calls[0]!.text.trim()).toBe(''); // primed before the letter is spoken
    expect(first.plays).toHaveLength(1);
    expect(first.plays[0]!.sync).toBe(true);
    expect(first.plays[0]!.src.startsWith('blob:')).toBe(true);
    expect((await state(page)).named).toContain(l);
    await tapBlock(page, (await state(page)).floor[1]!);
    await pointer(page, 'pointerdown', 12, c);
    await pointer(page, 'pointerup', 12, c);
    const later = await fake();
    expect(later.calls.filter((x) => x.text.trim() === '')).toHaveLength(1);
    expect(later.plays).toHaveLength(1);
  });

  it('a finger resting on the screen does not block taps from another finger', async () => {
    const { page } = await open();
    const f = center(await find(page, 'floor'));
    await pointer(page, 'pointerdown', 50, f); // a thumb gripping the phone, never lifted
    await page.waitForTimeout(350);
    const l = (await state(page)).floor[0]!;
    await tapBlock(page, l);
    expect((await state(page)).named).toContain(l);
    await tapBlock(page, l);
    expect((await state(page)).tower).toEqual([l]);
  });

  it('a cancelled pointer, or an up that lands on the corner, does not leave the barn dead', async () => {
    const { page } = await open();
    const f = center(await find(page, 'floor'));
    await pointer(page, 'pointerdown', 60, f);
    await pointer(page, 'pointercancel', 60, f);
    const a = (await state(page)).floor[0]!;
    await tapBlock(page, a);
    expect((await state(page)).named).toContain(a);
    await pointer(page, 'pointerdown', 70, f);
    await pointer(page, 'pointerup', 70, f, '#corner');
    const b = (await state(page)).floor[1]!;
    await tapBlock(page, b);
    expect((await state(page)).named).toContain(b);
  });

  it('a hidden tab stops speaking', async () => {
    const { page } = await open();
    await tapBlock(page, (await state(page)).floor[0]!);
    expect((await state(page)).speaking).not.toBeNull();
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect((await state(page)).speaking).toBeNull();
    expect(await said(page)).toContain('<cancel>');
  });
});
