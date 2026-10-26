import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { ZodError, type ZodIssue } from 'zod';
import { PolicySchema, type Policy } from './schema.js';

export class PolicyError extends Error {
  override name = 'PolicyError';
}

function formatIssue(i: ZodIssue): string {
  if (i.code === 'unrecognized_keys') {
    return i.keys.map((k) => `${[...i.path, k].join('.')}: unknown key`).join('; ');
  }
  return `${i.path.join('.')}: ${i.message}`;
}

export function parsePolicy(yamlText: string): Policy {
  try {
    return PolicySchema.parse(parse(yamlText));
  } catch (e) {
    if (e instanceof ZodError) {
      throw new PolicyError(e.issues.map(formatIssue).join('; '));
    }
    throw new PolicyError(`policy.yaml is not valid YAML: ${(e as Error).message}`);
  }
}

export async function loadPolicy(path: string): Promise<Policy> {
  return parsePolicy(await readFile(path, 'utf8'));
}
