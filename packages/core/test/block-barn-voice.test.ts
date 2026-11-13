import { afterEach, describe, expect, it, vi } from 'vitest';

import { SPEECH, createVoice, pickVoice } from '../../../games/block-barn/voice.js';
import { CLIPS } from '../../../games/block-barn/audio/clips.js';

afterEach(() => { (CLIPS as Set<string>).clear(); vi.useRealTimers(); });

function setup(o: { clips?: string[]; rec?: (k: string) => Promise<string | null>; synth?: any; playFails?: boolean } = {}) {
  const log: string[] = [];
  const audios: any[] = [];
  const audio = (url: string) => {
    const a = { url, paused: false, play: () => { log.push('play ' + url); return o.playFails ? Promise.reject(new Error('blocked')) : Promise.resolve(); }, pause() { a.paused = true; log.push('pause ' + url); } };
    audios.push(a);
    return a;
  };
  o.clips?.forEach((c) => (CLIPS as Set<string>).add(c));
  const utter = (t: string) => ({ text: t, rate: 0, pitch: 0, onend: null as any, onerror: null as any });
  const v = createVoice({ audio, synth: o.synth ?? null, recordings: o.rec ?? (async () => null), base: './', utter });
  return { v, log, audios };
}

function fakeSynth(opts: { voices?: any[]; script?: Array<'end' | 'error' | 'hold'> } = {}) {
  const spoken: any[] = [];
  const listeners: Record<string, Array<() => void>> = {};
  const script = opts.script ?? [];
  const s: any = {
    spoken, cancels: 0,
    getVoices: () => opts.voices ?? [],
    speak(u: any) { spoken.push(u); const m = script.shift() ?? 'end'; if (m === 'end') u.onend?.(); else if (m === 'error') u.onerror?.({}); },
    cancel() { s.cancels++; },
    addEventListener(n: string, f: () => void, opt?: { once?: boolean }) {
      const g = opt?.once ? () => { s.removeEventListener(n, g); f(); } : f;
      (g as any).orig = f;
      (listeners[n] ||= []).push(g);
    },
    removeEventListener(n: string, f: () => void) { listeners[n] = (listeners[n] || []).filter((x: any) => x !== f && x.orig !== f); },
    listenerCount: (n: string) => (listeners[n] || []).length,
    fire(n: string) { [...(listeners[n] || [])].forEach((f) => f()); },
  };
  return s;
}

