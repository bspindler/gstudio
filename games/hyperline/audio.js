// Hyperline's sound (quality plan, phase 4). Sound effects are recorded and designed samples (Kenney, CC0), embedded
// in audio/sfx.js and decoded on the first tap: nothing is fetched. Music is a synthwave sequencer built from Web
// Audio synthesis (kick, snare, hats, sidechained bass, arpeggio, pads), a different progression and sound per theme,
// with layers building through each theme's sectors. Its clock is course time (world.js tauAt), set with setClock, so
// its beats stay locked to the track: the beat sectors put their take-offs on them, and a pause, a revive or a
// practice start can't knock it out of step. A limiter sits on the master; the music ducks on a crash and closes its
// filter in slow motion. On iPhone the audio session is 'playback' so the ring/silent switch doesn't mute it.

import SFX from './audio/sfx.js';
import { BEAT } from './lib/world.js';

const SIX = BEAT / 4; // a sixteenth note, in seconds of course time
const midi = (n) => 440 * 2 ** ((n - 69) / 12);
/** Per theme: chords (root note, minor or major), one per bar, and the sound. */
export const MUSIC_THEMES = [
  { prog: [[57, 'm'], [53, 'M'], [60, 'M'], [55, 'M']], arp: [0, 1, 2, 1, 0, 2, 1, 2], wave: 'square', cutoff: 2200 }, // Neon District: Am F C G
  { prog: [[50, 'm'], [58, 'M'], [55, 'm'], [57, 'M']], arp: [0, 2, 1, 2, 0, 1, 2, 1], wave: 'sawtooth', cutoff: 1800 }, // Flip City: Dm Bb Gm A
  { prog: [[52, 'm'], [48, 'M'], [50, 'M'], [47, 'M']], arp: [0, 1, 2, 3, 2, 1, 2, 3], wave: 'sawtooth', cutoff: 2600 }, // Hypercore: Em C D B
];
const THEME_UNTIL = [7, 14, Infinity]; // sectors per theme, as in render3d.js THEMES
const triad = ([root, q]) => [root, root + (q === 'm' ? 3 : 4), root + 7];

