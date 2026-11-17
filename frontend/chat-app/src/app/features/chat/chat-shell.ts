import { DatePipe } from '@angular/common';
import { Component, ElementRef, OnInit, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/auth.service';
import { ChatStateService } from '../../core/chat-state.service';

/** Plain-markup chat screen for phase 3; the real layout and styling arrive in phase 4. */
@Component({
  selector: 'app-chat-shell',
  imports: [FormsModule, DatePipe],
  template: `
    <header class="top-bar">
      <span class="brand">Chat</span>
      <span class="spacer"></span>
      <span data-testid="display-name">{{ auth.user()?.displayName }}</span>
      <button type="button" (click)="logout()">Log out</button>
    </header>
    <div class="layout">
      <aside>
        <input type="search" placeholder="Search people" aria-label="Search people" [ngModel]="search()" (ngModelChange)="onSearch($event)" />
        <ul data-testid="contacts">
          @for (c of chat.contacts(); track c.userId) {
            <li>
              <button type="button" [class.active]="c.userId === chat.selectedUserId()" (click)="chat.selectContact(c.userId)">
                <strong>{{ c.displayName }}</strong>
                @if (c.unreadCount > 0) {
                  <span class="badge">{{ c.unreadCount }}</span>
                }
                <small>{{ c.lastMessagePreview }}</small>
              </button>
            </li>
          } @empty {
            <li class="empty">No people found.</li>
          }
        </ul>
      </aside>
      <section class="conversation">
        @if (chat.selectedContact(); as contact) {
          <h2>{{ contact.displayName }}</h2>
          <div class="messages" #scroller (scroll)="onScroll()" data-testid="messages">
            @if (chat.hasMore()) {
              <p class="hint">Scroll up for older messages</p>
            }
            @for (m of chat.messages(); track m.id) {
              <div class="msg" [class.mine]="m.senderId === auth.user()?.id">
                <span class="body">{{ m.body }}</span>
                <small>{{ m.sentAt | date: 'short' }}</small>
              </div>
            } @empty {
              @if (!chat.loading()) {
                <p class="hint">No messages yet.</p>
              }
            }
          </div>
          <form (submit)="send($event)">
            <input name="draft" placeholder="Type a message" aria-label="Message" maxlength="2000" [(ngModel)]="draft" autocomplete="off" />
            <button type="submit" [disabled]="!draft.trim()">Send</button>
          </form>
        } @else {
          <p class="hint">Pick someone to start chatting.</p>
        }
        @if (chat.error(); as err) {
          <p class="error" role="alert">{{ err }}</p>
        }
      </section>
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; height: 100vh; }
    .top-bar { display: flex; align-items: center; gap: 12px; height: 56px; padding: 0 16px; background: #fff; border-bottom: 1px solid #e5e7eb; }
    .brand { font-weight: 600; }
    .brand::before { content: ''; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #4f46e5; margin-right: 8px; }
    .spacer { flex: 1; }
    button { border: 0; background: none; color: #4f46e5; cursor: pointer; font: inherit; }
    .layout { flex: 1; display: flex; min-height: 0; }
    aside { width: 300px; border-right: 1px solid #e5e7eb; display: flex; flex-direction: column; background: #fff; }
    aside input { margin: 8px; padding: 6px 8px; }
    ul { list-style: none; margin: 0; padding: 0; overflow-y: auto; }
    li button { display: block; width: 100%; text-align: left; padding: 8px 12px; color: inherit; }
    li button.active { background: #eef2ff; }
    li small { display: block; color: #6b7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .badge { float: right; background: #4f46e5; color: #fff; border-radius: 9px; padding: 0 6px; font-size: 12px; }
    .conversation { flex: 1; display: flex; flex-direction: column; min-width: 0; padding: 0 16px; }
    .messages { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
    .msg { max-width: 70%; align-self: flex-start; background: #f3f4f6; padding: 6px 10px; border-radius: 8px; }
    .msg.mine { align-self: flex-end; background: #e0e7ff; }
    .msg small { display: block; color: #6b7280; font-size: 11px; }
    .hint, .empty { color: #6b7280; text-align: center; }
    .error { color: #b91c1c; }
    form { display: flex; gap: 8px; padding: 8px 0; }
    form input { flex: 1; padding: 6px 8px; }
  `,
})
export class ChatShell implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly chat = inject(ChatStateService);

  protected readonly search = signal('');
  protected draft = '';
  private readonly scroller = viewChild<ElementRef<HTMLDivElement>>('scroller');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private lastNewestId: number | undefined;

  constructor() {
    // Jump to the bottom when the newest message changes (conversation opened, message sent);
    // prepending older messages leaves the newest one alone, so it doesn't scroll.
    effect(() => {
      const msgs = this.chat.messages();
      const el = this.scroller()?.nativeElement;
      if (!el || msgs.length === 0) return;
      const newest = msgs[msgs.length - 1].id;
      if (newest === this.lastNewestId) return;
      this.lastNewestId = newest;
      queueMicrotask(() => (el.scrollTop = el.scrollHeight));
    });
  }

  ngOnInit(): void {
    void this.chat.loadContacts();
  }

  protected onSearch(value: string): void {
    this.search.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.chat.loadContacts(value), 250);
  }

  protected async onScroll(): Promise<void> {
    const el = this.scroller()?.nativeElement;
    if (!el || el.scrollTop > 40) return;
    const before = el.scrollHeight;
    const added = await this.chat.loadOlder();
    if (added > 0) {
      // Keep the viewport on the same message after older ones are prepended.
      queueMicrotask(() => setTimeout(() => (el.scrollTop = el.scrollHeight - before)));
    }
  }

  protected async send(event: Event): Promise<void> {
    event.preventDefault();
    const text = this.draft;
    this.draft = '';
    await this.chat.send(text);
  }

  protected logout(): void {
    this.chat.clear();
    this.auth.logout();
  }
}
