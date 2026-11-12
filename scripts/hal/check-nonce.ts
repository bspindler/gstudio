// Imported FIRST by check-entry.ts, before any game code can load. It takes this check's result nonce out of the env
// and captures what writing the result needs (JSON.stringify, process.stdout.write) while they are still pristine.
// check-entry takes the channel once; game code imported later can neither read the nonce from process.env nor
// replace the functions the result is written with. Defence in depth only (see the residual note in check-entry.ts).
export const NONCE_ENV = 'HAL_CHECK_NONCE';
export const RESULT_PREFIX = 'HAL-RESULT ';

export type ResultChannel = (value: unknown) => void;
type Captured = { nonce: string; stringify: (v: unknown) => string; write: (s: string) => unknown };

/** Pure core, for tests: reads and deletes the nonce from `env`, captures `stringify` and `write`, hands out one channel. */
export function captureChannel(env: NodeJS.ProcessEnv, stringify: (v: unknown) => string, write: (s: string) => unknown): () => ResultChannel {
  const c: Captured = { nonce: env[NONCE_ENV] ?? '', stringify, write };
  delete env[NONCE_ENV];
  let taken = false;
  return () => {
    if (taken) throw new Error('result channel already taken');
    taken = true;
    return (value) => { c.write(`\n${RESULT_PREFIX}${c.nonce} ${c.stringify(value)}\n`); };
  };
}

/** The process's channel, captured at import time. Callable once. */
export const takeResultChannel: () => ResultChannel = captureChannel(
  process.env,
  JSON.stringify.bind(JSON) as (v: unknown) => string,
  process.stdout.write.bind(process.stdout),
);
