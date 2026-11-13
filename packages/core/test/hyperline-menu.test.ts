import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../../games/hyperline/index.html', import.meta.url), 'utf8');

describe('hyperline game-over Main Menu button', () => {
  it('sits next to Run again in title case, using the existing button style', () => {
    expect(html).toContain('<button class="btn ghost" data-act="menu">Main Menu</button>');
    expect(html).not.toContain('MAIN MENU');
  });

  it('returns to the ready screen without saving anything', () => {
    expect(html).toMatch(/case 'menu': closeModal\(\); reset\(\); break;/);
  });
});