describe('block-barn voice', () => {
  it('exports an empty CLIPS set', () => {
    expect(CLIPS instanceof Set).toBe(true);
    expect(CLIPS.size).toBe(0);
  });
  it('recording beats clip and synth', async () => {
    const synth = fakeSynth();
    const { v, log } = setup({ clips: ['name-a'], rec: async () => 'blob:rec', synth });
    await v.say('name-a', 'ant');
    expect(log).toEqual(['play blob:rec']);
    expect(synth.spoken).toHaveLength(0);
  });
  it('clip beats synth', async () => {
    const synth = fakeSynth();
    const { v, log } = setup({ clips: ['name-b'], synth });
    await v.say('name-b', 'bear');
    expect(log).toEqual(['play ./audio/name-b.m4a']);
    expect(synth.spoken).toHaveLength(0);
  });
  it('falls to synth, slow and at a natural pitch (rate 0.7, pitch 1.0)', async () => {
    const synth = fakeSynth();
    const { v } = setup({ synth });
    await v.say('name-c', 'cow');
    expect(synth.spoken[0].text).toBe('cow');
    expect(synth.spoken[0].rate).toBe(0.7);
    expect(synth.spoken[0].pitch).toBe(1.0);
  });
  it('resolves silently with no synth and no clip', async () => {
    const { v, log } = setup();
    await expect(v.say('name-d', 'duck')).resolves.toBeUndefined();
    expect(log).toEqual([]);
  });
  it('a throwing or rejecting recordings lookup falls back', async () => {
    for (const rec of [async () => { throw new Error('x'); }, () => { throw new Error('y'); }]) {
      const synth = fakeSynth();
      const { v } = setup({ synth, rec: rec as any });
      await v.say('name-e', 'elephant');
      expect(synth.spoken).toHaveLength(1);
    }
  });
  it('a rejected play() falls back to speech', async () => {
    const synth = fakeSynth();
    const { v } = setup({ synth, rec: async () => 'blob:r', playFails: true });
    await v.say('name-f', 'frog');
    expect(synth.spoken[0].text).toBe('frog');
  });
  it('a new say stops the previous audio first, and the old promise resolves', async () => {
    let release!: (s: string) => void;
    const slow = new Promise<string>((r) => (release = r));
    let n = 0;
    const { v, log, audios } = setup({ rec: (k) => (n++ === 0 ? slow : Promise.resolve('blob:second')) });
    const first = v.say('name-g', 'goat');
    const second = v.say('name-h', 'horse');
    await second;
    release('blob:first');
    await expect(first).resolves.toBeUndefined();
    expect(log).toEqual(['play blob:second']);
    expect(audios).toHaveLength(1);
  });
  it('say while audio plays pauses it and cancels synth', async () => {
    const synth = fakeSynth();
    const { v, log } = setup({ synth, rec: async (k) => (k === 'name-a' ? 'blob:a' : null) });
    await v.say('name-a', 'ant');
    await v.say('name-b', 'bear');
    expect(log).toContain('pause blob:a');
    expect(synth.cancels).toBeGreaterThan(0);
  });
  it('stop() cancels synth and pauses audio', async () => {
    const synth = fakeSynth();
    const { v, log } = setup({ synth, rec: async () => 'blob:a' });
    await v.say('name-a', 'ant');
    const before = synth.cancels;
    v.stop();
    expect(log).toContain('pause blob:a');
    expect(synth.cancels).toBe(before + 1);
  });
  it('stop() resolves a pending say', async () => {
    const synth = fakeSynth({ script: ['hold'] });
    const { v } = setup({ synth });
    const p = v.say('name-a', 'ant');
    await new Promise((r) => setTimeout(r, 0));
    v.stop();
    await expect(p).resolves.toBeUndefined();
  });
  it('still calls speak with no voices', async () => {
    const synth = fakeSynth({ voices: [] });
    const { v } = setup({ synth });
    await v.say('name-i', 'iguana');
    expect(synth.spoken).toHaveLength(1);
  });
  it('retries once after voiceschanged when speech errors', async () => {
    const synth = fakeSynth({ script: ['error', 'end'] });
    const { v } = setup({ synth });
    const p = v.say('name-j', 'jellyfish');
    await new Promise((r) => setTimeout(r, 0));
    expect(synth.spoken).toHaveLength(1);
    synth.fire('voiceschanged');
    await p;
    expect(synth.spoken).toHaveLength(2);
  });
  it('retries immediately if voiceschanged already fired, and never more than once', async () => {
    const synth = fakeSynth({ script: ['error', 'error', 'end'] });
    const { v } = setup({ synth });
    synth.fire('voiceschanged');
    await v.say('name-k', 'kangaroo');
    expect(synth.spoken).toHaveLength(2);
  });
  it('voiceschanged then 1.5s timer: exactly one retry', async () => {
    vi.useFakeTimers();
    const synth = fakeSynth({ script: ['error', 'hold', 'end'] });
    const { v } = setup({ synth });
    const p = v.say('name-j', 'jellyfish');
    await vi.advanceTimersByTimeAsync(0);
    synth.fire('voiceschanged');
    await vi.advanceTimersByTimeAsync(2000);
    expect(synth.spoken).toHaveLength(2);
    v.stop();
    await p;
  });
  it('timer first then late voiceschanged: exactly one retry', async () => {
    vi.useFakeTimers();
    const synth = fakeSynth({ script: ['error', 'hold', 'end'] });
    const { v } = setup({ synth });
    const p = v.say('name-j', 'jellyfish');
    await vi.advanceTimersByTimeAsync(2000);
    synth.fire('voiceschanged');
    await vi.advanceTimersByTimeAsync(0);
    expect(synth.spoken).toHaveLength(2);
    v.stop();
    await p;
  });
  it('stop() during the retry wait: no retry, no lingering timer', async () => {
    vi.useFakeTimers();
    const synth = fakeSynth({ script: ['error', 'end'] });
    const { v } = setup({ synth });
    const p = v.say('name-j', 'jellyfish');
    await vi.advanceTimersByTimeAsync(0);
    v.stop();
    await p;
    expect(vi.getTimerCount()).toBe(0);
    expect(synth.listenerCount('voiceschanged')).toBe(1);
    synth.fire('voiceschanged');
    await vi.advanceTimersByTimeAsync(2000);
    expect(synth.spoken).toHaveLength(1);
  });
  it('stop() during a pending recordings lookup never plays', async () => {
    let release!: (s: string) => void;
    const { v, log } = setup({ rec: () => new Promise<string>((r) => (release = r)) });
    const p = v.say('name-a', 'ant');
    v.stop();
    release('blob:late');
    await expect(p).resolves.toBeUndefined();
    expect(log).toEqual([]);
  });
  it('a new say while speech is in flight cancels it and resolves the old promise', async () => {
    const synth = fakeSynth({ script: ['hold', 'end'] });
    const { v } = setup({ synth });
    const first = v.say('name-a', 'ant');
    await new Promise((r) => setTimeout(r, 0));
    const before = synth.cancels;
    await v.say('name-b', 'bear');
    expect(synth.cancels).toBeGreaterThan(before);
    await expect(first).resolves.toBeUndefined();
  });
});


