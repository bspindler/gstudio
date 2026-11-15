/// <reference lib="dom" />
// Block Barn runner for the block-barn scorer: real touch taps on the real page (?hal), headless, at 390x844 and
// 1024x768, then a bounded walk through the alphabet on the phone. The ?hal hook only reads the barn (state, targets),
// reseeds it and runs its idle clock; every tap is a real touch.
//   - A fixed tap script from a fixed seed visits every state the barn reaches (fresh, all named, a tower, a tower
//     knocked down, a tower that tumbled by itself, an invitation, the grown-up corner opened and closed) and taps
//     every kind of target in it; before every tap, every target the hook lists is measured.
//   - Then, on the same page, state combinations (taps on blocks, the tower and the hay with the doors open; naming,
//     stacking and the invitation at dusk). Then the toddler phase: for each of TODDLER_SEEDS, a fresh barn and that
//     seed's random gestures (toddlerPlan): random taps anywhere (gaps included), runs of 3-6 taps on one target,
//     two-finger and palm touches, a 1 s press (on the corner, and anywhere), cancelled touches. Each gesture is judged
//     like a tap: how many times the page answered it (exactly once; a cancel never; pressed state, such as the
//     corner's ring that starts on the press and stops on the lift, is no answer), what it changed (its signature and
//     the feature it reached), and what it left stuck. The scorer counts variety per seed and reports its seed noise.
//   - A tap answers only by a DOM change the page makes synchronously while handling that tap's own (trusted)
//     pointerdown or pointerup. Changes made later (a timer of this tap or of an earlier one) never count, so the
//     result does not depend on timing. `ms` is from the pointerdown to that change.
//   - Calm is read structurally, never by screenshot: every animation and transition that starts is checked (a
//     brightness property that repeats, or goes back and forth, faster than BLOCK_BARN_RULES.flashMs is a flash), and
//     the Web Audio graph is recorded (gain nodes however made, their values and automation, connections, source start
//     and stop times) so the effective gain of everything sounding at once can be computed.
//   - Speech is a fake that records what is said and ends each line at once, so runs are quiet and repeatable. It offers
//     an online voice and a local one; a line in any voice but an on-device one is an error (the score is rejected).
// Page and console errors, blocked requests, a page that leaves the barn, and a viewport run over VIEW_DEADLINE_MS go
// to `errors` / `page.leftBarn`. A browser that can't launch throws "browser unavailable: ..."; the CLI exits 1 on it.
// Run it with `npm run hal -- score --game block-barn`.
import type { Browser, BrowserContextOptions, CDPSession, Page } from 'playwright';
import {
  BLOCK_BARN_ALPHABET_STEPS, BLOCK_BARN_RULES, BLOCK_BARN_TODDLER_SEEDS, BLOCK_BARN_TODDLER_TAPS, BLOCK_BARN_VIEWPORTS,
  type BlockBarnGesture, type BlockBarnGestureKind, type BlockBarnKind, type BlockBarnPage, type BlockBarnRecord, type BlockBarnTargetSize, type BlockBarnViewport,
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
  /** The toddler phase's seeds at each viewport, each on a fresh barn (default TODDLER_SEEDS). */
  toddlerSeeds?: number[];
  /** Test hook: these steps instead of each seed's toddlerPlan. */
  toddlerSteps?: ToddlerStep[];
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
type State = { floor: string[]; named: string[]; tower: string[]; corner: boolean; speaking: string | null; invited: string | null; door: boolean; dusk: boolean };
type Point = { x: number; y: number };

/** Runs in the page before the game: fake speech, tap probe, animation and audio recorders, on window.__bbPlay. */
function instrument(flashMs: number, gapMs: number): void {
  const w = window as any;
  // ---- The virtual clock (seconds): audio is placed on it, never on the wall clock ----
  // The n-th real tap is at n x gapMs (plus any hold the runner declares), whatever the driver's real gaps; `tapAt` is
  // the latest tap's time. Everything runs at tapAt (the tap's own input events, intervals, media and onended events,
  // promise continuations, the runner's own calls) except two kinds of wrapped callback:
  // - a setTimeout callback runs at its scheduler's virtual time plus the requested delay (so a chain a tap starts
  //   stays on that tap's time line, however late the real timer ran);
  // - a requestAnimationFrame callback runs at max(its scheduler's virtual time, tapAt): a frame never moves the clock
  //   on, so a standing frame loop always sounds with the latest tap, however many real frames ran.
  // After a wrapped callback the clock goes back to tapAt, so nothing it leaves behind runs at its time.
  // A gesture of several fingers (two fingers, a palm) is one tap on the clock: only a pointerdown with no other finger
  // down moves it on.
  let taps = 0, held = 0, tapAt = 0, vnow = 0;
  const down = new Set<number>();
  for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click', 'keydown', 'keyup']) {
    addEventListener(type, (e) => {
      if (!e.isTrusted) return;
      if (type === 'pointerdown') { if (!down.size) tapAt = (++taps * gapMs + held) / 1000; down.add((e as PointerEvent).pointerId); }
      if (type === 'pointerup' || type === 'pointercancel') down.delete((e as PointerEvent).pointerId);
      vnow = tapAt;
    }, true);
  }
  const at = (fn: unknown, when: () => number) => (typeof fn !== 'function' ? fn : function (this: unknown) {
    vnow = when();
    try { return (fn as Function).apply(this, arguments as any); } finally { vnow = tapAt; }
  });
  const realTimeout = w.setTimeout, realRaf = w.requestAnimationFrame;
  w.setTimeout = function (fn: unknown, ms?: number, ...rest: unknown[]) { const t = vnow + Math.max(0, Number(ms) || 0) / 1000; return realTimeout.call(this, at(fn, () => t), ms, ...rest); };
  if (realRaf) w.requestAnimationFrame = function (fn: FrameRequestCallback) { const t = vnow; return realRaf.call(this, at(fn, () => Math.max(t, tapAt))); };
  // Speech: record each spoken line and end it at once. The device offers an online English voice (it would send the
  // words to a server) and a local one; a line spoken in anything but an on-device voice is a hard failure.
  const spoken: string[] = [], offDevice: string[] = [];
  const voices = [
    { name: 'Google US English', lang: 'en-US', localService: false, voiceURI: 'Google US English', default: true },
    { name: 'Samantha', lang: 'en-US', localService: true, voiceURI: 'Samantha', default: false },
  ];
  w.SpeechSynthesisUtterance = class { text: string; volume = 1; rate = 1; pitch = 1; voice: unknown = null; lang = ''; onend: unknown = null; onerror: unknown = null; constructor(t: unknown) { this.text = String(t ?? ''); } };
  const fake = {
    speak(u: any) {
      const t = String(u?.text ?? '');
      if (!t.trim()) return;
      spoken.push(t);
      if (u?.voice?.localService !== true) offDevice.push(`${u?.voice?.name ?? '(browser default)'}: ${t}`);
      setTimeout(() => u.onend?.({}), 10);
    },
    cancel() {}, pause() {}, resume() {}, getVoices: () => voices.slice(), addEventListener() {}, removeEventListener() {}, speaking: false, pending: false, paused: false,
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
  type Ev = { k: 'set' | 'lin' | 'exp' | 'target'; v: number; t: number; tc?: number; now?: true }; // now: a `.value =`
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
      // Drops the automation scheduled at or after the cancel time; a `.value =` already took effect and stays.
      // cancelAndHoldAtTime then holds the value reached at that time.
      AP[m] = function (this: AudioParam, t: number) {
        const r = gainRec.get(this);
        if (r) {
          const from = wall(r.ctx, t), kept = m === 'cancelAndHoldAtTime' ? valueAt(this, from) : null;
          r.events = r.events.filter((e) => e.t < from || e.now);
          if (kept !== null) r.events.push({ k: 'set', v: kept, t: from });
        }
        return orig.apply(this, arguments as any);
      };
    }
    const value = Object.getOwnPropertyDescriptor(AP, 'value')!;
    Object.defineProperty(AP, 'value', {
      ...value,
      set(this: AudioParam, v: number) {
        const r = gainRec.get(this);
        // The start value is the constructor's (or the default 1); every assignment is a set at the (virtual) now, so
        // turning a gain down after its sound played never rewrites what it played at.
        if (r && Number.isFinite(Number(v))) r.events.push({ k: 'set', v: Number(v), t: wall(r.ctx, r.ctx.currentTime), now: true });
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
  // A toddler gesture (one finger or several, held or cancelled), from `startGesture()` on. Each trusted pointerdown,
  // pointerup and pointercancel dispatch is judged the same way as a tap's: did the page change while handling it.
  // Pressed state never answers: an attribute that a press of this gesture changed and a later release of the same
  // gesture set back as it was (a hold ring that starts on the press and stops on the lift or the cancel) counts
  // neither at the press nor at the release. A change and its undo inside one dispatch (restarting an animation) still
  // answers. `regions`: for each answering change, the id of the nearest element with one (where in the barn it
  // answered); `sounds`: the Web Audio sources started while handling it.
  type Change = { region: string; key?: string; old?: string | null; now?: string | null };
  type Dispatch = { kind: 'down' | 'release'; changes: Change[]; sounds: number };
  let gest: { dispatches: Dispatch[] } | null = null;
  let current: Event | null = null, since = 0, soundsAt = 0, pending: MutationRecord[] = [];
  const hit = () => { if (probe && probe.ms === undefined) probe.ms = performance.now() - since; };
  const regionOf = (n: Node | null): string => {
    let el: Element | null = n && n.nodeType === 1 ? (n as Element) : n?.parentElement ?? null;
    while (el && !el.id) el = el.parentElement;
    return el ? el.id : 'document';
  };
  const nodeIds = new WeakMap<Node, number>();
  let nodeCount = 0;
  const nodeId = (n: Node) => { let i = nodeIds.get(n); if (i === undefined) nodeIds.set(n, (i = ++nodeCount)); return i; };
  /**
   * An attribute's value; a class list is read as a set, and no class attribute as the empty set (adding a class to an
   * element that had none, then removing it, leaves class="": the same classes as before).
   */
  const attrValue = (name: string, v: string | null) => (name !== 'class' ? v : [...new Set((v ?? '').split(/\s+/).filter(Boolean))].sort().join(' '));
  const note = (recs: MutationRecord[]) => {
    if (!recs.length) return;
    hit();
    if (gest) pending.push(...recs);
  };
  const mo = new MutationObserver((recs) => { if (current && current.eventPhase !== Event.NONE) note(recs); });
  mo.observe(document, { subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true });
  const begin = (e: Event) => { mo.takeRecords(); current = e; since = performance.now(); soundsAt = sources.length; pending = []; }; // records taken here are someone else's
  const finish = (e: Event) => {
    note(mo.takeRecords());
    current = null;
    if (!gest) return;
    const changes = pending.map((r): Change => {
      const region = regionOf(r.target);
      if (r.type !== 'attributes' || !r.attributeName) return { region };
      const name = r.attributeName;
      return { region, key: `${nodeId(r.target)}:${name}`, old: attrValue(name, r.oldValue), now: attrValue(name, (r.target as Element).getAttribute(name)) };
    });
    pending = [];
    gest.dispatches.push({ kind: e.type === 'pointerdown' ? 'down' : 'release', changes, sounds: sources.length - soundsAt });
  };
  addEventListener('pointerdown', (e) => { if (!e.isTrusted) return; if (down.size <= 1) probe = { t0: performance.now(), up: false }; begin(e); }, true);
  addEventListener('pointerdown', (e) => { if (e.isTrusted && current === e) finish(e); });
  for (const type of ['pointerup', 'pointercancel']) {
    addEventListener(type, (e) => { if (e.isTrusted) begin(e); }, true);
    addEventListener(type, (e) => {
      if (!e.isTrusted || current !== e) return;
      finish(e);
      if (type === 'pointerup' && probe && !probe.up) { probe.up = true; probe.end = performance.now() - probe.t0; }
    });
  }
  /**
   * The gesture's answers: every release (pointerup or pointercancel) that changed the page, and every extra finger's
   * press that did; a gesture answered only as its first finger landed (and not on release) answered once. Pressed
   * state is left out first. A change outside every element with an id (the root's layout variables, rewritten
   * whenever the barn re-measures itself) still answers, but is bookkeeping, not a place in the barn: it names no region.
   */
  const gesture = () => {
    if (!gest) return null;
    const ds = gest.dispatches;
    // Pressed state: an attribute first changed in this gesture at a press, that a later release set back to its value
    // from before the press.
    const pressed = new Set<string>(), first = new Map<string, { at: number; old: string | null | undefined }>();
    ds.forEach((d, i) => {
      for (const c of d.changes) {
        if (!c.key) continue;
        if (!first.has(c.key)) first.set(c.key, { at: i, old: c.old });
        const f = first.get(c.key)!;
        if (d.kind === 'release' && ds[f.at]!.kind === 'down' && f.at < i && c.now === f.old) pressed.add(c.key);
      }
    });
    const live = (d: Dispatch) => d.changes.filter((c) => !c.key || !pressed.has(c.key));
    const downs = ds.filter((d) => d.kind === 'down'), releases = ds.filter((d) => d.kind === 'release');
    const firstDown = !!downs[0] && live(downs[0]).length > 0;
    const n = releases.filter((d) => live(d).length).length + downs.slice(1).filter((d) => live(d).length).length;
    const regions = new Set<string>();
    for (const d of ds) for (const c of live(d)) if (c.region !== 'document') regions.add(c.region);
    return { downs: downs.length, releases: releases.length, responses: n || (firstDown ? 1 : 0), regions: [...regions].sort(), sounds: ds.reduce((a, d) => a + d.sounds, 0) };
  };

  // `hold(ms)`: the runner is holding a finger down for ms; the virtual clock moves on by that much.
  w.__bbPlay = { spoken, offDevice, played, flashes, audio, reset() { probe = null; }, probe: () => probe, startGesture() { gest = { dispatches: [] }; }, gesture, hold(ms: number) { held += Number(ms) || 0; tapAt += (Number(ms) || 0) / 1000; vnow = tapAt; } };
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
  gestures: BlockBarnGesture[] = [];
  sizes: BlockBarnTargetSize[] = [];
  seen = new Set<string>();
  tapped = new Set<string>();
  last = 0;
  /** The toddler seed whose random phase is playing (unset for the combinations). */
  seed?: number;
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
  /**
   * Waits until nothing a tap is routed by is moving: the tower (its box) and the animals (their boxes) have no
   * finite animation running. A toddler would not wait, but where a tap lands must not depend on the driver's timing.
   */
  async settle(): Promise<void> {
    await this.page.waitForFunction(() => {
      const els = [document.getElementById('tower'), ...Array.from(document.querySelectorAll('#slots .animal'))].filter(Boolean) as Element[];
      return els.every((el) => el.getAnimations({ subtree: el.id === 'tower' }).every((a) => a.playState !== 'running' || (a.effect?.getComputedTiming().iterations ?? 1) === Infinity));
    }, null, { timeout: 8000, polling: 50 });
  }
  /**
   * One toddler gesture with real touches (CDP): every finger lands, (for a press) stays PRESS_MS, then all lift (or
   * the touch is cancelled). Reads how many times the page answered, what changed, and whether anything is stuck.
   */
  async gesture(gesture: BlockBarnGestureKind, phase: 'random' | 'combo', points: Point[]): Promise<BlockBarnGesture> {
    const { page } = this;
    await this.settle();
    const gap = this.last + TAP_GAP_MS - Date.now();
    if (gap > 0) await page.waitForTimeout(gap);
    const before = await this.state();
    const on = kindAt(await this.targets(), points[0]!);
    await page.evaluate(() => (window as any).__bbPlay.startGesture());
    const cdp = await this.cdp();
    await touch(cdp, 'touchStart', points);
    if (gesture === 'press') {
      await page.waitForTimeout(PRESS_MS);
      await page.evaluate((ms) => (window as any).__bbPlay.hold(ms), PRESS_MS);
    }
    await touch(cdp, gesture === 'cancel' ? 'touchCancel' : 'touchEnd', []);
    const n = points.length;
    type G = { responses: number; regions: string[]; sounds: number; releases: number; downs: number };
    const g = await page.waitForFunction((k) => { const x = (window as any).__bbPlay.gesture(); return x && x.releases >= k ? x : false; }, n, { timeout: 1000 })
      .then((h) => h.jsonValue() as Promise<G>, () => page.evaluate(() => (window as any).__bbPlay.gesture()) as Promise<G>);
    this.last = Date.now();
    const after = await this.state();
    const stuck = await this.stuck(after);
    if (g.downs < n || g.releases < n) stuck.push(`${n} finger${n === 1 ? '' : 's'} landed, the page heard ${g.downs} down and ${g.releases} up`);
    const c = stateChange(before, after), where = g.regions.join('+');
    const answered = g.responses > 0, sound = g.sounds ? 'sound' : 'quiet';
    // A state change is named by the change (where else it showed depends on what the animals' own timers were doing,
    // which varies from run to run); an answer that changes no state, by where it showed.
    const signature = !answered ? '' : c ? `${c}|${sound}` : `same|${where}|${sound}`;
    const rec: BlockBarnGesture = {
      viewport: this.viewport, phase, ...(phase === 'random' && this.seed !== undefined ? { seed: this.seed } : {}), gesture, on, state: flags(before), responses: g.responses,
      signature, feature: answered ? FEATURE[c] ?? (c || `touch:${where}`) : '', stuck,
    };
    this.gestures.push(rec);
    return rec;
  }
  /** What is stuck right now: the grown-up corner open or still counting a hold, or a barn that lost its blocks. */
  async stuck(s: State): Promise<string[]> {
    const out: string[] = [];
    if (s.corner) out.push('the grown-up corner is open');
    if (await this.page.evaluate(() => !!document.querySelector('#corner.holding'))) out.push('the grown-up corner is still counting a hold');
    if (s.floor.length !== 5) out.push(`the floor has ${s.floor.length} blocks`);
    if (s.tower.length > 5) out.push(`the tower has ${s.tower.length} blocks`);
    return out;
  }
  private session?: CDPSession;
  async cdp(): Promise<CDPSession> { return (this.session ??= await this.page.context().newCDPSession(this.page)); }
  /** One finger on the centre of the first target of `kind` (and `letter`), as a combination tap. */
  async comboTap(kind: BlockBarnKind, letter?: string): Promise<BlockBarnGesture> {
    await this.settle();
    const ts = await this.targets();
    const t = ts.find((x) => x.kind === kind && (letter === undefined || x.letter === letter));
    if (!t) throw new Error(`${this.viewport}: no ${kind} target${letter ? ` for ${letter}` : ''}`);
    return this.gesture('tap', 'combo', [center(t)]);
  }
  async expectTower(n: number, what: string) {
    const got = (await this.state()).tower.length;
    if (got !== n) throw new Error(`${this.viewport}: ${what}: the tower has ${got} blocks, expected ${n}`);
  }
}

async function touch(cdp: CDPSession, type: 'touchStart' | 'touchEnd' | 'touchCancel', points: Point[]) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id, radiusX: 8, radiusY: 8, force: 1 })) });
}

