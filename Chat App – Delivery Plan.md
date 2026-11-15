# Chat App – Delivery Plan

Nov 15, 2026 · @Jan · Status: Draft v0.1

Assumes one developer working full time with intermediate C# experience. Estimates are in working days; total MVP ≈ **5 weeks**. Each phase ends with something you can demo.

## Phase overview

| # | Phase | Est. | Demo at the end |
| --- | --- | --- | --- |
| 0 | Setup & skeleton | 2 d | Empty app builds, runs, deploys from CI |
| 1 | Accounts & user list | 3 d | Register, log in, see other users |
| 2 | Messaging with persistence (no real-time yet) | 4 d | Send a message, see it after refresh |
| 3 | Real-time delivery with SignalR | 4 d | Two browsers – message appears instantly |
| 4 | Typing indicator | 2 d | "Anna is typing…" |
| 5 | Focus detection & notifications | 4 d | Browser notification when in another tab; unread badges |
| 6 | Read receipts & presence (optional) | 2 d | ✓✓ read, online dot |
| 7 | Hardening, tests, deployment | 5 d | Production-ready MVP |

## Phase 0 – Setup & skeleton (2 d)

- Install .NET 10 SDK, IDE, Docker, Git.
- `dotnet new blazor --interactivity WebAssembly --auth Individual` → gives Server + Client projects with Identity scaffolded; add `ChatApp.Shared` and test projects.
- PostgreSQL in Docker (`docker compose`), switch EF provider to Npgsql.
- GitHub repo, GitHub Actions: build + test on every push.
- **Done when:** app runs locally against Postgres and the pipeline is green.

## Phase 1 – Accounts & user list (3 d)

- Add `DisplayName` to the user; registration/login pages (from the template, restyled).
- `GET /api/users` + recipient list page with search.
- **Done when:** two accounts can log in and see each other in the list (US-01, US-02).

## Phase 2 – Messaging with persistence (4 d)

- Entities `Conversation`, `Message`; EF migration; indexes.
- Service layer: get-or-create conversation, save message, paged history.
- Conversation page: message list + input; history endpoint with "load older" paging.
- Validation rules BR-01…BR-04; unit tests.
- **Done when:** a sent message is stored and visible after reload (US-03, US-07).

## Phase 3 – Real-time delivery (4 d)

- `ChatHub : Hub<IChatClient>` with `[Authorize]`, `SendMessage` using `Clients.User(...)`.
- Client `ChatConnectionService` (singleton in WASM) wrapping `HubConnection`, with `WithAutomaticReconnect` and a reconnect banner.
- Optimistic "sending…" state, ack, retry with `clientMessageId`; gap-fill after reconnect.
- Integration test: two SignalR clients exchange a message.
- **Done when:** two browsers on different machines see messages instantly (US-04).

## Phase 4 – Typing indicator (2 d)

- `Typing` / `StopTyping` hub methods; client-side throttle and 5 s safety timeout.
- Indicator component with `aria-live`.
- **Done when:** BR-05 timings are met in manual and E2E tests (US-05).

## Phase 5 – Focus detection & notifications (4 d)

- Small JS module (`chatInterop.js`): visibility/focus listeners → callback to .NET via `DotNetObjectReference`; `requestPermission()`; `showNotification()`; notification click → focus window + navigate.
- Client logic for BR-06: focused → render + `MarkRead`; not focused → unread badge, tab title counter, sound, notification.
- "Enable notifications" button + settings toggle for message previews (BR-08).
- Unread counts on login (`GET /api/me/unread`).
- **Done when:** acceptance scenario 4 passes in Chrome, Firefox, Edge and Safari (US-06, US-08).

## Phase 6 – Read receipts & presence (optional, 2 d)

- `MarkRead` → `MessagesRead` to sender; ✓ / ✓✓ in UI.
- Presence: track connections per user in `OnConnectedAsync`/`OnDisconnectedAsync` (in-memory for one instance; Redis when scaled).
- **Done when:** US-09, US-10.

## Phase 7 – Hardening & go-live (5 d)

- Security pass: participant checks on every hub call, rate limiting, message size limits, cookie settings, HTTPS/HSTS.
- Playwright E2E suite with two browser contexts; bUnit component tests.
- Load test with k6/NBomber (500 connections, p95 < 500 ms).
- Logging, OpenTelemetry, `/health`; GDPR basics (privacy notice, account deletion).
- Deploy: Azure App Service (WebSockets ON) + Azure Database for PostgreSQL in an EU region, or a container host behind Nginx.
- **Done when:** all acceptance criteria from the business requirements pass on the production URL.

## Phase 2+ ideas (after MVP)

- Web Push via service worker – notifications when the browser tab is closed.
- Scale-out with Azure SignalR Service or Redis backplane.
- Attachments (Blob storage), message edit/delete, group chats, emoji reactions.
- PWA install for a mobile-app-like experience.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Browser notification permission denied or blocked | Users miss messages | In-app unread badges + tab title counter always work; ask for permission only after a click; explain why |
| Safari / iOS notification differences | Inconsistent behaviour | Test early (Phase 5); on iOS web notifications require the site to be installed as a PWA – document as a known limitation or add PWA in phase 2 |
| WebSockets blocked by proxy / hosting misconfig | Slower fallback transports, sticky-session issues | Enable WebSockets on host; configure reverse proxy headers; test in staging |
| Lost messages during reconnect | Data gaps | Persist before push, idempotent `clientMessageId`, gap-fill fetch after reconnect |
| Scope creep (groups, files) | Delay | Keep the out-of-scope list; handle via phase 2 backlog |

## Definition of done (every feature)

- Code reviewed (or self-reviewed against a checklist) and merged via pull request
- Unit/integration tests added and passing in CI
- Works in the two-browser manual test
- No new warnings; no message content in logs
