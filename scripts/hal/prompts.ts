// Hal's role prompts: plain Markdown in scripts/hal/prompts/ with {{placeholders}}. Secrets and env values never go in.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** `implementer-fix` is appended to the implementer prompt for a fix round after failed checks (candidate.ts). */
export type PromptRole = 'planner' | 'implementer' | 'implementer-fix' | 'director';

/** The inputs each template takes. Callers must supply every one. */
export const ROLE_PLACEHOLDERS: Record<PromptRole, readonly string[]> = {
  planner: ['games', 'scores', 'ledger', 'screens', 'controls', 'consoleErrors', 'changelogs', 'notes', 'feedback', 'approvals', 'stagnation', 'lessons', 'held', 'budget'],
  implementer: ['game', 'scorers', 'ticket'],
  'implementer-fix': ['round', 'rounds', 'failure'],
  director: ['results', 'notes', 'stagnation', 'feedback', 'lessons'],
};

export const placeholders = (template: string): string[] => [...new Set([...template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!))];

/** Breaks up runs of 3+ backticks (with zero-width spaces) so a data value can never close the fenced block it sits in. */
const defang = (v: string) => v.replace(/`{3,}/g, (m) => m.split('').join('\u200b'));

/** Replaces each {{name}} in one pass (values are never re-expanded). Throws if any placeholder has no value. */
export function renderPrompt(template: string, vars: Record<string, string>): string {
  const missing = placeholders(template).filter((k) => !Object.hasOwn(vars, k));
  if (missing.length) throw new Error(`prompt is missing values for: ${missing.join(', ')}`);
  return template.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => defang(vars[k]!));
}

export const loadPrompt = (role: PromptRole): string =>
  readFileSync(fileURLToPath(new URL(`./prompts/${role}.md`, import.meta.url)), 'utf8');

export type ImplementerOutput = { changelog: string; summary: string; blocked?: string };

/** The last top-level JSON object in the text, validated against the implementer contract; null if none or invalid. */
export function parseImplementerOutput(text: string): ImplementerOutput | null {
  let found: unknown;
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    for (let end = text.indexOf('}', start); end !== -1; end = text.indexOf('}', end + 1)) {
      try {
        const v = JSON.parse(text.slice(start, end + 1));
        if (v && typeof v === 'object' && !Array.isArray(v)) found = v;
        start = end; // skip past this object so nested ones are not taken
        break;
      } catch { /* keep growing */ }
    }
  }
  if (!found) return null;
  const o = found as Record<string, unknown>;
  const line = (x: unknown): x is string => typeof x === 'string' && x.trim() !== '' && !/[\r\n]/.test(x);
  if (o.blocked !== undefined) return line(o.blocked) ? { changelog: line(o.changelog) ? o.changelog : '', summary: line(o.summary) ? o.summary : '', blocked: o.blocked } : null;
  return line(o.changelog) && line(o.summary) ? { changelog: o.changelog, summary: o.summary } : null;
}
