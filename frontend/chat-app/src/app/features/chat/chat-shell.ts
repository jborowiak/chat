import { Component, ElementRef, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/auth.service';
import { ChatStateService } from '../../core/chat-state.service';
import { avatarColour, buildThread, clock, initials, listTime } from './chat-view';

@Component({
  selector: 'app-chat-shell',
  imports: [FormsModule],
  templateUrl: './chat-shell.html',
  styleUrl: './chat-shell.scss',
})
export class ChatShell implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly chat = inject(ChatStateService);

  protected readonly search = signal('');
  protected draft = '';
  protected readonly thread = computed(() => buildThread(this.chat.messages(), this.auth.user()?.id));
  protected readonly initials = initials;
  protected readonly colour = avatarColour;
  protected readonly clock = clock;
  protected readonly listTime = (iso: string | null) => listTime(iso);
  private readonly composer = viewChild<ElementRef<HTMLTextAreaElement>>('composer');
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

  protected async open(userId: string): Promise<void> {
    const opening = this.chat.selectContact(userId);
    // Focus the composer on desktop only, so the keyboard doesn't pop up on phones.
    if (this.isDesktop()) setTimeout(() => this.composer()?.nativeElement.focus());
    await opening;
  }

  protected onEscape(): void {
    if (!this.isDesktop()) this.chat.closeConversation();
  }

  protected moveFocus(event: Event, step: 1 | -1): void {
    const buttons = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button.contact'));
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[i + step];
    if (i >= 0 && next) {
      event.preventDefault();
      next.focus();
    }
  }

  protected onEnter(event: Event): void {
    if ((event as KeyboardEvent).shiftKey) return; // Shift+Enter inserts a new line
    event.preventDefault();
    void this.send();
  }

  /** Grows the textarea from 1 to 5 lines. */
  protected grow(): void {
    const el = this.composer()?.nativeElement;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  protected async send(event?: Event): Promise<void> {
    event?.preventDefault();
    const text = this.draft;
    if (!text.trim()) return;
    this.draft = '';
    queueMicrotask(() => this.grow());
    await this.chat.send(text);
  }

  private isDesktop(): boolean {
    return window.matchMedia('(min-width: 768px)').matches;
  }

  protected logout(): void {
    this.chat.clear();
    this.auth.logout();
  }
}
