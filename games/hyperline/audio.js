// Every sound is synthesised with WebAudio: no audio files, no network. The context is created
// on the first tap (browsers require a gesture) and suspended when the tab is hidden.

export function createAudio() {
  let ctx = null, master = null, musicBus = null, noise = null;
  let sound = true, music = true;
  let beatTimer = 0, nextNote = 0, stepIdx = 0, root = 0;

  function ensure() {
    if (!sound) return null;
    if (!ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return null;
      // iPhone: Web Audio is muted by the ring/silent switch unless the page's audio session is 'playback', like a music app.
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* older browsers: follows the ringer */ }
      try { ctx = new AC(); } catch { return null; }
      master = ctx.createGain(); master.gain.value = 0.42; master.connect(ctx.destination);
      musicBus = ctx.createGain(); musicBus.gain.value = 0.32; musicBus.connect(master);
      noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
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
    o.connect(g); g.connect(bus || master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function hiss(dur, { vol = 0.2, f0 = 800, f1 = 4000, q = 1.2, type = 'bandpass', at = 0, bus = null } = {}) {
    const c = ensure(); if (!c) return;
    const t0 = (at || c.currentTime) + 0.001;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = noise; f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(bus || master);
    s.start(t0); s.stop(t0 + dur + 0.02);
  }

  // A small synthwave loop: four-on-the-floor kick, off-beat hats, an arpeggiated bass.
  const ROOTS = [55, 49, 61.74, 46.25, 58.27, 41.2, 65.41];
  const ARP = [0, 12, 7, 12, 3, 12, 7, 15];
  const BPM = 116, SIXTEENTH = 60 / BPM / 4;
  function schedule() {
    if (!ctx || !music || !sound) return;
    while (nextNote < ctx.currentTime + 0.12) {
      const s = stepIdx % 16, at = nextNote;
      if (s % 4 === 0) { tone(150, 0.16, { type: 'sine', vol: 0.5, to: 40, at, bus: musicBus }); }
      if (s % 4 === 2) hiss(0.05, { vol: 0.12, f0: 7000, f1: 9000, type: 'highpass', at, bus: musicBus });
      if (s % 2 === 0) {
        const n = ARP[(stepIdx >> 1) % ARP.length];
        tone(ROOTS[root % ROOTS.length] * 2 ** (n / 12), SIXTEENTH * 1.8, { type: 'sawtooth', vol: 0.07, at, bus: musicBus, attack: 0.01 });
      }
      nextNote += SIXTEENTH; stepIdx++;
    }
  }

  return {
    unlock() { ensure(); },
    setSound(on) { sound = on; if (!on) this.stopBeat(); if (ctx) (on ? ctx.resume() : ctx.suspend()).catch(() => {}); },
    setMusic(on) { music = on; if (!on) this.stopBeat(); },
    suspend() { this.stopBeat(); if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); },
    resume() { if (ctx && sound) ctx.resume().catch(() => {}); },
    startBeat(sector) {
      root = sector || 0;
      if (!music || !sound || beatTimer || !ensure()) return;
      nextNote = ctx.currentTime + 0.05; stepIdx = 0;
      beatTimer = setInterval(schedule, 25);
    },
    setSector(sector) { root = sector; },
    stopBeat() { if (beatTimer) { clearInterval(beatTimer); beatTimer = 0; } },
    jump() { tone(420, 0.09, { to: 880, vol: 0.09 }); },
    pad() { tone(220, 0.35, { type: 'triangle', to: 1400, vol: 0.2 }); hiss(0.3, { vol: 0.08, f0: 400, f1: 6000 }); },
    chip(streak) {
      const semis = Math.min(24, streak) ;
      tone(988 * 2 ** (semis / 24), 0.12, { type: 'sine', vol: 0.16 });
      tone(1976 * 2 ** (semis / 24), 0.08, { type: 'sine', vol: 0.05 });
    },
    near() {
      hiss(0.28, { vol: 0.22, f0: 600, f1: 5000, q: 2.5 }); tone(1320, 0.1, { type: 'triangle', vol: 0.06 });
      const c = ensure(); if (!c) return;
      // A bright two-note synth blip on top of the whoosh.
      tone(1568, 0.07, { type: 'square', vol: 0.05, at: c.currentTime });
      tone(2349, 0.11, { type: 'square', vol: 0.05, at: c.currentTime + 0.06 });
    },
    /** Landing thud: freq from landPitch (lower for a longer fall). */
    land(freq) { tone(freq, 0.12, { type: 'sine', to: freq * 0.55, vol: 0.22 }); hiss(0.06, { vol: 0.06, f0: 900, f1: 200, type: 'lowpass', q: 0.7 }); },
    flip() { tone(300, 0.25, { type: 'sine', to: 900, vol: 0.14 }); },
    death() {
      hiss(0.5, { vol: 0.45, f0: 3000, f1: 80, type: 'lowpass', q: 0.8 });
      tone(180, 0.45, { type: 'sawtooth', to: 30, vol: 0.25 });
    },
    sector() {
      const c = ensure(); if (!c) return;
      [0, 4, 7, 12].forEach((n, i) => tone(523 * 2 ** (n / 12), 0.35, { type: 'triangle', vol: 0.1, at: c.currentTime + i * 0.07 }));
    },
    mission() {
      const c = ensure(); if (!c) return;
      [0, 7, 12, 16, 19].forEach((n, i) => tone(659 * 2 ** (n / 12), 0.22, { type: 'square', vol: 0.06, at: c.currentTime + i * 0.06 }));
    },
    click() { tone(1800, 0.03, { type: 'square', vol: 0.04 }); },
  };
}