// ---- The toddler phase: how she really plays ----
/** The toddler phase's own random streams, one fresh barn each (the barn keeps BLOCK_BARN_SEED). */
export const TODDLER_SEEDS: readonly number[] = Array.from({ length: BLOCK_BARN_TODDLER_SEEDS }, (_, i) => i + 1);
/** Fresh barns playing their toddler seeds at once. */
const SEED_PAGES = 6;
/** The 1 s press: a toddler's long touch, well short of the grown-up corner's 3 s hold. */
export const PRESS_MS = 1000;
/** A palm: five contacts around where it lands (CSS px). */
const PALM = [[-40, -10], [-15, -35], [15, -38], [40, -20], [0, 25]] as const;

/** mulberry32: a small seeded generator, so the toddler's taps are the same in every run. */
export function toddlerRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One step of a toddler plan: `n` taps for a run; `corner`: the first finger lands on the grown-up corner. */
export type ToddlerStep = { gesture: BlockBarnGestureKind; n?: number; corner?: boolean };
/**
 * The random phase's gestures in a seeded order: 4 runs of 3-6 taps on one target, 3 two-finger taps, 3 palms, two
 * 1 s presses (one on the grown-up corner, one anywhere), 2 cancelled touches, and single taps anywhere (gaps
 * included) to make up `taps` answering taps in all (the cancels are on top).
 */
