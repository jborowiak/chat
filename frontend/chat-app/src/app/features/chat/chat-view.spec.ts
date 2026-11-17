import { Message } from '../../core/chat-state.service';
import { ThreadItem, avatarColour, buildThread, dayLabel, initials, listTime } from './chat-view';

const msg = (id: number, sender: string, sentAt: string): Message => ({
  id,
  conversationId: 1,
  senderId: sender,
  body: `m${id}`,
  sentAt,
  clientMessageId: `c${id}`,
});

describe('chat-view helpers', () => {
  const now = new Date(2026, 10, 17, 15, 0, 0);
  const at = (day: number, h: number, m: number, s = 0) => new Date(2026, 10, day, h, m, s).toISOString();

  it('builds initials', () => {
    expect(initials('Anna Nowak')).toBe('AN');
    expect(initials('  madonna ')).toBe('M');
    expect(initials('')).toBe('?');
  });

  it('picks a stable avatar colour', () => {
    expect(avatarColour('abc')).toBe(avatarColour('abc'));
    expect(avatarColour('abc')).toMatch(/^#/);
  });

  it('formats list times', () => {
    expect(listTime(null, now)).toBe('');
    expect(listTime(at(17, 9, 5), now)).toBe('09:05');
    expect(listTime(at(16, 9, 5), now)).toBe('Yesterday');
    expect(listTime(at(14, 9, 5), now)).toBe('Sat');
    expect(listTime(new Date(2026, 9, 12).toISOString(), now)).toBe('12 Oct');
  });

  it('formats day labels', () => {
    expect(dayLabel(at(17, 1, 0), now)).toBe('Today');
    expect(dayLabel(at(16, 1, 0), now)).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 9, 12).toISOString(), now)).toBe('12 Oct 2026');
  });

  it('adds day separators and groups same-author messages within 2 minutes', () => {
    const items = buildThread(
      [
        msg(1, 'a', at(16, 10, 0)),
        msg(2, 'a', at(16, 10, 1)),
        msg(3, 'a', at(16, 10, 5)),
        msg(4, 'b', at(16, 10, 5, 30)),
        msg(5, 'b', at(17, 9, 0)),
      ],
      'a',
      now,
    );
    expect(items.map((i) => i.kind)).toEqual(['day', 'msg', 'msg', 'msg', 'msg', 'day', 'msg']);
    const m = items.filter((i): i is Extract<ThreadItem, { kind: 'msg' }> => i.kind === 'msg');
    expect(m.map((i) => i.grouped)).toEqual([false, true, false, false, false]);
    expect(m.map((i) => i.tail)).toEqual([false, true, true, true, true]);
    expect(m[0].mine).toBe(true);
    expect(m[3].mine).toBe(false);
  });
});
