import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UnreadBadge } from './unread-badge';

@Component({ imports: [UnreadBadge], template: '<app-unread-badge [count]="n()" />' })
class Host {
  readonly n = signal(0);
}

describe('UnreadBadge', () => {
  function render(n: number): HTMLElement {
    const f = TestBed.createComponent(Host);
    f.componentInstance.n.set(n);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }
  const badge = (el: HTMLElement) => el.querySelector('[data-testid="unread-badge"]');

  it('is hidden at 0', () => expect(badge(render(0))).toBeNull());
  it('shows the number', () => expect(badge(render(3))?.textContent?.trim()).toBe('3'));
  it('shows 99 as is and 99+ above', () => {
    expect(badge(render(99))?.textContent?.trim()).toBe('99');
    expect(badge(render(100))?.textContent?.trim()).toBe('99+');
  });
  it('has an accessible label with the real count', () => expect(badge(render(150))?.getAttribute('aria-label')).toBe('150 unread messages'));
});
