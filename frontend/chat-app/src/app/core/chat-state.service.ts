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
  readonly hasMore = this._hasMore.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
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
  }

  async loadContacts(search = ''): Promise<void> {
    this.lastSearch = search;
    let params = new HttpParams();
    if (search.trim()) params = params.set('search', search.trim());
    try {
      this._contacts.set(await firstValueFrom(this.http.get<Contact[]>(`${this.api}/contacts`, { params })));
      this._error.set(null);
    } catch {
      this._error.set('Could not load contacts.');
    }
  }

  async selectContact(userId: string): Promise<void> {
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
    } catch {
      this._error.set('Could not load messages.');
    } finally {
      this._loading.set(false);
    }
  }

  /** Leaves the open conversation (mobile back button). */
  closeConversation(): void {
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

  clear(): void {
    this._contacts.set([]);
    this._selectedUserId.set(null);
    this._messages.set([]);
    this._pending.set([]);
    this._hasMore.set(false);
  }

  /** After a reconnect: re-read contacts (unread counts) and fill the gap in the open conversation. */
  async resync(): Promise<void> {
    await this.loadContacts(this.lastSearch);
    const userId = this._selectedUserId();
    if (userId) await this.fillGap(userId);
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
    this.touchContact(otherId, msg, !isMine && !isOpen && !alreadyKnown);
    if (isOpen) this._messages.update((list) => mergeMessages(list, [msg]));
    // Marking the open conversation as read and the typing indicator arrive in phases 6 and 7.
  }

  /** Updates a contact's preview and time, moves it to the top, and optionally counts one more unread. */
  private touchContact(userId: string, msg: Message, countUnread: boolean): void {
    this._contacts.update((list) => {
      const i = list.findIndex((c) => c.userId === userId);
      if (i < 0) return list;
      const c = list[i];
      const updated: Contact = {
        ...c,
        conversationId: msg.conversationId,
        lastMessagePreview: msg.body.length <= PREVIEW_LENGTH ? msg.body : msg.body.slice(0, PREVIEW_LENGTH) + '...',
        lastMessageAt: msg.sentAt,
        unreadCount: c.unreadCount + (countUnread ? 1 : 0),
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