// ---------- Task 10: slower, warmer device speech ----------
const vo = (name: string, lang = 'en-US', localService = true) => ({ name, lang, localService, voiceURI: name, default: false });

describe('block-barn voice: the best installed English voice', () => {
  const zoe = vo('Zoe (Premium)'), ava = vo('Ava (Enhanced)'), gUS = vo('Google US English', 'en-US', false);
  const gUK = vo('Google UK English Female', 'en-GB', false), sam = vo('Samantha'), albert = vo('Albert');
  const amelie = vo('Amélie (Premium)', 'fr-CA'), thomas = vo('Thomas', 'fr-FR'), anna = vo('Anna (Enhanced)', 'de-DE');

  it('SPEECH is slow, natural and leaves room between parts', () => {
    expect(SPEECH).toEqual({ rate: 0.7, pitch: 1.0, gapMs: 700 });
  });
  it('prefers Premium, then Enhanced, then another local en-US/en-GB voice', () => {
    const all = [albert, sam, gUK, gUS, ava, amelie, zoe];
    expect(pickVoice(all as any)).toBe(zoe);
    expect(pickVoice(all.filter((x) => x !== zoe) as any)).toBe(ava);
    expect(pickVoice([albert, sam, gUK, gUS] as any)).toBe(sam);
    expect(pickVoice([sam] as any)).toBe(sam);
    expect(pickVoice([vo('Daniel', 'en-GB')] as any)?.name).toBe('Daniel');
    expect(pickVoice([vo('Karen', 'en_US')] as any)?.name).toBe('Karen'); // Android spells it with an underscore
  });
  it('never picks an online voice (it would send the words to a server), even when it is the only English one', () => {
    expect(pickVoice([gUS] as any)).toBeNull();
    expect(pickVoice([gUK, amelie] as any)).toBeNull();
    expect(pickVoice([vo('Some Voice (Premium)', 'en-US', false), vo('Other (Enhanced)', 'en-GB', false)] as any)).toBeNull();
    expect(pickVoice([vo('Some Voice (Premium)', 'en-US', false), sam] as any)).toBe(sam);
  });
  it('passes over the macOS novelty voices for a plain one', () => {
    expect(pickVoice([albert, vo('Bad News'), vo('Zarvox'), sam] as any)).toBe(sam);
  });
  it('never picks a non-English voice, whatever its quality', () => {
    expect(pickVoice([amelie, thomas, anna] as any)).toBeNull();
    expect(pickVoice([amelie, sam] as any)).toBe(sam);
    expect(pickVoice([anna, ava] as any)).toBe(ava);
  });
  it('returns null (the browser default) with no voices, or only remote English ones it does not know', () => {
    expect(pickVoice([])).toBeNull();
    expect(pickVoice([vo('Some Cloud Voice', 'en-US', false)] as any)).toBeNull();
  });
  it('utterances use the picked voice, and the choice is made again after voiceschanged', async () => {
    const list: any[] = [sam];
    const synth = fakeSynth();
    synth.getVoices = () => list;
    const { v } = setup({ synth });
    await v.say('name-a', 'ant');
    expect(synth.spoken[0].voice).toBe(sam);
    list.push(ava);
    synth.fire('voiceschanged');
    await v.say('name-b', 'bear');
    expect(synth.spoken[1].voice).toBe(ava);
    expect(synth.spoken[1].lang).toBe('en-US');
  });
  it('with no voice picked, it leaves the browser default (no voice set)', async () => {
    const synth = fakeSynth({ voices: [] });
    const { v } = setup({ synth });
    await v.say('name-a', 'ant');
    expect(synth.spoken[0].voice ?? null).toBeNull();
  });
});

