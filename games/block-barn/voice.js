import { CLIPS } from './audio/clips.js';

// Voice order: parent recording > bundled clip > device speech > silence.
// Pure: every browser dependency is injected.
export function createVoice(o) {
  const { audio, synth, recordings, base } = o;
  const utter = o.utter || ((t) => new SpeechSynthesisUtterance(t));
  let current = null; // { audio?, finish }
  let voicesChanged = false;
  if (synth && typeof synth.addEventListener === 'function') {
    synth.addEventListener('voiceschanged', () => { voicesChanged = true; });
  }

  function halt() {
    const c = current;
    current = null;
    if (c) {
      try { c.audio && c.audio.pause(); } catch (e) { /* ignore */ }
      c.finish();
    }
    try { synth && synth.cancel(); } catch (e) { /* ignore */ }
  }

  async function lookup(key) {
    try { return (await recordings(key)) || null; } catch (e) { return null; }
  }

  function speak(text, mine) {
    return new Promise((resolve) => {
      mine.finish = resolve;
      let retried = false;
      const attempt = () => {
        if (current !== mine) return resolve();
        let u;
        try {
          u = utter(text);
          u.rate = 0.9;
          u.pitch = 1.1;
          u.onend = () => resolve();
          u.onerror = () => {
            if (retried || current !== mine) return resolve();
            retried = true;
            if (voicesChanged || !synth.addEventListener) return attempt();
            const go = () => { if (current === mine) attempt(); };
            synth.addEventListener('voiceschanged', go, { once: true });
            setTimeout(go, 1500);
          };
          synth.speak(u);
        } catch (e) { resolve(); }
      };
      attempt();
    });
  }

  async function say(key, text) {
    halt();
    const mine = { audio: null, finish() {} };
    current = mine;
    const rec = await lookup(key);
    if (current !== mine) return;
    const url = rec || (CLIPS.has(key) ? `${base}audio/${key}.m4a` : null);
    if (url) {
      try {
        const a = audio(url);
        mine.audio = a;
        await a.play();
        return; // stays current so a later say/stop can pause it
      } catch (e) {
        if (current !== mine) return;
        mine.audio = null;
      }
    }
    if (!synth) { if (current === mine) current = null; return; }
    await speak(text, mine);
    if (current === mine) current = null;
  }

  return { say, stop: halt };
}
