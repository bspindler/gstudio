// Studio in a Box game SDK. Plain ES module with no dependencies and no build step.
// Hard rules it carries: anonymous IDs only; fake-door purchases tell the player the item is
// free during the beta; no re-offer after a decline; random rewards are earned-only and show odds.

const VERSION = 1;
const FLUSH_AT = 20;
const FLUSH_MS = 10_000;
const HEARTBEAT_MS = 30_000;
const MAX_QUEUE = 200;
const MAX_BATCH = 100;
// Keepalive requests share a 64 KiB in-flight quota, so unload sends go in smaller pieces.
const UNLOAD_BATCH = 50;
const FEEDBACK_EVERY_MS = 7 * 86400_000;
const CHANNELS = ['portal', 'own_site'];

/**
 * @typedef {string | number | boolean | null} PropValue
 * @typedef {Record<string, PropValue>} Props
 * @typedef {{ getItem(k: string): string | null; setItem(k: string, v: string): void }} KV
 * @typedef {{ label: string; weight: number }} OddsRow
 * @typedef {{ sku: string; title: string; priceUsd: number; randomReward?: boolean }} Offer
 * @typedef {{
 *   game: string; version: string; endpoint: string; channel?: 'portal' | 'own_site';
 *   storage?: KV; fetch?: typeof fetch; now?: () => number; random?: () => number;
 *   document?: Document; window?: Window; location?: { search: string };
 * }} StudioOptions
 */

/** Wraps storage so a throwing localStorage (private mode, blocked cookies) falls back to memory. */
function safeKV(/** @type {KV | undefined} */ inner) {
  /** @type {Map<string, string>} */
  const mem = new Map();
  return {
    /** @param {string} k */
    get(k) {
      try { const v = inner?.getItem(k); if (v != null) return v; } catch { /* fall through */ }
      return mem.get(k) ?? null;
    },
    /** @param {string} k @param {string} v */
    set(k, v) {
      mem.set(k, v);
      try { inner?.setItem(k, v); } catch { /* memory only */ }
    },
  };
}

function defaultStorage() {
  try { return globalThis.localStorage; } catch { return undefined; }
}

