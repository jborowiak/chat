import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { ChatHubService } from './chat-hub.service';

export interface Contact {
  userId: string;
  displayName: string;
  conversationId: number | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  isOnline: boolean;
}

export interface Message {
  id: number;
  conversationId: number;
  senderId: string;
  body: string;
  sentAt: string;
  clientMessageId: string;
}

/** A message as shown in the thread. `status` is only set for messages the server has not confirmed yet. */
export interface LocalMessage extends Message {
  status?: 'sending' | 'failed';
}

interface Pending {
  recipientId: string;
  message: LocalMessage;
}

const PAGE_SIZE = 50;
const GAP_PAGE_SIZE = 100;
const PREVIEW_LENGTH = 80;
/** BR-07 / technical requirements section 6: sender throttle and idle stop, recipient safety timeout. */
export const TYPING_THROTTLE_MS = 2000;
export const TYPING_IDLE_MS = 3000;
export const TYPING_SAFETY_MS = 5000;

const byId = (a: Message, b: Message) => a.id - b.id;

/** Adds `incoming` to `list`, skipping ids that are already there, oldest first. */
function mergeMessages(list: Message[], incoming: Message[]): Message[] {
  const seen = new Set(list.map((m) => m.id));
  const added = incoming.filter((m) => !seen.has(m.id));
  return added.length === 0 ? list : [...list, ...added].sort(byId);
}

/**
 * Holds contacts and the open conversation. History comes over REST; live messages come from the SignalR hub.
 * The database is the source of truth: after a reconnect everything is re-read from it.
 */
