// Studio in a Box: one resource group per environment, deployed as a deployment stack.
targetScope = 'resourceGroup'

@allowed(['dev', 'prod'])
param env string
param location string = 'eastus2'
param namePrefix string = 'sib'

var suffix = uniqueString(resourceGroup().id)
var tags = { app: 'studio-in-a-box', env: env }

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: { name: '${namePrefix}-${env}', location: location, tags: tags }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: {
    lakeName: take('${namePrefix}${env}lake${suffix}', 24)
    funcName: take('${namePrefix}${env}func${suffix}', 24)
    location: location
    tags: tags
  }
}

module cosmos 'modules/cosmos.bicep' = {
  name: 'cosmos'
  params: { name: '${namePrefix}-${env}-cosmos-${suffix}', location: location, tags: tags }
}

module keyvault 'modules/keyvault.bicep' = {
  name: 'keyvault'
  params: { name: take('${namePrefix}-${env}-kv-${suffix}', 24), location: location, tags: tags, purgeProtection: env == 'prod' }
}

module functions 'modules/functions.bicep' = {
  name: 'functions'
  params: {
    name: '${namePrefix}-${env}-api-${suffix}'
    location: location
    tags: tags
    funcStorageName: storage.outputs.funcName
    deploymentContainerUrl: storage.outputs.deploymentContainerUrl
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    cosmosEndpoint: cosmos.outputs.endpoint
    lakeName: storage.outputs.lakeName
    keyVaultUri: keyvault.outputs.uri
  }
}

module rbac 'modules/rbac.bicep' = {
  name: 'rbac'
  params: {
    principalId: functions.outputs.principalId
    lakeName: storage.outputs.lakeName
    funcStorageName: storage.outputs.funcName
    cosmosName: cosmos.outputs.name
    keyVaultName: keyvault.outputs.name
  }
}

output cosmosEndpoint string = cosmos.outputs.endpoint
output storageAccountName string = storage.outputs.lakeName
output keyVaultUri string = keyvault.outputs.uri
output functionAppName string = functions.outputs.name
output appInsightsConnectionString string = monitoring.outputs.appInsightsConnectionString
