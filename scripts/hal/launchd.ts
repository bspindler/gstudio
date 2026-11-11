// The two macOS LaunchAgents: the 1 a.m. nightly run and the keep-alive "Run now" server. Pure plist builders plus an
// install/uninstall that takes the target dir and launchctl as parameters (tests never touch the real ones).
import { closeSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const NIGHTLY_LABEL = 'com.gstudio.hal.nightly';
export const SERVER_LABEL = 'com.gstudio.hal.server';

export type PlistOpts = {
  execPath: string; repo: string; halDir: string; at?: { hour: number; minute: number };
  /** Directory holding the claude binary (resolved at install time); omitted on a dry run that cannot find it. */
  claudeDir?: string;
  home: string;
};

/** launchd's PATH is bare: node's dir, claude's dir, user and Homebrew bins, then the system dirs. Deduplicated. */
export function launchPath(o: PlistOpts): string {
  const parts = [dirname(o.execPath), o.claudeDir, join(o.home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  return [...new Set(parts.filter((p): p is string => !!p))].join(':');
}

export const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const str = (s: string) => `<string>${xml(s)}</string>`;
const args = (a: string[]) => `<array>\n${a.map((x) => `    ${str(x)}`).join('\n')}\n  </array>`;

/** Parses "HH:MM". */
export function parseAt(s: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  const hour = m ? Number(m[1]) : NaN, minute = m ? Number(m[2]) : NaN;
  if (!m || hour > 23 || minute > 59) throw new Error('--at must be HH:MM (24 hour)');
  return { hour, minute };
}

function plist(label: string, o: PlistOpts, program: string[], extra: string, logName: string): string {
  const log = join(o.halDir, 'logs', logName);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  ${str(label)}
  <key>ProgramArguments</key>
  ${args(program)}
  <key>WorkingDirectory</key>
  ${str(o.repo)}
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    ${str(launchPath(o))}
  </dict>
${extra}  <key>StandardOutPath</key>
  ${str(log)}
  <key>StandardErrorPath</key>
  ${str(log)}
</dict>
</plist>
`;
}

export function nightlyPlist(o: PlistOpts): string {
  const at = o.at ?? { hour: 1, minute: 0 };
  const npm = join(dirname(o.execPath), 'npm');
  return plist(NIGHTLY_LABEL, o, ['/usr/bin/caffeinate', '-is', npm, 'run', 'hal', '--', 'run', '--nightly'],
    `  <key>StartCalendarInterval</key>\n  <dict>\n    <key>Hour</key>\n    <integer>${at.hour}</integer>\n    <key>Minute</key>\n    <integer>${at.minute}</integer>\n  </dict>\n`,
    'nightly.log');
}

export function serverPlist(o: PlistOpts): string {
  const npm = join(dirname(o.execPath), 'npm');
  // --quiet keeps the token out of the launchd log file.
  return plist(SERVER_LABEL, o, [npm, 'run', 'hal', '--', 'serve', '--lan', '--quiet'],
    '  <key>RunAtLoad</key>\n  <true/>\n  <key>KeepAlive</key>\n  <true/>\n', 'server.log');
}

export type Launchctl = (args: string[]) => void;
export type InstallDeps = PlistOpts & { agentsDir: string; launchctl: Launchctl };

const files = (d: InstallDeps) => [
  { label: NIGHTLY_LABEL, path: join(d.agentsDir, `${NIGHTLY_LABEL}.plist`), text: nightlyPlist(d) },
  { label: SERVER_LABEL, path: join(d.agentsDir, `${SERVER_LABEL}.plist`), text: serverPlist(d) },
];

export function install(d: InstallDeps): string[] {
  mkdirSync(d.agentsDir, { recursive: true });
  mkdirSync(join(d.halDir, 'logs'), { recursive: true, mode: 0o700 });
  // launchd would create these 0644 as the user; pre-create them private (the file may hold run output).
  for (const n of ['nightly.log', 'server.log']) closeSync(openSync(join(d.halDir, 'logs', n), 'a', 0o600));
  const out: string[] = [];
  for (const f of files(d)) {
    writeFileSync(f.path, f.text);
    try { d.launchctl(['unload', f.path]); } catch { /* not loaded yet */ }
    d.launchctl(['load', '-w', f.path]);
    out.push(f.path);
  }
  return out;
}

export function uninstall(d: InstallDeps): string[] {
  const out: string[] = [];
  for (const f of files(d)) {
    try { d.launchctl(['unload', f.path]); } catch { /* not loaded */ }
    rmSync(f.path, { force: true });
    out.push(f.path);
  }
  return out;
}

export const dryRun = (d: PlistOpts) => [nightlyPlist(d), serverPlist(d)];
