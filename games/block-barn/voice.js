import { CLIPS } from './audio/clips.js';

// Device speech for a two-year-old: slow, at a natural pitch, with a real pause between the parts of a line.
export const SPEECH = { rate: 0.7, pitch: 1.0, gapMs: 700 };

// macOS ships joke and old formant voices (Albert, Zarvox, Bad News...) as local en-US voices; never pick those.
const NOVELTY = new Set(['albert', 'bad news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos', 'deranged', 'good news', 'hysterical',
  'jester', 'organ', 'pipe organ', 'superstar', 'trinoids', 'whisper', 'wobble', 'zarvox', 'fred', 'junior', 'kathy', 'ralph', 'princess',
  'eddy', 'flo', 'grandma', 'grandpa', 'reed', 'rocko', 'sandy', 'shelley']);
const GOOGLE = ['google us english', 'google uk english female'];

const langOf = (v) => String(v.lang || '').toLowerCase().replace('_', '-');
const baseName = (v) => String(v.name || '').toLowerCase().replace(/\s*\(.*$/, '').trim();
function rank(v) {
  const name = String(v.name || '');
  if (/premium/i.test(name)) return 0;
  if (/enhanced/i.test(name)) return 1;
  const g = GOOGLE.indexOf(name.toLowerCase());
  if (g >= 0) return 2 + g;
  const lang = langOf(v);
  if (v.localService && (lang === 'en-us' || lang === 'en-gb') && !NOVELTY.has(baseName(v))) return 4;
  return -1;
}

/** The warmest English voice installed: Premium, then Enhanced, then Chrome's Google voices, then a local en-US/en-GB one; null = browser default. */
export function pickVoice(voices) {
  let best = null, bestRank = Infinity, bestLang = Infinity;
  for (const v of voices || []) {
    if (!v || !langOf(v).startsWith('en')) continue;
    const r = rank(v);
    if (r < 0) continue;
    const lang = langOf(v);
    const l = lang === 'en-us' ? 0 : lang === 'en-gb' ? 1 : 2;
    if (r < bestRank || (r === bestRank && l < bestLang)) { best = v; bestRank = r; bestLang = l; }
  }
  return best;
}

// Voice order: parent recording > bundled clip > device speech > silence.
// Pure: every browser dependency is injected.
export function createVoice(o) {
  const { audio, synth, recordings, base } = o;
  const utter = o.utter || ((t) => new SpeechSynthesisUtterance(t));
  let current = null; // { audio?, finish }
  let seq = 0; // bumped by every say/sayAll/stop, so an older line stops between its parts
  let gap = null; // { timer, done } while a line waits between parts
  let voicesChanged = false;
  let chosen = null;
  const choose = () => { try { chosen = pickVoice(synth.getVoices()); } catch (e) { chosen = null; } };
  if (synth) choose();
  if (synth && typeof synth.addEventListener === 'function') {
    synth.addEventListener('voiceschanged', () => { voicesChanged = true; choose(); });
  }

  function halt() {
    seq++;
    const g = gap;
    gap = null;
    if (g) { clearTimeout(g.timer); g.done(); }
    const c = current;
    current = null;
    if (c) {
      if (c.cancelWait) c.cancelWait();
      try { c.audio && c.audio.pause(); } catch (e) { /* ignore */ }
      c.finish();
    }
    try { synth && synth.cancel(); } catch (e) { /* ignore */ }
  }

  function pause(me) {
    return new Promise((done) => {
      if (seq !== me) return done();
      const g = { timer: setTimeout(() => { if (gap === g) gap = null; done(); }, SPEECH.gapMs), done };
      gap = g;
    });
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
          u.rate = SPEECH.rate;
          u.pitch = SPEECH.pitch;
          if (!chosen) choose();
          if (chosen) { u.voice = chosen; u.lang = chosen.lang; }
          u.onend = () => resolve();
          u.onerror = () => {
            if (retried || current !== mine) return resolve();
            retried = true;
            if (voicesChanged || !synth.addEventListener) return attempt();
            let done = false;
            let timer = null;
            const cleanup = () => {
              done = true;
              clearTimeout(timer);
              if (synth.removeEventListener) synth.removeEventListener('voiceschanged', go);
            };
            const go = () => {
              if (done) return;
              cleanup();
              mine.cancelWait = null;
              if (current === mine) attempt();
            };
            mine.cancelWait = cleanup;
            synth.addEventListener('voiceschanged', go, { once: true });
            timer = setTimeout(go, 1500);
          };
          synth.speak(u);
        } catch (e) { resolve(); }
      };
      attempt();
    });
  }

  // One part of a line: its recording or clip if there is one (it stands for all of `texts`), else each text
  // spoken in turn with a gap between.
  async function one(key, texts, me) {
    const mine = { audio: null, finish() {} };
    current = mine;
    const rec = await lookup(key);
    if (current !== mine || seq !== me) return;
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
    for (let i = 0; i < texts.length; i++) {
      if (i > 0) {
        await pause(me);
        if (seq !== me) return;
        current = mine;
      }
      await speak(texts[i], mine);
      if (current !== mine || seq !== me) return;
    }
    if (current === mine) current = null;
  }

  const parts = (text) => (Array.isArray(text) ? text : [text]);

  /** Says one line; `text` may be several parts (e.g. ['C.', 'c.']) spoken with gaps; a recording or clip replaces them all. */
  async function say(key, text) {
    halt();
    await one(key, parts(text), seq);
  }

  /** Says lines in order with a gap between each; any later say, sayAll or stop cancels the rest. */
  async function sayAll(lines, onLine) {
    halt();
    const me = seq;
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) await pause(me);
      if (seq !== me) return;
      const [key, text] = lines[i];
      if (onLine) onLine(key);
      await one(key, parts(text), me);
      if (seq !== me) return;
    }
  }

  return { say, sayAll, stop: halt };
}