/** Speech that takes 300 ms per utterance on fake timers, logging when each starts and ends. */
function timedSynth() {
  const s = fakeSynth();
  const times: { text: string; start: number; end: number | null }[] = [];
  s.times = times;
  s.speak = (u: any) => {
    s.spoken.push(u);
    const t = { text: u.text, start: Date.now(), end: null as number | null };
    times.push(t);
    const timer = setTimeout(() => { t.end = Date.now(); u.onend?.(); }, 300);
    u.__timer = timer;
  };
  const cancel = s.cancel;
  s.cancel = () => { cancel(); for (const u of s.spoken) clearTimeout(u.__timer); };
  return s;
}
const gaps = (times: { start: number; end: number | null }[]) => times.slice(1).map((t, i) => t.start - (times[i]!.end ?? Infinity));
const C_LINES: Array<[string, string]> = [['letter-c', 'C.'], ['name-c', 'cow'], ['noise-c', 'moo']];

describe('block-barn voice: a tap\'s line in parts, with gaps', () => {
  it('speaks the capital letter once, then the name and the noise, as separate utterances at least 700 ms apart', async () => {
    vi.useFakeTimers();
    const synth = timedSynth();
    const { v } = setup({ synth });
    const keys: string[] = [];
    const p = v.sayAll(C_LINES, (k: string) => keys.push(k));
    await vi.advanceTimersByTimeAsync(10000);
    await p;
    expect(synth.times.map((t: any) => t.text)).toEqual(['C.', 'cow', 'moo']);
    for (const g of gaps(synth.times)) expect(g).toBeGreaterThanOrEqual(SPEECH.gapMs);
    expect(keys).toEqual(['letter-c', 'name-c', 'noise-c']);
    for (const u of synth.spoken) { expect(u.rate).toBe(0.7); expect(u.pitch).toBe(1.0); }
  });
  it('a new tap during a gap cancels the rest: nothing from the old tap speaks later', async () => {
    vi.useFakeTimers();
    const synth = timedSynth();
    const { v } = setup({ synth });
    const first = v.sayAll(C_LINES);
    await vi.advanceTimersByTimeAsync(300 + 200); // "C." has ended; we are in the gap before "cow"
    expect(synth.times.map((t: any) => t.text)).toEqual(['C.']);
    const second = v.sayAll([['letter-d', 'D.'], ['name-d', 'duck']]);
    await vi.advanceTimersByTimeAsync(10000);
    await first; await second;
    expect(synth.times.map((t: any) => t.text)).toEqual(['C.', 'D.', 'duck']);
  });
  it('a plain say() during a gap also cancels the rest', async () => {
    vi.useFakeTimers();
    const synth = timedSynth();
    const { v } = setup({ synth });
    const first = v.sayAll(C_LINES);
    await vi.advanceTimersByTimeAsync(300 + 700 + 300 + 100); // in the gap after "cow"
    expect(synth.times.map((t: any) => t.text)).toEqual(['C.', 'cow']);
    const second = v.say('where-d', "Where's the duck?");
    await vi.advanceTimersByTimeAsync(10000);
    await first; await second;
    expect(synth.times.map((t: any) => t.text)).toEqual(['C.', 'cow', "Where's the duck?"]);
  });
  it('stop() during a gap: nothing more, the promise resolves, no timer left behind', async () => {
    vi.useFakeTimers();
    const synth = timedSynth();
    const { v } = setup({ synth });
    const p = v.sayAll(C_LINES);
    await vi.advanceTimersByTimeAsync(500);
    v.stop();
    await vi.advanceTimersByTimeAsync(0);
    await expect(p).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10000);
    expect(synth.times.map((t: any) => t.text)).toEqual(['C.']);
  });
  it('a letter recording replaces the spoken letter; then the same gap before the name', async () => {
    vi.useFakeTimers();
    const synth = timedSynth();
    const log: { what: string; at: number }[] = [];
    const audio = (url: string) => ({
      play: () => { log.push({ what: 'play ' + url, at: Date.now() }); return new Promise<void>((r) => setTimeout(() => { log.push({ what: 'end ' + url, at: Date.now() }); r(); }, 500)); },
      pause() {},
    });
    const utter = (t: string) => ({ text: t, rate: 0, pitch: 0, onend: null as any, onerror: null as any });
    const v = createVoice({ audio, synth, recordings: async (k) => (k === 'letter-c' ? 'blob:mine' : null), base: './', utter });
    const p = v.sayAll(C_LINES);
    await vi.advanceTimersByTimeAsync(10000);
    await p;
    expect(log.map((x) => x.what)).toEqual(['play blob:mine', 'end blob:mine']);
    expect(synth.times.map((t: any) => t.text)).toEqual(['cow', 'moo']); // no "C." from the device
    expect(synth.times[0].start - log[1]!.at).toBeGreaterThanOrEqual(SPEECH.gapMs);
  });
  it('bundled clips play as recorded, in the same order with the same gaps', async () => {
    vi.useFakeTimers();
    const ends: number[] = [];
    const plays: { url: string; at: number }[] = [];
    const audio = (url: string) => ({
      play: () => { plays.push({ url, at: Date.now() }); return new Promise<void>((r) => setTimeout(() => { ends.push(Date.now()); r(); }, 400)); },
      pause() {},
    });
    (CLIPS as Set<string>).add('letter-c'); (CLIPS as Set<string>).add('name-c'); (CLIPS as Set<string>).add('noise-c');
    const utter = (t: string) => ({ text: t, rate: 0, pitch: 0, onend: null as any, onerror: null as any });
    const synth = timedSynth();
    const v = createVoice({ audio, synth, recordings: async () => null, base: './', utter });
    const p = v.sayAll(C_LINES);
    await vi.advanceTimersByTimeAsync(10000);
    await p;
    expect(plays.map((x) => x.url)).toEqual(['./audio/letter-c.m4a', './audio/name-c.m4a', './audio/noise-c.m4a']);
    for (let i = 1; i < plays.length; i++) expect(plays[i]!.at - ends[i - 1]!).toBeGreaterThanOrEqual(SPEECH.gapMs);
    expect(synth.spoken).toHaveLength(0);
  });
});
