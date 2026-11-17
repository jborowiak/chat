import { TestBed } from '@angular/core/testing';
import { TypingIndicator } from './typing-indicator';

describe('TypingIndicator', () => {
  it('renders three dots with screen-reader text naming the person', () => {
    const fixture = TestBed.createComponent(TypingIndicator);
    fixture.componentRef.setInput('name', 'Anna');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const bubble = el.querySelector('[role="status"]')!;
    expect(bubble.getAttribute('aria-label')).toBe('Anna is typing');
    expect(bubble.querySelectorAll('span').length).toBe(3);
  });
});
