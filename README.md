# Chat App

One-to-one chat app: Angular front end, ASP.NET Core + SignalR back end, Azure SQL. Design documents are in [docs/](docs/); progress is tracked in [docs/03-implementation-plan.md](docs/03-implementation-plan.md).

## Prerequisites

- .NET 10 SDK
- Node.js LTS and the Angular CLI (`npm i -g @angular/cli`)
- Docker Desktop (runs the local SQL Server)

## Run locally

Start the API (http://localhost:5113):

```
cd backend
dotnet run --project src/ChatApp.Api
```

Check it: `curl http://localhost:5113/health`

Start the Angular app (http://localhost:4200) in a second terminal:

```
cd frontend/chat-app
npm install
ng serve
```

The page shows "API health: Healthy" when the front end can reach the API.

## Tests

```
cd backend && dotnet test
cd frontend/chat-app && ng test
```

## Configuration

- API allowed origins: `Cors:AllowedOrigins` in `backend/src/ChatApp.Api/appsettings.json`.
- API URL for Angular: `frontend/chat-app/src/environments/environment.ts` (dev) and `environment.prod.ts` (production build).
- Secrets (connection strings, from phase 1) go in `dotnet user-secrets`, never in the repository.

## Database (local)

SQL Server runs in Docker (see [docker-compose.yml](docker-compose.yml)). Data is kept in a Docker volume, so it survives restarts.

```powershell
# 1. One-time: create .env from the example and choose a password
copy .env.example .env

# 2. Start SQL Server (start Docker Desktop first)
docker compose up -d

# 3. One-time: point the API at it (use the same password as in .env)
cd backend/src/ChatApp.Api
dotnet user-secrets set "ConnectionStrings:Default" "Server=localhost,1433;Database=ChatApp;User Id=sa;Password=<your password>;TrustServerCertificate=True"

# 4. Create/update the schema
cd ../..
dotnet tool restore
dotnet tool run dotnet-ef database update --project src/ChatApp.Api
```

Stop it with `docker compose stop`. `docker compose down -v` also deletes the data.
