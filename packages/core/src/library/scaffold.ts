// Helpers for `npm run new-game <slug>`: checking the name, making a title, filling the starter template.
// Messages are written for a beginner: each one says what to change.

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SLUG = 40;
// Folder names Windows will not create.
const RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/** Returns a plain-English error message, or null when the slug is fine to use. */
export function validateSlug(slug: string, existing: string[]): string | null {
  if (slug === '') return 'Type a name for your game, for example: npm run new-game star-catcher';
  if (slug.length > MAX_SLUG) return `The name is ${slug.length} characters long. Make it 40 characters or fewer.`;
  if (/\s/.test(slug)) return `The name "${slug}" has a space in it. Use a dash instead, for example: star-catcher`;
  if (/[A-Z]/.test(slug)) return `The name "${slug}" has capital letters. Use lowercase only, for example: ${slug.toLowerCase()}`;
  if (slug.startsWith('-') || slug.endsWith('-')) return `The name "${slug}" must not start or end with a dash. Remove the dash at the ${slug.startsWith('-') ? 'start' : 'end'}.`;
  if (!SLUG.test(slug)) return `The name "${slug}" can only use lowercase letters a-z, numbers 0-9 and single dashes between words, for example: star-catcher`;
  if (RESERVED.has(slug)) return `"${slug}" is a reserved name on Windows and cannot be a folder. Pick a different name.`;
  if (existing.includes(slug)) return `There is already a game called "${slug}" in games/. Pick a different name.`;
  return null;
}

/** 'star-catcher' -> 'Star Catcher' */
export function titleFromSlug(slug: string): string {
  return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Replaces every {{name}} with vars[name]; throws if any placeholder has no value. */
export function fillTemplate(tpl: string, vars: Record<string, string>): string {
  const missing = new Set<string>();
  const out = tpl.replace(/\{\{(\w+)\}\}/g, (m, name: string) => {
    if (Object.hasOwn(vars, name)) return vars[name]!;
    missing.add(name);
    return m;
  });
  if (missing.size) throw new Error(`Template placeholder(s) with no value: ${[...missing].map((n) => `{{${n}}}`).join(', ')}`);
  return out;
}
