import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Static checks on each shipped game for the hard rules that can be seen in source.
const GAMES = ['tidepool-pals', 'hyperline'];
const src = (slug: string) => readFileSync(new URL(`../../../games/${slug}/index.html`, import.meta.url), 'utf8');

describe.each(GAMES)('%s compliance', (slug) => {
  const html = src(slug);

  it('is built on the studio SDK', () => {
    expect(html).toMatch(/import\s*\{[^}]*createStudio[^}]*\}\s*from\s*['"][^'"]*studio-sdk\.js['"]/);
  });

  it('routes every purchase through the fake-door SDK', () => {
    expect(html).toContain('purchase.offer(');
    expect(html).not.toMatch(/mockBuy|simulated purchase/i);
  });

  it('has no hard-coded price strings (prices come from priceUsd)', () => {
    expect(html).not.toMatch(/\$\d+\.\d{2}/);
  });

  it('sells no random rewards', () => {
    expect(html).not.toMatch(/randomReward\s*:\s*true/);
  });

  it('shows odds wherever it rolls a random reward', () => {
    if (/\bodds\.roll\(/.test(html)) expect(html).toMatch(/\bodds\.format\(/);
    expect(html).not.toMatch(/Math\.random\(\)\s*<\s*0\.\d+.*(rare|epic|common)/i);
  });

  it('has no fake social proof, fake scarcity or resetting timers', () => {
    expect(html).not.toMatch(/RIVALS|DROP_CAP|claimed\s*:\s*Math|dropWindow/);
  });

  it('emits level events and asks for feedback', () => {
    expect(html).toMatch(/track\(\s*['"]level_start['"]/);
    expect(html).toMatch(/track\(\s*['"]level_end['"]/);
    expect(html).toContain('feedback.maybePrompt(');
  });
});
