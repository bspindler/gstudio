// Shared wiring for the local scripts: everything lives under .data/ (gitignored), no Azure.
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFsObjectStore, createSqliteStore } from '@studio/adapters-local';
import { createGateway, createStageExecutors, loadPolicy, type RegistryStore } from '@studio/core';

export const repo = fileURLToPath(new URL('../', import.meta.url));
export const gamesDir = join(repo, 'games');

export function localEnv(dataDir = process.env.STUDIO_DATA ?? join(repo, '.data')) {
  mkdirSync(dataDir, { recursive: true });
  return {
    dataDir,
    store: createSqliteStore(join(dataDir, 'registry.db')),
    objects: createFsObjectStore(join(dataDir, 'objects')),
  };
}

export async function localGateway(store: RegistryStore, clock: () => Date) {
  const policy = await loadPolicy(join(repo, 'policy.yaml'));
  const gateway = createGateway({
    store, policy, executors: createStageExecutors(store, clock), clock, ids: randomUUID,
    notify: async (n) => console.log(`  [notify${n.urgent ? ' URGENT' : ''}] ${n.title}`),
  });
  return { policy, gateway };
}
