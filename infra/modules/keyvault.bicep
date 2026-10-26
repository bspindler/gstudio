param name string
param location string
param tags object
param purgeProtection bool

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    // Purge protection cannot be turned off once on, so it is only enabled in prod.
    enablePurgeProtection: purgeProtection ? true : null
  }
}

output name string = vault.name
output uri string = vault.properties.vaultUri
