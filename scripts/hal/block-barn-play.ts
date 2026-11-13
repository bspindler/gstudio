/// <reference lib="dom" />
// Block Barn runner for the block-barn scorer: real touch taps on the real page (?hal), headless, at 390x844 and
// 1024x768, then a bounded walk through the alphabet on the phone. The ?hal hook only reads the barn (state, targets),
// reseeds it and runs its idle clock; every tap is a real touch.
//   - A fixed tap script from a fixed seed visits every state the barn reaches (fresh, all named, a tower, a tower
//     knocked down, a tower that tumbled by itself, an invitation, the grown-up corner opened and closed) and taps
//     every kind of target in it; before every tap, every target the hook lists is measured.
//   - A tap answers only by a DOM change the page makes synchronously while handling that tap's own (trusted)
//     pointerdown or pointerup. Changes made later (a timer of this tap or of an earlier one) never count, so the
//     result does not depend on timing. `ms` is from the pointerdown to that change.
//   - Calm is read structurally, never by screenshot: every animation and transition that starts is checked (a
//     brightness property that repeats, or goes back and forth, faster than BLOCK_BARN_RULES.flashMs is a flash), and
//     the Web Audio graph is recorded (gain nodes however made, their values and automation, connections, source start
//     and stop times) so the effective gain of everything sounding at once can be computed.
//   - Speech is a fake that records what is said and ends each line at once, so runs are quiet and repeatable.
// Page and console errors, blocked requests, a page that leaves the barn, and a viewport run over VIEW_DEADLINE_MS go
// to `errors` / `page.leftBarn`. A browser that can't launch throws "browser unavailable: ..."; the CLI exits 1 on it.
// Run it with `npm run hal -- score --game block-barn`.
import type { Browser, BrowserContextOptions, CDPSession, Page } from 'playwright';
import {
  BLOCK_BARN_ALPHABET_STEPS, BLOCK_BARN_RULES, BLOCK_BARN_VIEWPORTS,
  type BlockBarnKind, type BlockBarnPage, type BlockBarnRecord, type BlockBarnTargetSize, type BlockBarnViewport,
} from '../../packages/core/src/hal/block-barn-score.js';
import { closeAll, launchBrowser, newHalContext, serveGames, type StaticServer } from './browser.js';

export type BlockBarnPlayOptions = {
  viewports?: BlockBarnViewport[];
  /** Stack-and-refill steps in the alphabet walk (default BLOCK_BARN_ALPHABET_STEPS; 0 names only the first floor). */
  alphabetSteps?: number;
  /** Test hook: script added to every context after the runner's own instrumentation (to inject faults). */
  initScript?: string;
  /** Wall-clock bound for each viewport's tap script and for the alphabet walk (default VIEW_DEADLINE_MS). */
  deadlineMs?: number;
};
export type BlockBarnPlayResult = { records: BlockBarnRecord[]; page: BlockBarnPage; errors: string[] };

/** The barn's seed for every run: the same floor, the same arrivals, the same surprises. */
export const BLOCK_BARN_SEED = 7;
/** A viewport's tap script (or the alphabet walk) that runs longer than this is a hang: the score is rejected. */
export const VIEW_DEADLINE_MS = 120_000;
const VOICE_WAIT_MS = 2000;
/** Taps come at most this often (a toddler's fastest, 4 a second), so sounds overlap as they would in her hands. */
export const TAP_GAP_MS = 250;
const HOLD_MS = 3300; // the grown-up corner opens after a 3 s hold

