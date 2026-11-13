import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStudio, resolveEndpoint } from '../studio-sdk.js';

type Sent = { url: string; events: { name: string; props: Record<string, unknown>; playerId: string; channel: string; sessionId: string }[] };

const memStorage = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    m,
  };
};
const throwingStorage = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('SecurityError'); },
  removeItem: () => { throw new Error('SecurityError'); },
};

let sent: Sent[];
let fetchOk: boolean;
const fakeFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  if (!fetchOk) throw new Error('offline');
  sent.push({ url: String(url), events: JSON.parse(String(init?.body)).events });
  return new Response(null, { status: 202 });
});

const live: { destroy(): void }[] = [];
const make = (o: Record<string, unknown> = {}) => {
  const s = createStudio({
    game: 'hyperline', version: '0.2.0', endpoint: 'http://localhost:8787', storage: memStorage(),
    fetch: fakeFetch, ...o,
  });
  live.push(s);
  return s;
};
const allEvents = () => sent.flatMap((s) => s.events);
const names = () => allEvents().map((e) => e.name);
const click = (sel: string) => {
  const el = document.querySelector<HTMLElement>(`[data-studio="${sel}"]`);
  if (!el) throw new Error(`no ${sel} button`);
  el.click();
};

beforeEach(() => {
  sent = []; fetchOk = true; fakeFetch.mockClear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
  document.body.innerHTML = '';
});
afterEach(() => { live.splice(0).forEach((s) => s.destroy()); vi.useRealTimers(); });

describe('identity and channel', () => {
  it('persists an anonymous UUID player id', () => {
    const storage = memStorage();
    const a = make({ storage });
    const b = make({ storage });
    expect(a.playerId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(b.playerId).toBe(a.playerId);
    expect(b.sessionId).not.toBe(a.sessionId);
  });

  it('works with an in-memory id when storage throws', async () => {
    const s = make({ storage: throwingStorage });
    expect(s.playerId).toMatch(/^[0-9a-f-]{36}$/);
    s.track('level_start', { level: 1 });
    await s.flush();
    expect(names()).toContain('level_start');
  });

  it('takes the channel from ?ch= and defaults to own_site', () => {
    expect(make({ location: { search: '?ch=portal' } }).channel).toBe('portal');
    expect(make({ location: { search: '?ch=bogus' } }).channel).toBe('own_site');
    expect(make({ location: { search: '' } }).channel).toBe('own_site');
  });
});

describe('batching', () => {
  it('sends session_start and the event envelope on flush', async () => {
    const s = make();
    s.track('level_end', { level: 2, result: 'win', score: 10 });
    await s.flush();
    expect(sent[0]!.url).toBe('http://localhost:8787/v1/events');
    expect(names()).toEqual(['session_start', 'level_end']);
    const e = allEvents()[1]!;
    expect(e).toMatchObject({ v: 1, game: 'hyperline', version: '0.2.0', channel: 'own_site', playerId: s.playerId, sessionId: s.sessionId });
  });

  it('flushes automatically at 20 events', async () => {
    const s = make();
    for (let i = 0; i < 19; i++) s.track('custom', { i });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.events).toHaveLength(20);
  });

  it('flushes on a 10 second timer', async () => {
    make().track('custom', {});
    await vi.advanceTimersByTimeAsync(9_000);
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(sent).toHaveLength(1);
  });

  it('retries a failed batch once, then drops it', async () => {
    const s = make();
    fetchOk = false;
    await s.flush();
    await s.flush();
    fetchOk = true;
    s.track('custom', { after: true });
    await s.flush();
    expect(names()).toEqual(['custom']);
  });

  it('keeps a failed batch for one retry', async () => {
    const s = make();
    fetchOk = false;
    await s.flush();
    fetchOk = true;
    await s.flush();
    expect(names()).toEqual(['session_start']);
  });

  it('bounds the queue at 200 events', async () => {
    const s = make();
    fetchOk = false;
    for (let i = 0; i < 500; i++) s.track('custom', { i });
    fetchOk = true;
    await s.flush();
    expect(allEvents().length).toBeLessThanOrEqual(200);
  });

  it('sends heartbeats every 30 s and session_end on pagehide', async () => {
    const s = make();
    await vi.advanceTimersByTimeAsync(30_000);
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);
    expect(names()).toEqual(expect.arrayContaining(['heartbeat', 'session_end']));
    expect(fakeFetch.mock.calls.at(-1)![1]).toMatchObject({ keepalive: true });
    s.destroy();
  });
});

