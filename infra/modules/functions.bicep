param name string
param location string
param tags object
param funcStorageName string
param deploymentContainerUrl string
param appInsightsConnectionString string
param cosmosEndpoint string
param lakeName string
param keyVaultUri string

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: '${name}-plan'
  location: location
  tags: tags
  kind: 'functionapp'
  sku: { name: 'FC1', tier: 'FlexConsumption' }
  properties: { reserved: true }
}

resource app 'Microsoft.Web/sites@2024-04-01' = {
  name: name
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: deploymentContainerUrl
          authentication: { type: 'SystemAssignedIdentity' }
        }
      }
      scaleAndConcurrency: { maximumInstanceCount: 40, instanceMemoryMB: 2048 }
      runtime: { name: 'node', version: '22' }
    }
    siteConfig: {
      minTlsVersion: '1.2'
      appSettings: [
        { name: 'AzureWebJobsStorage__accountName', value: funcStorageName }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
        { name: 'COSMOS_ENDPOINT', value: cosmosEndpoint }
        { name: 'LAKE_ACCOUNT', value: lakeName }
        { name: 'KEY_VAULT_URI', value: keyVaultUri }
      ]
    }
  }
}

output name string = app.name
output principalId string = app.identity.principalId