const CONTEXT: Record<BlockBarnViewport, BrowserContextOptions> = {
  '390x844': { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  '1024x768': { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true },
};

type Target = { kind: BlockBarnKind; letter?: string; x: number; y: number; w: number; h: number };
type State = { floor: string[]; named: string[]; tower: string[]; corner: boolean; speaking: string | null; invited: string | null };

/** Runs in the page before the game: fake speech, tap probe, animation and audio recorders, on window.__bbPlay. */
function instrument(flashMs: number, gapMs: number): void {
  const w = window as any;
  // ---- The virtual clock (seconds): audio is placed on it, never on the wall clock ----
  // The n-th real tap is at n x gapMs (plus any hold the runner declares), whatever the driver's real gaps. Work a tap
  // starts runs at its virtual time: the tap's own input events, then any setTimeout or requestAnimationFrame callback
  // scheduled from it (transitively), at the scheduler's virtual time plus the requested delay (one frame for a frame
  // callback). So how long the driver or a busy timer really took never moves a sound. A callback sets the time and
  // leaves it in place, so its promise continuations share it; any other task (an interval, the runner's own calls)
  // runs at the latest tap's time.
  let taps = 0, held = 0, tapAt = 0, vnow = 0;
  for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click', 'keydown', 'keyup']) {
    addEventListener(type, (e) => {
      if (!e.isTrusted) return;
      if (type === 'pointerdown') tapAt = (++taps * gapMs + held) / 1000;
      vnow = tapAt;
    }, true);
  }
  const later = (fn: unknown, at: number) => (typeof fn !== 'function' ? fn : function (this: unknown) { vnow = at; return (fn as Function).apply(this, arguments as any); });
  const realTimeout = w.setTimeout, realRaf = w.requestAnimationFrame, realInterval = w.setInterval;
  w.setTimeout = function (fn: unknown, ms?: number, ...rest: unknown[]) { return realTimeout.call(this, later(fn, vnow + Math.max(0, Number(ms) || 0) / 1000), ms, ...rest); };
  if (realRaf) w.requestAnimationFrame = function (fn: FrameRequestCallback) { return realRaf.call(this, later(fn, vnow + 1 / 60)); };
  w.setInterval = function (fn: unknown, ...rest: unknown[]) {
    return realInterval.call(this, typeof fn !== 'function' ? fn : function (this: unknown) { vnow = tapAt; return (fn as Function).apply(this, arguments as any); }, ...rest);
  };
  // Speech: record each spoken line and end it at once.
  const spoken: string[] = [];
  const fake = {
    speak(u: any) { const t = String(u?.text ?? ''); if (!t.trim()) return; spoken.push(t); setTimeout(() => u.onend?.({}), 10); },
    cancel() {}, pause() {}, resume() {}, getVoices: () => [], addEventListener() {}, removeEventListener() {}, speaking: false, pending: false, paused: false,
  };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, get: () => fake });
  // Media: a clip that really starts playing (blob: is the silent priming sound or a parent's recording).
  const played: string[] = [];
  const realPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    const src = this.currentSrc || this.src;
    const p = realPlay.call(this);
    if (!src.startsWith('blob:')) p.then(() => played.push(src), () => {});
    return p;
  };

  // ---- Web Audio: the graph, every gain's values over time, and when each source sounds ----
  // Times are kept on the virtual clock: each call's context time is placed at the virtual now plus its offset from the
  // context's currentTime. (A headless context's clock barely moves between taps, and the wall clock moves with the
  // driver's latency; neither is what a toddler tapping 4 times a second would hear together.)
  // One anchor per context per task, so the calls of one handler (an envelope, then its source's start) keep their
  // exact offsets even if the audio clock ticks between them.
  // The page sees the same: a context's currentTime holds still within a task (the real one moves on mid-task, by render
  // quanta, which would shift one handler's sounds against each other by a few ms from run to run).
  const anchors = new Map<BaseAudioContext, { now: number; ct: number }>();
  const BAC0 = (w.BaseAudioContext ?? w.AudioContext) as typeof BaseAudioContext | undefined;
  const clock = BAC0 && Object.getOwnPropertyDescriptor(BAC0.prototype, 'currentTime');
  const anchor = (ctx: BaseAudioContext) => {
    let a = anchors.get(ctx);
    if (!a) { a = { now: vnow, ct: clock?.get ? Number(clock.get.call(ctx)) : ctx.currentTime }; anchors.set(ctx, a); queueMicrotask(() => anchors.delete(ctx)); }
    return a;
  };
  if (BAC0 && clock?.get) Object.defineProperty(BAC0.prototype, 'currentTime', { ...clock, get(this: BaseAudioContext) { return anchor(this).ct; } });
  const wall = (ctx: BaseAudioContext, t: number) => {
    const a = anchor(ctx);
    return Math.round((a.now + (Number(t) - a.ct)) * 1e6) / 1e6; // to the microsecond: the context's own clock value never shows
  };
  type Ev = { k: 'set' | 'lin' | 'exp' | 'target'; v: number; t: number; tc?: number };
  type Rec = { init: number | null; events: Ev[]; ctx: BaseAudioContext };
  const gainRec = new Map<AudioParam, Rec>(); // the gain parameter of every GainNode the page made
  const gainOf = new WeakMap<AudioNode, AudioParam>();
  const edges = new Map<AudioNode, Set<AudioNode>>();
  const sources: { node: AudioScheduledSourceNode; ctx: BaseAudioContext; start: number; stop: number }[] = [];
  const srcOf = new WeakMap<AudioNode, (typeof sources)[number]>();
  const BAC = (w.BaseAudioContext ?? w.AudioContext) as typeof BaseAudioContext | undefined;
  if (BAC && w.AudioParam && w.AudioNode && w.GainNode) {
    const track = (g: GainNode, init: number | null) => { gainOf.set(g, g.gain); gainRec.set(g.gain, { init, events: [], ctx: g.context }); };
    const createGain = BAC.prototype.createGain;
    BAC.prototype.createGain = function (this: BaseAudioContext) { const g = createGain.call(this); track(g, null); return g; };
    const RealGain = w.GainNode;
    const Gain = function (ctx: BaseAudioContext, opts?: GainOptions) {
      const g = new RealGain(ctx, opts);
      track(g, opts && opts.gain !== undefined ? Number(opts.gain) : null);
      return g;
    } as any;
    Gain.prototype = RealGain.prototype;
    Object.setPrototypeOf(Gain, RealGain);
    w.GainNode = Gain;
    const AP = AudioParam.prototype as any;
    const push = (p: AudioParam, e: Ev) => { const r = gainRec.get(p); if (r && Number.isFinite(e.v) && Number.isFinite(e.t)) r.events.push({ ...e, t: wall(r.ctx, e.t) }); };
    const wrap = (m: string, k: Ev['k']) => {
      const orig = AP[m];
      AP[m] = function (this: AudioParam, v: number, t: number, tc?: number) { push(this, { k, v: Number(v), t: Number(t), tc: Number(tc) }); return orig.apply(this, arguments as any); };
    };
    wrap('setValueAtTime', 'set'); wrap('linearRampToValueAtTime', 'lin'); wrap('exponentialRampToValueAtTime', 'exp'); wrap('setTargetAtTime', 'target');
    const curve = AP.setValueCurveAtTime;
    AP.setValueCurveAtTime = function (this: AudioParam, c: ArrayLike<number>, t: number, d: number) {
      for (let i = 0; i < c.length; i++) push(this, { k: i ? 'lin' : 'set', v: Number(c[i]), t: Number(t) + (c.length > 1 ? (i * Number(d)) / (c.length - 1) : 0) });
      return curve.apply(this, arguments as any);
    };
    for (const m of ['cancelScheduledValues', 'cancelAndHoldAtTime']) {
      const orig = AP[m];
      if (!orig) continue;
      AP[m] = function (this: AudioParam, t: number) { const r = gainRec.get(this); if (r) { const at = wall(r.ctx, t); r.events = r.events.filter((e) => e.t < at); } return orig.apply(this, arguments as any); };
    }
    const value = Object.getOwnPropertyDescriptor(AP, 'value')!;
    Object.defineProperty(AP, 'value', {
      ...value,
      set(this: AudioParam, v: number) {
        const r = gainRec.get(this);
        // The start value is the constructor's (or the default 1); every assignment is a set at the (virtual) now, so
        // turning a gain down after its sound played never rewrites what it played at.
        if (r && Number.isFinite(Number(v))) r.events.push({ k: 'set', v: Number(v), t: wall(r.ctx, r.ctx.currentTime) });
        value.set!.call(this, v);
      },
    });
    const connect = AudioNode.prototype.connect as any;
    (AudioNode.prototype as any).connect = function (this: AudioNode, dest: unknown) {
      if (dest instanceof AudioNode) { if (!edges.has(this)) edges.set(this, new Set()); edges.get(this)!.add(dest); }
      return connect.apply(this, arguments as any);
    };
    const ASN = (w.AudioScheduledSourceNode as typeof AudioScheduledSourceNode).prototype as any;
    const start = ASN.start, stop = ASN.stop;
    ASN.start = function (this: AudioScheduledSourceNode, when?: number) {
      const s = { node: this, ctx: this.context, start: wall(this.context, Math.max(Number(when) || 0, this.context.currentTime)), stop: Infinity };
      sources.push(s); srcOf.set(this, s);
      return start.apply(this, arguments as any);
    };
    ASN.stop = function (this: AudioScheduledSourceNode, when?: number) {
      const s = srcOf.get(this);
      if (s) s.stop = Math.min(s.stop, wall(this.context, Math.max(Number(when) || 0, this.context.currentTime)));
      return stop.apply(this, arguments as any);
    };
  }
  /** A gain parameter's value at context time t: its automation (set, linear, exponential, target) over its start value. */
  const valueAt = (p: AudioParam | undefined, t: number): number => {
    const r = p && gainRec.get(p);
    if (!r) return 1; // a GainNode the recorder never saw: its default gain
    const evs = r.events.map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t || a.i - b.i).map((x) => x.e);
    let v = r.init ?? 1, pt = -Infinity, pv = v;
    for (const e of evs) {
      if (e.k === 'set' || e.k === 'target') {
        if (e.t > t) break;
        v = e.k === 'set' ? e.v : e.v + (pv - e.v) * Math.exp(-(t - e.t) / (e.tc && e.tc > 0 ? e.tc : 1e-9));
        pt = e.t; pv = e.k === 'set' ? e.v : Math.max(pv, e.v); // a target only approaches e.v from pv: never louder than both
        continue;
      }
      if (e.t <= t) { v = e.v; pt = e.t; pv = e.v; continue; }
      const f = pt === -Infinity || e.t === pt ? 1 : (t - pt) / (e.t - pt);
      v = e.k === 'lin' ? pv + (e.v - pv) * f : pv > 0 && e.v > 0 ? pv * Math.pow(e.v / pv, f) : pv;
      break;
    }
    return Math.abs(v);
  };
  /** Every path from a source to its context's speakers, as the gain parameters along it. */
  const pathsOf = (src: AudioNode, dest: AudioNode): AudioParam[][] => {
    const out: AudioParam[][] = [];
    const walk = (n: AudioNode, seen: Set<AudioNode>, gains: AudioParam[]) => {
      if (out.length >= 256) return;
      if (n === dest) { out.push(gains); return; }
      for (const m of edges.get(n) ?? []) {
        if (seen.has(m)) continue;
        seen.add(m);
        walk(m, seen, m instanceof w.GainNode ? [...gains, gainOf.get(m) ?? (m as GainNode).gain] : gains);
        seen.delete(m);
      }
    };
    walk(src, new Set([src]), []);
    return out;
  };
  const audio = () => {
    const live = sources.map((s) => {
      let stop = s.stop;
      const n = s.node as any;
      if (n instanceof AudioBufferSourceNode && n.buffer && !n.loop) stop = Math.min(stop, s.start + n.buffer.duration / Math.max(1e-6, n.playbackRate.value));
      return { ...s, stop, paths: pathsOf(s.node, s.ctx.destination) };
    }).filter((s) => s.paths.length);
    // The shared stage: gain parameters that more than one source sounds through.
    const users = new Map<AudioParam, number>();
    for (const s of live) for (const p of new Set(s.paths.flat())) users.set(p, (users.get(p) ?? 0) + 1);
    const product = (ps: AudioParam[], t: number) => ps.reduce((a, p) => a * valueAt(p, t), 1);
    let masterGain = 0, peakGain = 0, loudest = '';
    for (const ctx of new Set(live.map((s) => s.ctx))) {
      const here = live.filter((s) => s.ctx === ctx);
      const times = new Set<number>();
      for (const s of here) {
        times.add(s.start);
        for (const p of new Set(s.paths.flat())) for (const e of gainRec.get(p)?.events ?? []) if (e.t >= s.start && e.t < s.stop) times.add(e.t);
      }
      for (const t of times) {
        let total = 0;
        const parts: string[] = [];
        for (const s of here) {
          if (t < s.start || t >= s.stop) continue;
          for (const ps of s.paths) {
            const g = product(ps, t);
            total += g;
            if (g > 1e-3) parts.push(`${s.node.constructor.name.replace(/Node$/, '')} +${(t - s.start).toFixed(3)}s ${g.toFixed(3)}`);
            const shared = ps.filter((p) => (users.get(p) ?? 0) > 1);
            if (shared.length) masterGain = Math.max(masterGain, product(shared, t)); // a path with no shared stage has no master
          }
        }
        if (total > peakGain) { peakGain = total; loudest = parts.join(', '); }
      }
    }
    // Every sound's virtual start and stop, in the order the page started them.
    const sounds = live.map((s) => ({ start: s.start, stop: s.stop }));
    return { masterGain, peakGain, loudest, sounds };
  };

  // ---- Animations and transitions: brightness that repeats, or goes back and forth, faster than flashMs ----
  const LIGHT = /^(opacity|filter|backdrop-filter|-webkit-filter|color|fill|stroke|visibility|box-shadow|text-shadow|background.*|border.*color|outline-color)$/;
  const kebab = (p: string) => p.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
  const num = (v: string): number | null => { const m = /-?\d*\.?\d+(e-?\d+)?/i.exec(v); return m ? Number(m[0]) : null; };
  const judged = new WeakSet<Animation>(), flashes: string[] = [];
  const judge = (a: Animation) => {
    if (judged.has(a)) return;
    judged.add(a);
    const fx = a.effect as KeyframeEffect | null;
    if (!fx || typeof fx.getKeyframes !== 'function') return;
    const timing = fx.getComputedTiming();
    const d = Number(timing.duration), n = Number(timing.iterations ?? 1), dir = String(timing.direction ?? 'normal');
    if (!(d > 0)) return;
    const kfs = fx.getKeyframes();
    const light = new Set<string>();
    for (const k of kfs) for (const p of Object.keys(k)) if (LIGHT.test(kebab(p))) light.add(p);
    const tp = (a as any).transitionProperty as string | undefined;
    if (tp && LIGHT.test(tp)) light.add(tp);
    if (!light.size) return;
    const name = `${(a as any).animationName ?? tp ?? 'animation'} ${Math.round(d)} ms`;
    // Repeating: every iteration jumps back (or, alternating, turns back), so a fast one flickers.
    if ((n > 1 || dir.includes('alternate')) && d < flashMs) { flashes.push(`${name} x${n}`); return; }
    // Back and forth inside one iteration: a turn whose two legs are both faster than flashMs.
    for (const p of light) {
      const seq: { o: number; v: string }[] = [];
      for (const k of kfs) {
        if ((k as any)[p] === undefined) continue;
        const v = String((k as any)[p]), o = Number(k.computedOffset ?? k.offset ?? 0);
        if (!seq.length || seq[seq.length - 1]!.v !== v) seq.push({ o, v });
      }
      for (let i = 1; i + 1 < seq.length; i++) {
        const [a0, a1, a2] = [seq[i - 1]!, seq[i]!, seq[i + 1]!];
        const x0 = num(a0.v), x1 = num(a1.v), x2 = num(a2.v);
        const turns = x0 !== null && x1 !== null && x2 !== null ? (x1 - x0) * (x2 - x1) < 0 : a2.v === a0.v;
        if (turns && (a1.o - a0.o) * d < flashMs && (a2.o - a1.o) * d < flashMs) { flashes.push(`${name} ${kebab(p)} back and forth`); return; }
      }
    }
  };
  const onStart = (e: Event) => { const t = e.target as Element | null; try { for (const x of t?.getAnimations?.() ?? []) judge(x); } catch { /* detached */ } };
  for (const t of ['animationstart', 'transitionrun']) document.addEventListener(t, onStart, true);
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) { const x = animate.apply(this, args); judge(x); return x; };

  // ---- Tap probe: a change made while this tap's own pointerdown or pointerup is being handled ----
  // Window capture runs before the page hears the event, window bubble after all its handlers: records taken at the
  // capture are someone else's (a timer's); records still pending at the bubble were made by the page's handlers.
  // Mutation records reach the observer at the microtask checkpoint after each listener, so the callback also counts,
  // but only while the tap's event is still being dispatched (its eventPhase drops to NONE as soon as dispatch ends,
  // even when a listener stops propagation); a timer can never run inside a dispatch.
  // `ms` runs from the start of the dispatch that made the change (the pointerdown's, or the pointerup's): how long the
  // page took to answer, not how long the finger stayed down (in a headless browser that gap is the driver's latency).
  let probe: { t0: number; ms?: number; up: boolean; end?: number } | null = null;
  let current: Event | null = null, since = 0;
  const hit = () => { if (probe && probe.ms === undefined) probe.ms = performance.now() - since; };
  const mo = new MutationObserver((recs) => { if (recs.length && current && current.eventPhase !== Event.NONE) hit(); });
  mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  const begin = (e: Event) => { mo.takeRecords(); current = e; since = performance.now(); }; // records taken here are someone else's
  const finish = () => { if (mo.takeRecords().length) hit(); current = null; };
  addEventListener('pointerdown', (e) => { if (!e.isTrusted) return; probe = { t0: performance.now(), up: false }; begin(e); }, true);
  addEventListener('pointerdown', (e) => { if (e.isTrusted && current === e) finish(); });
  addEventListener('pointerup', (e) => { if (e.isTrusted && probe) begin(e); }, true);
  addEventListener('pointerup', (e) => { if (!e.isTrusted || !probe || current !== e) return; finish(); probe.up = true; probe.end = performance.now() - probe.t0; });

  // `hold(ms)`: the runner is holding a finger down for ms; the virtual clock moves on by that much.
  w.__bbPlay = { spoken, played, flashes, audio, reset() { probe = null; }, probe: () => probe, hold(ms: number) { held += Number(ms) || 0; tapAt += (Number(ms) || 0) / 1000; vnow = tapAt; } };
}

