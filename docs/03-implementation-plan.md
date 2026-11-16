# Chat App – Implementation Plan

Version 1.1 · 16 Nov 2026 · Status: Draft

The plan assumes one developer. Estimates are in working days, about **4 weeks** in total. Each phase ends with something you can demo, and each one builds on the previous one.

## Progress

**Overall: 2 / 11 phases done** · Last updated: 16 Nov 2026

Status legend: ⬜ Not started · 🟡 In progress · ✅ Done · ⏸️ Blocked / postponed

To update: tick the task checkboxes (`- [x]`) inside each phase. When all of a phase's tasks and its "Done when" check are ticked, set the phase to ✅ in the table below and update the overall count.

| # | Phase | Est. | Status | Demo at the end |
| --- | --- | --- | --- | --- |
| 0 | Repo and project skeletons | 1 d | ✅ Done | API and Angular app both run locally |
| 1 | Database and data model | 1.5 d | ✅ Done | Migrations create the schema locally |
| 2 | Authentication | 2 d | ⬜ Not started | Register, log in, log out from the Angular UI |
| 3 | Contacts and history (REST only) | 2 d | ⬜ Not started | Contact list; a conversation shows stored messages |
| 4 | UI layout and styling | 2 d | ⬜ Not started | Final look: sidebar, bubbles, composer, mobile view |
| 5 | SignalR: live messaging | 3 d | ⬜ Not started | Two browsers, messages appear instantly |
| 6 | Typing indicator | 1 d | ⬜ Not started | Animated dots while the other person types |
| 7 | Unread badges and read state | 2 d | ⬜ Not started | Badge shows 3, clears on open, syncs across tabs |
| 8 | Azure deployment | 2 d | ⬜ Not started | Same demo on the Azure URLs |
| 9 | Hardening and tests | 2.5 d | ⬜ Not started | E2E suite green, security checklist done |
| 10 | *(Could)* Online presence | 0.5 d | ⬜ Not started | Green online dot |

## Phase 0 – Repo and project skeletons (1 d) · ✅ Done

- [x] Install the .NET 10 SDK, Node.js LTS, Angular CLI (`npm i -g @angular/cli`), and Docker Desktop (or SQL Server LocalDB).
- [x] Backend: `dotnet new sln -n ChatApp`, `dotnet new web -n ChatApp.Api -o src/ChatApp.Api`, `dotnet new xunit -n ChatApp.Api.Tests -o tests/ChatApp.Api.Tests`.
- [x] Frontend: `ng new chat-app --style=scss --routing --ssr=false`.
- [x] Add `GET /health` and enable CORS for `http://localhost:4200`.
- [x] Add a `.gitignore` for .NET and Node, plus a short `README.md` that explains how to run locally.
- [x] **Done when:** `dotnet run` and `ng serve` both start, and the Angular app can call `/health`.

## Phase 1 – Database and data model (1.5 d) · ✅ Done

- [x] Start SQL Server locally: SQL Server 2022 in Docker via `docker-compose.yml` (`docker compose up -d`); the password is in the git-ignored `.env`.
- [x] Add packages: `Microsoft.EntityFrameworkCore.SqlServer`, `Microsoft.AspNetCore.Identity.EntityFrameworkCore`, `Microsoft.EntityFrameworkCore.Design`.
- [x] Create the entities `AppUser` (with `DisplayName`), `Conversation`, `ConversationMember` and `Message`, plus the indexes from technical requirements section 3.
- [x] `ChatDbContext : IdentityDbContext<AppUser>`. Store the connection string in user-secrets.
- [x] `dotnet ef migrations add Initial` and `dotnet ef database update`.
- [x] **Done when:** the tables and indexes exist in the local database.

## Phase 2 – Authentication (2 d) · ⬜ Not started

- [ ] Backend: `AddIdentityApiEndpoints<AppUser>()` and `MapGroup("/api/auth").MapIdentityApi<AppUser>()`.
- [ ] Backend: a custom register endpoint, or a post-register step, that sets `DisplayName`.
- [ ] Backend: `GET /api/me`.
- [ ] Backend: read the hub token from the query string (technical requirements section 7).
- [ ] Frontend: `AuthService` with signals for the current user and tokens, stored in `localStorage`.
- [ ] Frontend: `authInterceptor` that adds the bearer token and refreshes once on a 401.
- [ ] Frontend: `authGuard`, plus login and register pages.
- [ ] **Done when:** a user can register, log in, reload and stay logged in, and log out (US-01, US-02).

