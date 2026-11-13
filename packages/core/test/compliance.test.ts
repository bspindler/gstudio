import { describe, expect, it } from 'vitest';
import { complianceViolations } from '../src/library/compliance.js';

const clean = `<!doctype html><html><body>
<script type="module">
import { createStudio, resolveEndpoint } from '../../packages/sdk/studio-sdk.js';
const { track, feedback } = createStudio({ endpoint: resolveEndpoint(location, window.STUDIO_CONFIG) });
track('level_start', {});
track('level_end', {});
feedback.maybePrompt();
</script></body></html>`;

const withExtra = (extra: string) => clean.replace('</body>', `${extra}</body>`);
const has = (html: string, text: string) => complianceViolations(html).some((v) => v.includes(text));

describe('complianceViolations', () => {
  it('returns [] for a clean game with no purchases', () => {
    expect(complianceViolations(clean)).toEqual([]);
  });

  it.each([
    ['a Buy button', '<button>Buy coins</button>'],
    ['priceUsd', '<script>const p = { priceUsd: 0.99 };</script>'],
    ['Shop copy', '<h2>Shop</h2>'],
    ['PaymentRequest', '<script>new PaymentRequest();</script>'],
  ])('requires purchase.offer( when the game has %s', (_n, extra) => {
    expect(has(withExtra(extra), 'purchase.offer')).toBe(true);
  });

  it('accepts a shop that uses purchase.offer(', () => {
    expect(complianceViolations(withExtra('<h2>Shop</h2><script>purchase.offer({});</script>'))).toEqual([]);
  });

  it('ignores purchase-like words in script comments', () => {
    const extra = `<script>
// localStorage keeps the store of shopping progress
/* restore() the buy state */
const u = 'https://example.com/x'; // checkout later
</script>`;
    expect(complianceViolations(withExtra(extra))).toEqual([]);
  });

  it('ignores purchase-like words in HTML comments', () => {
    expect(complianceViolations(withExtra('<!-- CHANGE ME: shop colours -->'))).toEqual([]);
  });

  it('does not let a // inside a string hide later purchase code', () => {
    const extra = `<script>const u = 'https://x.test/'; const b = 'Buy now';</script>`;
    expect(has(withExtra(extra), 'purchase.offer')).toBe(true);
  });

  it.each([
    ['missing SDK import', clean.replace(/import[^\n]*\n/, ''), 'SDK'],
    ['hard-coded price', withExtra('<p>$1.99</p><script>purchase.offer({})</script>'), 'priceUsd'],
    ['randomReward: true', withExtra('<script>x({ randomReward: true })</script>'), 'random'],
    ['odds.roll without odds.format', withExtra('<script>odds.roll(t)</script>'), 'odds.format'],
    ['RIVALS', withExtra('<script>const RIVALS=[]</script>'), 'social proof'],
    ['hidden without CSS rule', withExtra('<div hidden></div>'), '[hidden]'],
    ['missing level_start', clean.replace("track('level_start'", "track('x'"), 'level_start'],
    ['missing level_end', clean.replace("track('level_end'", "track('x'"), 'level_end'],
    ['missing feedback prompt', clean.replace('feedback.maybePrompt(', 'feedback.x('), 'feedback.maybePrompt('],
    ['mockBuy', withExtra('<script>mockBuy()</script><script>purchase.offer({})</script>'), 'mockBuy'],
  ])('flags %s', (_n, html, text) => {
    expect(has(html, text)).toBe(true);
  });

  it('requires resolveEndpoint( for the SDK endpoint', () => {
    const html = clean.replace('resolveEndpoint(location, window.STUDIO_CONFIG)', "'https://ingest.example'");
    expect(has(html, 'resolveEndpoint(')).toBe(true);
  });

  it.each([
    ['fetch(', "<script>fetch('/x')</script>"],
    ['navigator.sendBeacon', "<script>navigator.sendBeacon('/x', '')</script>"],
    ['XMLHttpRequest', '<script>new XMLHttpRequest()</script>'],
    ['new WebSocket', "<script>new WebSocket('wss://x')</script>"],
    ['EventSource', "<script>new EventSource('/x')</script>"],
    ['an external script', '<script src="https://cdn.example/lib.js"></script>'],
    ['a protocol-relative external script', "<script src='//cdn.example/lib.js'></script>"],
  ])('flags a direct network call: %s', (_n, extra) => {
    expect(has(withExtra(extra), 'network')).toBe(true);
  });

  it('ignores network words in comments and allows Google Fonts links', () => {
    const extra = `<!-- fetch(x) --><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=X">
<script>// we never fetch( anything
/* no XMLHttpRequest, no new WebSocket, no EventSource, no sendBeacon */</script>`;
    expect(complianceViolations(withExtra(extra))).toEqual([]);
  });

  it.each([
    ['Stripe', '<script src="./pay.js"></script><script>Stripe(key)</script>'],
    ['js.stripe.com', '<script>const u = "https://js.stripe.com/v3"</script>'],
    ['PayPal', '<script>paypal.Buttons()</script>'],
    ['Braintree', '<script>braintree.dropin.create()</script>'],
    ['PaymentRequest', '<script>new PaymentRequest([], {})</script><script>purchase.offer({})</script>'],
  ])('bans external payments: %s', (_n, extra) => {
    expect(has(withExtra(extra), 'store billing')).toBe(true);
  });

  it('ignores payment words in comments', () => {
    expect(complianceViolations(withExtra('<script>// not stripe, not paypal, not braintree</script>'))).toEqual([]);
  });

  it('does not count a purchase.offer( that only appears in a comment', () => {
    expect(has(withExtra('<h2>Shop</h2><script>// purchase.offer({})</script>'), 'purchase.offer')).toBe(true);
    expect(has(withExtra('<h2>Shop</h2><!-- purchase.offer( -->'), 'purchase.offer')).toBe(true);
  });

  it('strips comments in plain .js source too (no <script> wrapper)', () => {
    const js = "\n// shop and buy later; fetch( nothing\nconst x = 1;\n";
    expect(complianceViolations(clean + js)).toEqual([]);
  });

  it('accepts hidden with the [hidden] rule', () => {
    const html = withExtra('<style>[hidden]{display:none !important}</style><div hidden></div>');
    expect(complianceViolations(html)).toEqual([]);
  });
});

