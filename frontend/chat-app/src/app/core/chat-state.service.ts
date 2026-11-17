import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

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

const PAGE_SIZE = 50;

/** Holds contacts and the open conversation. Phase 3: REST only; SignalR is added in phase 5. */
@Injectable({ providedIn: 'root' })
export class ChatStateService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiBaseUrl}/api`;

  private readonly _contacts = signal<Contact[]>([]);
  private readonly _selectedUserId = signal<string | null>(null);
  /** Oldest first, ready to render. */
  private readonly _messages = signal<Message[]>([]);
  private readonly _hasMore = signal(false);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly contacts = this._contacts.asReadonly();
  readonly selectedUserId = this._selectedUserId.asReadonly();
  readonly messages = this._messages.asReadonly();
  readonly hasMore = this._hasMore.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly selectedContact = computed(() => this._contacts().find((c) => c.userId === this._selectedUserId()) ?? null);

  async loadContacts(search = ''): Promise<void> {
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
      this._messages.set([...page].reverse());
      this._hasMore.set(page.length === PAGE_SIZE);
      this._error.set(null);
    } catch {
      this._error.set('Could not load messages.');
    } finally {
      this._loading.set(false);
    }
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
      this._messages.update((m) => [...[...page].reverse(), ...m]);
      this._hasMore.set(page.length === PAGE_SIZE);
      return page.length;
    } catch {
      this._error.set('Could not load older messages.');
      return 0;
    } finally {
      this._loading.set(false);
    }
  }

  /** TEMPORARY (removed in phase 5): sends over REST so history can be tested before SignalR exists. */
  async send(body: string): Promise<void> {
    const userId = this._selectedUserId();
    if (!userId || !body.trim()) return;
    try {
      const msg = await firstValueFrom(
        this.http.post<Message>(`${this.api}/conversations/${userId}/messages`, {
          body,
          clientMessageId: crypto.randomUUID(),
        }),
      );
      this._messages.update((m) => (m.some((x) => x.id === msg.id) ? m : [...m, msg]));
      this._error.set(null);
      await this.loadContacts();
    } catch {
      this._error.set('Could not send the message.');
    }
  }

  clear(): void {
    this._contacts.set([]);
    this._selectedUserId.set(null);
    this._messages.set([]);
    this._hasMore.set(false);
  }

  private fetchMessages(userId: string, q: { limit: number; beforeId?: number }): Promise<Message[]> {
    let params = new HttpParams().set('limit', q.limit);
    if (q.beforeId !== undefined) params = params.set('beforeId', q.beforeId);
    return firstValueFrom(this.http.get<Message[]>(`${this.api}/conversations/${userId}/messages`, { params }));
  }
}
