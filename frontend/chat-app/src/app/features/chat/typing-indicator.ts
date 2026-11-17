import { Component, input } from '@angular/core';

/** Three bouncing dots inside a "theirs" bubble (docs/04-ui-design.md section 4). */
@Component({
  selector: 'app-typing-indicator',
  template: `
    <div class="bubble theirs typing" role="status" [attr.aria-label]="name() + ' is typing'">
      <span></span><span></span><span></span>
    </div>
  `,
  styles: `
    :host { display: flex; margin-top: 12px; }
    .bubble { padding: 12px 14px; border-radius: var(--radius-bubble); border-bottom-left-radius: 4px; background: var(--surface-2); }
    .typing { display: inline-flex; gap: 4px; }
    .typing span {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--text-muted);
      animation: typing-bounce 1.2s infinite ease-in-out;
    }
    .typing span:nth-child(2) { animation-delay: .15s; }
    .typing span:nth-child(3) { animation-delay: .30s; }
    @keyframes typing-bounce {
      0%, 60%, 100% { transform: translateY(0); opacity: .4; }
      30% { transform: translateY(-4px); opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      .typing span { animation: none; opacity: .7; }
    }
  `,
})
export class TypingIndicator {
  readonly name = input.required<string>();
}
