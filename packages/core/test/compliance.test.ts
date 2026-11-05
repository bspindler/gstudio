import { describe, expect, it } from 'vitest';
import { complianceViolations } from '../src/library/compliance.js';

const clean = `<!doctype html><html><body>
<script type="module">
import { createStudio } from '../../packages/sdk/studio-sdk.js';
const { track, feedback } = createStudio({});
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

  it('accepts hidden with the [hidden] rule', () => {
    const html = withExtra('<style>[hidden]{display:none !important}</style><div hidden></div>');
    expect(complianceViolations(html)).toEqual([]);
  });
});
