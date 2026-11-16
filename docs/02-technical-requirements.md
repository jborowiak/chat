# Chat App – Technical Requirements

Version 1.0 · 16 Nov 2026 · Status: Draft

## 1. Architecture overview

The system has three parts:

1. **Angular single-page app (SPA).** It runs in the browser. It can be served locally with `ng serve` or hosted on **Azure Static Web Apps**.
2. **ASP.NET Core backend (C#).** One app on **one Azure App Service instance**. It hosts a REST API (auth, contacts, history) and a **SignalR hub** (live messages, typing, unread sync).
3. **Azure SQL Database.** Stores users, conversations, messages and read positions.

```
┌──────────────────────────┐        HTTPS (REST)          ┌───────────────────────────────┐
│  Angular SPA             │ ───────────────────────────► │  ASP.NET Core (.NET 10)        │
│  (localhost:4200 or      │                              │  Azure App Service, 1 instance │
│   Azure Static Web Apps) │ ◄═════════════════════════►  │                                │
└──────────────────────────┘   WebSocket (SignalR)        │  /api/*        REST endpoints  │
        ▲    ▲                 /hubs/chat                 │  /hubs/chat    ChatHub         │
        │    │                                            │  EF Core 10                    │
  user A│    │user B                                      └──────────────┬────────────────┘
                                                                         │ TDS (EF Core)
                                                          ┌──────────────▼────────────────┐
                                                          │  Azure SQL Database            │
                                                          └───────────────────────────────┘
```

**Core principle: save first, then push.** Every message is written to the database before it is sent over SignalR. The database is the source of truth. SignalR is only the fast path for clients that are online. A client that was offline, or had another conversation open, reads the stored messages over REST when it needs them.

## 2. Technology stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Front end | **Angular 21+** (standalone components, signals, new control flow) | Simple, typed, no NgModules |
| UI styling | Plain SCSS with CSS custom properties (design tokens) | No component library. Keeps the bundle small and the look consistent (see [04-ui-design.md](04-ui-design.md)). |
| Real-time client | `@microsoft/signalr` (npm) | Automatic reconnect |
| Backend runtime | **.NET 10 (LTS)**, C# 14, ASP.NET Core 10 | Minimal APIs + SignalR |
| Real-time server | ASP.NET Core SignalR, strongly typed `Hub<IChatClient>` | One instance, so no backplane is needed |
| Authentication | ASP.NET Core Identity + **Identity API endpoints** (`MapIdentityApi<AppUser>()`, bearer tokens) | Built in. Fits an SPA on a different origin. |
| Data access | Entity Framework Core 10 (SQL Server provider) | Code-first migrations |
| Database (Azure) | **Azure SQL Database**, serverless General Purpose (or the free offer) | Managed. Auto-pauses when idle, so it costs little for a small app. |
| Database (local) | SQL Server 2022 Developer in Docker, or SQL Server LocalDB on Windows | Same provider as Azure |
| Hosting (API) | Azure App Service, Linux, **B1** plan, **WebSockets ON**, **Always On ON**, 1 instance | F1 (free) has no Always On and limits WebSockets, so it's not suitable |
| Hosting (UI) | Azure Static Web Apps, Free tier | Global CDN, free TLS |
| Monitoring | Application Insights (OpenTelemetry) | Logs, failures, latency |
| Tests | xUnit, `WebApplicationFactory`, Testcontainers (SQL Server); Angular: Vitest/Jasmine for unit tests, Playwright for E2E | |

### Why Azure SQL Database

- It's a relational model: users, conversations and messages are clearly related, and the unread count is a simple, indexed `COUNT`.
- First-class EF Core support. The same engine runs locally (Docker or LocalDB) and in Azure.
- Serverless tier or the free offer keeps cost close to zero at MVP scale.
- Alternatives considered:
  - **Azure Database for PostgreSQL Flexible Server:** equally good, slightly more setup on Windows.
  - **Cosmos DB:** overkill, and unread counting is awkward.

## 3. Data model

```
AspNetUsers (Identity)          Conversations                    ConversationMembers
─────────────────────           ─────────────────────            ─────────────────────────────
Id            nvarchar(450) PK  Id             int PK identity   ConversationId  int  PK, FK
Email         …                 PairKey        nvarchar(901) UQ  UserId          nvarchar(450) PK, FK
DisplayName   nvarchar(50)      CreatedAt      datetime2         LastReadMessageId bigint NULL
CreatedAt     datetime2         LastMessageAt  datetime2 NULL
                                                                 Messages
                                                                 ─────────────────────────────
                                                                 Id               bigint PK identity
                                                                 ConversationId   int FK
                                                                 SenderId         nvarchar(450) FK
                                                                 Body             nvarchar(2000)
                                                                 ClientMessageId  uniqueidentifier
                                                                 SentAt           datetime2 (UTC, server-set)
```

- **PairKey** is `"{smallerUserId}:{largerUserId}"`. A unique index on it guarantees exactly one conversation per pair of users (BR-01), and lets the server get-or-create the conversation in a single lookup.
- **Message.Id** is an increasing `bigint`, so it doubles as the sort order. "Unread" becomes a simple comparison against `LastReadMessageId`.
- **ConversationMembers.LastReadMessageId** stores the read position per user, per conversation (BR-09, BR-10). It is one row per member, not a flag on every message.
- **ClientMessageId** is a GUID created by the browser. With a unique index on `(SenderId, ClientMessageId)`, retries after a connection drop don't create duplicates.

**Indexes**

| Table | Index | Used by |
| --- | --- | --- |
| Messages | `(ConversationId, Id DESC)` | History paging, unread count |
| Messages | `UNIQUE (SenderId, ClientMessageId)` | Idempotent send |
| Conversations | `UNIQUE (PairKey)` | Get-or-create |
| ConversationMembers | `(UserId)` | "My conversations" + unread summary |

**Unread count for user U in conversation C:**

```sql
SELECT COUNT(*) FROM Messages m
WHERE m.ConversationId = @C
  AND m.SenderId <> @U
  AND m.Id > ISNULL(@LastReadMessageId, 0)
```

## 4. REST API

Base path: `/api`. Every endpoint except register/login needs `Authorization: Bearer <token>`.

| Method & path | Purpose | Response |
| --- | --- | --- |
| `POST /api/auth/register` | Identity: register (e-mail, password). A thin custom wrapper also sets `DisplayName`. | 200 / 400 validation errors |
| `POST /api/auth/login` | Identity: returns `accessToken`, `refreshToken`, `expiresIn` | token response |
| `POST /api/auth/refresh` | Identity: exchange a refresh token for a new access token | token response |
| `GET /api/me` | Current user profile | `{ id, displayName, email }` |
| `GET /api/contacts?search=` | All other users, with conversation summary | `ContactDto[]` (below) |
| `GET /api/conversations/{otherUserId}/messages?beforeId=&limit=50` | Message history, newest first, paged by `beforeId` | `MessageDto[]` |
| `GET /api/conversations/{otherUserId}/messages?afterId=` | Gap-fill after a reconnect | `MessageDto[]` |
| `GET /health` | Health probe for App Service | 200 |

```ts
ContactDto  { userId, displayName, conversationId | null, lastMessagePreview | null,
              lastMessageAt | null, unreadCount, isOnline }
MessageDto  { id, conversationId, senderId, body, sentAt, clientMessageId }
```

Contacts are sorted by `lastMessageAt` descending, then by `displayName`.

## 5. SignalR hub contract: `/hubs/chat`

- `[Authorize]`. The user id always comes from `Context.UserIdentifier`, never from client input.
- `Clients.User(id)` reaches **all** open tabs and devices of that user.
- Strongly typed: `ChatHub : Hub<IChatClient>`.

### Client → server

| Method | Arguments | Server behaviour |
| --- | --- | --- |
| `SendMessage` | `recipientId: string, clientMessageId: Guid, body: string` | 1) Validate: recipient exists and isn't the caller; trimmed length is 1–2,000. 2) Get or create the conversation and its 2 member rows. 3) If `(sender, clientMessageId)` already exists, return the existing message. 4) Insert the message, update `LastMessageAt`, and move the **sender's** `LastReadMessageId` to this message. 5) Push `ReceiveMessage(dto)` to `Clients.User(recipientId)` and `Clients.User(senderId)` (the sender's other tabs). 6) Return `MessageDto` as the acknowledgement. |
| `Typing` | `recipientId: string` | Forward `UserTyping(senderId)` to the recipient. Not stored. |
| `StopTyping` | `recipientId: string` | Forward `UserStoppedTyping(senderId)` to the recipient. |
| `MarkRead` | `conversationId: int, lastReadMessageId: long` | Check that the caller is a member. Set `LastReadMessageId = max(current, value)`. Push `ConversationRead(conversationId, lastReadMessageId)` to `Clients.User(caller)` so the badges in the caller's other tabs clear (BR-10). |

### Server → client (`IChatClient`)

| Method | Payload | Client reaction |
| --- | --- | --- |
| `ReceiveMessage` | `MessageDto` | See section 6 |
| `UserTyping` | `userId` | Show the dots for that contact and (re)start a 5 s safety timer |
| `UserStoppedTyping` | `userId` | Hide the dots |
| `ConversationRead` | `conversationId, lastReadMessageId` | Set the unread count for that conversation to 0 |
| `PresenceChanged` *(Could)* | `userId, isOnline` | Update the online dot |

Presence is tracked in memory with a `ConcurrentDictionary<userId, connectionCount>` in `OnConnectedAsync` and `OnDisconnectedAsync`. This is valid only because there is one server (section 10).

## 6. Client-side real-time logic

The client keeps one `ChatStateService` built on Angular signals:

```
contacts          = signal<ContactDto[]>
activeContactId   = signal<string | null>      // which conversation is open
messages          = signal<Map<conversationId, MessageDto[]>>
typing            = signal<Set<userId>>
totalUnread       = computed(() => sum of contacts[].unreadCount)   // drives the tab title "(3) Chat"
```

### On `ReceiveMessage(msg)`

```
isMine   = msg.senderId == me.id
otherId  = isMine ? (contact of msg.conversationId) : msg.senderId
isOpen   = activeContactId() == otherId

update that contact's lastMessagePreview / lastMessageAt, move it to the top
if msg.clientMessageId matches a pending (optimistic) message → replace it, done
if isOpen → append to the message list, auto-scroll if the user is near the bottom
if !isMine:
    hide typing dots for otherId
    if isOpen && document.visibilityState == 'visible'
        → call MarkRead(msg.conversationId, msg.id)          // BR-06
    else
        → contact.unreadCount += 1                            // BR-08, BR-11
```

### On opening a conversation

1. Set `activeContactId`.
2. Load the last 50 messages over REST, or reuse the cache and gap-fill with `afterId`.
3. Call `MarkRead` with the newest message id. Set the contact's `unreadCount` to 0 straight away (optimistic).

### On `visibilitychange` → visible

If the open conversation has unread messages, call `MarkRead`.

### Typing indicator

**Sender:**
- On input, call `Typing(recipientId)` no more than once every **2 s**.
- Call `StopTyping` after **3 s** without keystrokes, when the input is cleared, on send, or when switching conversations.

**Recipient:**
- Show the dots on `UserTyping`.
- Hide them on `UserStoppedTyping`, on a `ReceiveMessage` from that user, or after a **5 s** safety timeout. The timeout covers lost events, for example when the sender disconnects.

### Sending (optimistic UI)

1. Create a `clientMessageId` (`crypto.randomUUID()`) and add the message immediately in a "sending" state (faded).
2. Call `SendMessage`. On acknowledgement, replace the pending message with the saved one.
3. On error or timeout (10 s), show a "Retry" link. Retrying reuses the same `clientMessageId`, and the server de-duplicates it.

### Connection lifecycle

- `withAutomaticReconnect([0, 2000, 5000, 10000, 30000])`.
- While reconnecting, show a thin "Reconnecting…" banner and disable sending.
- After `onreconnected`, refetch `GET /api/contacts` to resync unread counts. If a conversation is open, also gap-fill it with `afterId = lastKnownId`.
- On login, start the connection. On logout, stop it.
- Access token: `accessTokenFactory: () => auth.getValidAccessToken()`. This refreshes the token if it's about to expire.

## 7. Authentication details

- Identity API endpoints issue opaque bearer tokens: access token about 1 h, refresh token 14 days.
- The SPA keeps the tokens in `localStorage`. This is acceptable for the MVP, and the risk is reduced by Angular's default output encoding and a Content Security Policy.
- An HTTP interceptor adds `Authorization: Bearer …` to `/api` calls. On a 401 it tries one refresh, and if that fails it redirects to login.
- **SignalR auth:** browsers can't send headers on WebSocket requests, so the token is sent as the `access_token` query parameter. On the server, configure `BearerTokenOptions.Events.OnMessageReceived` to read `access_token` from the query string when the path starts with `/hubs/chat`.
- `DisplayName` is required, 2–50 characters, and stored as a custom property on `AppUser : IdentityUser`.

## 8. Security requirements

- HTTPS only, with HSTS on the API.
- **CORS:** allow only the configured SPA origins, for example `http://localhost:4200` and `https://<app>.azurestaticapps.net`. Use `AllowAnyHeader`, `AllowAnyMethod` and `AllowCredentials`, which the SignalR negotiate request needs.
- Every hub method and history endpoint checks that the caller is a member of the conversation (BR-02).
- Message bodies are rendered with Angular text interpolation (`{{ }}`), never with `[innerHTML]`.
- Rate limiting: max 30 hub messages per 10 s per user, enforced in the hub with a simple per-user token bucket. Max hub message size is 32 KB.
- Password policy: Identity defaults (minimum 8 characters, mixed). Lockout after 5 failed logins.
- Logs never contain message bodies or tokens.
- Secrets (SQL connection string) live in App Service configuration (or Key Vault later), never in the repository. Locally, use `dotnet user-secrets`.

## 9. Non-functional requirements

| Area | Target |
| --- | --- |
| Delivery latency (online recipient, same region) | < 500 ms p95 |
| Concurrency (MVP) | 200 simultaneous connections on one B1 instance |
| Initial load | Contacts + first 50 messages in < 1 s |
| Availability | Best effort for the MVP (single instance, about 99.5 %) |
| Browsers | Last 2 versions of Chrome, Edge, Firefox, Safari (desktop + mobile) |
| Accessibility | Keyboard usable. The message list is `aria-live="polite"`. The typing indicator has screen-reader text ("Anna is typing"). Contrast meets WCAG AA. |
| Region | West Europe or North Europe (data stays in the EU) |

## 10. Hosting and environments

| Environment | UI | API | Database |
| --- | --- | --- | --- |
| **Local** | `ng serve` → `http://localhost:4200` | `dotnet run` → `https://localhost:7100` | SQL Server in Docker or LocalDB |
| **Local UI + Azure API** | `ng serve` with `environment.azure.ts` | Azure App Service | Azure SQL |
| **Azure** | Azure Static Web Apps | Azure App Service (Linux B1) | Azure SQL Database |

The API base URL is set per Angular environment file (`environment.ts`, `environment.prod.ts`). The API's allowed CORS origins are set in `appsettings` / App Service configuration (`Cors:AllowedOrigins`).

**App Service settings that matter for SignalR:**

- **WebSockets: On.**
- **Always On: On.** This avoids cold starts that drop connections.
- **ARR affinity:** can stay on. It isn't strictly needed with 1 instance and WebSockets.
- **Instance count: 1.**

**Single-server constraint.** The in-memory presence map and SignalR's in-process connection registry only work with one instance. Scaling out later needs **Azure SignalR Service** (the preferred option, which mostly takes a NuGet package and a connection string) and moving presence to Redis or the database.

## 11. Repository structure

```
/docs                      Business, technical, plan, UI design
/backend
  ChatApp.slnx
  src/ChatApp.Api          Program.cs, Endpoints/, Hubs/ChatHub.cs, Data/ (DbContext, Entities, Migrations), Services/
  tests/ChatApp.Api.Tests  Unit + integration tests (WebApplicationFactory, SignalR .NET client)
/frontend
  chat-app/                Angular workspace
    src/app/core           auth.service, auth.interceptor, auth.guard, chat-hub.service, chat-state.service, api clients
    src/app/features/auth  login, register pages
    src/app/features/chat  chat-shell, contact-list, contact-item, conversation, message-bubble, composer, typing-indicator
    src/styles             tokens.scss, base.scss
/.github/workflows         api.yml (build, test, deploy App Service), web.yml (Static Web Apps)
/infra (optional)          main.bicep – App Service plan, App Service, SQL server + DB, Static Web App, App Insights
```

## 12. Testing strategy

- **Backend unit tests:** message validation, PairKey building, unread calculation, idempotent send.
- **Backend integration tests:** `WebApplicationFactory` with SQL Server via Testcontainers. Two SignalR .NET clients (users A and B) check that A sends → B gets `ReceiveMessage`; that `Typing` is forwarded; that a non-member can't read a conversation; that a duplicate `clientMessageId` doesn't create a second row; and that the unread count is correct after `MarkRead`.
- **Angular unit tests:** `ChatStateService` (unread logic for open/closed/hidden cases) and the typing throttle and timeouts (with fake timers).
- **E2E (Playwright):** two browser contexts (A and B) run the acceptance scenarios from the business requirements: live message, typing dots, badge count of 3, history after reload.
