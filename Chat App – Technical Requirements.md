# Chat App – Technical Requirements

Nov 15, 2026 · @Jan · Status: Draft v0.1

## 1. Architecture overview

A single ASP.NET Core application serves the Blazor front end, a small REST API and a SignalR hub. SignalR keeps a persistent connection (WebSockets, with automatic fallback to Server-Sent Events / long polling) between each browser and the server, which is what makes instant delivery and the typing indicator possible. Messages are persisted in a relational database before they are pushed to the recipient.

```
Browser A (Blazor WASM)            ASP.NET Core server                  Browser B (Blazor WASM)
  ├─ REST: history, users  ───►  Minimal API endpoints
  └─ SignalR connection    ◄──►  ChatHub ──► EF Core ──► PostgreSQL
                                     │
                                     └── Clients.User(B) ─────────────►  ReceiveMessage / UserTyping
                                                                         ├─ focused → render live
                                                                         └─ not focused → browser notification
```

## 2. Technology stack

| Layer | Choice | Why |
| --- | --- | --- |
| Runtime | .NET 10 (LTS, supported until Nov 2028), C# 14 | Long-term support; one language end to end |
| Web framework | ASP.NET Core 10 | Hosts API, hub and front end |
| Real-time | ASP.NET Core SignalR | Built-in real-time messaging, user targeting, auto-reconnect |
| Front end | Blazor Web App, Interactive WebAssembly render mode | UI written in C#/Razor; runs in the browser so it can react to focus/visibility events |
| UI components | MudBlazor (or Fluent UI Blazor) | Ready-made lists, inputs, badges, snackbars |
| Auth | ASP.NET Core Identity (cookie auth) | Registration, login, password hashing out of the box |
| Data access | Entity Framework Core 10 | Migrations, LINQ |
| Database | PostgreSQL 16+ (alternative: SQL Server / Azure SQL) | Free, robust, available as managed service |
| Browser APIs (via JS interop) | Notifications API, Page Visibility API, window focus/blur | Detect "focused on chat" and show OS-level notifications |
| Scale-out (later) | Redis backplane or Azure SignalR Service | Needed only with more than one server instance |
| Push when browser closed (phase 2) | Web Push (service worker + VAPID), e.g. the `WebPush` NuGet package | Notifications without an open tab |

## 3. Domain model

**User** (extends IdentityUser): `Id`, `DisplayName`, `Email`, `CreatedAt`, `LastSeenAt`

**Conversation**: `Id`, `UserAId`, `UserBId` (stored ordered so that `UserAId < UserBId`; unique index on the pair), `CreatedAt`, `LastMessageAt`

**Message**: `Id` (Guid), `ConversationId`, `SenderId`, `Body` (max 4,000), `ClientMessageId` (Guid, unique per sender – for idempotent retries), `SentAt` (UTC, server-assigned), `DeliveredAt?`, `ReadAt?`

Indexes: `(ConversationId, SentAt DESC)` for history paging; `(SenderId, ClientMessageId)` unique.

## 4. SignalR hub contract – `/hubs/chat`

The hub is protected with `[Authorize]`. The user identity comes from the auth cookie; SignalR's `Clients.User(userId)` reaches **all** open tabs/devices of that user.

**Client → server**

| Method | Parameters | Behaviour |
| --- | --- | --- |
| `SendMessage` | `recipientId, clientMessageId, body` | Validate (recipient exists, not self, length 1–4000). Save. Send `ReceiveMessage` to recipient and to the sender's other tabs. Return saved message (id, `SentAt`) as ack. Duplicate `clientMessageId` returns the existing message. |
| `Typing` | `recipientId` | Forward `UserTyping(senderId)` to recipient. Throttled on client (max once per 2–3 s). Not persisted. |
| `StopTyping` | `recipientId` | Forward `UserStoppedTyping(senderId)`. |
| `MarkRead` | `conversationId, upToMessageId` | Set `ReadAt`; notify sender with `MessagesRead`. |

**Server → client**

| Method | Payload |
| --- | --- |
| `ReceiveMessage` | `MessageDto { id, conversationId, senderId, senderName, body, sentAt }` |
| `UserTyping` / `UserStoppedTyping` | `senderId` |
| `MessagesRead` | `conversationId, upToMessageId, readAt` |
| `PresenceChanged` (optional) | `userId, isOnline` |

## 5. REST API

| Endpoint | Purpose |
| --- | --- |
| `POST /account/register`, `POST /account/login`, `POST /account/logout` | Identity endpoints |
| `GET /api/users?search=` | List of possible recipients (excluding self) with unread count and last message preview |
| `GET /api/conversations/with/{userId}/messages?before={timestamp}&limit=50` | Paged history, newest first |
| `GET /api/me/unread` | Unread counts per contact (for the badge after login/reconnect) |

## 6. Real-time behaviour rules

