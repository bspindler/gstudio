// Two accounts: an ADLS Gen2 lake (events, audit archive, builds) and a plain account for the Functions host,
// because the Functions host does not support hierarchical-namespace accounts.
param lakeName string
param funcName string
param location string
param tags object

var common = {
  minimumTlsVersion: 'TLS1_2'
  allowBlobPublicAccess: false
  allowSharedKeyAccess: false
  supportsHttpsTrafficOnly: true
}

resource lake 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: lakeName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: union(common, { isHnsEnabled: true })
}

resource lakeBlobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: lake
  name: 'default'
}

resource events 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: lakeBlobs
  name: 'events'
}

resource builds 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: lakeBlobs
  name: 'builds'
}

resource audit 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: lakeBlobs
  name: 'audit'
}

// WORM retention for the audit archive. Left unlocked here; locking it in prod is a separate, irreversible operator step.
resource auditImmutability 'Microsoft.Storage/storageAccounts/blobServices/containers/immutabilityPolicies@2023-05-01' = {
  parent: audit
  name: 'default'
  properties: {
    immutabilityPeriodSinceCreationInDays: 3650
    allowProtectedAppendWrites: true
  }
}

resource func 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: funcName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: common
}

resource funcBlobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: func
  name: 'default'
}

resource deployments 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: funcBlobs
  name: 'deployments'
}

resource funcQueues 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = {
  parent: func
  name: 'default'
}

resource jobs 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  parent: funcQueues
  name: 'jobs'
}

resource jobsPoison 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  parent: funcQueues
  name: 'jobs-poison'
}

output lakeName string = lake.name
output funcName string = func.name
output deploymentContainerUrl string = '${func.properties.primaryEndpoints.blob}${deployments.name}'
