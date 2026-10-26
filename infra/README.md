# Infrastructure (Bicep)

There is one resource group per environment, deployed as an Azure deployment stack. Local development never needs any of this; see `docs/architecture.md` → "Local development".

## What gets deployed

| Module | Resources |
|---|---|
| `monitoring` | Log Analytics (30-day retention, 1 GB/day cap) and workspace-based Application Insights |
| `storage` | **Lake account**: ADLS Gen2 with containers `events`, `builds`, and `audit` (WORM 3650 days, unlocked). **Functions account**: host storage, `deployments` container, queues `jobs` and `jobs-poison`. Shared-key access is disabled on both |
| `cosmos` | NoSQL account on the free tier with local auth disabled. Database `registry` at 1000 RU/s shared, holding games, audit, inbox, ledger, metrics and settings |
| `keyvault` | RBAC-authorized vault. Purge protection is on in prod only |
| `functions` | Flex Consumption (FC1) Node 22 app with a system-assigned identity |
| `rbac` | Roles for the app identity: Blob Data Owner (both accounts), Queue Data Contributor, Key Vault Secrets User, and Cosmos Data Contributor |

## Prerequisites

- One subscription per environment. The Cosmos free tier allows only one account per subscription.
- `az login`, then `az account set --subscription <id>`.
- `az group create --name sib-<env>-rg --location eastus2`

## Preview changes, then deploy

```bash
az deployment group what-if --resource-group sib-dev-rg \
  --template-file infra/main.bicep --parameters infra/dev.bicepparam

az stack group create --name sib-dev --resource-group sib-dev-rg \
  --template-file infra/main.bicep --parameters infra/dev.bicepparam \
  --action-on-unmanage deleteResources --deny-settings-mode none
```

## Operator-only steps (not automated)

- **Locking the audit container's immutability policy in prod is irreversible.** Do it only after the audit export is verified: `az storage container immutability-policy lock ...`
