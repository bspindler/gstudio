import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsePolicy, type Policy } from '@studio/core';

export const repoPolicyYaml = readFileSync(fileURLToPath(new URL('../../../policy.yaml', import.meta.url)), 'utf8');
export const repoPolicy = (): Policy => parsePolicy(repoPolicyYaml);

export const policyWithBudgets = (b: Partial<Policy['budgets']>): Policy => {
  const p = repoPolicy();
  return { ...p, budgets: { ...p.budgets, ...b } };
};

export const seq = (prefix = 'id') => { let n = 0; return () => `${prefix}${++n}`; };
