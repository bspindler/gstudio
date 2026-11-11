// .hal.env (git-ignored) and the environment handed to Hal's headless Claude children.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Parse KEY=VALUE lines. `#` comments, optional `export`, optional single/double quotes, no interpolation. Errors name the line, never the value. */
export function parseHalEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) throw new Error(`.hal.env: malformed line ${i + 1}`);
    let v = m[2]!.trim();
    const q = v[0];
    if (q === '"' || q === "'") {
      if (v.length < 2 || v[v.length - 1] !== q) throw new Error(`.hal.env: unterminated quote on line ${i + 1}`);
      v = v.slice(1, -1);
    }
    out[m[1]!] = v;
  });
  return out;
}

/** Reads `<repo>/.hal.env`; `{}` when absent. */
export function loadHalEnv(repo: string): Record<string, string> {
  const f = join(repo, '.hal.env');
  return existsSync(f) ? parseHalEnv(readFileSync(f, 'utf8')) : {};
}

/** A fresh env for a child process; `base` is never mutated. */
export function childEnv(base: NodeJS.ProcessEnv, billing: 'api' | 'subscription', key?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  if (billing === 'api') {
    if (!key) throw new Error('no API key in .hal.env');
    env.ANTHROPIC_API_KEY = key;
    delete env.ANTHROPIC_AUTH_TOKEN;
  } else {
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
  }
  return env;
}
