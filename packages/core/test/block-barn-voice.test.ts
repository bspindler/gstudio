import { describe, expect, it } from 'vitest';

import { createVoice } from '../../../games/block-barn/voice.js';
import { CLIPS } from '../../../games/block-barn/audio/clips.js';

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
    addEventListener(n: string, f: () => void) { (listeners[n] ||= []).push(f); },
    fire(n: string) { (listeners[n] || []).forEach((f) => f()); },
  };
  return s;
}

describe('block-barn voice', () => {
  it('exports an empty CLIPS set', () => {
    expect(CLIPS instanceof Set).toBe(true);
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
  it('falls to synth with calm rate and pitch', async () => {
    const synth = fakeSynth();
    const { v } = setup({ synth });
    await v.say('name-c', 'cow');
    expect(synth.spoken[0].text).toBe('cow');
    expect(synth.spoken[0].rate).toBeCloseTo(0.9);
    expect(synth.spoken[0].pitch).toBeCloseTo(1.1);
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
});
