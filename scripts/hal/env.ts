// .hal.env (git-ignored) and the environment handed to Hal's headless Claude children.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Credentials and shell profiles in the home folder that no Hal role, and no Claude-written code Hal runs, may read.
 * Denied next to <repo>/.hal.env everywhere: Claude's Read/Grep rules, the implementer's Bash sandbox and Hal's own
 * sandbox-exec profile (as subpaths, so a folder covers everything in it). The first live probe showed the planner
 * could read any file outside the repo, because a bare `Read` in --allowedTools pre-approves every path.
 */
export const HOME_SECRET_NAMES = [
  '.ssh', '.aws', '.azure', '.docker', '.kube', '.gnupg', '.config/gh', '.netrc', '.git-credentials', '.npmrc',
  '.zshrc', '.zprofile', '.zshenv', '.bashrc', '.bash_profile', '.profile', '.claude', '.claude.json', 'Library/Keychains',
];
/** `<repo>/.hal.env` plus HOME_SECRET_NAMES under `home`: every path Hal denies reading. */
export function secretReadPaths(repo: string, home: string = homedir()): string[] {
  return [join(repo, '.hal.env'), ...HOME_SECRET_NAMES.map((n) => join(home, n))];
}

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