export function createAudio() {
  let ctx = null, master = null, sfxBus = null, musicBus = null, musicFilter = null, musicDuck = null, pump = null;
  let reverb = null, delaySend = null, noise = null;
  const buffers = {};
  let sound = true, music = true;
  let timer = 0, clock = null, sector = 0, stepDone = -1, rate = 1, lastTau = null, lastWall = 0;
  let windSrc = null, windGain = null, windFilter = null;

  function ensure() {
    if (!sound) return null;
    if (!ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return null;
      // iPhone: Web Audio is muted by the ring/silent switch unless the page's audio session is 'playback', like a music app.
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* older browsers: follows the ringer */ }
      try { ctx = new AC(); } catch { return null; }
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -10; limiter.knee.value = 6; limiter.ratio.value = 12; limiter.attack.value = 0.003; limiter.release.value = 0.15;
      master = ctx.createGain(); master.gain.value = 0.9; master.connect(limiter); limiter.connect(ctx.destination);
      sfxBus = ctx.createGain(); sfxBus.gain.value = 0.85; sfxBus.connect(master);
      musicDuck = ctx.createGain(); musicDuck.connect(master);
      musicFilter = ctx.createBiquadFilter(); musicFilter.type = 'lowpass'; musicFilter.frequency.value = 18000; musicFilter.connect(musicDuck);
      musicBus = ctx.createGain(); musicBus.gain.value = 0.3; musicBus.connect(musicFilter);
      pump = ctx.createGain(); pump.connect(musicBus); // bass and pads, ducked by the kick (sidechain)
      noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      // a short plate for the snare, and a dotted-eighth delay for the arp
      reverb = ctx.createConvolver();
      const ir = ctx.createBuffer(2, ctx.sampleRate * 1.6, ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const ch = ir.getChannelData(c); for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length) ** 3; }
      reverb.buffer = ir;
      const rvGain = ctx.createGain(); rvGain.gain.value = 0.35; reverb.connect(rvGain); rvGain.connect(musicBus);
      const delay = ctx.createDelay(1), fb = ctx.createGain(), dl = ctx.createBiquadFilter();
      delay.delayTime.value = SIX * 3; fb.gain.value = 0.32; dl.type = 'lowpass'; dl.frequency.value = 2400;
      delaySend = ctx.createGain(); delaySend.connect(delay); delay.connect(dl); dl.connect(fb); fb.connect(delay); dl.connect(musicBus);
      decodeAll();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function decodeAll() {
    for (const [name, b64] of Object.entries(SFX)) {
      const bin = atob(b64), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      // the callback form works on older Safari as well as the promise form elsewhere
      try { ctx.decodeAudioData(u8.buffer, (buf) => { buffers[name] = buf; if (name === 'wind') startWind(); }, () => {}); } catch { /* keep the synth fallback */ }
    }
  }

  /** Plays a sample; false when it isn't decoded (the caller may fall back to synthesis). */
  function play(name, { vol = 1, rate: r = 1, at = 0 } = {}) {
    const c = ensure(); if (!c || !buffers[name]) return false;
    const s = c.createBufferSource(), g = c.createGain();
    s.buffer = buffers[name]; s.playbackRate.value = r; g.gain.value = vol;
    s.connect(g); g.connect(sfxBus); s.start(at || c.currentTime);
    return true;
  }

  function tone(freq, dur, { type = 'square', vol = 0.18, to = 0, at = 0, bus = null, attack = 0.004 } = {}) {
    const c = ensure(); if (!c) return;
    const t0 = (at || c.currentTime) + 0.001;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(bus || sfxBus);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function hiss(dur, { vol = 0.2, f0 = 800, f1 = 4000, q = 1.2, type = 'bandpass', at = 0, bus = null } = {}) {
    const c = ensure(); if (!c) return null;
    const t0 = (at || c.currentTime) + 0.001;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = noise; f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(bus || sfxBus);
    s.start(t0); s.stop(t0 + dur + 0.02);
    return g;
  }

  // ---------- the wind bed: a looped low engine rush that opens up with speed ----------
  function startWind() {
    if (windSrc || !buffers.wind || !ctx) return;
    windSrc = ctx.createBufferSource(); windSrc.buffer = buffers.wind; windSrc.loop = true;
    windFilter = ctx.createBiquadFilter(); windFilter.type = 'lowpass'; windFilter.frequency.value = 300;
    windGain = ctx.createGain(); windGain.gain.value = 0;
    windSrc.connect(windFilter); windFilter.connect(windGain); windGain.connect(sfxBus); windSrc.start();
  }

  // ---------- the synthwave sequencer, clocked by course time ----------
  function synth(type, f, det, at, len, { lp = 1300, q = 0.7, vol = 0.02, attack = 0.006, lpTo = 0, out = musicBus, send = null } = {}) {
    const o = ctx.createOscillator(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = type; o.frequency.value = f; o.detune.value = det;
    fl.type = 'lowpass'; fl.Q.value = q; fl.frequency.setValueAtTime(lp, at); if (lpTo) fl.frequency.exponentialRampToValueAtTime(lpTo, at + len * 0.9);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + attack); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(fl); fl.connect(g); g.connect(out); if (send) g.connect(send);
    o.start(at); o.stop(at + len + 0.05);
  }
  function voices(at, n, chord, th, lvl) {
    const s = n % 16, bar = Math.floor(n / 16), hyper = th === 2, T = MUSIC_THEMES[th];
    const notes = triad(chord);
    // kick on the beat, with the sidechain pump on bass and pads
    if (s % 4 === 0) {
      tone(150, 0.3, { type: 'sine', vol: 0.9, to: 45, at, bus: musicBus, attack: 0.002 });
      hiss(0.012, { vol: 0.18, f0: 5000, f1: 7000, type: 'highpass', at, bus: musicBus });
      pump.gain.cancelScheduledValues(at); pump.gain.setValueAtTime(0.3, at); pump.gain.linearRampToValueAtTime(1, at + 0.2);
    }
    // bass: eighth notes on the chord root, two detuned saws through a plucky low-pass
    if (s % 2 === 0) {
      const f = midi(chord[0] - 24 + (hyper && s % 8 === 6 ? 12 : 0));
      for (const det of [-8, 8]) synth('sawtooth', f, det, at, SIX * 1.8, { lp: 1100, lpTo: 260, q: 6, vol: 0.16, out: pump });
    }
    // pads: the chord held across the bar, slow in and out
    if (s === 0) for (const nt of notes) for (const det of [-10, 10]) synth('sawtooth', midi(nt), det, at, SIX * 16, { lp: 1300, vol: 0.022, attack: 0.35, out: pump });
    // hats: off-beat eighths, sixteenths later in a theme; open hats on the "and" of 2 and 4
    if (lvl >= 1 && s % 4 === 2) hiss(0.035, { vol: 0.11, f0: 8000, f1: 10000, type: 'highpass', at, bus: musicBus });
    if (lvl >= 4 && s % 2 === 1) hiss(0.02, { vol: 0.05, f0: 9000, f1: 11000, type: 'highpass', at, bus: musicBus });
    if (lvl >= 4 && (s === 6 || s === 14)) hiss(0.16, { vol: 0.07, f0: 7000, f1: 8000, type: 'highpass', at, bus: musicBus });
    // arpeggio: sixteenths through the chord, into the dotted-eighth delay
    if (lvl >= 2) {
      const step = T.arp[s % T.arp.length], nt = step === 3 ? notes[0] + 24 : notes[step] + 12;
      synth(T.wave, midi(nt), 0, at, SIX * 0.9, { lp: T.cutoff, vol: 0.045, attack: 0.004, send: delaySend });
    }
    // snare on 2 and 4, with a plate
    if (lvl >= 3 && (s === 4 || s === 12)) {
      const g = hiss(0.18, { vol: 0.32, f0: 1800, f1: 1400, q: 0.7, at, bus: musicBus });
      if (g) g.connect(reverb);
      tone(190, 0.09, { type: 'triangle', vol: 0.12, at, bus: musicBus });
    }
    // Hypercore stabs: the chord's top note, short and bright
    if (hyper && lvl >= 4 && (s === 3 || s === 11) && bar % 2 === 1) synth('sawtooth', midi(notes[2] + 24), 0, at, SIX * 1.5, { lp: 4000, vol: 0.05 });
  }

  function schedule() {
    if (!ctx || !music || !sound || !clock) return;
    const tau = clock();
    if (tau == null || !Number.isFinite(tau)) return;
    const wall = ctx.currentTime;
    // how fast course time runs against the audio clock (slower in slow motion)
    if (lastTau !== null && wall > lastWall) rate = Math.max(0.15, Math.min(1.6, rate * 0.8 + ((tau - lastTau) / (wall - lastWall)) * 0.2));
    lastTau = tau; lastWall = wall;
    if (tau / SIX - stepDone > 64) stepDone = Math.floor(tau / SIX); // a jump forward (practice start): no catch-up burst
    const th = THEME_UNTIL.findIndex((u) => sector < u), lvl = th === 2 ? 4 : Math.min(4, sector - (th > 0 ? THEME_UNTIL[th - 1] : 0));
    const prog = MUSIC_THEMES[th].prog;
    while ((stepDone + 1) * SIX < tau + 0.12 * rate) {
      const n = stepDone + 1, at = wall + Math.max(0, (n * SIX - tau) / rate) + 0.01;
      voices(at, n, prog[Math.floor(n / 16) % prog.length], th, lvl);
      stepDone = n;
    }
  }

  return {
    unlock() { ensure(); },
    setSound(on) { sound = on; if (!on) this.stopBeat(); if (ctx) (on ? ctx.resume() : ctx.suspend()).catch(() => {}); },
    setMusic(on) { music = on; if (!on) this.stopBeat(); },
    suspend() { this.stopBeat(); if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); },
    resume() { if (ctx && sound) ctx.resume().catch(() => {}); },
    /** The music's clock: a function returning course time (seconds), or null to stop following the track. */
    setClock(fn) { clock = fn; },
    startBeat(s) {
      sector = s || 0;
      if (!music || !sound || timer || !ensure()) return;
      musicDuck.gain.cancelScheduledValues(ctx.currentTime); musicDuck.gain.setValueAtTime(1, ctx.currentTime);
      const tau = clock ? clock() : 0;
      stepDone = Math.floor((tau || 0) / SIX); lastTau = null; rate = 1;
      timer = setInterval(schedule, 25);
    },
    setSector(s) { sector = s; },
    stopBeat() { if (timer) { clearInterval(timer); timer = 0; } },
    /** The wind bed: louder and brighter with speed while running; silent otherwise. */
    wind(speed, running) {
      if (!ctx || !windGain) return;
      const k = Math.max(0, Math.min(1, (speed - 9) / 9)), t = ctx.currentTime;
      windGain.gain.setTargetAtTime(running && sound ? 0.05 + 0.17 * k : 0, t, 0.15);
      windFilter.frequency.setTargetAtTime(300 + 2400 * k, t, 0.2);
    },
    jump() { if (!play('jump', { vol: 0.55, rate: 0.97 + Math.random() * 0.06 })) tone(420, 0.09, { to: 880, vol: 0.09 }); },
    pad() { if (!play('pad', { vol: 0.8 })) tone(220, 0.35, { type: 'triangle', to: 1400, vol: 0.2 }); },
    chip(streak) {
      const r = 2 ** (Math.min(24, streak) / 24); // up an octave over a 24-chip streak
      if (!play('chip', { vol: 0.5, rate: r })) tone(988 * r, 0.12, { type: 'sine', vol: 0.16 });
    },
    near() { if (!play('near', { vol: 0.55 })) hiss(0.28, { vol: 0.22, f0: 600, f1: 5000, q: 2.5 }); },
    /** Gravity flip: rising into the ceiling, falling back out. */
    flip(into = true) { if (!play(into ? 'flipIn' : 'flipOut', { vol: 0.6 })) tone(300, 0.25, { type: 'sine', to: into ? 900 : 150, vol: 0.14 }); },
    death() {
      const a = play('crash', { vol: 0.9 }), b = play('crashLow', { vol: 1 });
      if (!a && !b) { hiss(0.5, { vol: 0.45, f0: 3000, f1: 80, type: 'lowpass', q: 0.8 }); tone(180, 0.45, { type: 'sawtooth', to: 30, vol: 0.25 }); }
      if (ctx) { const t = ctx.currentTime; musicDuck.gain.cancelScheduledValues(t); musicDuck.gain.setTargetAtTime(0.12, t, 0.04); }
    },
    sector() { if (!play('sector', { vol: 0.7 })) { const c = ensure(); if (c) [0, 4, 7, 12].forEach((n, i) => tone(523 * 2 ** (n / 12), 0.35, { type: 'triangle', vol: 0.1, at: c.currentTime + i * 0.07 })); } },
    mission() { if (!play('mission', { vol: 0.8 })) tone(659, 0.22, { type: 'square', vol: 0.06 }); },
    streak() { play('streak', { vol: 0.6 }); },
    gate() { play('gate', { vol: 0.5 }); },
    revive() { play('revive', { vol: 0.8 }); },
    crate() { play('crate', { vol: 0.8 }); },
    /** Slow motion: a low swoop, and the music's filter closes then opens again. */
    slowmo() {
      play('slowmo', { vol: 0.6 });
      if (ctx) { const t = ctx.currentTime, f = musicFilter.frequency; f.cancelScheduledValues(t); f.setValueAtTime(500, t); f.exponentialRampToValueAtTime(18000, t + 0.7); }
    },
    /** Landing thud: freq from landPitch (lower for a longer fall) sets the sample's pitch, with a sine underneath. */
    land(freq) {
      play('land', { vol: 0.7, rate: Math.max(0.5, Math.min(1.1, freq / 140)) });
      tone(freq, 0.12, { type: 'sine', to: freq * 0.55, vol: 0.16 });
    },
    /** For tests: what is decoded and where the sequencer is. Reads only. */
    debug() { return { state: ctx ? ctx.state : 'none', decoded: Object.keys(buffers).length, total: Object.keys(SFX).length, running: !!timer, step: stepDone, rate, wind: !!windSrc }; },
    click() { if (!play('click', { vol: 0.7 })) tone(1800, 0.03, { type: 'square', vol: 0.04 }); },
    back() { play('back', { vol: 0.6 }); },
    toggle() { play('toggle', { vol: 0.6 }); },
    error() { play('error', { vol: 0.6 }); },
  };
}
