// Chat app infrastructure (phase 8). Scope: one resource group.
// Deploy with: az deployment group create -g rg-chat-test-jb -f infra/main.bicep -p infra/main.parameters.json -p sqlAdminPassword=<secret>
targetScope = 'resourceGroup'

@description('Region for everything except the Static Web App (EU data).')
param location string = resourceGroup().location

@description('Static Web Apps is not offered in North Europe, so it uses a nearby EU region. Content is served from the global CDN; only metadata lives here.')
@allowed([
  'westeurope'
  'westus2'
  'centralus'
  'eastus2'
  'eastasia'
])
param staticWebAppLocation string = 'westeurope'

@description('Prefix used in every resource name.')
param namePrefix string = 'chat-test-jb'

@description('SQL administrator login.')
param sqlAdminLogin string = 'chatadmin'

@secure()
@description('SQL administrator password. Provided at deployment time only. Use letters, digits, - and _ so it is safe inside a connection string.')
param sqlAdminPassword string

@description('Optional public IP of your machine, so you can run the migration script. Empty = no rule.')
param clientIpAddress string = ''

@description('Extra allowed CORS origin so the local Angular app can use the Azure API. Empty = none.')
param localCorsOrigin string = 'http://localhost:4200'

var apiName = '${namePrefix}-api'
var sqlServerName = '${namePrefix}-sql'
var sqlDatabaseName = '${namePrefix}-db'

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-log'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${namePrefix}-ai'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
  }
}

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: sqlServerName
  location: location
  properties: {
    administratorLogin: sqlAdminLogin
    administratorLoginPassword: sqlAdminPassword
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: sqlServer
  name: sqlDatabaseName
  location: location
  sku: {
    name: 'GP_S_Gen5_1'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: 1
  }
  properties: {
    autoPauseDelay: 60
    minCapacity: json('0.5')
    maxSizeBytes: 2147483648
    zoneRedundant: false
    requestedBackupStorageRedundancy: 'Local'
    collation: 'SQL_Latin1_General_CP1_CI_AS'
  }
}

// "Allow Azure services and resources to access this server".
resource allowAzureServices 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = {
  parent: sqlServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource allowClientIp 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = if (!empty(clientIpAddress)) {
  parent: sqlServer
  name: 'AllowClientIp'
  properties: {
    startIpAddress: clientIpAddress
    endIpAddress: clientIpAddress
  }
}

resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: '${namePrefix}-web'
  location: staticWebAppLocation
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {}
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${namePrefix}-plan'
  location: location
  kind: 'linux'
  sku: {
    name: 'B1'
    tier: 'Basic'
    capacity: 1
  }
  properties: {
    reserved: true
  }
}

resource api 'Microsoft.Web/sites@2023-12-01' = {
  name: apiName
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: true
    siteConfig: {
      linuxFxVersion: 'DOTNETCORE|10.0'
      alwaysOn: true
      webSocketsEnabled: true
      http20Enabled: true
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      healthCheckPath: '/health'
      appSettings: [
        {
          name: 'ConnectionStrings__Default'
          value: 'Server=tcp:${sqlServer.properties.fullyQualifiedDomainName},1433;Database=${sqlDatabaseName};User ID=${sqlAdminLogin};Password=${sqlAdminPassword};Encrypt=True;TrustServerCertificate=False;Connection Timeout=60;'
        }
        {
          name: 'Cors__AllowedOrigins__0'
          value: 'https://${staticWebApp.properties.defaultHostname}'
        }
        {
          name: 'Cors__AllowedOrigins__1'
          value: localCorsOrigin
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: insights.properties.ConnectionString
        }
        {
          name: 'ApplicationInsightsAgent_EXTENSION_VERSION'
          value: '~3'
        }
      ]
    }
  }
}

output apiUrl string = 'https://${api.properties.defaultHostName}'
output staticWebAppUrl string = 'https://${staticWebApp.properties.defaultHostname}'
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName
output sqlDatabaseName string = sqlDatabaseName