describe('fake-door purchases', () => {
  const offer = { sku: 'skin-neon', title: 'Neon Trail', priceUsd: 0.99 };

  it("draws its own colours (a game's dark-mode button styles can't make it unreadable) and gives No thanks the same weight as Buy", async () => {
    const s = make();
    const p = s.purchase.offer(offer);
    const root = document.querySelector<HTMLElement>('.studio-modal')!;
    const card = root.firstElementChild as HTMLElement;
    expect(root.style.colorScheme).toBe('dark');
    expect(card.style.background).not.toBe('');
    expect(card.style.color).not.toBe('');
    const buy = document.querySelector<HTMLElement>('[data-studio="buy"]')!;
    const no = document.querySelector<HTMLElement>('[data-studio="decline"]')!;
    for (const b of [buy, no]) {
      expect(b.style.color).not.toBe('');
      expect(b.style.background).not.toBe('');
      expect(b.style.minHeight).toBe('44px');
    }
    expect(no.style.cssText).toBe(buy.style.cssText);
    click('decline');
    await p;
  });

  it('logs intent, tells the player it is free during the beta, and grants', async () => {
    const s = make();
    const p = s.purchase.offer(offer);
    expect(document.body.textContent).toContain('Neon Trail');
    expect(document.body.textContent).toContain('$0.99');
    click('buy');
    expect(document.body.textContent).toMatch(/free during the beta/i);
    expect(document.body.textContent).toMatch(/nothing was charged/i);
    click('ok');
    expect(await p).toBe('granted');
    await s.flush();
    expect(names()).toEqual(['session_start', 'purchase_offer_shown', 'purchase_intent']);
    expect(allEvents()[2]!.props).toMatchObject({ sku: 'skin-neon', priceUsd: 0.99 });
    expect(document.querySelector('[data-studio]')).toBeNull();
  });

  it('does not re-offer a declined SKU in the same session', async () => {
    const s = make();
    const p = s.purchase.offer(offer);
    click('decline');
    expect(await p).toBe('declined');
    expect(await s.purchase.offer(offer)).toBe('suppressed');
    expect(document.querySelector('[data-studio]')).toBeNull();
    await s.flush();
    expect(names().filter((n) => n === 'purchase_offer_shown')).toHaveLength(1);
    expect(names()).toContain('purchase_declined');
  });

  it('refuses paid random rewards', () => {
    expect(() => make().purchase.offer({ ...offer, randomReward: true })).toThrow(/earned-only/);
  });

  it('refuses a non-positive or non-finite price', () => {
    expect(() => make().purchase.offer({ ...offer, priceUsd: 0 })).toThrow();
    expect(() => make().purchase.offer({ ...offer, priceUsd: Number.NaN })).toThrow();
  });
});

describe('feedback prompt', () => {
  it('does not ask during the first session', async () => {
    expect(await make().feedback.maybePrompt()).toBeNull();
    expect(document.querySelector('[data-studio]')).toBeNull();
  });

  it('asks from the second session and logs the rating', async () => {
    const storage = memStorage();
    make({ storage });
    const s = make({ storage });
    const p = s.feedback.maybePrompt();
    click('star-4');
    expect(await p).toBe(4);
    await s.flush();
    expect(allEvents().find((e) => e.name === 'rating')!.props).toEqual({ stars: 4 });
  });

  it('asks at most once per 7 days', async () => {
    const storage = memStorage();
    make({ storage });
    const p = make({ storage }).feedback.maybePrompt();
    click('star-5');
    await p;
    expect(await make({ storage }).feedback.maybePrompt()).toBeNull();
    vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
    const again = make({ storage }).feedback.maybePrompt();
    expect(document.querySelector('[data-studio="star-1"]')).not.toBeNull();
    click('dismiss');
    await again;
  });

  it('logs nothing on dismiss and does not ask again', async () => {
    const storage = memStorage();
    make({ storage });
    const s = make({ storage });
    const p = s.feedback.maybePrompt();
    click('dismiss');
    expect(await p).toBeNull();
    expect(await s.feedback.maybePrompt()).toBeNull();
    await s.flush();
    expect(names()).not.toContain('rating');
  });
});

describe('A/B flags', () => {
  it('assigns a stable variant and logs one exposure per session', async () => {
    const storage = memStorage();
    const s = make({ storage });
    const v = s.flag('tutorial', ['short', 'long']);
    expect(['short', 'long']).toContain(v);
    expect(s.flag('tutorial', ['short', 'long'])).toBe(v);
    expect(make({ storage }).flag('tutorial', ['short', 'long'])).toBe(v);
    await s.flush();
    expect(allEvents().filter((e) => e.name === 'exposure')).toHaveLength(1);
    expect(allEvents().find((e) => e.name === 'exposure')!.props).toEqual({ experiment: 'tutorial', variant: v });
  });

  it('spreads players across variants', () => {
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 400; i++) counts[make().flag('x', ['a', 'b']) as 'a' | 'b']++;
    expect(counts.a).toBeGreaterThan(140);
    expect(counts.b).toBeGreaterThan(140);
  });
});

describe('odds for earned random rewards', () => {
  const table = [{ label: 'Common', weight: 0.62 }, { label: 'Rare', weight: 0.3 }, { label: 'Epic', weight: 0.08 }];

  it('formats odds as percentages', () => {
    expect(make().odds.format(table)).toBe('Common 62% · Rare 30% · Epic 8%');
  });

  it('rolls according to weights', () => {
    expect(make({ random: () => 0.5 }).odds.roll(table).label).toBe('Common');
    expect(make({ random: () => 0.7 }).odds.roll(table).label).toBe('Rare');
    expect(make({ random: () => 0.95 }).odds.roll(table).label).toBe('Epic');
  });

  it('rejects tables whose weights do not sum to 1', () => {
    expect(() => make().odds.format([{ label: 'A', weight: 0.5 }])).toThrow(/sum to 1/);
    expect(() => make().odds.roll([{ label: 'A', weight: 0.5 }, { label: 'B', weight: 0.6 }])).toThrow(/sum to 1/);
  });
});