**Typing indicator**

- Sender: on input change, call `Typing` at most once every 2–3 s; call `StopTyping` on send, on clearing the input, or after 3 s without keystrokes.
- Recipient: show "\<name> is typing…" on `UserTyping`; hide on `UserStoppedTyping`, on `ReceiveMessage` from that user, or after a 5 s safety timeout (covers lost events / disconnected sender).

**Focus detection and notifications** – decided in the recipient's browser:

```
isFocused = document.visibilityState == "visible"
            && document.hasFocus()
            && activeConversationPartnerId == message.senderId
```

- `isFocused` true → append message to the open conversation, auto-scroll, call `MarkRead`.
- `isFocused` false → increase unread badge for that contact, update tab title (`(3) Chat`), optionally play a short sound, and show `new Notification(senderName, { body: preview, tag: conversationId })` if permission is granted. Clicking the notification focuses the window and opens the conversation.
- When the window regains focus on a conversation with unread messages → `MarkRead`.
- Ask for notification permission after a user action (e.g. a "Enable notifications" button), not on page load — browsers block or penalise unsolicited prompts.

**Connection reliability**

- Use `WithAutomaticReconnect()` on the client and show a "Reconnecting…" banner.
- After reconnect, fetch messages newer than the last one held locally (REST) to fill any gap.
- Sender shows the message immediately as "sending" (optimistic UI) and marks it "sent" on ack; on failure, retry with the same `clientMessageId` (server de-duplicates).

## 7. Security requirements

- HTTPS only; HSTS enabled.
- Hub and API require authentication; every hub call checks that the caller is a participant of the conversation.
- Never trust a sender id from the client — always use `Context.UserIdentifier`.
- Message text is rendered as text (Blazor encodes by default); never render it as raw HTML/`MarkupString`.
- Rate limiting (ASP.NET Core rate limiter): e.g. max 20 messages / 10 s per user; hub `MaximumReceiveMessageSize` kept small (e.g. 32 KB).
- Anti-forgery for cookie-auth form posts; secure, HttpOnly, SameSite cookies.
- Passwords: Identity defaults (PBKDF2 hashing), lockout after repeated failures.
- GDPR: data in an EU region, account + message deletion on request, no message content in logs.

## 8. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Latency | Message delivery to an online, connected recipient < 500 ms p95 (same region) |
| Capacity (MVP) | 500 concurrent connections on one instance |
| Availability | 99.5 % monthly for MVP |
| History load | First 50 messages of a conversation in < 300 ms |
| Browsers | Last 2 versions of Chrome, Edge, Firefox, Safari (desktop + mobile) |
| Accessibility | WCAG 2.1 AA basics; typing indicator and new messages announced via `aria-live` |
| Observability | Structured logs (Serilog or built-in), OpenTelemetry metrics/traces, health check endpoint `/health` |

## 9. Testing strategy

- **Unit tests** (xUnit): message validation, conversation pairing, typing-throttle logic.
- **Integration tests**: `WebApplicationFactory` + SignalR .NET client against a real PostgreSQL in Docker (Testcontainers) — send/receive, authorization, de-duplication.
- **Component tests**: bUnit for Blazor components (message list, typing indicator).
- **End-to-end**: Playwright for .NET with **two browser contexts** (user A and user B) — covers live delivery, typing indicator, and notification behaviour (Playwright can grant notification permission and switch tab focus).
- **Load test** (before go-live): k6 or NBomber to open 500 connections and measure delivery latency.

## 10. Deployment

- Containerised with the .NET SDK container support (`dotnet publish /t:PublishContainer`) or a Dockerfile.
- Hosting option A: Azure App Service (Linux) with **WebSockets enabled** + Azure Database for PostgreSQL, EU region. Add Azure SignalR Service when scaling beyond one instance.
- Hosting option B: any VPS / container host (e.g. Docker Compose with Nginx reverse proxy – remember to forward `Upgrade`/`Connection` headers for WebSockets).
- CI/CD: GitHub Actions — build, test, run EF migrations, deploy.
- With more than one server instance: sticky sessions (needed for non-WebSocket fallbacks) plus Redis backplane or Azure SignalR Service.

## 11. Recommended solution structure

```
ChatApp.sln
├─ src/ChatApp.Server        ASP.NET Core host: Identity, API endpoints, ChatHub, EF Core
├─ src/ChatApp.Client        Blazor WebAssembly UI, HubConnection service, JS interop for notifications/focus
├─ src/ChatApp.Shared        DTOs and hub interface contracts (shared by server and client)
├─ tests/ChatApp.UnitTests
├─ tests/ChatApp.IntegrationTests
└─ tests/ChatApp.E2ETests    Playwright
```

Use a strongly typed hub (`Hub<IChatClient>`) with the `IChatClient` interface in `ChatApp.Shared` so the server and client agree on method names at compile time.