/** UUID v4; crypto.randomUUID is missing on plain-http LAN origins, so fall back to getRandomValues. */
function uuid(/** @type {() => number} */ random) {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(random() * 256);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** FNV-1a, 32-bit. Stable variant assignment across sessions and devices with the same ID. */
function fnv1a(/** @type {string} */ s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function checkOdds(/** @type {OddsRow[]} */ table) {
  const sum = table.reduce((a, r) => a + r.weight, 0);
  if (!table.length || table.some((r) => !(r.weight >= 0)) || Math.abs(sum - 1) > 1e-9) {
    throw new Error('odds weights must be non-negative and sum to 1');
  }
}

/** @param {StudioOptions} opts */
export function createStudio(opts) {
  const doc = opts.document ?? globalThis.document;
  const win = opts.window ?? globalThis.window;
  const now = opts.now ?? (() => Date.now());
  const random = opts.random ?? Math.random;
  const send = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const kv = safeKV(opts.storage ?? defaultStorage());
  const key = (/** @type {string} */ k) => `studio:${opts.game}:${k}`;

  let playerId = kv.get('studio:playerId');
  if (!playerId) { playerId = uuid(random); kv.set('studio:playerId', playerId); }
  const sessionId = uuid(random);
  const sessions = Number(kv.get(key('sessions')) ?? 0) + 1;
  kv.set(key('sessions'), String(sessions));

  const fromUrl = new URLSearchParams((opts.location ?? globalThis.location)?.search ?? '').get('ch');
  const channel = opts.channel ?? (fromUrl && CHANNELS.includes(fromUrl) ? fromUrl : 'own_site');

  /** @type {{ e: object; tries: number }[]} */
  let queue = [];
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  /** @param {string} name @param {Props} [props] */
  function track(name, props = {}) {
    queue.push({
      e: { v: VERSION, game: opts.game, version: opts.version, channel, playerId, sessionId, ts: now(), name, props },
      tries: 0,
    });
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    if (queue.length >= FLUSH_AT) void flush();
    else if (!timer) timer = setTimeout(() => { void flush(); }, FLUSH_MS);
  }

  /** @type {Promise<void>} */
  let inflight = Promise.resolve();
  /** Flushes run one at a time, so the queue bound also bounds what gets sent. */
  function flush() {
    if (timer) { clearTimeout(timer); timer = undefined; }
    inflight = inflight.then(drain);
    return inflight;
  }

  async function drain() {
    while (queue.length) {
      const batch = queue.splice(0, MAX_BATCH);
      try {
        const res = await send(`${opts.endpoint}/v1/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ events: batch.map((b) => b.e) }),
          keepalive: true,
        });
        // A 4xx means the batch itself is bad; retrying won't help.
        if (res.status >= 500) throw new Error(`ingest ${res.status}`);
      } catch {
        const retry = batch.filter((b) => b.tries < 1).map((b) => ({ ...b, tries: b.tries + 1 }));
        queue = [...retry, ...queue].slice(-MAX_QUEUE);
        return;
      }
    }
  }

  /**
   * Page is going away (or may be discarded while hidden): send everything now, without waiting
   * behind an in-flight request and without retry. Mobile browsers often skip pagehide entirely.
   */
  function sendNow() {
    if (timer) { clearTimeout(timer); timer = undefined; }
    while (queue.length) {
      const batch = queue.splice(0, UNLOAD_BATCH);
      send(`${opts.endpoint}/v1/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events: batch.map((b) => b.e) }),
        keepalive: true,
      }).catch(() => { /* page is leaving; nothing to retry into */ });
    }
  }

  const heartbeat = setInterval(() => {
    if (!doc || doc.visibilityState === 'visible') track('heartbeat');
  }, HEARTBEAT_MS);
  const onHide = () => { track('session_end'); sendNow(); };
  const onVisibility = () => { if (doc?.visibilityState === 'hidden') sendNow(); };
  /** @param {ErrorEvent} ev */
  const onError = (ev) => track('error', { message: String(ev.message ?? 'error').slice(0, 200) });
  win?.addEventListener('pagehide', onHide);
  win?.addEventListener('error', onError);
  doc?.addEventListener('visibilitychange', onVisibility);

  track('session_start');

  // ---- minimal modal UI ----------------------------------------------------------------
  /**
   * Shows a dialog and calls `onPick` synchronously with the pressed button's id.
   * @param {string} text
   * @param {{ id: string; label: string }[]} buttons
   * @param {(id: string) => void} onPick
   */
  function modal(text, buttons, onPick) {
    const root = doc.createElement('div');
    root.className = 'studio-modal';
    root.setAttribute('role', 'dialog');
    root.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;'
      + 'background:rgba(0,0,0,.55);z-index:2147483647;font:16px system-ui,sans-serif';
    const card = doc.createElement('div');
    card.style.cssText = 'background:#fff;color:#111;border-radius:14px;padding:20px;max-width:320px;text-align:center';
    const p = doc.createElement('p');
    p.textContent = text;
    card.append(p);
    for (const b of buttons) {
      const btn = doc.createElement('button');
      btn.dataset.studio = b.id;
      btn.textContent = b.label;
      btn.style.cssText = 'margin:4px;padding:10px 14px;border-radius:10px;border:1px solid #999;font:inherit';
      btn.addEventListener('click', () => { root.remove(); onPick(b.id); });
      card.append(btn);
    }
    root.append(card);
    doc.body.append(root);
  }

  // ---- fake-door purchases --------------------------------------------------------------
  /** @type {Set<string>} */
  const declined = new Set();

  /**
   * @param {Offer} o
   * @returns {Promise<'granted' | 'declined' | 'suppressed'>}
   */
  function offer(o) {
    if (o.randomReward) throw new Error('paid random rewards are not allowed: random rewards are earned-only');
    if (!(Number.isFinite(o.priceUsd) && o.priceUsd > 0)) throw new Error(`invalid price for ${o.sku}`);
    if (declined.has(o.sku)) return Promise.resolve('suppressed');
    const price = `$${o.priceUsd.toFixed(2)}`;
    track('purchase_offer_shown', { sku: o.sku, priceUsd: o.priceUsd });
    return new Promise((resolve) => modal(`${o.title} · ${price}`, [
      { id: 'buy', label: `Buy ${price}` },
      { id: 'decline', label: 'No thanks' },
    ], (choice) => {
      if (choice !== 'buy') {
        declined.add(o.sku);
        track('purchase_declined', { sku: o.sku });
        resolve('declined');
        return;
      }
      track('purchase_intent', { sku: o.sku, priceUsd: o.priceUsd });
      modal(`Thanks! ${o.title} is free during the beta: nothing was charged. Enjoy!`, [
        { id: 'ok', label: 'OK' },
      ], () => resolve('granted'));
    }));
  }

  // ---- feedback --------------------------------------------------------------------------
  let askedThisSession = false;

  /** @returns {Promise<number | null>} stars, or null when not asked or dismissed */
  function maybePrompt() {
    const last = Number(kv.get(key('feedbackAt')) ?? 0);
    if (sessions < 2 || askedThisSession || now() - last < FEEDBACK_EVERY_MS) return Promise.resolve(null);
    askedThisSession = true;
    kv.set(key('feedbackAt'), String(now()));
    const stars = [1, 2, 3, 4, 5].map((n) => ({ id: `star-${n}`, label: '★'.repeat(n) }));
    return new Promise((resolve) => modal('Enjoying the game? Tap a rating.', [...stars, { id: 'dismiss', label: 'Not now' }],
      (choice) => {
        if (choice === 'dismiss') { resolve(null); return; }
        const n = Number(choice.slice(5));
        track('rating', { stars: n });
        resolve(n);
      }));
  }

  // ---- A/B flags -------------------------------------------------------------------------
  /** @type {Set<string>} */
  const exposed = new Set();

  /**
   * @template {string} V
   * @param {string} experiment
   * @param {readonly V[]} variants
   * @returns {V}
   */
  function flag(experiment, variants) {
    const variant = /** @type {V} */ (variants[fnv1a(`${playerId}:${experiment}`) % variants.length]);
    if (!exposed.has(experiment)) {
      exposed.add(experiment);
      track('exposure', { experiment, variant });
    }
    return variant;
  }

  // ---- odds (earned random rewards) ------------------------------------------------------
  const odds = {
    /** @param {OddsRow[]} table */
    format(table) {
      checkOdds(table);
      return table.map((r) => `${r.label} ${+(r.weight * 100).toFixed(1)}%`).join(' · ');
    },
    /**
     * @template {OddsRow} R
     * @param {R[]} table
     * @returns {R}
     */
    roll(table) {
      checkOdds(table);
      const x = random();
      let acc = 0;
      for (const r of table) { acc += r.weight; if (x < acc) return r; }
      return /** @type {R} */ (table[table.length - 1]);
    },
  };

  return {
    playerId,
    sessionId,
    channel,
    track,
    flush,
    flag,
    odds,
    purchase: { offer },
    feedback: { maybePrompt },
    destroy() {
      clearInterval(heartbeat);
      if (timer) clearTimeout(timer);
      win?.removeEventListener('pagehide', onHide);
      win?.removeEventListener('error', onError);
      doc?.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
