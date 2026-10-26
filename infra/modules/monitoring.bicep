param name string
param location string
param tags object

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${name}-logs'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: 1 } // cost guard
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${name}-ai'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    DisableLocalAuth: false
  }
}

output appInsightsConnectionString string = appInsights.properties.ConnectionString
