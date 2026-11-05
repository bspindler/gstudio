import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { complianceViolations, fillTemplate, loadGameLibrary, titleFromSlug, validateSlug } from '../src/index.js';

const templates = fileURLToPath(new URL('../../../scripts/templates/game/', import.meta.url));

describe('validateSlug', () => {
  it.each(['star-catcher', 'game2'])('accepts %s', (slug) => {
    expect(validateSlug(slug, ['hyperline'])).toBeNull();
  });

  it.each([
    ['Star', /lowercase/i],
    ['star catcher', /space/i],
    ['../x', /letters|lowercase/i],
    ['-star', /start or end with a dash/i],
    ['star-', /start or end with a dash/i],
    ['', /type a name/i],
    ['a'.repeat(41), /40 characters/i],
  ])('rejects %j with a message saying what to change', (slug, msg) => {
    expect(validateSlug(slug, [])).toMatch(msg);
  });

  it('rejects a slug that is already a game', () => {
    expect(validateSlug('hyperline', ['hyperline', 'tidepool-pals'])).toMatch(/already.*different name/i);
  });

  it.each(['con', 'nul', 'aux', 'prn', 'com1', 'lpt1'])('rejects the Windows reserved name %s', (slug) => {
    expect(validateSlug(slug, [])).toMatch(/reserved.*Windows.*different name/i);
  });
});

describe('titleFromSlug', () => {
  it('capitalises each word', () => {
    expect(titleFromSlug('star-catcher')).toBe('Star Catcher');
    expect(titleFromSlug('game2')).toBe('Game2');
  });
});

describe('fillTemplate', () => {
  it('replaces every {{name}}', () => {
    expect(fillTemplate('{{a}} and {{b}} and {{a}}', { a: 'x', b: 'y' })).toBe('x and y and x');
  });

  it('throws when a placeholder is left over', () => {
    expect(() => fillTemplate('hi {{missing}}', {})).toThrow(/missing/);
  });
});

describe('the starter game', () => {
  it('the starter passes compliance', async () => {
    const vars = { slug: 'test-starter', title: titleFromSlug('test-starter') };
    const html = fillTemplate(readFileSync(join(templates, 'index.html'), 'utf8'), vars);
    const yaml = fillTemplate(readFileSync(join(templates, 'game.yaml'), 'utf8'), vars);
    const tempGames = mkdtempSync(join(tmpdir(), 'starter-'));
    mkdirSync(join(tempGames, 'test-starter'));
    writeFileSync(join(tempGames, 'test-starter', 'index.html'), html);
    writeFileSync(join(tempGames, 'test-starter', 'game.yaml'), yaml);

    expect(complianceViolations(html)).toEqual([]);
    const games = await loadGameLibrary(tempGames);
    expect(games.map((g) => [g.slug, g.version, g.title])).toEqual([['test-starter', '0.1.0', 'Test Starter']]);
    expect(html).toMatch(/game: 'test-starter',\s*version: '0.1.0'/);
  });
});
