import { MemoryStore } from '@studio/core';
import { registryStoreContract } from '@studio/core/contract';

registryStoreContract('memory', async () => new MemoryStore());
