// Whether a run.lock's holder is still running: shared by the run's lock (run.ts) and the Run-now server (server.ts),
// so both apply the same pid-reuse guard. Small on purpose: server.ts must not load the run's machinery.
import { execFileSync } from 'node:child_process';
import type { RunLock } from './server.js';

export const defaultAlive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
};
/** `ps -o lstart= -p <pid>` as a Date (second resolution), or null. */
export const defaultStartTime = (pid: number): Date | null => {
  try {
    const t = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const d = new Date(t);
    return t && Number.isFinite(d.getTime()) ? d : null;
  } catch { return null; }
};
const PID_REUSE_SLACK_MS = 5_000;
/** A lock is live if its pid is alive and that process started no later than the lock (else the pid was reused). */
export function lockLive(l: RunLock, isAlive: (pid: number) => boolean = defaultAlive, startTimeOf: (pid: number) => Date | null = defaultStartTime): boolean {
  if (!isAlive(l.pid)) return false;
  const started = startTimeOf(l.pid), at = Date.parse(l.startedAt);
  return !(started && Number.isFinite(at) && started.getTime() > at + PID_REUSE_SLACK_MS);
}
