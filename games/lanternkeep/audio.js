// Lanternkeep sound: small synthesized tones, no files. Quiet by design, so it never grates
// over a long session. Each kind of sound is rate-limited so a big wave doesn't turn to noise.
export function createAudio() {
  let ctx = null;
  let master = null;
  let on = true;
  const last = new Map();

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    return ctx;
  }

  function tone(freq, dur, { type = 'sine', gain = 0.2, slide = 0, delay = 0 } = {}) {
    if (!on || !ensure()) return;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function limited(name, ms) {
    const now = performance.now();
    if (now - (last.get(name) ?? 0) < ms) return false;
    last.set(name, now);
    return true;
  }

  const PENTA = [523, 587, 659, 784, 880, 1047];

  return {
    unlock() { if (ensure() && ctx.state === 'suspended') ctx.resume(); },
    setOn(v) { on = v; },
    get on() { return on; },
    events(evs) {
      for (const ev of evs) {
        if (ev.e === 'bolt' && limited('bolt', 70)) tone(880 + Math.random() * 120, 0.05, { type: 'triangle', gain: 0.05 });
        else if (ev.e === 'burst' && limited('burst', 90)) tone(140, 0.22, { type: 'sine', gain: 0.18, slide: 0.5 });
        else if (ev.e === 'beam' && limited('beam', 120)) tone(1320, 0.25, { type: 'sine', gain: 0.07, slide: 0.6 });
        else if (ev.e === 'pulse' && limited('pulse', 200)) tone(1760, 0.18, { type: 'sine', gain: 0.03, slide: 1.3 });
        else if (ev.e === 'chime' && limited('chime', 400)) { tone(659, 0.9, { type: 'sine', gain: 0.035 }); tone(988, 1.1, { type: 'sine', gain: 0.02, delay: 0.04 }); }
        else if (ev.e === 'thornhit' && limited('thornhit', 80)) tone(520, 0.08, { type: 'triangle', gain: 0.06, slide: 0.5 });
        else if (ev.e === 'kill' && limited('kill', 45)) tone(PENTA[Math.floor(Math.random() * PENTA.length)], 0.12, { type: 'triangle', gain: ev.type === 'toad' ? 0.2 : 0.07 });
        else if (ev.e === 'leak') tone(110, 0.4, { type: 'sawtooth', gain: 0.08, slide: 0.6 });
        else if (ev.e === 'wave') { tone(392, 0.25, { gain: 0.1 }); tone(523, 0.35, { gain: 0.1, delay: 0.12 }); }
        else if (ev.e === 'flare') { tone(196, 0.9, { type: 'sawtooth', gain: 0.06, slide: 3 }); [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.7, { type: 'triangle', gain: 0.09, delay: 0.05 + i * 0.04 })); }
      }
    },
    place() { tone(330, 0.1, { type: 'triangle', gain: 0.12, slide: 1.5 }); },
    upgrade() { tone(523, 0.1, { type: 'triangle', gain: 0.1 }); tone(784, 0.16, { type: 'triangle', gain: 0.1, delay: 0.08 }); },
    sell() { tone(440, 0.14, { type: 'triangle', gain: 0.09, slide: 0.6 }); },
    reveal() { [659, 880, 1175].forEach((f, i) => tone(f, 0.5, { type: 'sine', gain: 0.08, delay: i * 0.1 })); },
    charged() { tone(784, 0.2, { type: 'sine', gain: 0.07 }); tone(1175, 0.4, { type: 'sine', gain: 0.07, delay: 0.1 }); },
    branch() { [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, { type: 'triangle', gain: 0.09, delay: i * 0.06 })); },
    callout() { tone(587, 0.15, { type: 'triangle', gain: 0.06 }); tone(880, 0.25, { type: 'triangle', gain: 0.06, delay: 0.08 }); },
    perk() { [523, 784, 1047, 1568].forEach((f, i) => tone(f, 0.5, { type: 'sine', gain: 0.08, delay: i * 0.08 })); },
    nope() { tone(180, 0.12, { type: 'square', gain: 0.04 }); },
    won(stars) { [523, 659, 784, 1047].slice(0, 1 + stars).forEach((f, i) => tone(f, 0.4, { type: 'triangle', gain: 0.12, delay: i * 0.13 })); },
    lost() { [392, 330, 262].forEach((f, i) => tone(f, 0.5, { type: 'sine', gain: 0.12, delay: i * 0.2 })); },
  };
}
