import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { registryStoreContract, sampleGame } from '@studio/core/contract';
import { createSqliteStore } from '../src/index.js';

registryStoreContract('SqliteStore', async () => createSqliteStore(':memory:'));

describe('SqliteStore persistence', () => {
  it('keeps data across reopen', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'reg-')), 'registry.db');
    const a = createSqliteStore(path);
    await a.putGame(sampleGame('hyperline'));
    await a.appendAudit({ at: '2026-10-26T00:00:00Z', actor: 'system', type: 't', summary: 's', data: { n: 1 } });
    a.close();
    const b = createSqliteStore(path);
    expect((await b.getGame('hyperline'))?.slug).toBe('hyperline');
    expect((await b.listAudit())[0]?.data).toEqual({ n: 1 });
    b.close();
  });
});