@Injectable({ providedIn: 'root' })
export class ChatStateService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly hub = inject(ChatHubService);
  private readonly api = `${environment.apiBaseUrl}/api`;

  private readonly _contacts = signal<Contact[]>([]);
  private readonly _selectedUserId = signal<string | null>(null);
  /** Saved messages of the open conversation, oldest first. */
  private readonly _messages = signal<Message[]>([]);
  /** Messages sent from this tab that the server has not acknowledged yet (any conversation). */
  private readonly _pending = signal<Pending[]>([]);
  private readonly _hasMore = signal(false);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  /** Users who are typing to us right now. */
  private readonly _typing = signal<ReadonlySet<string>>(new Set());
  private readonly typingSafetyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Outgoing side: who we last told "typing" and when, plus the idle timer that sends StopTyping. */
  private typingTo: string | null = null;
  private typingSentAt = 0;
  private typingIdleTimer: ReturnType<typeof setTimeout> | undefined;
  /** Per conversation: the newest live message this tab counted as unread. Lets a late ConversationRead be recognised as stale. */
  private readonly newestCountedUnread = new Map<number, number>();
  private lastSearch = '';
  private pendingSeq = 0;

  readonly contacts = this._contacts.asReadonly();
  readonly selectedUserId = this._selectedUserId.asReadonly();
  /** Saved messages followed by this tab's unconfirmed ones for the open conversation. */
  readonly messages = computed<LocalMessage[]>(() => {
    const open = this._selectedUserId();
    const pending = this._pending().filter((p) => p.recipientId === open).map((p) => p.message);
    return pending.length === 0 ? this._messages() : [...this._messages(), ...pending];
  });
  readonly typing = this._typing.asReadonly();
  readonly hasMore = this._hasMore.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  /** Sum of all unread counts; drives the tab title. */
  readonly totalUnread = computed(() => this._contacts().reduce((sum, c) => sum + c.unreadCount, 0));
  readonly selectedContact = computed(() => this._contacts().find((c) => c.userId === this._selectedUserId()) ?? null);
  readonly connected = this.hub.connected;
  readonly reconnecting = this.hub.reconnecting;

  constructor() {
    // The connection lives exactly as long as the login does.
    effect(() => {
      const loggedIn = this.auth.isLoggedIn();
      untracked(() => void (loggedIn ? this.hub.start() : this.hub.stop()));
    });
    this.hub.messageReceived.subscribe((m) => this.applyMessage(m));
    this.hub.reconnected.subscribe(() => void this.resync());
    this.hub.userTyping.subscribe((id) => this.showTyping(id));
    this.hub.userStoppedTyping.subscribe((id) => this.hideTyping(id));
    this.hub.conversationRead.subscribe((e) => this.onConversationRead(e.conversationId, e.lastReadMessageId));
    // Coming back to the tab: whatever arrived in the open conversation meanwhile counts as read now (BR-11).
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (this.isVisible()) this.markOpenRead(true);
      });
    }
  }

  async loadContacts(search = ''): Promise<void> {
    this.lastSearch = search;
    let params = new HttpParams();
    if (search.trim()) params = params.set('search', search.trim());
    try {
      this._contacts.set(await firstValueFrom(this.http.get<Contact[]>(`${this.api}/contacts`, { params })));
      this.newestCountedUnread.clear();
      this._error.set(null);
    } catch {
      this._error.set('Could not load contacts.');
    }
  }

  async selectContact(userId: string): Promise<void> {
    if (this.typingTo !== userId) this.stopTyping();
    this._selectedUserId.set(userId);
    this._messages.set([]);
    this._hasMore.set(false);
    this._loading.set(true);
    try {
      const page = await this.fetchMessages(userId, { limit: PAGE_SIZE });
      if (this._selectedUserId() !== userId) return; // user switched meanwhile
      // Keep anything that was pushed live while the history was loading.
      this._messages.update((live) => mergeMessages([...page].reverse(), live));
      this._hasMore.set(page.length === PAGE_SIZE);
      this._error.set(null);
      this.markOpenRead(false); // opening a conversation reads it (BR-09)
    } catch {
      this._error.set('Could not load messages.');
    } finally {
      this._loading.set(false);
    }
  }

  /** Leaves the open conversation (mobile back button). */
  closeConversation(): void {
    this.stopTyping();
    this._selectedUserId.set(null);
    this._messages.set([]);
    this._hasMore.set(false);
  }

  /** Loads the page of messages older than the oldest one shown. Returns how many were added. */
  async loadOlder(): Promise<number> {
    const userId = this._selectedUserId();
    const oldest = this._messages()[0];
    if (!userId || !oldest || !this._hasMore() || this._loading()) return 0;
    this._loading.set(true);
    try {
      const page = await this.fetchMessages(userId, { limit: PAGE_SIZE, beforeId: oldest.id });
      if (this._selectedUserId() !== userId) return 0;
      this._messages.update((m) => mergeMessages(m, page));
      this._hasMore.set(page.length === PAGE_SIZE);
      return page.length;
    } catch {
      this._error.set('Could not load older messages.');
      return 0;
    } finally {
      this._loading.set(false);
    }
  }

  /** Optimistic send: the message shows at once as "sending", then is replaced by the saved one. */
  async send(body: string): Promise<void> {
    const recipientId = this._selectedUserId();
    const text = body.trim();
    if (!recipientId || !text) return;
    this.stopTyping();
    const clientMessageId = crypto.randomUUID();
    const message: LocalMessage = {
      id: --this.pendingSeq, // negative: never collides with a real id
      conversationId: this.selectedContact()?.conversationId ?? 0,
      senderId: this.auth.user()?.id ?? '',
      body: text,
      sentAt: new Date().toISOString(),
      clientMessageId,
      status: 'sending',
    };
    this._pending.update((p) => [...p, { recipientId, message }]);
    await this.transmit(clientMessageId);
  }

  /** "Not sent · Retry": resends with the SAME clientMessageId, so the server can't store it twice. */
  async retry(clientMessageId: string): Promise<void> {
    this.setStatus(clientMessageId, 'sending');
    await this.transmit(clientMessageId);
  }

  /**
   * Called by the composer on every input event with the current text.
   * Sends `Typing` at most once per 2 s, and `StopTyping` after 3 s without input or when the text is empty.
   */
  notifyTyping(draft: string): void {
    const to = this._selectedUserId();
    if (!to || !draft.trim()) {
      this.stopTyping();
      return;
    }
    if (this.typingTo !== null && this.typingTo !== to) this.stopTyping(); // never leave dots hanging for a previous recipient
    const now = Date.now();
    if (this.typingTo !== to || now - this.typingSentAt >= TYPING_THROTTLE_MS) {
      this.typingTo = to;
      this.typingSentAt = now;
      this.hub.sendTyping(to);
    }
    clearTimeout(this.typingIdleTimer);
    this.typingIdleTimer = setTimeout(() => this.stopTyping(), TYPING_IDLE_MS);
  }

  /** Tells the recipient we stopped (input cleared, message sent, idle, conversation switched). No-op if we weren't typing. */
  stopTyping(): void {
    clearTimeout(this.typingIdleTimer);
    const to = this.typingTo;
    this.typingTo = null;
    this.typingSentAt = 0;
    if (to) this.hub.sendStopTyping(to);
  }

  isTyping(userId: string): boolean {
    return this._typing().has(userId);
  }

  clear(): void {
    this.stopTyping();
    for (const t of this.typingSafetyTimers.values()) clearTimeout(t);
    this.typingSafetyTimers.clear();
    this._typing.set(new Set());
    this._contacts.set([]);
    this.newestCountedUnread.clear();
    this._selectedUserId.set(null);
    this._messages.set([]);
    this._pending.set([]);
    this._hasMore.set(false);
  }

  /** After a reconnect: re-read contacts (unread counts) and fill the gap in the open conversation. */
  async resync(): Promise<void> {
    // Typing events sent while we were disconnected are lost, so don't keep stale dots.
    for (const id of [...this._typing()]) this.hideTyping(id);
    await this.loadContacts(this.lastSearch);
    const userId = this._selectedUserId();
    if (userId) {
      await this.fillGap(userId);
      // A MarkRead sent while offline was lost, so the fresh counts may include the open conversation.
      this.markOpenRead(true);
    }
  }

  private async transmit(clientMessageId: string): Promise<void> {
    const pending = this._pending().find((p) => p.message.clientMessageId === clientMessageId);
    if (!pending) return;
    try {
      const saved = await this.hub.sendMessage(pending.recipientId, clientMessageId, pending.message.body);
      this.applyMessage(saved);
    } catch {
      // The message may still have been saved (e.g. a timeout); if its push arrives, applyMessage clears this state.
      this.setStatus(clientMessageId, 'failed');
    }
  }

  private setStatus(clientMessageId: string, status: 'sending' | 'failed'): void {
    this._pending.update((list) =>
      list.map((p) => (p.message.clientMessageId === clientMessageId ? { ...p, message: { ...p.message, status } } : p)),
    );
  }

  /**
   * One saved message, from either the hub push or the send acknowledgement (whichever comes first;
   * the second one finds the message already there and changes nothing).
   */
  private applyMessage(msg: Message): void {
    const me = this.auth.user()?.id;
    const isMine = msg.senderId === me;

    const pending = this._pending().find((p) => p.message.clientMessageId === msg.clientMessageId);
    if (pending) this._pending.update((list) => list.filter((p) => p !== pending));

    const otherId = isMine
      ? (pending?.recipientId ?? this._contacts().find((c) => c.conversationId === msg.conversationId)?.userId)
      : msg.senderId;
    if (!otherId) {
      // E.g. our own message from another tab to someone we had no conversation with yet.
      void this.loadContacts(this.lastSearch);
      return;
    }

    const isOpen = this._selectedUserId() === otherId;
    const alreadyKnown = this._messages().some((m) => m.id === msg.id);
    this.touchContact(otherId, msg);
    if (isOpen) this._messages.update((list) => mergeMessages(list, [msg]));
    if (!isMine) {
      this.hideTyping(otherId); // a message from them ends "is typing"
      if (isOpen && this.isVisible()) {
        // Seen live: read at once, no badge (BR-06).
        this.setUnread(otherId, 0);
        this.hub.markRead(msg.conversationId, msg.id);
      } else if (!alreadyKnown) {
        // Another conversation is open, or this tab is hidden: unread until the user looks (BR-08, BR-11).
        this.newestCountedUnread.set(msg.conversationId, Math.max(this.newestCountedUnread.get(msg.conversationId) ?? 0, msg.id));
        this.addUnread(otherId);
      }
    }
  }

  private isVisible(): boolean {
    return typeof document === 'undefined' || document.visibilityState === 'visible';
  }

  /**
   * Marks the open conversation read up to its newest known message and zeroes its badge straight away.
   * `onlyIfUnread` skips the call when the badge is already 0 (used for visibility and reconnect events).
   */
  private markOpenRead(onlyIfUnread: boolean): void {
    const contact = this.selectedContact();
    const newest = this._messages().at(-1);
    if (!contact || !newest || !this.isVisible()) return;
    if (onlyIfUnread && contact.unreadCount === 0) return;
    this.setUnread(contact.userId, 0);
    this.hub.markRead(newest.conversationId, newest.id);
  }

  /** Another tab (or this one) read a conversation: clear its badge (BR-10), unless a newer message is still unread here. */
  private onConversationRead(conversationId: number, lastReadMessageId: number): void {
    const contact = this._contacts().find((c) => c.conversationId === conversationId);
    if (!contact) return;
    const newestUnread = this.newestCountedUnread.get(conversationId) ?? 0;
    if (lastReadMessageId >= newestUnread) {
      this.newestCountedUnread.delete(conversationId);
      this.setUnread(contact.userId, 0);
    } else {
      void this.loadContacts(this.lastSearch); // a newer message arrived meanwhile; let the database decide the count
    }
  }

  private setUnread(userId: string, count: number): void {
    this._contacts.update((list) => list.map((c) => (c.userId === userId && c.unreadCount !== count ? { ...c, unreadCount: count } : c)));
  }

  private addUnread(userId: string): void {
    this._contacts.update((list) => list.map((c) => (c.userId === userId ? { ...c, unreadCount: c.unreadCount + 1 } : c)));
  }

  /** Shows the dots for a user and (re)starts the 5 s safety timer that covers lost StopTyping events. */
  private showTyping(userId: string): void {
    clearTimeout(this.typingSafetyTimers.get(userId));
    this.typingSafetyTimers.set(userId, setTimeout(() => this.hideTyping(userId), TYPING_SAFETY_MS));
    if (!this._typing().has(userId)) this._typing.update((s) => new Set(s).add(userId));
  }

  private hideTyping(userId: string): void {
    clearTimeout(this.typingSafetyTimers.get(userId));
    this.typingSafetyTimers.delete(userId);
    if (this._typing().has(userId)) {
      this._typing.update((s) => {
        const next = new Set(s);
        next.delete(userId);
        return next;
      });
    }
  }

  /** Updates a contact's preview and time and moves it to the top. */
  private touchContact(userId: string, msg: Message): void {
    this._contacts.update((list) => {
      const i = list.findIndex((c) => c.userId === userId);
      if (i < 0) return list;
      const c = list[i];
      const updated: Contact = {
        ...c,
        conversationId: msg.conversationId,
        lastMessagePreview: msg.body.length <= PREVIEW_LENGTH ? msg.body : msg.body.slice(0, PREVIEW_LENGTH) + '...',
        lastMessageAt: msg.sentAt,
      };
      return [updated, ...list.slice(0, i), ...list.slice(i + 1)];
    });
  }

  /** Fetches everything newer than the newest saved message we have, oldest first. */
  private async fillGap(userId: string): Promise<void> {
    try {
      for (;;) {
        const afterId = this._messages().at(-1)?.id ?? 0;
        const page = await this.fetchMessages(userId, { limit: GAP_PAGE_SIZE, afterId });
        if (this._selectedUserId() !== userId) return;
        this._messages.update((list) => mergeMessages(list, page));
        const fresh = page.length > 0 && page.every((m) => m.id > afterId);
        if (page.length < GAP_PAGE_SIZE || !fresh) return;
      }
    } catch {
      this._error.set('Could not refresh messages.');
    }
  }

  private fetchMessages(userId: string, q: { limit: number; beforeId?: number; afterId?: number }): Promise<Message[]> {
    let params = new HttpParams().set('limit', q.limit);
    if (q.beforeId !== undefined) params = params.set('beforeId', q.beforeId);
    if (q.afterId !== undefined) params = params.set('afterId', q.afterId);
    return firstValueFrom(this.http.get<Message[]>(`${this.api}/conversations/${userId}/messages`, { params }));
  }
}
