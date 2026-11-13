/// <reference lib="dom" />
// Block Barn runner for the block-barn scorer: real touch taps on the real page (?hal), headless, at 390x844 and
// 1024x768, then a bounded walk through the alphabet on the phone. The ?hal hook only reads the barn (state, targets),
// reseeds it and runs its idle clock; every tap is a real touch.
//   - A fixed tap script from a fixed seed visits every state the barn reaches (fresh, all named, a tower, a tower
//     knocked down, a tower that tumbled by itself, an invitation, the grown-up corner opened and closed) and taps
//     every kind of target in it. Each tap is measured in the page: from its pointerup to the first DOM change. A
//     change made inside the pointerup dispatch is the barn answering that tap; otherwise the first change within
//     ASYNC_WAIT_MS counts.
//   - Calm is read structurally, never by screenshot: every animation and transition that starts is checked
//     (brightness properties with an iteration under BLOCK_BARN_RULES.flashMs are flashes), and every Web Audio gain
//     value the page sets is recorded (the master stage is the gain that feeds a non-gain node).
//   - Speech is a fake that records what is said and ends each line at once, so runs are quiet and repeatable.
// Page and console errors, blocked requests and a page that leaves the barn go to `errors` / `page.leftBarn`.
// A browser that can't launch throws "browser unavailable: ..."; the CLI exits 1 on it.
// Run it with `npm run hal -- score --game block-barn`.
import type { Browser, BrowserContextOptions, CDPSession, Page } from 'playwright';
import {
  BLOCK_BARN_ALPHABET_STEPS, BLOCK_BARN_RULES, BLOCK_BARN_VIEWPORTS,
  type BlockBarnKind, type BlockBarnPage, type BlockBarnRecord, type BlockBarnViewport,
} from '../../packages/core/src/hal/block-barn-score.js';
import { closeAll, launchBrowser, newHalContext, serveGames, type StaticServer } from './browser.js';

export type BlockBarnPlayOptions = {
  viewports?: BlockBarnViewport[];
  /** Stack-and-refill steps in the alphabet walk (default BLOCK_BARN_ALPHABET_STEPS; 0 skips the walk). */
  alphabetSteps?: number;
  /** Test hook: script added to every context after the runner's own instrumentation (to inject faults). */
  initScript?: string;
};
export type BlockBarnPlayResult = { records: BlockBarnRecord[]; page: BlockBarnPage; errors: string[] };

/** The barn's seed for every run: the same floor, the same arrivals, the same surprises. */
export const BLOCK_BARN_SEED = 7;
/** How long a tap may take to change the page before it counts as a dead end. */
export const ASYNC_WAIT_MS = 500;
const VOICE_WAIT_MS = 2000;
const HOLD_MS = 3300; // the grown-up corner opens after a 3 s hold

