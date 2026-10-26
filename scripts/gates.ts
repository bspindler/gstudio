// npm run gates: one daily gate cycle against the local registry.
import { runGateCycle, templateRationale } from '@studio/core';
import { localEnv, localGateway } from './local-env.js';

const { store } = localEnv();
const now = new Date();
const { policy, gateway } = await localGateway(store, () => now);
// No QA pipeline until Phase 2, so the 1->2 requirements report as not met.
const evals = await runGateCycle({
  store, gateway, policy, rationale: templateRationale, now,
  context: async () => ({ now, qaPassed: false, botPlayable: false }),
});
for (const e of evals) console.log(`${e.slug}: ${e.decision} (${e.fromStage}->${e.toStage ?? '-'})${e.insufficientData ? ' [insufficient data]' : ''}`);
const pending = await store.listInbox('pending');
if (pending.length) console.log(`Inbox: ${pending.map((i) => i.title).join('; ')}`);
