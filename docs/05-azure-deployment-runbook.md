# Azure deployment runbook (phase 8)

One-time manual setup. Everything below is run by you, in PowerShell, from the repo root. Nothing here is run automatically.

Fixed names (from `infra/main.bicep`, prefix `chat-test-jb`):

| Thing | Name |
| --- | --- |
| Resource group | `rg-chat-test-jb` (North Europe) |
| API App Service | `chat-test-jb-api` -> https://chat-test-jb-api.azurewebsites.net |
| App Service plan | `chat-test-jb-plan` (Linux B1) |
| Static Web App | `chat-test-jb-web` (Free; metadata in West Europe, because Static Web Apps is not offered in North Europe) |
| SQL server / database | `chat-test-jb-sql` / `chat-test-jb-db` (serverless, auto-pause 60 min) |
| Application Insights / Log Analytics | `chat-test-jb-ai` / `chat-test-jb-log` |

Expected cost: about 12 EUR/month for the B1 plan, 0-5 EUR for SQL, the rest is free or pennies. Delete the resource group when you are done testing: `az group delete -n rg-chat-test-jb`.

Notes before you start:

- The SQL server name `chat-test-jb-sql` must be globally unique. If the deployment says it is taken, change `namePrefix` in `infra/main.parameters.json` (and the API URL in `environment.prod.ts`, `environment.azure.ts`, and `AZURE_WEBAPP_NAME` in `.github/workflows/api.yml`, because the App Service name changes too).
- Choose a SQL password with letters, digits, `-` and `_` only (at least 12 characters, mixed case plus a digit). Characters such as `;` or `"` would break the connection string.
- New subscriptions sometimes have no B1 quota or cannot create SQL servers in a region. If North Europe refuses, the error says so; retry in `westeurope` (create the resource group there and change the region in the same way).

## 1. Log in and pick the subscription

```powershell
az login
az account list -o table
az account set --subscription "<subscription id or name>"
az account show --query "{sub:id, tenant:tenantId}" -o json   # note both ids
```

## 2. Create the resource group

```powershell
az group create -n rg-chat-test-jb -l northeurope
```

## 3. Preview, then deploy the infrastructure

Find your public IP (needed so you can run the migration script from your machine):

```powershell
$myIp = (Invoke-RestMethod https://api.ipify.org)
```

Prompt for the SQL password so it never lands in shell history or a file:

```powershell
$sqlPwd = Read-Host "SQL admin password"   # visible; clear the screen afterwards if you like
```

Preview what will be created (changes nothing):

```powershell
az deployment group what-if -g rg-chat-test-jb -f infra/main.bicep -p infra/main.parameters.json -p sqlAdminPassword=$sqlPwd clientIpAddress=$myIp
```

Deploy:

```powershell
az deployment group create -g rg-chat-test-jb -n chat-infra -f infra/main.bicep -p infra/main.parameters.json -p sqlAdminPassword=$sqlPwd clientIpAddress=$myIp --query properties.outputs
```

The template creates the SQL server and database, the firewall rules (Azure services plus your IP), the B1 Linux plan, the API app (HTTPS only, WebSockets on, Always On on, health check `/health`, .NET 10), Application Insights, and the Static Web App. It writes `ConnectionStrings__Default` and the CORS origins (`Cors__AllowedOrigins__0` = the Static Web App URL, `__1` = `http://localhost:4200`) into the App Service settings. The password stays only in Azure.

Note the Static Web App URL from the outputs (`staticWebAppUrl`); the random part of the hostname is assigned by Azure.

Re-running the deployment later with the same command is safe, but you must supply the password again.

## 4. Create the database schema (run the migration script yourself)

```powershell
cd backend
dotnet tool restore
dotnet tool run dotnet-ef migrations script --idempotent --project src/ChatApp.Api -o $env:TEMP\chat-migrate.sql
cd ..
```

Run it against Azure SQL (use whichever tool you have; `sqlcmd` shown):

```powershell
sqlcmd -S chat-test-jb-sql.database.windows.net -d chat-test-jb-db -U chatadmin -P $sqlPwd -N -i $env:TEMP\chat-migrate.sql
```

Alternatively open the file in SSMS or Azure Data Studio, connect to `chat-test-jb-sql.database.windows.net` and run it. The first connection can fail once while the serverless database wakes up; just retry. The script is idempotent, so running it again is harmless. Delete the temp file afterwards.

