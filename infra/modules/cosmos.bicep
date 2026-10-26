param name string
param location string
param tags object

var containers = [
  { name: 'games', pk: '/slug' }
  { name: 'audit', pk: '/gameSlug' }
  { name: 'inbox', pk: '/id' }
  { name: 'ledger', pk: '/gameSlug' }
  { name: 'metrics', pk: '/gameSlug' }
  { name: 'settings', pk: '/id' }
]

resource account 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: name
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    enableFreeTier: true // one free-tier account per subscription; dev and prod are separate subscriptions
    disableLocalAuth: true
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    locations: [{ locationName: location, failoverPriority: 0, isZoneRedundant: false }]
  }
}

resource db 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: account
  name: 'registry'
  properties: {
    resource: { id: 'registry' }
    options: { throughput: 1000 } // shared, within the free tier
  }
}

resource cs 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = [for c in containers: {
  parent: db
  name: c.name
  properties: {
    resource: { id: c.name, partitionKey: { paths: [c.pk], kind: 'Hash' } }
  }
}]

output name string = account.name
output endpoint string = account.properties.documentEndpoint