describe('I4: flush on hide without waiting', () => {
  const setVisibility = (v: 'hidden' | 'visible') => {
    Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  afterEach(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); });

  it('sends queued events as soon as the page is hidden', async () => {
    const s = make();
    s.track('rating', { stars: 5 });
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(0);
    expect(names()).toEqual(['session_start', 'rating']);
    s.destroy();
  });

  it('sends session_end on pagehide even while an earlier request is still pending', async () => {
    let first = true;
    const hanging = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (first) { first = false; return new Promise<Response>(() => {}); }
      return fakeFetch(url, init);
    });
    const s = make({ fetch: hanging });
    void s.flush(); // takes session_start and never resolves
    await vi.advanceTimersByTimeAsync(0);
    s.track('purchase_intent', { sku: 'x', priceUsd: 0.99 });
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);
    expect(names()).toEqual(['purchase_intent', 'session_end']);
    s.destroy();
  });

  it('keeps each unload request to at most 50 events', async () => {
    let hang = true; // the first auto-flush hangs, so later events pile up behind it
    const s = make({ fetch: (u: string, i?: RequestInit) => (hang ? new Promise<Response>(() => {}) : fakeFetch(u, i)) });
    for (let i = 0; i < 300; i++) s.track('custom', { i }); // queue caps at 200; the hung drain holds 100
    await vi.advanceTimersByTimeAsync(0);
    hang = false;
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.length).toBeGreaterThan(1);
    expect(Math.max(...sent.map((b) => b.events.length))).toBeLessThanOrEqual(50);
    s.destroy();
  });
});

describe('no-ingest mode (endpoint "")', () => {
  it('no-ingest mode sends nothing', async () => {
    const s = make({ endpoint: '' });
    for (let i = 0; i < 30; i++) s.track('tick', { i });
    await s.flush();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
    Reflect.deleteProperty(document, 'visibilityState');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it('no-ingest mode keeps the APIs working', async () => {
    const storage = memStorage();
    const s = make({ endpoint: '', storage });
    const p = s.purchase.offer({ sku: 'skin-neon', title: 'Neon Trail', priceUsd: 0.99 });
    click('buy');
    expect(document.body.textContent).toMatch(/free during the beta/i);
    click('ok');
    expect(await p).toBe('granted');

    const v = s.flag('tutorial', ['short', 'long']);
    expect(['short', 'long']).toContain(v);
    expect(s.flag('tutorial', ['short', 'long'])).toBe(v);
    expect(s.odds.format([{ label: 'a', weight: 0.25 }, { label: 'b', weight: 0.75 }])).toBe('a 25% · b 75%');
    expect(s.odds.roll([{ label: 'a', weight: 1 }]).label).toBe('a');

    const s2 = make({ endpoint: '', storage });
    const f = s2.feedback.maybePrompt();
    click('star-5');
    expect(await f).toBe(5);
    await s2.flush();
    expect(fakeFetch).not.toHaveBeenCalled();
  });
});

describe('fails closed: ingest needs a non-empty endpoint and a non-Pages host', () => {
  const quiet = async (s: ReturnType<typeof make>) => {
    for (let i = 0; i < 30; i++) s.track('tick', { i });
    await s.flush();
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fakeFetch).not.toHaveBeenCalled();
  };
  it('sends nothing when endpoint is undefined', async () => {
    await quiet(make({ endpoint: undefined }));
  });
  it('sends nothing when endpoint is null', async () => {
    await quiet(make({ endpoint: null }));
  });
  it('sends nothing on a github.io host even with an endpoint', async () => {
    await quiet(make({ endpoint: 'https://ingest.example', location: { search: '', hostname: 'x.github.io' } }));
  });
  it('still sends on a normal host with an endpoint', async () => {
    const s = make({ location: { search: '', hostname: 'localhost' } });
    s.track('tick');
    await s.flush();
    expect(fakeFetch).toHaveBeenCalled();
  });
});

describe('resolveEndpoint', () => {
  it('uses no ingest on github.io', () => {
    expect(resolveEndpoint({ protocol: 'https:', hostname: 'x.github.io' })).toBe('');
  });
  it('uses port 8787 on the current host otherwise', () => {
    expect(resolveEndpoint({ protocol: 'http:', hostname: '192.168.1.5' })).toBe('http://192.168.1.5:8787');
  });
  it('an explicit endpoint wins, including the empty string', () => {
    expect(resolveEndpoint({ protocol: 'http:', hostname: 'localhost' }, { endpoint: 'https://e' })).toBe('https://e');
    expect(resolveEndpoint({ protocol: 'http:', hostname: 'localhost' }, { endpoint: '' })).toBe('');
  });
});
