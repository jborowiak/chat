# Chat App – UI Design Proposal

Version 1.0 · 16 Nov 2026 · Status: Draft

Design goal: **simple, calm and neat.** That means plenty of white space, one accent colour, rounded bubbles, and no visual noise. The app has two screens: **Auth** (login/register) and **Chat**.

## 1. Layout

### Desktop (≥ 768 px): two panes

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ● Chat                                                     Jan Kowalski  [Log out]│  ← top bar, 56px
├──────────────────────────┬───────────────────────────────────────────────────────┤
│ 🔍 Search people…         │  (AN)  Anna Nowak                                      │  ← conversation header
├──────────────────────────┤        ● online                                        │
│ (AN) Anna Nowak     14:32 │───────────────────────────────────────────────────────│
│      typing…           ⓷  │                       ── Today ──                      │
│──────────────────────────│                                                        │
│ (PK) Piotr Kaczmarek 12:05│   ┌──────────────────────────┐                         │
│      See you tomorrow!    │   │ Hi! Are we still on for   │                        │
│──────────────────────────│   │ Friday?                   │                        │
│ (MW) Marta Wiśniewska Mon │   └──────────────────── 14:30┘                         │
│      Thanks 🙂            │                         ┌───────────────────────────┐  │
│──────────────────────────│                         │ Yes, 7pm works for me      │  │
│ (TZ) Tomasz Zieliński     │                         └───────────────────── 14:31┘  │
│      No messages yet      │   ┌───────┐                                            │
│                           │   │ • • • │   ← typing indicator                       │
│                           │   └───────┘                                            │
│                           ├───────────────────────────────────────────────────────┤
│                           │ ┌───────────────────────────────────────────┐  ┌────┐ │
│                           │ │ Write a message…                           │  │ ➤  │ │  ← composer
│                           │ └───────────────────────────────────────────┘  └────┘ │
└──────────────────────────┴───────────────────────────────────────────────────────┘
   sidebar 320px                     conversation pane (fluid, content max 760px)
