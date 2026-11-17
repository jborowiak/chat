import { Component, computed, input } from '@angular/core';

/** The unread counter next to a contact: hidden at 0, "99+" above 99 (BR-09). */
@Component({
  selector: 'app-unread-badge',
  template: `
    @if (count() > 0) {
      <span class="badge" data-testid="unread-badge" [attr.aria-label]="count() + (count() === 1 ? ' unread message' : ' unread messages')">{{ text() }}</span>
    }
  `,
  styles: `
    .badge { display: block; min-width: 20px; height: 20px; padding: 0 6px; border-radius: var(--radius-pill); background: var(--accent); color: var(--on-accent); font-size: 12px; font-weight: 700; line-height: 20px; text-align: center; animation: pop .15s ease-out; }
    @keyframes pop { 0% { transform: scale(.7); } 70% { transform: scale(1.15); } 100% { transform: scale(1); } }
    @media (prefers-reduced-motion: reduce) { .badge { animation: none; } }
  `,
})
export class UnreadBadge {
  readonly count = input.required<number>();
  protected readonly text = computed(() => (this.count() > 99 ? '99+' : String(this.count())));
}
