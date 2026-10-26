import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APPROVE_FLOOR, classifyAction, loadPolicy, parsePolicy, type Action } from '@studio/core';

const POLICY_PATH = fileURLToPath(new URL('../../../policy.yaml', import.meta.url));
const repoYaml = readFileSync(POLICY_PATH, 'utf8');
const act = (a: Partial<Action> & Pick<Action, 'kind'>): Action => ({ params: {}, requestedBy: 'system', ...a });

describe('policy loader', () => {
  it('parses repo policy.yaml', async () => {
    const p = await loadPolicy(POLICY_PATH);
    expect(p.actions.build).toBe('auto');
    expect(p.gates['2->3'].d1.portal).toBe(0.15);
  });

  it('rejects unknown action key', () => {
    const bad = repoYaml.replace('  build: auto\n', '  build: auto\n  spnd: auto\n');
    expect(() => parsePolicy(bad)).toThrow(/actions\.spnd/);
  });

  it('rejects invalid class', () => {
    expect(() => parsePolicy(repoYaml.replace('build: auto', 'build: sometimes'))).toThrow(/actions\.build/);
  });

  for (const kind of APPROVE_FLOOR) {
    it(`rejects loosening approve-floor kind ${kind}`, () => {
      const bad = repoYaml.replace(new RegExp(`^  ${kind.replace('.', '\\.')}: approve$`, 'm'), `  ${kind}: notify`);
      expect(bad).not.toBe(repoYaml);
      expect(() => parsePolicy(bad)).toThrow(/approve floor/);
    });
  }

  it('rejects stage.kill.max_auto_stage > 2', () => {
    expect(() => parsePolicy(repoYaml.replace('max_auto_stage: 2', 'max_auto_stage: 3'))).toThrow(/max_auto_stage/);
  });
});

describe('classifyAction', () => {
  const p = parsePolicy(repoYaml);

  it('classifies stage.advance by transition', () => {
    expect(classifyAction(act({ kind: 'stage.advance', fromStage: 1, toStage: 2 }), p)).toBe('approve');
    expect(classifyAction(act({ kind: 'stage.advance', fromStage: 0, toStage: 1 }), p)).toBe('auto');
    expect(classifyAction(act({ kind: 'stage.advance', fromStage: 2, toStage: 3 }), p)).toBe('notify');
    expect(classifyAction(act({ kind: 'stage.advance', fromStage: 6, toStage: 7 }), p)).toBe('approve');
  });

  it('classifies stage.kill by stage', () => {
    expect(classifyAction(act({ kind: 'stage.kill', fromStage: 2 }), p)).toBe('auto');
    expect(classifyAction(act({ kind: 'stage.kill', fromStage: 3 }), p)).toBe('approve');
  });

  it('classifies post.public by channel', () => {
    expect(classifyAction(act({ kind: 'post.public', channel: 'youtube' }), p)).toBe('approve');
    expect(classifyAction(act({ kind: 'post.public', channel: 'x' }), p)).toBe('approve');
  });

  it('throws on unknown kind', () => {
    expect(() => classifyAction(act({ kind: 'nuke' as Action['kind'] }), p)).toThrow();
  });
});
