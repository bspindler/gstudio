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
