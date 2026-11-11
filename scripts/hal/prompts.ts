// Hal's role prompts: plain Markdown in scripts/hal/prompts/ with {{placeholders}}. Secrets and env values never go in.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type PromptRole = 'planner' | 'implementer' | 'director';

/** The inputs each template takes. Callers must supply every one. */
export const ROLE_PLACEHOLDERS: Record<PromptRole, readonly string[]> = {
  planner: ['games', 'scores', 'ledger', 'screens', 'controls', 'consoleErrors', 'changelogs', 'notes', 'feedback', 'approvals', 'stagnation', 'budget'],
  implementer: ['game', 'ticket'],
  director: ['results', 'notes', 'stagnation'],
};

export const placeholders = (template: string): string[] => [...new Set([...template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!))];

/** Replaces each {{name}} in one pass (values are never re-expanded). Throws if any placeholder has no value. */
export function renderPrompt(template: string, vars: Record<string, string>): string {
  const missing = placeholders(template).filter((k) => !Object.hasOwn(vars, k));
  if (missing.length) throw new Error(`prompt is missing values for: ${missing.join(', ')}`);
  return template.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => vars[k]!);
}

export const loadPrompt = (role: PromptRole): string =>
  readFileSync(fileURLToPath(new URL(`./prompts/${role}.md`, import.meta.url)), 'utf8');
