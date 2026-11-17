import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../../games/lanternkeep/index.html', import.meta.url), 'utf8');

describe('lanternkeep ?night=N', () => {
  it('reads night from the page address, clamps it, and is not behind the HAL flag', () => {
    const i = html.indexOf(".get('night')");
    expect(i).toBeGreaterThan(0);
    const line = html.slice(html.lastIndexOf('\n', i), html.indexOf('\n', i));
    expect(line).toContain('location.search');
    expect(line).not.toMatch(/HAL/);
    const block = html.slice(i, i + 400);
    expect(block).toContain('LEVELS.length');
    expect(block).toContain('startLevel(');
    expect(block).not.toMatch(/\bHAL\b/);
  });
});
