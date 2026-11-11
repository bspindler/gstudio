import { describe, expect, it } from 'vitest';
import { loadPrompt, placeholders, renderPrompt, ROLE_PLACEHOLDERS, type PromptRole } from './prompts.js';

const roles = Object.keys(ROLE_PLACEHOLDERS) as PromptRole[];

describe('renderPrompt', () => {
  it('fills every placeholder, once, without re-expanding values', () => {
    expect(renderPrompt('a {{x}} b {{x}} {{y}}', { x: '{{y}}', y: '1' })).toBe('a {{y}} b {{y}} 1');
  });
  it('throws naming every missing placeholder', () => {
    expect(() => renderPrompt('{{a}} {{b}} {{c}}', { a: '1' })).toThrow(/b, c/);
  });
  it('ignores extra vars', () => expect(renderPrompt('{{a}}', { a: '1', z: '2' })).toBe('1'));
});

describe.each(roles)('%s.md', (role) => {
  const tpl = loadPrompt(role);
  it('has exactly the documented placeholders', () => expect(placeholders(tpl).sort()).toEqual([...ROLE_PLACEHOLDERS[role]].sort()));
  it('renders with all of them and leaves no braces behind', () => {
    const vars = Object.fromEntries(ROLE_PLACEHOLDERS[role].map((k) => [k, `<<${k}>>`]));
    const out = renderPrompt(tpl, vars);
    expect(out).not.toMatch(/\{\{/);
    for (const k of ROLE_PLACEHOLDERS[role]) expect(out).toContain(`<<${k}>>`);
  });
  it('throws when one is missing', () => {
    const [, ...some] = ROLE_PLACEHOLDERS[role];
    expect(() => renderPrompt(tpl, Object.fromEntries(some.map((k) => [k, 'x'])))).toThrow(/missing/i);
  });
  it('never names a secret or env variable', () => expect(tpl).not.toMatch(/ANTHROPIC_API_KEY|sk-ant|process\.env/));
});

describe('prompt contents', () => {
  it('planner quotes the anti-goals verbatim and marks notes as Brian\'s direction', () => {
    const p = loadPrompt('planner');
    expect(p).toContain('Anything that makes the studio liable for usage or payments.');
    expect(p).toContain('Dark patterns.');
    expect(p).toContain('Generic drift.');
    expect(p).toContain('Copying.');
    expect(p).toContain('A surprise bill.');
    expect(p).toContain("Brian's direction (from the Tell Hal box)");
    expect(p).toMatch(/one idea per ticket/i);
    expect(p).toMatch(/identity/i);
    expect(p).toMatch(/band over a bigger number/i);
    expect(p).toContain('{"tickets":[');
  });
  it('implementer lists the protected paths, bans npx, forbids version edits', () => {
    const p = loadPrompt('implementer');
    for (const s of ['packages/core/src/hal/**', 'packages/core/test/hal-*.test.ts', 'scripts/hal.ts', 'scripts/hal/**', 'games/gearhold/levels.d.ts', '// ---- hal hook',
      '.data/**', '.hal.env', 'policy.yaml', 'markets.yaml', 'infra/**', '.github/**', 'CLAUDE.md',
      'packages/core/src/**/{gateway,policy,compliance}*', 'packages/core/test/{compliance,games-compliance,no-external-fonts,game-versions}*.test.ts',
      'package.json', 'package-lock.json', 'docs/superpowers/**']) expect(p, s).toContain(s);
    expect(p).toMatch(/npx/);
    expect(p).toContain('npm test -- <path>');
    expect(p).toMatch(/CHANGELOG\.md/);
    expect(p).toContain('docs/hal/history');
  });
  it('director returns the documented JSON shape', () => {
    const p = loadPrompt('director');
    expect(p).toContain('"noteReplies"');
    expect(p).toContain('"perGame"');
  });
  it("Brian's notes cannot override the hard rules or protected list, in all prompts that see them", () => {
    for (const r of ['planner', 'director'] as const) expect(loadPrompt(r)).toMatch(/cannot override/i);
  });
});
