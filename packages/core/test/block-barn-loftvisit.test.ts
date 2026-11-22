import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../../../games/block-barn/index.html', import.meta.url)), 'utf8');

describe('block-barn: an animal dropped on the open door visits the loft window', () => {
  const fn = html.slice(html.indexOf('function visitLoft'), html.indexOf('function leaveBarn'));
  it('needs the open door and the loft, and reuses trot-in / trot-out', () => {
    expect(fn).toMatch(/!doorOpen/);
    expect(fn).toMatch(/!loftBox\(\)/);
    expect(fn).toMatch(/classList\.add\('trot-in'\)/);
    expect(fn).toMatch(/classList\.add\('trot-out'\)/);
    expect(fn).toMatch(/prefers-reduced-motion: reduce/);
  });
  it('has no sound, text or tap zone', () => {
    expect(fn).not.toMatch(/sfx\.|tone\(|talk\(|textContent/);
  });
  it('is routed from the drag-drop only, and tapDoor is untouched by it', () => {
    const at = html.slice(html.indexOf('function trotAt'), html.indexOf('function endPointer'));
    expect(at).toMatch(/visitLoft\(b\.letter\)/);
    expect(at).toMatch(/trotAnimal\(b\.letter, x\)/);
    const tap = html.slice(html.indexOf('function tapAt'), html.indexOf('function endPointer'));
    expect(tap).toMatch(/tapDoor\(\); return;/);
    expect(html.slice(html.indexOf('function tapDoor'), html.indexOf('the sky ----------'))).not.toMatch(/visitLoft/);
  });
});