## Phase 3 – Contacts and history over REST (2 d) · ⬜ Not started

- [ ] `GET /api/contacts?search=`, including `unreadCount`, `lastMessagePreview` and `lastMessageAt`.
- [ ] `GET /api/conversations/{otherUserId}/messages` with `beforeId` / `afterId` paging and a membership check.
- [ ] A temporary `POST` to send a message. It is removed in phase 5 and only lets you test history before SignalR exists.
- [ ] Angular: `ChatStateService`, a contacts list, and a conversation view (plain markup is fine at this stage).
- [ ] Angular: load older messages when the user scrolls to the top.
- [ ] Backend unit tests: validation, PairKey, unread count.
- [ ] **Done when:** messages stored in the database show up in the right conversation, in order (US-03, US-07, US-11).

## Phase 4 – UI layout and styling (2 d) · ⬜ Not started

- [ ] Design tokens and base styles from [04-ui-design.md](04-ui-design.md).
- [ ] Two-pane layout, plus contact items with avatar initials and badges.
- [ ] Message bubbles with grouping and day separators.
- [ ] Auto-growing composer and empty states.
- [ ] Responsive behaviour: below 768 px, show only one pane at a time, with a back button in the conversation header.
- [ ] **Done when:** the UI matches the design on desktop and on a phone-width screen.

## Phase 5 – SignalR live messaging (3 d) · ⬜ Not started

- [ ] Backend: `AddSignalR()` and `MapHub<ChatHub>("/hubs/chat")`, with `ChatHub : Hub<IChatClient>` and `[Authorize]`.
- [ ] Backend: `SendMessage` follows the order: validate → save → push to recipient and sender → return the acknowledgement.
- [ ] Backend: idempotency via `ClientMessageId`.
- [ ] Backend: remove the temporary POST.
- [ ] Frontend: `ChatHubService` wraps `HubConnection`, with `withAutomaticReconnect`, `accessTokenFactory`, and start/stop tied to login and logout.
- [ ] Frontend: optimistic sending with "sending", "sent" and "failed + Retry" states.
- [ ] Frontend: a "Reconnecting…" banner, and contacts resync plus gap-fill after a reconnect.
- [ ] Integration test: two SignalR clients exchange a message, and a duplicate send is ignored.
- [ ] **Done when:** in two browsers (for example Chrome and Edge in private mode, logged in as A and B), messages appear instantly on both sides (US-04, US-05).

## Phase 6 – Typing indicator (1 d) · ⬜ Not started

- [ ] Hub methods `Typing` and `StopTyping`, and client events `UserTyping` and `UserStoppedTyping`.
- [ ] Composer: throttle `Typing` to once every 2 s, and send `StopTyping` after 3 s idle, on send, on clear, or on conversation switch.
- [ ] `TypingIndicatorComponent`: three animated dots inside a bubble, with a 5 s safety timeout and screen-reader text.
- [ ] A small "typing…" label in the contact list row.
- [ ] Angular unit test with fake timers.
- [ ] **Done when:** BR-07 timings are met (US-06).

## Phase 7 – Unread badges and read state (2 d) · ⬜ Not started

- [ ] Hub `MarkRead` and client event `ConversationRead`.
- [ ] Client logic from technical requirements section 6:
  - [ ] Live message in the open, visible conversation → `MarkRead`.
  - [ ] Otherwise → `unreadCount + 1`.
  - [ ] On opening a conversation → `MarkRead` and set the count to 0.
  - [ ] On `visibilitychange` back to visible → `MarkRead`.
- [ ] Badge component (hidden at 0, "99+" above 99).
- [ ] Tab title shows `(N) Chat`, driven by the computed `totalUnread`.
- [ ] Integration test: B sends 3 → A's unread count is 3 → A calls `MarkRead` → 0, and A's second connection receives `ConversationRead`.
- [ ] **Done when:** acceptance scenario 4 passes, both live and after logging in again (US-08, US-10, BR-08 to BR-11).

## Phase 8 – Azure deployment (2 d) · ⬜ Not started

