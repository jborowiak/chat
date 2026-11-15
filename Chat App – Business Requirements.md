# Chat App – Business Requirements

Nov 15, 2026 · @Jan · Status: Draft v0.1

## 1. Purpose

Build a web application that lets two registered people hold a private, real-time text conversation. The product must feel "live": messages appear instantly, the recipient can see when the other person is typing, and nobody misses a message just because they are in another browser tab.

## 2. Scope

**In scope (MVP)**

- One-to-one (two-person) text conversations
- Choosing a recipient from a list of users
- Writing and sending messages
- Real-time delivery when the recipient has the chat open and focused
- A "typing…" indicator
- Notifications when the recipient is not focused on the chat
- Message history that survives page reloads

**Out of scope (MVP)** – may be considered later

- Group chats (3+ people)
- File, image and voice attachments
- Editing and deleting sent messages
- Native mobile apps
- End-to-end encryption
- Push notifications when the browser is fully closed (planned for phase 2)

## 3. Users and stakeholders

| Role | Description |
| --- | --- |
| Chat user | A registered person who sends and receives messages. Every user is both a sender and a recipient. |
| Product owner | Decides on scope and priorities, accepts features. |
| Administrator (optional) | Can deactivate accounts that abuse the service. |

## 4. User stories

| ID | As a… | I want to… | So that… | Priority |
| --- | --- | --- | --- | --- |
| US-01 | user | register and log in | my conversations are private to me | Must |
| US-02 | user | see a list of other users and pick one | I can start or continue a conversation with them | Must |
| US-03 | user | type and send a message | the other person receives it | Must |
| US-04 | recipient with the chat open | see a new message appear immediately, without refreshing | the conversation feels live | Must |
| US-05 | recipient | see that the other person is typing | I know a reply is coming | Must |
| US-06 | recipient not looking at the chat (other tab, other window, other conversation) | get a notification about a new message | I don't miss it | Must |
| US-07 | user | see earlier messages when I reopen a conversation | I keep the context | Must |
| US-08 | user | see how many unread messages I have per contact | I know who is waiting for me | Should |
| US-09 | sender | see whether my message was delivered / read | I know it reached the person | Could |
| US-10 | user | see whether a contact is online | I know if I can expect a quick reply | Could |

## 5. Business rules

- **BR-01** A conversation always has exactly two participants. Messaging yourself is not allowed.
- **BR-02** Only the two participants can read a conversation.
- **BR-03** A message contains text only, 1–4,000 characters; empty or whitespace-only messages are rejected.
- **BR-04** Messages are shown in the order they were sent, with the time of sending.
- **BR-05** The typing indicator appears within \~1 second after the other person starts typing and disappears no later than \~5 seconds after they stop, or immediately when the message is sent.
- **BR-06** "Focused on the chat" means: the browser tab is visible **and** the window has focus **and** the recipient has the conversation with the sender open.
  - Focused → the message appears in the conversation in real time and is marked as read. No notification.
  - Not focused → the user gets a browser notification (if permitted), the unread counter grows, and the tab title shows the unread count. Clicking the notification opens the conversation.
- **BR-07** If the recipient is offline, the message is stored and shown, with unread markers, at their next login.
- **BR-08** Notifications show the sender's name and a short preview (max \~100 characters). Users can turn previews off for privacy.

## 6. Business-level quality expectations

- A message reaches a recipient who has the chat open in under 1 second in normal conditions.
- No message is lost, even if the connection drops briefly.
- Works in current versions of Chrome, Edge, Firefox and Safari, on desktop and mobile browsers.
- Personal data is handled according to GDPR (users are in the EU): privacy notice, account deletion on request, data stored in the EU.

## 7. Success criteria / acceptance

The MVP is accepted when two people on two different computers can:

1. Register, log in and find each other in the user list.
2. Exchange messages that appear instantly on the other side.
3. See the "typing…" indicator while the other person types.
4. Receive a browser notification for a message while in another tab, and land in the right conversation after clicking it.
5. Reload the page and still see the full history.

## 8. Assumptions

- Users have a modern browser and a stable internet connection.
- Self-registration with e-mail and password is acceptable for the MVP (no corporate single sign-on).
- Expected initial load: up to a few hundred registered users, under 100 online at the same time.

## 9. Open questions

- Can anyone register, or is the app invite-only / for a closed group?
- How long must message history be kept?
- Is a native mobile experience expected later (this affects the push-notification design)?
- Does an admin role need to exist in the MVP?
