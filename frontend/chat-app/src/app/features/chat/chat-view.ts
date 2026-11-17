import { LocalMessage as Message } from '../../core/chat-state.service';

const AVATAR_COLOURS = ['#FDE2E4', '#E2ECE9', '#DFE7FD', '#FFF1C1', '#E4D9FF', '#D8F0F5'];
const GROUP_WINDOW_MS = 2 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/** One of 6 soft pastel colours, stable for a given user id. */
export function avatarColour(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return AVATAR_COLOURS[h % AVATAR_COLOURS.length];
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const pad = (n: number) => String(n).padStart(2, '0');

export function clock(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Contact list time: "14:32" today, weekday within the last week, otherwise "12 Nov". */
export function listTime(iso: string | null, now = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days <= 0) return clock(iso);
  if (days === 1) return 'Yesterday';
  if (days < 7) return WEEKDAYS[d.getDay()];
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** Day separator label: "Today", "Yesterday", "12 Nov 2026". */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export type ThreadItem =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'msg'; key: string; message: Message; mine: boolean; grouped: boolean; tail: boolean };

/** Inserts day separators and marks grouping (same author within 2 minutes) and the tail bubble of each group. */
export function buildThread(messages: Message[], myId: string | undefined, now = new Date()): ThreadItem[] {
  const items: ThreadItem[] = [];
  const sameDay = (a: Message, b: Message) => startOfDay(new Date(a.sentAt)) === startOfDay(new Date(b.sentAt));
  const joins = (a: Message, b: Message) =>
    a.senderId === b.senderId &&
    sameDay(a, b) &&
    new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime() <= GROUP_WINDOW_MS;

  messages.forEach((m, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    if (!prev || !sameDay(prev, m)) {
      items.push({ kind: 'day', key: `d${m.id}`, label: dayLabel(m.sentAt, now) });
    }
    items.push({
      kind: 'msg',
      key: `m${m.id}`,
      message: m,
      mine: m.senderId === myId,
      grouped: !!prev && joins(prev, m),
      tail: !next || !joins(m, next),
    });
  });
  return items;
}
