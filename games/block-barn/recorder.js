// Grown-ups' own recordings: the microphone, the on-device database and the list in the grown-up corner.
// Everything to do with recording lives in this file (Hal may not touch it). Recordings stay in this browser on this
// device (IndexedDB database 'block-barn-voices'); nothing is uploaded, sent or logged.

const DB_NAME = 'block-barn-voices';
const BOX = 'voices'; // the object-database table that holds one Blob per key, e.g. 'name-c'
const LIMIT_MS = 6000; // a recording stops by itself after 6 s

// Mic errors that mean "not allowed / no microphone", as opposed to a passing hiccup.
const MIC_REFUSED = new Set(['NotAllowedError', 'SecurityError', 'NotFoundError', 'OverconstrainedError']);

export function createRecorder(env = globalThis) {
  let micRefused = false;
  let noStorage = false;
  let dbp = null;
  const urls = new Map(); // key -> object URL handed out by get()
  let rec = null; // the one recording in progress: { key, mr, stream, chunks, done, timer, stopped }
  const listeners = new Set();
  const notify = () => { for (const f of listeners) { try { f(); } catch (e) { /* a listener's problem */ } } };

  function available() {
    try {
      if (!env.isSecureContext) return { ok: false, why: 'insecure' };
      const md = env.navigator && env.navigator.mediaDevices;
      if (micRefused || !md || typeof md.getUserMedia !== 'function' || typeof env.MediaRecorder !== 'function') return { ok: false, why: 'no-mic' };
      if (noStorage || !env.indexedDB) return { ok: false, why: 'no-storage' };
      return { ok: true };
    } catch (e) {
      return { ok: false, why: 'no-storage' }; // reading indexedDB itself can throw (blocked site data)
    }
  }

  function broken(e) { if (!noStorage) { noStorage = true; notify(); } throw e; }

  function openDb() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        let req;
        try { req = env.indexedDB.open(DB_NAME, 1); } catch (e) { reject(e); return; }
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains(BOX)) d.createObjectStore(BOX);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('open failed'));
      }).catch(broken);
    }
    return dbp;
  }

  async function run(mode, fn) {
    const d = await openDb();
    return new Promise((resolve, reject) => {
      let req;
      try {
        const t = d.transaction(BOX, mode);
        req = fn(t.objectStore(BOX));
        t.oncomplete = () => resolve(req ? req.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('aborted'));
      } catch (e) { reject(e); }
    });
  }

  function forget(key) {
    const u = urls.get(key);
    if (u) { urls.delete(key); try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ } }
  }

  function release(r) {
    clearTimeout(r.timer);
    try { for (const t of r.stream.getTracks()) t.stop(); } catch (e) { /* ignore */ }
  }

  async function start(key) {
    if (rec) throw new Error('already recording');
    const a = available();
    if (!a.ok) throw new Error(a.why);
    const me = { key, stopped: false };
    rec = me;
    me.started = begin(me);
    return me.started;
  }

  async function begin(me) {
    let stream;
    try {
      stream = await env.navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      rec = null;
      if (!e || MIC_REFUSED.has(e.name)) { micRefused = true; notify(); }
      throw e;
    }
    let mr;
    try { mr = new env.MediaRecorder(stream); } catch (e) {
      rec = null;
      for (const t of stream.getTracks()) t.stop();
      micRefused = true; notify();
      throw e;
    }
    const chunks = [];
    me.stream = stream;
    me.mr = mr;
    me.done = new Promise((resolve) => {
      mr.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
      mr.onstop = () => {
        me.stopped = true;
        release(me);
        resolve(new Blob(chunks, { type: mr.mimeType || (chunks[0] && chunks[0].type) || '' }));
        notify();
      };
    });
    try { mr.start(); } catch (e) { rec = null; release(me); notify(); throw e; }
    me.timer = setTimeout(() => { if (mr.state !== 'inactive') mr.stop(); }, LIMIT_MS);
    notify();
  }

  async function finish() {
    const me = rec;
    if (!me) throw new Error('not recording');
    try { await me.started; } catch (e) { throw new Error('not recording'); } // stop pressed while the mic was starting
    if (me.mr.state !== 'inactive') me.mr.stop();
    const blob = await me.done;
    if (rec === me) rec = null;
    notify();
    return blob;
  }

  async function keep(key, blob) {
    await run('readwrite', (os) => os.put(blob, key));
    forget(key);
  }

  async function get(key) {
    if (urls.has(key)) return urls.get(key);
    if (!available().ok && (noStorage || !env.isSecureContext)) return null;
    let blob;
    try { blob = await run('readonly', (os) => os.get(key)); } catch (e) { return null; }
    if (!(blob instanceof Blob) || !blob.size) return null;
    if (urls.has(key)) return urls.get(key);
    const u = URL.createObjectURL(blob);
    urls.set(key, u);
    return u;
  }

  async function reset(key) {
    await run('readwrite', (os) => os.delete(key));
    forget(key);
  }

  async function keys() {
    try { return (await run('readonly', (os) => os.getAllKeys())).map(String); } catch (e) { return []; }
  }

  // Open the database straight away, so a browser that can't keep recordings is known before anyone taps record.
  const ready = (() => {
    try { if (!env.isSecureContext || !env.indexedDB) return Promise.resolve(); } catch (e) { noStorage = true; return Promise.resolve(); }
    return openDb().then(() => {}, () => {});
  })();

  return {
    available, start, finish, keep, get, reset, keys,
    /** Resolves once the database has been opened (or found unusable). */
    ready: () => ready,
    /** The key being recorded, and whether it has already stopped (6 s), or null. */
    recording: () => (rec && rec.mr ? { key: rec.key, stopped: rec.stopped } : null),
    /** Calls fn whenever available(), recording() or a stop changes; returns an unsubscribe function. */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

// ---------- the list in the grown-up corner ----------

const OFF = {
  insecure: 'Recording needs the secure (https) version of this page.',
  'no-mic': "The microphone isn't allowed for this page. To record, allow the microphone for this page in the browser's settings, then reload.",
  'no-storage': "This browser can't keep recordings here (private browsing can do this).",
};

const CSS = `
#voices .vpick { display: grid; grid-template-columns: repeat(auto-fill, minmax(52px, 1fr)); gap: 8px; margin: 8px 0 12px; }
#voices .vpick button { padding: 0; position: relative; }
#voices .vpick button.mine::after { content: ""; position: absolute; top: 5px; right: 5px; width: 8px; height: 8px; border-radius: 50%; background: #c0392b; }
#voices .vrow { border: 2px solid #e3d3b8; border-radius: 14px; background: #fff; padding: 10px 12px; margin: 8px 0; }
#voices .vrow .vhead { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 8px; }
#voices .vrow .vword { font-weight: 800; font-size: 17px; }
#voices .vrow .vstate { font-size: 14px; color: #6d5a48; }
#voices .vrow.live { border-color: #c0392b; }
#voices .vrow.live .vstate { color: #c0392b; font-weight: 700; }
#voices .vbtns { display: flex; flex-wrap: wrap; gap: 8px; }
#voices .vbtns button.rec { background: #c0392b; border-color: #c0392b; color: #fff; }
#voices .voff { background: #fff1d6; border: 2px solid #e8c77d; border-radius: 12px; padding: 10px 12px; }
`;

/**
 * Renders the grown-ups' voice list into `section`: pick a letter, then for its letter, name and (for animals with
 * a call) noise: record, stop, hear it, keep, redo, back to default. `play(url)` plays a recording through the page's
 * shared audio element and resolves when it ends; `stop()` silences the barn's voice and any hear-back;
 * `onChange(key)` is called after a recording is kept or removed. `noises` maps a letter to its noise word.
 */
export function mountVoices(section, o) {
  const { recorder, animals } = o;
  const play = o.play || (() => Promise.resolve());
  const stop = o.stop || (() => {});
  const onChange = o.onChange || (() => {});
  const noises = o.noises || {};
  const doc = section.ownerDocument;
  let letter = animals[0].letter;
  const mine = new Set(); // keys with a kept recording
  const fresh = new Map(); // key -> Blob recorded but not yet kept
  let busy = null; // key being recorded
  let failed = null; // key whose last start failed for a passing reason

  if (!doc.getElementById('voices-css')) {
    const st = doc.createElement('style');
    st.id = 'voices-css';
    st.textContent = CSS;
    doc.head.append(st);
  }

  const el = (tag, props = {}, ...kids) => {
    const n = doc.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'on') n.addEventListener('click', v);
      else if (k === 'class') n.className = v;
      else if (k.startsWith('aria-') || k === 'role') n.setAttribute(k, v);
      else n[k] = v;
    }
    n.append(...kids);
    return n;
  };
  const button = (text, on, cls = '') => el('button', { type: 'button', textContent: text, on, class: cls });

  function rowsFor(l) {
    const a = animals.find((x) => x.letter === l);
    const out = [
      { key: `letter-${l}`, label: 'Letter', word: `${l.toUpperCase()} ${l}` },
      { key: `name-${l}`, label: 'Name', word: a.name },
    ];
    if (a.sound === 'call' && noises[l]) out.push({ key: `noise-${l}`, label: 'Noise', word: noises[l] });
    return out;
  }

  async function record(key) {
    stop();
    fresh.delete(key);
    failed = null;
    busy = key;
    render();
    try { await recorder.start(key); } catch (e) {
      busy = null;
      if (recorder.available().ok) failed = key;
    }
    render();
  }
  let finishing = false;
  async function finish() {
    const key = busy;
    if (!key || finishing) return;
    finishing = true;
    try {
      const blob = await recorder.finish();
      if (blob && blob.size) fresh.set(key, blob);
    } catch (e) { /* nothing recorded */ }
    finishing = false;
    if (busy === key) busy = null;
    render();
  }
  async function hear(key) {
    stop();
    const blob = fresh.get(key);
    if (blob) {
      const u = URL.createObjectURL(blob);
      try { await play(u); } catch (e) { /* ignore */ }
      setTimeout(() => URL.revokeObjectURL(u), 60000);
      return;
    }
    const u = await recorder.get(key);
    if (u) { try { await play(u); } catch (e) { /* ignore */ } }
  }
  async function keep(key) {
    const blob = fresh.get(key);
    if (!blob) return;
    stop();
    try {
      await recorder.keep(key, blob);
      fresh.delete(key);
      mine.add(key);
      onChange(key);
    } catch (e) { /* the browser refused: available() now says why */ }
    render();
  }
  async function toDefault(key) {
    stop();
    fresh.delete(key);
    try { await recorder.reset(key); mine.delete(key); onChange(key); } catch (e) { /* see available() */ }
    render();
  }

  function stateText(key) {
    if (busy === key) return recorder.recording() ? 'Recording… (up to 6 s)' : 'Starting the microphone…';
    if (fresh.has(key)) return 'New recording: keep it?';
    if (failed === key) return "Couldn't start the microphone. Try again.";
    return mine.has(key) ? 'Your voice' : 'Default voice';
  }

  function rowEl(r, canRecord) {
    const key = r.key;
    const btns = [];
    if (busy === key) {
      if (recorder.recording()) btns.push(button('Stop', finish, 'rec'));
    } else if (busy) {
      // one recording at a time, and nothing plays while the microphone is on
    } else if (fresh.has(key)) {
      btns.push(button('Hear it', () => hear(key)), button('Keep', () => keep(key)));
      if (canRecord) btns.push(button('Redo', () => record(key)));
    } else {
      if (canRecord) btns.push(button('Record', () => record(key)));
      if (mine.has(key)) btns.push(button('Hear it', () => hear(key)), button('Back to default', () => toDefault(key)));
    }
    return el('div', { role: 'group', 'aria-label': `${r.label}: ${r.word}`, class: `vrow${busy === key ? ' live' : ''}` },
      el('div', { class: 'vhead' }, el('span', { class: 'vword', textContent: `${r.label}: “${r.word}”` }), el('span', { class: 'vstate', textContent: stateText(key) })),
      el('div', { class: 'vbtns' }, ...btns));
  }

  function render() {
    const a = recorder.available();
    section.dataset.why = a.ok ? '' : a.why;
    const kids = [el('h3', { textContent: 'Your voice' })];
    if (!a.ok) kids.push(el('p', { class: 'voff' }, el('strong', { textContent: 'Recording is off. ' }), OFF[a.why], ' The barn still uses its own voices.'));
    else kids.push(el('p', { textContent: 'Record the letters and names in your own voice. Pick a letter, record, hear it back, then keep it or redo it. Recordings stay on this device.' }));
    const showList = a.ok || (a.why === 'no-mic' && mine.size > 0);
    if (showList) {
      kids.push(el('div', { class: 'vpick' }, ...animals.map((x) => {
        const has = rowsFor(x.letter).some((r) => mine.has(r.key));
        const b = button(`${x.letter.toUpperCase()} ${x.letter}`, () => { if (!busy) { letter = x.letter; failed = null; render(); } }, has ? 'mine' : '');
        b.setAttribute('aria-pressed', String(x.letter === letter));
        if (has) b.title = 'Has your voice';
        return b;
      })));
      for (const r of rowsFor(letter)) kids.push(rowEl(r, a.ok));
    }
    section.replaceChildren(...kids);
  }

  recorder.subscribe(() => {
    const r = recorder.recording();
    if (r && r.stopped && busy === r.key) { finish(); return; } // 6 s are up
    render();
  });

  render();
  recorder.ready().then(async () => {
    for (const k of await recorder.keys()) mine.add(k);
    render();
  });

  return {
    render,
    /** Stops a recording in progress (the corner is closing). */
    async close() { if (busy) await finish(); },
  };
}
