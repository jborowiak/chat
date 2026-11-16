import { Component, inject } from '@angular/core';
import { AuthService } from '../../core/auth.service';

/** Placeholder for the chat screen; the real layout arrives in later phases. */
@Component({
  selector: 'app-chat-shell',
  template: `
    <header class="top-bar">
      <span class="brand">Chat</span>
      <span class="spacer"></span>
      <span data-testid="display-name">{{ auth.user()?.displayName }}</span>
      <button type="button" (click)="auth.logout()">Log out</button>
    </header>
    <main><p>You are logged in. Contacts and messages come in the next phases.</p></main>
  `,
  styles: `
    .top-bar { display: flex; align-items: center; gap: 12px; height: 56px; padding: 0 16px; background: #fff; border-bottom: 1px solid #e5e7eb; }
    .brand { font-weight: 600; }
    .brand::before { content: ''; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #4f46e5; margin-right: 8px; }
    .spacer { flex: 1; }
    button { border: 0; background: none; color: #4f46e5; cursor: pointer; font: inherit; }
    main { padding: 16px; }
  `,
})
export class ChatShell {
  protected readonly auth = inject(AuthService);
}