const CONTEXT: Record<BlockBarnViewport, BrowserContextOptions> = {
  '390x844': { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  '1024x768': { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true },
};

type Target = { kind: BlockBarnKind; letter?: string; x: number; y: number; w: number; h: number };
type State = { floor: string[]; named: string[]; tower: string[]; corner: boolean; speaking: string | null; invited: string | null };

/** Runs in the page before the game: fake speech, tap probe, animation and audio-gain recorders, on window.__bbPlay. */
function instrument(flashMs: number): void {
  const w = window as any;
  // Speech: record each spoken line and end it at once.
  const spoken: string[] = [];
  const fake = {
    speak(u: any) { const t = String(u?.text ?? ''); if (!t.trim()) return; spoken.push(t); setTimeout(() => u.onend?.({}), 10); },
    cancel() {}, pause() {}, resume() {}, getVoices: () => [], addEventListener() {}, removeEventListener() {}, speaking: false, pending: false, paused: false,
  };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, get: () => fake });
  // Media: a clip or recording that really starts playing (blob: is the silent priming sound or a parent's recording).
  const played: string[] = [];
  const realPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    const src = this.currentSrc || this.src;
    const p = realPlay.call(this);
    if (!src.startsWith('blob:')) p.then(() => played.push(src), () => {});
    return p;
  };

  // Web Audio gains: the highest value each gain parameter is set or ramped to.
  const peaks = new Map<AudioParam, number>(), gainParams = new WeakSet<AudioParam>(), masters = new Set<AudioParam>();
  const note = (p: AudioParam, v: number) => { if (gainParams.has(p) && Number.isFinite(v)) peaks.set(p, Math.max(peaks.get(p) ?? 0, Math.abs(v))); };
  const BAC = (w.BaseAudioContext ?? w.AudioContext) as typeof BaseAudioContext | undefined;
  if (BAC && w.AudioParam && w.AudioNode) {
    const createGain = BAC.prototype.createGain;
    BAC.prototype.createGain = function (this: BaseAudioContext) { const g = createGain.call(this); gainParams.add(g.gain); return g; };
    const AP = AudioParam.prototype as any;
    for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime']) {
      const orig = AP[m];
      AP[m] = function (this: AudioParam, v: number, ...rest: unknown[]) { note(this, v); return orig.call(this, v, ...rest); };
    }
    const curve = AP.setValueCurveAtTime;
    AP.setValueCurveAtTime = function (this: AudioParam, c: ArrayLike<number>, ...rest: unknown[]) { for (let i = 0; i < c.length; i++) note(this, c[i]!); return curve.call(this, c, ...rest); };
    const value = Object.getOwnPropertyDescriptor(AP, 'value')!;
    Object.defineProperty(AP, 'value', { ...value, set(this: AudioParam, v: number) { note(this, v); value.set!.call(this, v); } });
    const connect = AudioNode.prototype.connect as any;
    (AudioNode.prototype as any).connect = function (this: AudioNode, dest: unknown, ...rest: unknown[]) {
      if (this instanceof GainNode && dest instanceof AudioNode && !(dest instanceof GainNode)) masters.add(this.gain);
      return connect.call(this, dest, ...rest);
    };
  }

  // Animations and transitions: brightness properties changing faster than flashMs per iteration are flashes.
  const LIGHT = /^(opacity|filter|backdrop-filter|-webkit-filter|color|fill|stroke|visibility|box-shadow|text-shadow|background.*|border.*color|outline-color)$/;
  const judged = new WeakSet<Animation>(), flashes: string[] = [];
  const judge = (a: Animation) => {
    if (judged.has(a)) return;
    judged.add(a);
    const fx = a.effect as KeyframeEffect | null;
    if (!fx || typeof fx.getKeyframes !== 'function') return;
    const props = new Set<string>();
    if ((a as any).transitionProperty) props.add((a as any).transitionProperty);
    for (const k of fx.getKeyframes()) for (const p of Object.keys(k)) if (!['offset', 'computedOffset', 'easing', 'composite'].includes(p)) props.add(p.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`));
    const dur = Number(fx.getComputedTiming().duration);
    if ([...props].some((p) => LIGHT.test(p)) && dur > 0 && dur < flashMs)
      flashes.push(`${(a as any).animationName ?? (a as any).transitionProperty ?? 'animation'} ${Math.round(dur)} ms`);
  };
  const onStart = (e: Event) => { const t = e.target as Element | null; try { for (const a of t?.getAnimations?.() ?? []) judge(a); } catch { /* detached */ } };
  for (const t of ['animationstart', 'transitionrun']) document.addEventListener(t, onStart, true);
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) { const a = animate.apply(this, args); judge(a); return a; };

  // Tap probe: from the pointerup (window, capture: before the game hears it) to the first DOM change. A change
  // already made when the pointerup has bubbled back to window was made by the game's own pointerup handlers.
  let probe: { t0: number; ms?: number; sync?: boolean } | null = null;
  const mo = new MutationObserver((recs) => { if (probe && probe.ms === undefined && recs.length) { probe.ms = performance.now() - probe.t0; probe.sync = false; } });
  mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  addEventListener('pointerup', () => { mo.takeRecords(); probe = { t0: performance.now() }; }, true);
  addEventListener('pointerup', () => { if (probe && probe.ms === undefined && mo.takeRecords().length) { probe.ms = performance.now() - probe.t0; probe.sync = true; } });

  w.__bbPlay = {
    spoken, played, flashes,
    reset() { probe = null; },
    probe: () => probe,
    audio() {
      let masterGain = 0, peakGain = 0;
      for (const [p, v] of peaks) if (masters.has(p)) masterGain = Math.max(masterGain, v); else peakGain = Math.max(peakGain, v);
      return { masterGain, peakGain };
    },
  };
}

const center = (t: Target) => ({ x: t.x + t.w / 2, y: t.y + t.h / 2 });
const r1 = (x: number) => Math.round(x * 10) / 10;

class Barn {
  records: BlockBarnRecord[] = [];
  constructor(readonly page: Page, readonly viewport: BlockBarnViewport) {}
  state(): Promise<State> { return this.page.evaluate(() => (window as any).__hal.state()); }
  targets(): Promise<Target[]> { return this.page.evaluate(() => (window as any).__hal.targets()); }
  /** Waits until the tower's own animations (wobble, bump) are over: its box, and the free floor beside it, are still. */
  async still(): Promise<void> {
    await this.page.waitForFunction(() => {
      const t = document.getElementById('tower');
      return !t || t.getAnimations({ subtree: true }).every((a) => a.playState !== 'running' || (a.effect?.getComputedTiming().iterations ?? 1) === Infinity);
    }, null, { timeout: 5000 });
  }
  async find(kind: BlockBarnKind, letter?: string): Promise<Target> {
    await this.still();
    const t = (await this.targets()).find((x) => x.kind === kind && (letter === undefined || x.letter === letter));
    if (!t) throw new Error(`${this.viewport}: no ${kind} target${letter ? ` for ${letter}` : ''}`);
    return t;
  }
  /** One real tap on `t`, measured in the page; returns whether the page changed. */
  async tap(t: Target): Promise<boolean> {
    const { page } = this;
    await page.evaluate(() => (window as any).__bbPlay.reset());
    const c = center(t);
    await page.touchscreen.tap(c.x, c.y);
    const p = await page.evaluate((wait) => new Promise<{ ms?: number } | null>((done) => {
      const t0 = performance.now();
      const poll = () => {
        const p = (window as any).__bbPlay.probe();
        if (!p || p.ms !== undefined || performance.now() - t0 > wait) done(p); else setTimeout(poll, 10);
      };
      poll();
    }), ASYNC_WAIT_MS);
    const changed = p?.ms !== undefined && p.ms <= ASYNC_WAIT_MS;
    this.records.push({ kind: t.kind, ...(t.letter ? { letter: t.letter } : {}), ms: changed ? r1(p!.ms!) : ASYNC_WAIT_MS, changed, w: r1(t.w), h: r1(t.h), viewport: this.viewport });
    return changed;
  }
  async tapKind(kind: BlockBarnKind, letter?: string) { return this.tap(await this.find(kind, letter)); }
  /** Taps floor[0] until it is named, then once more to stack it. */
  async stackOne() {
    const l = (await this.state()).floor[0]!;
    if (!(await this.state()).named.includes(l)) await this.tapKind('block', l);
    await this.tapKind('block', l);
  }
}

async function touch(cdp: CDPSession, type: 'touchStart' | 'touchEnd', points: { x: number; y: number }[]) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
}

/** The fixed tap script: every state the barn reaches, every kind of target in it. */
async function script(b: Barn): Promise<void> {
  const { page } = b;
  // Fresh barn: the hay, the grown-up corner (a short tap only puffs), the empty tower, then every block (names it).
  await b.tapKind('floor');
  await b.tapKind('corner');
  await b.tapKind('tower');
  for (const l of (await b.state()).floor) await b.tapKind('block', l);
  // All five named: every animal, then stack three and knock the tower down.
  for (const l of (await b.state()).named) await b.tapKind('animal', l);
  for (let i = 0; i < 3; i++) await b.stackOne();
  await b.tapKind('tower');
  // After the knock-down: the hay, the empty tower, an unnamed block; then a tower that tumbles by itself (the 6th).
  await b.tapKind('floor');
  await b.tapKind('tower');
  for (let i = 0; i < 6; i++) await b.stackOne();
  // After the tumble: the hay, an animal, a block.
  await b.tapKind('floor');
  const named = (await b.state()).named;
  if (named.length) await b.tapKind('animal', named[0]);
  await b.tapKind('block', (await b.state()).floor[1]);
  // A quiet spell: the invitation, then tapping the invited block.
  await page.evaluate(() => (window as any).__hal.idle(8100));
  const invited = (await b.state()).invited;
  if (!invited) throw new Error(`${b.viewport}: no invitation after 8 s idle`);
  await b.tapKind('block', invited);
  // The grown-up corner: a real 3 s hold opens it; back to the barn, and every kind of target still answers.
  const corner = center(await b.find('corner'));
  const cdp = await page.context().newCDPSession(page);
  await touch(cdp, 'touchStart', [corner]);
  await page.waitForTimeout(HOLD_MS);
  await touch(cdp, 'touchEnd', []);
  if (!(await b.state()).corner) throw new Error(`${b.viewport}: the grown-up corner did not open after a 3 s hold`);
  await page.getByRole('button', { name: /back to the barn/i }).tap();
  if ((await b.state()).corner) throw new Error(`${b.viewport}: the grown-up corner did not close`);
  await b.tapKind('floor');
  await b.tapKind('tower');
  const after = await b.state();
  const unnamed = after.floor.find((l) => !after.named.includes(l)) ?? after.floor[0]!;
  await b.tapKind('block', unnamed);
  await b.tapKind('animal', unnamed);
}

/** After a tap: waits until a new line is spoken or a clip starts (or VOICE_WAIT_MS passes); true if one did. */
async function voiceAfter(page: Page, before: { s: number; p: number }): Promise<boolean> {
  return page.waitForFunction(([s, p]) => { const b = (window as any).__bbPlay; return b.spoken.length > s! || b.played.length > p!; }, [before.s, before.p], { timeout: VOICE_WAIT_MS })
    .then(() => true, () => false);
}
const voiceCount = (page: Page) => page.evaluate(() => { const b = (window as any).__bbPlay; return { s: b.spoken.length as number, p: b.played.length as number }; });

/** True when the named animal of `letter` is drawn: an svg (with shapes), image or canvas filling its target. */
function pictured(page: Page, letter: string): Promise<boolean> {
  return page.waitForFunction((l) => {
    const t = ((window as any).__hal.targets() as Target[]).find((x) => x.kind === 'animal' && x.letter === l);
    if (!t) return false;
    return Array.from(document.querySelectorAll('svg, img, canvas')).some((e) => {
      const r = e.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const ix = Math.max(0, Math.min(r.right, t.x + t.w) - Math.max(r.left, t.x)), iy = Math.max(0, Math.min(r.bottom, t.y + t.h) - Math.max(r.top, t.y));
      if (ix * iy < 0.5 * r.width * r.height) return false;
      if (e instanceof SVGSVGElement) { const bb = e.getBBox(); return bb.width > 0 && bb.height > 0 && !!e.querySelector('path, circle, ellipse, rect, polygon, polyline, line'); }
      if (e instanceof HTMLImageElement) return e.complete && e.naturalWidth > 0;
      return true;
    });
  }, letter, { timeout: 1500 }).then(() => true, () => false);
}

/** Names every letter that reaches the floor over `steps` stack-and-refill steps; checks its voice and picture. */
async function alphabet(b: Barn, steps: number): Promise<Pick<BlockBarnPage, 'letters' | 'voiced' | 'pictured'>> {
  const { page } = b;
  const letters = new Set<string>(), checked = new Set<string>(), voiced = new Set<string>(), drawn = new Set<string>();
  const name = async (l: string) => {
    letters.add(l); checked.add(l);
    const before = await voiceCount(page);
    await b.tapKind('block', l);
    if (await voiceAfter(page, before)) voiced.add(l);
    if (await pictured(page, l)) drawn.add(l);
  };
  for (const l of (await b.state()).floor) await name(l);
  for (let i = 0; i < steps && checked.size < 26; i++) { // stops early once every letter has been named
    const before = await voiceCount(page);
    await b.tapKind('block', (await b.state()).floor[0]); // stacks it; a new letter arrives in its place
    await voiceAfter(page, before); // let the stacked letter's line finish before the next tap is judged
    const s = await b.state();
    for (const l of s.floor) if (!s.named.includes(l)) letters.add(l);
    await name(s.floor[0]!);
  }
  return { letters: [...letters].sort(), voiced: [...voiced].sort(), pictured: [...drawn].sort() };
}

type Opened = { page: Page; close(): Promise<void>; failed(): string; navigations(): number };
async function openBarn(browser: Browser, origin: string, viewport: BlockBarnViewport, initScript?: string): Promise<Opened> {
  const { context, blockedRequests, consoleErrors } = await newHalContext(browser, { contextOptions: CONTEXT[viewport] });
  const pageErrors: string[] = [];
  // tsx compiles with keepNames, so functions sent to the page may call esbuild's __name helper: give the page one.
  await context.addInitScript({ content: `globalThis.__name = globalThis.__name || ((f) => f); (${instrument.toString()})(${BLOCK_BARN_RULES.flashMs});` });
  if (initScript) await context.addInitScript({ content: initScript });
  const page = await context.newPage();
  let navigations = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations++; });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('crash', () => pageErrors.push('page crashed'));
  await page.goto(`${origin}/block-barn/index.html?hal`);
  await page.waitForFunction(() => !!(window as any).__hal && !!(window as any).__bbPlay, null, { timeout: 10_000 });
  await page.evaluate((s) => (window as any).__hal.seed(s), BLOCK_BARN_SEED);
  return {
    page,
    close: () => context.close().catch(() => {}),
    navigations: () => navigations,
    failed: () => (pageErrors.length ? `${viewport}: page error: ${pageErrors[0]}`
      : consoleErrors.length ? `${viewport}: console error: ${consoleErrors[0]}`
      : blockedRequests.length ? `${viewport}: outbound request blocked: ${blockedRequests[0]}` : ''),
  };
}

/** Plays the tap script at each viewport and the alphabet walk on the phone; one browser and one static server. */
export async function runBlockBarnPlay({ viewports = [...BLOCK_BARN_VIEWPORTS], alphabetSteps = BLOCK_BARN_ALPHABET_STEPS, initScript }: BlockBarnPlayOptions = {}): Promise<BlockBarnPlayResult> {
  let server: StaticServer | undefined, browser: Browser | undefined;
  const records: BlockBarnRecord[] = [], errors: string[] = [];
  const page: BlockBarnPage = { letters: [], voiced: [], pictured: [], flashes: 0, masterGain: 0, peakGain: 0, leftBarn: false };
  const facts = async (o: Opened) => {
    const f = await o.page.evaluate(() => { const b = (window as any).__bbPlay; return { flashes: (b.flashes as string[]).length, ...b.audio() as { masterGain: number; peakGain: number } }; });
    page.flashes += f.flashes;
    page.masterGain = Math.max(page.masterGain, f.masterGain);
    page.peakGain = Math.max(page.peakGain, f.peakGain);
    if (o.navigations() !== 1 || !new URL(o.page.url()).pathname.endsWith('/block-barn/index.html')) page.leftBarn = true;
  };
  try {
    browser = await launchBrowser(); // throws "browser unavailable: ..."
    server = await serveGames();
    for (const v of viewports) {
      const o = await openBarn(browser, server.origin, v, initScript);
      try {
        const b = new Barn(o.page, v);
        try { await script(b); } catch (e) { errors.push(`${v}: ${String((e as Error)?.message ?? e).split('\n')[0]}`); }
        await o.page.waitForTimeout(200); // let a late async error surface
        records.push(...b.records);
        await facts(o);
        if (o.failed()) errors.push(o.failed());
      } finally { await o.close(); }
    }
    {
      const v = viewports[0] ?? '390x844';
      const o = await openBarn(browser, server.origin, v, initScript);
      try {
        const b = new Barn(o.page, v);
        try { Object.assign(page, await alphabet(b, alphabetSteps)); } catch (e) { errors.push(`${v} alphabet: ${String((e as Error)?.message ?? e).split('\n')[0]}`); }
        await facts(o);
        if (o.failed()) errors.push(o.failed());
      } finally { await o.close(); }
    }
  } finally {
    await closeAll(browser, server);
  }
  return { records, page, errors: [...new Set(errors)] };
}
