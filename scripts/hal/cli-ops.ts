// CLI commands for the Run-now server and the schedule: serve, setup, install, uninstall. cli.ts only dispatches here.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadHalEnv, parseHalEnv } from './env.js';
import { dryRun, install, parseAt, uninstall, type Launchctl } from './launchd.js';
import { parseTimes } from './series.js';
import { SERVER_PORT, createServerApp, probeDevUrl, realGit, realSpawnRun } from './server.js';

export const OPS_COMMANDS = ['serve', 'setup', 'install', 'uninstall'] as const;
export type OpsCommand = (typeof OPS_COMMANDS)[number];
export const isOpsCommand = (c: string | undefined): c is OpsCommand => !!c && (OPS_COMMANDS as readonly string[]).includes(c);

export type OpsDeps = {
  halDir: string;
  games: string[];
  repo?: string;
  execPath?: string;
  home?: string;
  agentsDir?: string;
  launchctl?: Launchctl;
  /** Finds a binary on PATH; returns its absolute path or null. */
  which?: (bin: string) => string | null;
  /** Interface table, as os.networkInterfaces(). */
  interfaces?: () => ReturnType<typeof networkInterfaces>;
  isTTY?: boolean;
  /** Starts listening; default uses @hono/node-server and never returns. */
  listen?: (o: { fetch: (r: Request) => Response | Promise<Response>; hostname: string; port: number }) => Promise<void>;
};

const defaultRepo = () => fileURLToPath(new URL('../../', import.meta.url));

export function lanIp(ifaces: ReturnType<typeof networkInterfaces>): string | null {
  for (const list of Object.values(ifaces)) for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) return i.address;
  return null;
}

const bookmark = (host: string, token?: string) => `http://${host}:${SERVER_PORT}/${token ? `?t=${token}` : ''}`;

function setup(d: OpsDeps): number {
  const repo = d.repo ?? defaultRepo();
  const file = join(repo, '.hal.env');
  const exists = existsSync(file);
  const text = exists ? readFileSync(file, 'utf8') : '';
  let token = parseHalEnv(text).HAL_TOKEN;
  if (!token) {
    token = randomBytes(32).toString('base64url');
    // mode 0600 applies when the file is created; an existing file keeps its permissions. Only an empty HAL_TOKEN= line is replaced; every other line stays byte-for-byte.
    const empty = /^([ \t]*(?:export[ \t]+)?HAL_TOKEN[ \t]*=)[ \t]*(?:(?:""|'')[ \t]*)?$/m;
    if (empty.test(text)) {
      writeFileSync(file, text.replace(empty, `$1${token}`));
    } else {
      const sep = text === '' || text.endsWith('\n') ? '' : '\n';
      writeFileSync(file, `${sep}HAL_TOKEN=${token}\n`, { mode: 0o600, flag: 'a' });
    }
    console.log('HAL_TOKEN created in .hal.env');
  } else {
    console.log('HAL_TOKEN already set in .hal.env (unchanged)');
  }
  const ip = lanIp((d.interfaces ?? networkInterfaces)());
  console.log(`Bookmark on your phone: ${bookmark(ip ?? 'localhost', token)}`);
  if (!ip) console.log("(no LAN address found; replace localhost with this Mac's IP)");
  return 0;
}

async function serveCmd(rest: string[], d: OpsDeps): Promise<number> {
  const { values } = parseArgs({ args: rest, options: { lan: { type: 'boolean' }, quiet: { type: 'boolean' } } });
  const repo = d.repo ?? defaultRepo();
  const token = loadHalEnv(repo).HAL_TOKEN;
  if (!token) throw new Error('no HAL_TOKEN in .hal.env; run: npm run hal -- setup');
  const hostname = values.lan ? '0.0.0.0' : '127.0.0.1';
  const ip = lanIp((d.interfaces ?? networkInterfaces)());
  const host = values.lan ? ip ?? 'localhost' : 'localhost';
  const app = createServerApp({ halDir: d.halDir, token, games: d.games, spawnRun: realSpawnRun(repo), devUrl: probeDevUrl(host), git: realGit(repo) });
  const tty = d.isTTY ?? Boolean(process.stdout.isTTY);
  // The token goes only to an interactive terminal; launchd's log file (not a TTY, --quiet) never gets it.
  console.log(`Hal Run now: ${bookmark(host, tty && !values.quiet ? token : undefined)}${values.lan ? ' (LAN)' : ' (this Mac only; use --lan for your phone)'}`);
  await (d.listen ?? defaultListen)({ fetch: app.fetch, hostname, port: SERVER_PORT });
  return 0;
}

async function defaultListen(o: { fetch: (r: Request) => Response | Promise<Response>; hostname: string; port: number }): Promise<void> {
  const { serve } = await import('@hono/node-server');
  serve(o);
  await new Promise<never>(() => {}); // keep the process alive
}

const realWhich = (bin: string): string | null => {
  try { return execFileSync('/usr/bin/which', [bin], { encoding: 'utf8' }).trim() || null; } catch { return null; }
};

const realLaunchctl: Launchctl = (a) => { execFileSync('launchctl', a, { stdio: 'ignore' }); };

function installCmd(cmd: 'install' | 'uninstall', rest: string[], d: OpsDeps): number {
  const { values } = parseArgs({ args: rest, options: { 'dry-run': { type: 'boolean' }, at: { type: 'string' }, times: { type: 'string' } } });
  const home = d.home ?? homedir();
  const claude = (d.which ?? realWhich)('claude');
  const opts = {
    claudeDir: claude ? dirname(claude) : undefined,
    home,
    execPath: d.execPath ?? process.execPath,
    repo: d.repo ?? defaultRepo(),
    halDir: d.halDir,
    at: values.at ? parseAt(values.at) : undefined,
    times: values.times !== undefined ? parseTimes(values.times) : undefined,
    agentsDir: d.agentsDir ?? join(home, 'Library', 'LaunchAgents'),
    launchctl: d.launchctl ?? realLaunchctl,
  };
  if (cmd === 'install' && !claude && !values['dry-run']) throw new Error('claude not found on PATH; install Claude Code (or fix PATH) so the nightly run can start it, then re-run install');
  if (cmd === 'install' && values['dry-run']) {
    if (!claude) console.log('WARNING: claude not found on PATH; install would fail until it is available');
    for (const p of dryRun(opts)) console.log(p);
    return 0;
  }
  const paths = (cmd === 'install' ? install : uninstall)(opts);
  for (const p of paths) console.log(`${cmd === 'install' ? 'installed' : 'removed'} ${p}`);
  return 0;
}

export async function runOpsCommand(c: OpsCommand, rest: string[], d: OpsDeps): Promise<number> {
  if (c === 'serve') return serveCmd(rest, d);
  if (c === 'setup') { parseArgs({ args: rest, options: {} }); return setup(d); }
  return installCmd(c, rest, d);
}
