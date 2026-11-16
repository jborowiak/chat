# Chat App – Business Requirements

Version 1.0 · 16 Nov 2026 · Status: Draft

## 1. Purpose

Build a simple web chat that lets registered users have private, one-to-one text conversations. The chat should feel live: messages show up right away, you can see when the other person is typing, and messages sent while you were away are waiting for you, with a clear count of how many are new.

## 2. Scope

### In scope (MVP)

- Registration, login, logout
- A contact list that shows every other registered user
- One-to-one text conversations
- Instant delivery when the recipient has the conversation open
- A typing indicator (three animated dots)
- Messages kept while the recipient is away or offline, shown when they open the conversation
- An unread badge with the number of new messages per contact, plus a total in the browser tab title
- Message history that survives a page reload or a new login

### Out of scope (MVP), possible later

- Group chats
- Attachments (images, files, voice)
- Editing or deleting messages
- Read receipts ("seen") shown to the sender
- Push notifications when the browser is closed
- Native mobile apps
- End-to-end encryption
- More than one backend server (scale-out)

## 3. Users

| Role | Description |
| --- | --- |
| Chat user | A registered person. Every user can both send and receive messages. |
| Product owner | Decides on scope and priorities and accepts features. |

There is no administrator role in the MVP.

## 4. User stories

| ID | As a… | I want to… | So that… | Priority |
| --- | --- | --- | --- | --- |
| US-01 | visitor | register with e-mail, display name and password | I can use the chat | Must |
| US-02 | user | log in and log out | my conversations stay private | Must |
| US-03 | user | see a list of other users, with a search box | I can pick who to talk to | Must |
| US-04 | user | open a conversation and send a text message | the other person gets it | Must |
| US-05 | user with a conversation open | see the other person's new messages appear right away, without refreshing | the conversation feels live | Must |
| US-06 | user with a conversation open | see animated dots while the other person is typing | I know a reply is coming | Must |
| US-07 | user who didn't have the conversation open | see the messages I missed as soon as I open it | I don't lose anything | Must |
| US-08 | user | see a badge with the number of new messages next to each contact | I know who wrote to me and how much | Must |
| US-09 | user | see the latest message preview and time in the contact list | I can judge what's urgent | Should |
| US-10 | user | see the total number of unread messages in the browser tab title | I notice new messages while working in another tab | Should |
| US-11 | user | scroll up to load older messages | I can read the whole history | Should |
| US-12 | user | see whether a contact is online (green dot) | I know if a quick reply is likely | Could |

## 5. Business rules

- **BR-01** A conversation always has exactly two participants. Users can't message themselves.
- **BR-02** Only the two participants can read a conversation.
- **BR-03** A message is plain text, 1–2,000 characters. Messages that are empty or only whitespace are rejected.
- **BR-04** Messages are shown oldest to newest, each with its send time. The server's clock sets the order and the time.
- **BR-05** A conversation is created automatically when the first message between two users is sent.
- **BR-06 Live delivery.** If the recipient has the conversation with the sender open, a new message appears within about 1 second and counts as read at once, so no badge appears for it.
- **BR-07 Typing indicator.** The dots appear within about 1 second after the other person starts typing. They disappear when the message arrives, when the person clears the input, or at the latest 5 seconds after their last keystroke.
- **BR-08 Messages while away.** If the recipient doesn't have that conversation open (another conversation is open, the app is closed, or they are offline), the message is stored and the unread counter for that contact goes up.
- **BR-09 Unread badge.** Each contact in the list shows the number of unread messages from that contact. The badge is hidden when the count is 0 and shows "99+" above 99. Opening the conversation marks all its messages as read and clears the badge.
- **BR-10 Unread state is per user, not per device.** If the same user has two tabs open and reads a conversation in one of them, the badge clears in the other one too.
- **BR-11** If the app is open but its browser tab is hidden or minimised, a message in the open conversation is shown but counts as unread until the user comes back to the tab.

## 6. Quality expectations (business level)

- An online recipient sees a message in under 1 second under normal conditions.
- No message is lost, even when a connection drops for a moment.
- Works in the current versions of Chrome, Edge, Firefox and Safari, on desktop and mobile.
- Personal data stays in an EU Azure region. A user can ask for their account and messages to be deleted.

## 7. Acceptance criteria (MVP)

The MVP is accepted when two people, on two different computers, can:

1. Register, log in and find each other in the contact list.
2. With the conversation open on both sides, exchange messages that appear instantly.
3. See the typing dots while the other person types, and see them disappear after a message is sent or the person stops typing.
4. With user A on a different conversation or logged out, user B sends 3 messages. A sees a badge with **3** next to B, either live or after logging in. When A opens the conversation, all 3 messages are there and the badge disappears.
5. Reload the page and still see the full history.
6. Use the app both locally (developer machine) and from the Azure-hosted URL.

## 8. Assumptions

- Anyone with the link can register. There is no invite system in the MVP.
- Expected size: up to a few hundred registered users, under 100 online at once. One backend server is enough.
- Messages are kept for as long as the account exists.

## 9. Open questions

- Should registration be restricted later, for example to invite-only or a single e-mail domain?
- Is a retention limit needed, for example deleting messages older than N months?
- Are browser (OS-level) notifications wanted in a later phase?