```

### Mobile (< 768 px): one pane at a time

```
┌─────────────────────────┐        ┌─────────────────────────┐
│ Chat            [⎋]     │        │ ←  (AN) Anna Nowak      │
├─────────────────────────┤  tap   ├─────────────────────────┤
│ 🔍 Search people…        │ ─────► │      messages…          │
│ (AN) Anna Nowak   ⓷     │        │                         │
│ (PK) Piotr K.           │        │ ┌──────────────────┐ ➤  │
└─────────────────────────┘        └─────────────────────────┘
```

### Empty state (no conversation selected)

The right pane is centred and shows a light speech-bubble icon and the text "Select a person to start chatting".

## 2. Components

| Component | Description |
| --- | --- |
| **Top bar** | App name with a small accent dot on the left; the user's display name and a "Log out" text button on the right. White background and a 1px bottom border. |
| **Search box** | Full width in the sidebar, rounded (pill), light grey fill, magnifier icon. Filters contacts as you type, with a 200 ms debounce. |
| **Contact item** | 64px tall. A 40px circular avatar with initials, coloured from a hash of the user id (6 soft pastel colours). Name in semibold. Below it, the last-message preview in muted text, cut off with an ellipsis. Time at the top right ("14:32", "Mon", "12 Nov"). **Unread badge** at the bottom right. The active item has an accent-tint background. Hover gives a light grey background. If the contact has unread messages, the name and preview are bold. When the contact is typing, the preview is replaced by an *accent-coloured "typing…"* label. |
| **Unread badge** | Pill shape, min 20px wide, 20px tall, accent background, white 12px bold number. Hidden at 0, "99+" above 99. It plays a short scale "pop" animation (150 ms) when the number goes up. |
| **Conversation header** | Avatar, name, and an optional "● online" line in a muted colour. On mobile there is also a back arrow. |
| **Day separator** | Centred small muted label ("Today", "Yesterday", "12 Nov 2026") with thin lines on both sides. |
| **Message bubble** | Max width 70%. Padding 8px 12px. Radius 16px, except 4px on the corner nearest the author's side. **Mine:** right-aligned, accent background, white text. **Theirs:** left-aligned, `--surface-2` background, normal text. Time in 11px under the text, right-aligned inside the bubble. Consecutive messages from the same author within 2 minutes are grouped: 2px gap instead of 12px, and only the last one has the "tail" corner. Line breaks are kept (`white-space: pre-wrap`) and long words wrap (`overflow-wrap: anywhere`). |
| **Pending/failed message** | Pending: 60% opacity with a small clock icon. Failed: a red "Not sent · Retry" link under the bubble. |
| **Typing indicator** | A "theirs" bubble with three 6px dots that bounce one after another (see the CSS below). Shown at the bottom of the message list. |
| **New messages divider** | When you open a conversation with unread messages, a thin accent line labelled "New messages" appears above the first unread one, and the view scrolls to it. |
| **Composer** | A textarea that grows from 1 to 5 lines. Placeholder "Write a message…". **Enter** sends, **Shift+Enter** adds a new line. A round 40px send button with an accent fill, disabled (grey) while the input is empty. A character counter appears only after 1,800 characters ("1,950 / 2,000"). |
| **Reconnecting banner** | A 28px strip under the top bar with an amber background and the text "Reconnecting…". It slides down. Sending is disabled while it's shown. |
| **Auth card** | A centred 380px card on a light grey page. App name, a title ("Welcome back" / "Create account"), labelled inputs, a full-width accent button, and a link to switch between login and register. Inline validation messages appear in red under each field. |

## 3. Design tokens

```scss
// src/styles/tokens.scss
:root {
  /* colours */
  --accent:        #4F46E5;   /* indigo – buttons, my bubbles, badges */
  --accent-hover:  #4338CA;
  --accent-tint:   #EEF2FF;   /* active contact background */
  --bg:            #F7F7FB;   /* page background */
  --surface:       #FFFFFF;   /* panes, cards */
  --surface-2:     #F1F2F6;   /* their bubbles, search box */
  --border:        #E5E7EB;
  --text:          #111827;
  --text-muted:    #6B7280;
  --on-accent:     #FFFFFF;
  --danger:        #DC2626;
  --warning-bg:    #FEF3C7;
  --online:        #22C55E;

  /* type */
  --font: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --fs-xs: 11px; --fs-sm: 13px; --fs-md: 15px; --fs-lg: 18px;

  /* shape & spacing */
  --radius-sm: 8px; --radius-md: 12px; --radius-bubble: 16px; --radius-pill: 999px;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-6: 24px;
  --shadow-card: 0 1px 2px rgb(0 0 0 / .04), 0 4px 16px rgb(0 0 0 / .06);
}
```

Base text size is 15px with a line height of 1.45. Inter is loaded from Google Fonts, with the system font as a fallback. A dark theme can be added later by overriding the same tokens under `[data-theme="dark"]`.

## 4. Typing dots

```html
<div class="bubble theirs typing" role="status" aria-label="Anna is typing">
  <span></span><span></span><span></span>
</div>
```

```scss
.typing { display: inline-flex; gap: 4px; padding: 12px 14px; }
.typing span {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--text-muted);
  animation: typing-bounce 1.2s infinite ease-in-out;
}
.typing span:nth-child(2) { animation-delay: .15s; }
.typing span:nth-child(3) { animation-delay: .30s; }

@keyframes typing-bounce {
  0%, 60%, 100% { transform: translateY(0);    opacity: .4; }
  30%           { transform: translateY(-4px); opacity: 1;  }
}

@media (prefers-reduced-motion: reduce) {
  .typing span { animation: none; opacity: .7; }
}
```

## 5. Behaviour details

- **Auto-scroll:** a new message scrolls the list to the bottom only if the user is already within 100px of the bottom. Otherwise a small "↓ New message" pill appears above the composer, and clicking it scrolls down.
- **Ordering of contacts:** the contact with the most recent activity is at the top. It moves up smoothly when a new message arrives.
- **Tab title:** `Chat` when there's nothing unread, `(3) Chat` when there are unread messages.
- **Focus:** opening a conversation puts the focus in the composer (desktop only, to avoid popping up the keyboard on mobile).
- **Keyboard:** `Esc` closes the conversation on mobile. `↑`/`↓` move through the contact list when it has focus.
