// Imported FIRST by check-entry.ts, before any game code can load: takes this check's result nonce out of the env.
// Defence in depth against game code forging a HAL-RESULT line; the host-api tripwire (R15) is the primary guard.
export const NONCE_ENV = 'HAL_CHECK_NONCE';
export const NONCE = process.env[NONCE_ENV] ?? '';
delete process.env[NONCE_ENV];