## 5. GitHub OIDC for the API deployment (no secrets)

This lets GitHub Actions log in to Azure without any password. The identity is limited to repo `jborowiak/chat`, branch `master`, and to this resource group.

```powershell
$sub = az account show --query id -o tsv
$tenant = az account show --query tenantId -o tsv

# App registration + service principal
$appId = az ad app create --display-name "chat-test-jb-github" --query appId -o tsv
az ad sp create --id $appId

# Federated credential: only this repo and branch
$cred = @{
  name      = "github-master"
  issuer    = "https://token.actions.githubusercontent.com"
  subject   = "repo:jborowiak/chat:ref:refs/heads/master"
  audiences = @("api://AzureADTokenExchange")
} | ConvertTo-Json
$cred | Out-File $env:TEMP\fedcred.json -Encoding ascii
az ad app federated-credential create --id $appId --parameters "@$env:TEMP\fedcred.json"
Remove-Item $env:TEMP\fedcred.json

# Contributor on the resource group only
az role assignment create --assignee $appId --role Contributor --scope "/subscriptions/$sub/resourceGroups/rg-chat-test-jb"

"AZURE_CLIENT_ID=$appId  AZURE_TENANT_ID=$tenant  AZURE_SUBSCRIPTION_ID=$sub"
```

If `az ad` fails with a permissions error, your account cannot create app registrations in this tenant; use the portal (Microsoft Entra ID -> App registrations) or ask the tenant admin.

## 6. GitHub secrets

Get the Static Web App deployment token:

```powershell
az staticwebapp secrets list -n chat-test-jb-web -g rg-chat-test-jb --query properties.apiKey -o tsv
```

In GitHub, repo `jborowiak/chat` -> Settings -> Secrets and variables -> Actions -> New repository secret. Add exactly these four:

| Secret | Value |
| --- | --- |
| `AZURE_CLIENT_ID` | `$appId` from step 5 |
| `AZURE_TENANT_ID` | tenant id (not a password) |
| `AZURE_SUBSCRIPTION_ID` | subscription id (not a password) |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | the token from the command above |

Do not add a publish profile, the SQL password or any connection string to GitHub.

## 7. Deploy

The repo is not yet pushed with the workflows. Commit and push `.github/`, `infra/`, the frontend changes and the docs to `master`. The two workflows (`api.yml`, `web.yml`) run on pushes to `master` that touch `backend/**` or `frontend/**` (or the workflow file), and can also be started manually from the Actions tab (workflow_dispatch). Watch both go green.

If you changed the Static Web App URL or API name, make sure `environment.prod.ts` matches the real API URL before the web workflow runs.

## 8. Verify (Done when)

1. API health: open https://chat-test-jb-api.azurewebsites.net/health and expect `{"status":"Healthy"}` (the first call after a quiet period can be slow while SQL wakes up).
2. Open the Static Web App URL. Deep links such as `/login` must load, not give 404.
3. Acceptance scenarios 1-5 on the Azure URLs, using two browsers (for example Chrome and Edge private mode): register A and B, log in, send messages both ways (they must appear instantly), typing indicator, unread badge and clearing it, reload and log in again.
4. Scenario 6, the local UI against the Azure API:
   ```powershell
   cd frontend/chat-app
   npx ng serve --configuration azure
   ```
   Open http://localhost:4200 and chat with a user logged in on the Azure site. This works because `http://localhost:4200` is in the API's CORS list.
5. Optional: in the portal check Application Insights shows requests, and that the API's "WebSockets" setting is On (SignalR should show `WebSockets` transport in the browser network tab).

When all of that works, tell Claude (or tick the last boxes in `docs/03-implementation-plan.md` yourself) and phase 8 becomes Done.

## Troubleshooting

- Browser CORS error: check the API settings `Cors__AllowedOrigins__0` equals the exact Static Web App URL (https, no trailing slash). Fix with `az webapp config appsettings set`, or redeploy the template.
- API returns 500 / cannot connect: the migration (step 4) has not run, or the SQL firewall lacks "Allow Azure services".
- Deploy step fails at `azure/login`: the federated credential subject must be exactly `repo:jborowiak/chat:ref:refs/heads/master`, and the workflow must run on `master`.
- Logs: `az webapp log tail -n chat-test-jb-api -g rg-chat-test-jb`.
