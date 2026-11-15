// `hal run --times N`: N runs in a row. Each is an ordinary run (its own lock, report, note and push); the series
// stops early when a run fails, Brian presses Stop, or the daily API cap is reached. Shared by the CLI, the report
// server's Run now and the nightly LaunchAgent, so all three accept the same 1..MAX_TIMES.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const MAX_TIMES = 10;
export type Series = { at: number; of: number };

/** "3" -> 3; anything but a whole number from 1 to MAX_TIMES throws. */
export function parseTimes(s: string | undefined): number {
  const n = s !== undefined && /^\d+$/.test(s) ? Number(s) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > MAX_TIMES) throw new Error(`--times must be a whole number from 1 to ${MAX_TIMES}`);
  return n;
}

/** Pulls `--times N` (or `--times=N`) out of run's args; the rest go to parseRunArgs unchanged. */
export function takeTimes(args: string[]): { times: number; rest: string[] } {
  const rest: string[] = [];
  let times = 1;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--times') { times = parseTimes(args[++i]); continue; }
    if (a.startsWith('--times=')) { times = parseTimes(a.slice('--times='.length)); continue; }
    rest.push(a);
  }
  return { times, rest };
}

/**
 * Runs `runOne` `times` times in a row (each told its place, unless it is a single run). A non-zero code ends the
 * series with that code; `stopReason` is asked between runs and a reason ends it cleanly.
 */
export async function runSeries(times: number, runOne: (s?: Series) => Promise<number>, stopReason: () => string | null, log: (s: string) => void): Promise<number> {
  for (let at = 1; at <= times; at++) {
    if (times > 1) log(`hal: run ${at} of ${times}`);
    const code = await runOne(times > 1 ? { at, of: times } : undefined);
    if (code !== 0) {
      if (at < times) log(`hal: run ${at} of ${times} ended with code ${code}: skipping the rest`);
      return code;
    }
    if (at < times) {
      const why = stopReason();
      if (why) { log(`hal: ${why}: skipping runs ${at + 1}-${times} of ${times}`); return 0; }
    }
  }
  return 0;
}

/** Why a series should not start its next run: Stop was pressed during the last one, or the API cap was reached. */
export function seriesStopReason(halDir: string, stopFile: string): string | null {
  if (existsSync(join(halDir, stopFile))) return 'Stop was pressed';
  try {
    const latest = JSON.parse(readFileSync(join(halDir, 'latest.json'), 'utf8')) as { reportMd?: string };
    if (typeof latest.reportMd === 'string') {
      const r = JSON.parse(readFileSync(join(dirname(latest.reportMd), 'report.json'), 'utf8')) as { capReached?: boolean };
      if (r.capReached) return 'the daily API cap was reached';
    }
  } catch { /* no report yet: nothing to stop for */ }
  return null;
}