export function toddlerPlan(rng: () => number, taps = BLOCK_BARN_TODDLER_TAPS): ToddlerStep[] {
  const runs = Array.from({ length: 4 }, () => ({ gesture: 'run' as const, n: 3 + Math.floor(rng() * 4) }));
  const fixed: ToddlerStep[] = [
    ...runs,
    ...Array.from({ length: 3 }, () => ({ gesture: 'two' as const })),
    ...Array.from({ length: 3 }, () => ({ gesture: 'palm' as const })),
    { gesture: 'press', corner: true }, { gesture: 'press' },
    { gesture: 'cancel' }, { gesture: 'cancel' },
  ];
  const used = runs.reduce((a, r) => a + r.n, 0) + 8;
  const plan: ToddlerStep[] = [...fixed, ...Array.from({ length: Math.max(0, taps - used) }, () => ({ gesture: 'tap' as const }))];
  for (let i = plan.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [plan[i], plan[j]] = [plan[j]!, plan[i]!]; }
  return plan;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
/** What a gesture changed in the barn's state, if anything. */
function stateChange(a: State, b: State): string {
  if (a.door !== b.door) return b.door ? 'door-open' : 'door-close';
  if (a.dusk !== b.dusk) return b.dusk ? 'dusk' : 'dawn';
  if (b.tower.length > a.tower.length) return 'stack';
  if (a.tower.length > 0 && b.tower.length === 0) return same(a.floor, b.floor) ? 'knock' : 'tumble';
  if (b.named.length > a.named.length && same(a.floor, b.floor)) return 'name';
  return '';
}
const FEATURE: Record<string, string> = { 'door-open': 'door', 'door-close': 'door', dusk: 'sky', dawn: 'sky' };
const flags = (s: State) => [s.door ? 'door' : '', s.dusk ? 'dusk' : ''].filter(Boolean).join('+');

/** The hook target under a point (the smallest when several hold it), or 'gap'. */
function kindAt(ts: Target[], p: Point): string {
  const holds = ts.filter((t) => p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y && p.y <= t.y + t.h).sort((a, b) => a.w * a.h - b.w * b.h);
  return holds[0]?.kind ?? 'gap';
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

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * One seed's random phase, on a fresh barn of its own: the seeded random gestures (toddlerPlan, or `steps` from a test)
 * anywhere on the screen. A step marked `corner` puts its first finger on the grown-up corner.
 */
async function randomPhase(b: Barn, seed: number, steps?: ToddlerStep[]): Promise<void> {
  const rng = toddlerRng(seed);
  b.seed = seed;
  const vp = b.page.viewportSize() ?? { width: 390, height: 844 };
  const inside = (p: Point): Point => ({ x: clamp(p.x, 4, vp.width - 4), y: clamp(p.y, 4, vp.height - 4) });
  const anywhere = (): Point => inside({ x: rng() * vp.width, y: rng() * vp.height });
  const corner = async () => center((await b.targets()).find((t) => t.kind === 'corner')!);
  for (const step of steps ?? toddlerPlan(rng)) {
    if (step.gesture === 'run') {
      const ts = (await b.targets()).filter((t) => t.kind !== 'corner');
      const p = step.corner ? await corner() : center(ts[Math.floor(rng() * ts.length)]!);
      for (let i = 0; i < (step.n ?? 3); i++) await b.gesture('run', 'random', [p]);
    } else if (step.gesture === 'two') {
      const p = step.corner ? await corner() : anywhere();
      await b.gesture('two', 'random', [p, inside({ x: p.x + 30 + rng() * 20, y: p.y - 20 + rng() * 40 })]);
    } else if (step.gesture === 'palm') {
      const p = step.corner ? await corner() : anywhere();
      await b.gesture('palm', 'random', PALM.map(([dx, dy]) => inside({ x: p.x + dx, y: p.y + dy })));
    } else {
      await b.gesture(step.gesture, 'random', [step.corner ? await corner() : anywhere()]);
    }
  }
  b.seed = undefined;
}

/**
 * The state combinations, after the scripted walk: taps on blocks, the tower and the hay while the doors are open;
 * naming, stacking and the invitation at dusk; the doors at dusk; then a plain tap that must still answer. The doors
 * and the sky are put back as they were found first.
 */
async function combos(b: Barn): Promise<void> {
  // Put the doors and the sky back, so the combinations start from a plain day with the doors shut.
  for (const [flag, kind] of [['door', 'door'], ['dusk', 'sky']] as const) if ((await b.state())[flag]) await b.comboTap(kind);
  const unnamed = async () => { const s = await b.state(); return s.floor.find((l) => !s.named.includes(l)); };
  const namedOne = async () => { const s = await b.state(); return s.floor.find((l) => s.named.includes(l)); };
  const expect = async (flag: 'door' | 'dusk', want: boolean, what: string) => {
    if ((await b.state())[flag] === want) return;
    const word = flag === 'door' ? 'the doors are' : 'the sky is', how = flag === 'door' ? 'open' : 'at dusk';
    b.gestures[b.gestures.length - 1]!.stuck.push(`after ${what} ${word} ${want ? 'not' : 'still'} ${how}`);
  };
  // The doors open: a block (named first if it can be), the tower, the hay, a named block (stacks), an animal outside.
  await b.comboTap('door');
  await expect('door', true, 'a tap on the doors');
  // (Every unnamed block is gone? A stack brings a new one.) The animal named with the doors open stays outside.
  if (!(await unnamed())) await b.comboTap('block', (await b.state()).floor[0]!);
  const l0 = (await unnamed())!;
  await b.comboTap('block', l0);
  const outside = (await b.targets()).find((t) => t.kind === 'animal');
  if (outside) await b.comboTap('animal', outside.letter);
  await b.comboTap('tower');
  await b.comboTap('floor');
  const n0 = await namedOne();
  if (n0) await b.comboTap('block', n0);
  await expect('door', true, 'taps elsewhere with the doors open');
  await b.comboTap('door');
  await expect('door', false, 'a second tap on the doors');
  // Dusk: name a block, stack a named one, the invitation, the doors at dusk; then morning.
  if ((await b.targets()).some((t) => t.kind === 'sky')) {
    await b.comboTap('sky');
    await expect('dusk', true, 'a tap on the sky');
    const l1 = await unnamed();
    if (l1) await b.comboTap('block', l1);
    const n1 = await namedOne();
    if (n1) await b.comboTap('block', n1);
    await b.page.evaluate(() => (window as any).__hal.idle(8100));
    const invited = (await b.state()).invited;
    if (!invited) throw new Error(`${b.viewport}: no invitation after 8 s idle at dusk`);
    await b.comboTap('block', invited);
    await b.comboTap('door');
    await b.comboTap('tower');
    await b.comboTap('door');
    await expect('dusk', true, 'taps elsewhere at dusk');
    await b.comboTap('sky');
    await expect('dusk', false, 'a second tap on the sky');
  }
  // Nothing is stuck: a plain tap on the hay still answers.
  await b.comboTap('floor');
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

type Opened = { page: Page; viewport: BlockBarnViewport; close(): Promise<void>; failed(): string; navigations(): number; popups(): number };
async function openBarn(browser: Browser, origin: string, viewport: BlockBarnViewport, initScript?: string): Promise<Opened> {
  const { context, blockedRequests, consoleErrors } = await newHalContext(browser, { contextOptions: CONTEXT[viewport] });
  const pageErrors: string[] = [];
  await context.addInitScript({ content: instrumentScript() });
  if (initScript) await context.addInitScript({ content: initScript });
  const page = await context.newPage();
  let navigations = 0, popups = 0;
  context.on('page', () => { popups++; }); // a popup or new tab leaves the barn too
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations++; });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('crash', () => pageErrors.push('page crashed'));
  await page.goto(`${origin}/block-barn/index.html?hal`);
  await page.waitForFunction(() => !!(window as any).__hal && !!(window as any).__bbPlay, null, { timeout: 10_000 });
  await page.evaluate((s) => (window as any).__hal.seed(s), BLOCK_BARN_SEED);
  return {
    page,
    viewport,
    close: () => context.close().catch(() => {}),
    navigations: () => navigations,
    popups: () => popups,
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
export async function runBlockBarnPlay({ viewports = [...BLOCK_BARN_VIEWPORTS], alphabetSteps = BLOCK_BARN_ALPHABET_STEPS, initScript, deadlineMs = VIEW_DEADLINE_MS, toddlerSeeds = [...TODDLER_SEEDS], toddlerSteps }: BlockBarnPlayOptions = {}): Promise<BlockBarnPlayResult> {
  let server: StaticServer | undefined, browser: Browser | undefined;
  const records: BlockBarnRecord[] = [], errors: string[] = [];
  const page: BlockBarnPage = { letters: [], voiced: [], pictured: [], flashes: 0, masterGain: 0, peakGain: 0, leftBarn: false, targets: [], gestures: [] };
  const facts = async (o: Opened) => {
    const f = await bounded(o.page.evaluate(() => { const b = (window as any).__bbPlay; const a = b.audio(); return { flashes: (b.flashes as string[]).length, masterGain: a.masterGain as number, peakGain: a.peakGain as number, offDevice: [...b.offDevice] as string[] }; }), 30_000);
    if (f.offDevice.length) errors.push(`${o.viewport}: speech in a voice that is not on the device: ${f.offDevice[0]}`);
    page.flashes += f.flashes;
    page.masterGain = Math.max(page.masterGain, r4(f.masterGain));
    page.peakGain = Math.max(page.peakGain, r4(f.peakGain));
    if (o.navigations() !== 1 || o.popups() > 0 || !new URL(o.page.url()).pathname.endsWith('/block-barn/index.html')) page.leftBarn = true;
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
        if (!hung) try { await bounded(combos(b), deadlineMs); } catch (e) { hung = (e as Error)?.message === HANG; errors.push(`${v}: ${why(e, deadlineMs, 'the state combinations')}`); }
        records.push(...b.records);
        page.targets.push(...b.sizes);
        page.gestures.push(...b.gestures);
        if (!hung) {
          await o.page.waitForTimeout(200); // let a late async error surface
          await facts(o).catch((e) => errors.push(`${v}: ${why(e, 30_000, 'reading the page')}`));
        }
        if (o.failed()) errors.push(o.failed());
      } finally { await o.close(); }
      // Each toddler seed on a fresh barn of its own, SEED_PAGES at a time (a page's results never depend on timing).
      const seeded: BlockBarnGesture[][] = [];
      const queue = toddlerSeeds.map((seed, i) => ({ seed, i }));
      const worker = async () => {
        for (let job = queue.shift(); job; job = queue.shift()) {
          const { seed, i } = job;
          const s = await openBarn(browser!, server!.origin, v, initScript);
          try {
            const b = new Barn(s.page, v, false);
            let hung = false;
            try { await bounded(randomPhase(b, seed, toddlerSteps), deadlineMs); } catch (e) { hung = (e as Error)?.message === HANG; errors.push(`${v} toddler seed ${seed}: ${why(e, deadlineMs, 'the toddler phase')}`); }
            seeded[i] = b.gestures;
            if (!hung) {
              await s.page.waitForTimeout(200);
              await facts(s).catch((e) => errors.push(`${v} toddler seed ${seed}: ${why(e, 30_000, 'reading the page')}`));
            }
            if (s.failed()) errors.push(s.failed()); // the same words as the main page's, so one fault is reported once
          } finally { await s.close(); }
        }
      };
      await Promise.all(Array.from({ length: Math.min(SEED_PAGES, toddlerSeeds.length) }, worker));
      for (const gs of seeded) page.gestures.push(...(gs ?? []));
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