/** The runner's in-page instrumentation as an init script (exported for tests). */
export function instrumentScript(): string {
  // tsx compiles with keepNames, so functions sent to the page may call esbuild's __name helper: give the page one.
  return `globalThis.__name = globalThis.__name || ((f) => f); (${instrument.toString()})(${BLOCK_BARN_RULES.flashMs}, ${TAP_GAP_MS});`;
}

const center = (t: Target) => ({ x: t.x + t.w / 2, y: t.y + t.h / 2 });
const r1 = (x: number) => Math.round(x * 10) / 10;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

class Barn {
  records: BlockBarnRecord[] = [];
  sizes: BlockBarnTargetSize[] = [];
  seen = new Set<string>();
  tapped = new Set<string>();
  last = 0;
  /** `measure`: record every target's size before each tap (the tap script does; the alphabet walk does not). */
  constructor(readonly page: Page, readonly viewport: BlockBarnViewport, readonly measure: boolean) {}
  state(): Promise<State> { return this.page.evaluate(() => (window as any).__hal.state()); }
  targets(): Promise<Target[]> { return this.page.evaluate(() => (window as any).__hal.targets()); }
  /** Waits until the tower's own animations (wobble, bump) are over: its box, and the free floor beside it, are still. */
  async still(): Promise<void> {
    await this.page.waitForFunction(() => {
      const t = document.getElementById('tower');
      return !t || t.getAnimations({ subtree: true }).every((a) => a.playState !== 'running' || (a.effect?.getComputedTiming().iterations ?? 1) === Infinity);
    }, null, { timeout: 5000 });
  }
  /** Lists the targets (measuring every one of them), then finds the one to tap. */
  async find(kind: BlockBarnKind, letter?: string): Promise<Target> {
    await this.still();
    const ts = await this.targets();
    for (const t of ts) {
      this.seen.add(t.kind);
      if (this.measure) this.sizes.push({ kind: t.kind, viewport: this.viewport, w: r1(t.w), h: r1(t.h) });
    }
    const t = ts.find((x) => x.kind === kind && (letter === undefined || x.letter === letter));
    if (!t) throw new Error(`${this.viewport}: no ${kind} target${letter ? ` for ${letter}` : ''}`);
    return t;
  }
  /** One real tap on `t`, judged in the page; returns whether the page answered it. */
  async tap(t: Target): Promise<boolean> {
    const { page } = this;
    const gap = this.last + TAP_GAP_MS - Date.now();
    if (gap > 0) await page.waitForTimeout(gap);
    await page.evaluate(() => (window as any).__bbPlay.reset());
    const c = center(t);
    await page.touchscreen.tap(c.x, c.y);
    // Only waits for the tap's own events to have been dispatched; nothing that happens after them counts.
    const p = await page.waitForFunction(() => { const x = (window as any).__bbPlay.probe(); return x?.up ? x : false; }, null, { timeout: 1000 })
      .then((h) => h.jsonValue() as Promise<{ ms?: number; end?: number }>, async () => (await page.evaluate(() => (window as any).__bbPlay.probe())) as { ms?: number; end?: number } | null);
    const changed = p?.ms !== undefined;
    this.last = Date.now();
    this.tapped.add(t.kind);
    this.records.push({ kind: t.kind, ...(t.letter ? { letter: t.letter } : {}), ms: r1(changed ? p!.ms! : p?.end ?? 0), changed, w: r1(t.w), h: r1(t.h), viewport: this.viewport });
    return changed;
  }
  async tapKind(kind: BlockBarnKind, letter?: string) { return this.tap(await this.find(kind, letter)); }
  /** Names the first floor block if it is not named, then taps it once more to stack it; returns the tower after. */
  async stackOne(): Promise<string[]> {
    const s = await this.state();
    const l = s.floor[0]!;
    if (!s.named.includes(l)) await this.tapKind('block', l);
    await this.tapKind('block', l);
    return (await this.state()).tower;
  }
  async expectTower(n: number, what: string) {
    const got = (await this.state()).tower.length;
    if (got !== n) throw new Error(`${this.viewport}: ${what}: the tower has ${got} blocks, expected ${n}`);
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
  await b.expectTower(3, 'three stacked');
  await b.tapKind('tower');
  await b.expectTower(0, 'a tap on the tower');
  // After the knock-down: the hay, the empty tower; then a tower that tumbles by itself on the 6th block.
  await b.tapKind('floor');
  await b.tapKind('tower');
  for (let i = 0; i < 5; i++) await b.stackOne();
  await b.expectTower(5, 'five stacked');
  await b.stackOne();
  await b.expectTower(0, 'the sixth block (it should tumble)');
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
  await page.evaluate((ms) => (window as any).__bbPlay.hold(ms), HOLD_MS);
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
  // Any kind the hook listed that the script has not tapped yet (one the game added): tap one of each.
  for (const kind of [...b.seen].filter((k) => !b.tapped.has(k)).sort()) {
    const t = (await b.targets()).find((x) => x.kind === kind);
    if (t) await b.tap(await b.find(kind));
  }
}

/**
 * After the tap that names `letter`: waits until its voice starts, a spoken line with the letter as a word of its own
 * or a clip whose key ends in it (letter-c, name-c), or VOICE_WAIT_MS passes. Lines from before the tap don't count.
 */
function voiceFor(page: Page, letter: string | null, before: { s: number; p: number }): Promise<boolean> {
  return page.waitForFunction(([l, s, p]) => {
    const b = (window as any).__bbPlay;
    const spoken = (b.spoken as string[]).slice(s as number), played = (b.played as string[]).slice(p as number);
    if (l === null) return spoken.length > 0 || played.length > 0;
    const word = new RegExp(`(^|[^a-z])${l}([^a-z]|$)`, 'i'), key = new RegExp(`-${l}\\.[a-z0-9]+$`, 'i');
    return spoken.some((x) => word.test(x)) || played.some((x) => key.test(x.split(/[?#]/)[0]!));
  }, [letter, before.s, before.p] as const, { timeout: VOICE_WAIT_MS }).then(() => true, () => false);
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

/**
 * Over `steps` stack-and-refill steps: names every unnamed letter on the floor (checking its voice and picture), then
 * stacks the first floor block. A refill may land in any slot; the walk only reads which letters are on the floor.
 */
async function alphabet(b: Barn, steps: number): Promise<Pick<BlockBarnPage, 'letters' | 'voiced' | 'pictured'>> {
  const { page } = b;
  const letters = new Set<string>(), checked = new Set<string>(), voiced = new Set<string>(), drawn = new Set<string>();
  const nameAll = async () => {
    const s = await b.state();
    for (const l of s.floor) {
      letters.add(l);
      if (s.named.includes(l)) continue;
      checked.add(l);
      const before = await voiceCount(page);
      await b.tapKind('block', l);
      if (await voiceFor(page, l, before)) voiced.add(l);
      if (await pictured(page, l)) drawn.add(l);
    }
  };
  await nameAll();
  for (let i = 0; i < steps && checked.size < 26; i++) { // stops early once every letter has been named
    const before = await voiceCount(page);
    await b.tapKind('block', (await b.state()).floor[0]); // named, so this stacks it; a new letter arrives
    await voiceFor(page, null, before); // let the stacked letter's line start before the next tap is judged
    await nameAll();
  }
  return { letters: [...letters].sort(), voiced: [...voiced].sort(), pictured: [...drawn].sort() };
}

type Opened = { page: Page; close(): Promise<void>; failed(): string; navigations(): number };
async function openBarn(browser: Browser, origin: string, viewport: BlockBarnViewport, initScript?: string): Promise<Opened> {
  const { context, blockedRequests, consoleErrors } = await newHalContext(browser, { contextOptions: CONTEXT[viewport] });
  const pageErrors: string[] = [];
  await context.addInitScript({ content: instrumentScript() });
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

const HANG = 'hang';
/** Rejects with HANG after `ms` of wall time (the caller then closes the page, which ends whatever was stuck). */
function bounded<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  p.catch(() => {});
  return Promise.race([p, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(HANG)), ms); })])
    .finally(() => clearTimeout(timer));
}
const why = (e: unknown, ms: number, what: string) => ((e as Error)?.message === HANG
  ? `hang: ${what} took over ${Math.round(ms / 1000)} s wall` : String((e as Error)?.message ?? e).split('\n')[0]);

/** Plays the tap script at each viewport and the alphabet walk on the phone; one browser and one static server. */
export async function runBlockBarnPlay({ viewports = [...BLOCK_BARN_VIEWPORTS], alphabetSteps = BLOCK_BARN_ALPHABET_STEPS, initScript, deadlineMs = VIEW_DEADLINE_MS }: BlockBarnPlayOptions = {}): Promise<BlockBarnPlayResult> {
  let server: StaticServer | undefined, browser: Browser | undefined;
  const records: BlockBarnRecord[] = [], errors: string[] = [];
  const page: BlockBarnPage = { letters: [], voiced: [], pictured: [], flashes: 0, masterGain: 0, peakGain: 0, leftBarn: false, targets: [] };
  const facts = async (o: Opened) => {
    const f = await bounded(o.page.evaluate(() => { const b = (window as any).__bbPlay; const a = b.audio(); return { flashes: (b.flashes as string[]).length, masterGain: a.masterGain as number, peakGain: a.peakGain as number }; }), 30_000);
    page.flashes += f.flashes;
    page.masterGain = Math.max(page.masterGain, r4(f.masterGain));
    page.peakGain = Math.max(page.peakGain, r4(f.peakGain));
    if (o.navigations() !== 1 || !new URL(o.page.url()).pathname.endsWith('/block-barn/index.html')) page.leftBarn = true;
  };
  try {
    browser = await launchBrowser(); // throws "browser unavailable: ..."
    server = await serveGames();
    for (const v of viewports) {
      const o = await openBarn(browser, server.origin, v, initScript);
      try {
        const b = new Barn(o.page, v, true);
        let hung = false;
        try { await bounded(script(b), deadlineMs); } catch (e) { hung = (e as Error)?.message === HANG; errors.push(`${v}: ${why(e, deadlineMs, 'the tap script')}`); }
        records.push(...b.records);
        page.targets.push(...b.sizes);
        if (!hung) {
          await o.page.waitForTimeout(200); // let a late async error surface
          await facts(o).catch((e) => errors.push(`${v}: ${why(e, 30_000, 'reading the page')}`));
        }
        if (o.failed()) errors.push(o.failed());
      } finally { await o.close(); }
    }
    {
      const v = viewports[0] ?? '390x844';
      const o = await openBarn(browser, server.origin, v, initScript);
      try {
        const b = new Barn(o.page, v, false);
        let hung = false;
        try { Object.assign(page, await bounded(alphabet(b, alphabetSteps), deadlineMs)); } catch (e) { hung = (e as Error)?.message === HANG; errors.push(`${v} alphabet: ${why(e, deadlineMs, 'the alphabet walk')}`); }
        if (!hung) await facts(o).catch((e) => errors.push(`${v}: ${why(e, 30_000, 'reading the page')}`));
        if (o.failed()) errors.push(o.failed());
      } finally { await o.close(); }
    }
  } finally {
    await closeAll(browser, server);
  }
  return { records, page, errors: [...new Set(errors)] };
}