- [ ] Resource group in **West Europe** (or North Europe).
- [ ] **Azure SQL:** logical server plus database (serverless General Purpose with auto-pause, or the free offer). Firewall: "Allow Azure services", plus your own IP for running migrations.
- [ ] **App Service:** Linux, .NET 10, **B1** plan, 1 instance.
- [ ] App Service configuration:
  - **WebSockets On**, **Always On On**, HTTPS only.
  - Connection string `ChatDb`.
  - `Cors__AllowedOrigins__0 = https://<swa>.azurestaticapps.net`, and optionally `Cors__AllowedOrigins__1 = http://localhost:4200` so the local UI can use the Azure API.
  - Health check path `/health`.
- [ ] **Application Insights**, connected to App Service.
- [ ] **Static Web App** (Free) for the Angular build output. Set `apiBaseUrl` in `environment.prod.ts`, and add `staticwebapp.config.json` with a navigation fallback to `index.html` for deep links.
- [ ] Migrations: create an idempotent SQL script with `dotnet ef migrations script --idempotent` and run it from the pipeline, or run `dotnet ef database update` manually for the MVP.
- [ ] *(Optional)* GitHub Actions: `api.yml` (build → test → `azure/webapps-deploy`) and `web.yml` (the Static Web Apps deploy action).
- [ ] *(Optional)* Describe all of the above in `infra/main.bicep`.
- [ ] **Done when:** acceptance scenarios 1–5 pass on the Azure URLs, and the local UI works against the Azure API (scenario 6).

## Phase 9 – Hardening and tests (2.5 d) · ⬜ Not started

- [ ] Security checklist (technical requirements section 8): membership checks, rate limit, max message size, CORS restricted, no message bodies in logs, lockout enabled.
- [ ] Playwright E2E with two browser contexts covering the acceptance scenarios.
- [ ] A quick load test: k6, or a small console app with 200 SignalR clients, checking that p95 delivery is under 500 ms.
- [ ] Accessibility pass: keyboard navigation, focus states, `aria-live`, contrast.
- [ ] **Done when:** all tests are green in CI and the checklist is complete.

## Phase 10 – Online presence *(Could, 0.5 d)* · ⬜ Not started

- [ ] In-memory connection counter in `OnConnectedAsync` and `OnDisconnectedAsync`.
- [ ] Broadcast `PresenceChanged` to everyone, include `isOnline` in `ContactDto`, and show a green dot on the avatar.
- [ ] **Done when:** US-12 works.

## Estimated Azure cost (MVP)

| Resource | Tier | ~Monthly |
| --- | --- | --- |
| App Service plan | Linux B1 | ~€12 |
| Azure SQL Database | Serverless GP with auto-pause, or the free offer | €0–5 |
| Static Web Apps | Free | €0 |
| Application Insights | Pay-as-you-go, low volume | ~€0–2 |
| **Total** | | **≈ €12–20** |

Prices are indicative. Check them in the Azure pricing calculator.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| WebSockets disabled on App Service | SignalR falls back to slower long polling | Turn on WebSockets in phase 8 and check the transport in browser dev tools |
| CORS or credentials misconfigured | Negotiate fails, so there are no live messages | Configure exact origins plus `AllowCredentials` and test local UI → Azure API early |
| Azure SQL auto-pause | The first request after idle takes about 30–60 s | Accept this for the MVP, or set a longer auto-pause delay or use provisioned compute |
| App restart drops connections | Users briefly disconnected | Auto-reconnect, resync on reconnect, and the database as source of truth (no data loss) |
| Duplicate or lost messages during reconnect | Wrong history | Save before push, `ClientMessageId` idempotency, gap-fill with `afterId` |
| Scaling past one server later | In-memory presence and connections break | Add Azure SignalR Service and move presence to Redis or the database (post-MVP) |

## Definition of done (every phase)

- The code builds without warnings, and new logic has tests.
- Manual two-browser check of the phase demo.
- No secrets in the repository, and no message bodies in logs.
- Docs updated if a contract changed (hub methods, DTOs, schema).

## After the MVP

- Read receipts ("Seen" under the last message).
- Message edit and delete, emoji reactions, attachments (Azure Blob Storage).
- Group conversations (the `ConversationMembers` table already supports more than 2 members).
- Dark theme (the tokens are already in place).
- Scale-out with Azure SignalR Service.
