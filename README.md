# Chat App

One-to-one chat app: Angular front end, ASP.NET Core + SignalR back end, Azure SQL. Design documents are in [docs/](docs/); progress is tracked in [docs/03-implementation-plan.md](docs/03-implementation-plan.md).

## Prerequisites

- .NET 10 SDK
- Node.js LTS and the Angular CLI (`npm i -g @angular/cli`)
- Docker Desktop or SQL Server LocalDB (needed from phase 1)

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