describe('complianceViolations for child-directed games', () => {
  const kid = `<!doctype html><html><body>
<script type="module">
import { createStudio } from '../../packages/sdk/studio-sdk.js';
const { purchase } = createStudio({ gameSlug: 'kid', endpoint: '' });
</script></body></html>`;
  const kidWith = (extra: string) => kid.replace('</body>', `${extra}</body>`);
  const opt = { childDirected: true };

  it('returns [] for a clean child-directed page with no events or prompts', () => {
    expect(complianceViolations(kid, opt)).toEqual([]);
  });

  it.each([
    ['resolveEndpoint(', 'const e = resolveEndpoint(location, window.STUDIO_CONFIG);'],
    ['track(', "track('level_start', {});"],
    ['purchase.offer(', 'purchase.offer({});'],
    ['feedback.maybePrompt(', 'feedback.maybePrompt();'],
  ])('flags %s', (_n, code) => {
    const v = complianceViolations(kidWith(`<script>${code}</script>`), opt);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/child-directed/i);
  });

  it('still flags fetch( (the existing network rule applies)', () => {
    expect(complianceViolations(kidWith("<script>fetch('/x');</script>"), opt)).toHaveLength(1);
  });

  it("requires endpoint: '' (no-ingest)", () => {
    const v = complianceViolations(kid.replace("endpoint: ''", 'endpoint: "https://x.example"'), opt);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/child-directed/i);
  });

  it('accepts a double-quoted empty endpoint', () => {
    expect(complianceViolations(kid.replace("endpoint: ''", 'endpoint: ""'), opt)).toEqual([]);
  });

  it("a decoy endpoint: '' elsewhere does not vouch for a createStudio call without it", () => {
    const decoy = kid.replace("createStudio({ gameSlug: 'kid', endpoint: '' })", "createStudio({ gameSlug: 'kid', endpoint: window.E })").replace('</script>', "const cfg = { endpoint: '' };\n</script>");
    const v = complianceViolations(decoy, opt);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/createStudio exactly once/i);
  });

  it('two createStudio calls are a violation, even if both pass endpoint: \'\'', () => {
    const two = kid.replace('</script>', "const s2 = createStudio({ gameSlug: 'kid', endpoint: '' });\n</script>");
    const v = complianceViolations(two, opt);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/createStudio exactly once/i);
    expect(complianceViolations(kid.replace('createStudio(', 'createStudi0('), opt).some((m) => /createStudio exactly once/i.test(m))).toBe(true);
  });

  it("a commented-out createStudio with endpoint: '' does not count", () => {
    const c = kid.replace("createStudio({ gameSlug: 'kid', endpoint: '' })", "createStudio({ gameSlug: 'kid', endpoint: window.E }) // createStudio({ endpoint: '' })");
    expect(complianceViolations(c, opt)).toHaveLength(1);
  });

  it("commented-out track( is fine; a commented-out endpoint: '' is not the call's endpoint", () => {
    expect(complianceViolations(kidWith("<script>// track('level_start', {});\n/* track('x') */</script>"), opt)).toEqual([]);
    expect(complianceViolations(kidWith('<!-- <script>track("x")</script> -->'), opt)).toEqual([]);
    const c = kid.replace("{ gameSlug: 'kid', endpoint: '' }", "{ gameSlug: 'kid' /* endpoint: '' */ }");
    const v = complianceViolations(c, opt);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/child-directed/i);
  });

  it('leaves ordinary games unchanged without the option', () => {
    expect(complianceViolations(kid).length).toBeGreaterThan(0);
    expect(complianceViolations(clean, { childDirected: false })).toEqual([]);
  });
});
