import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ChatStateService, Message } from './chat-state.service';

const msg = (id: number): Message => ({
  id,
  conversationId: 1,
  senderId: 'u',
  body: `m${id}`,
  sentAt: '2026-01-01T00:00:00Z',
  clientMessageId: `c${id}`,
});

/** Newest-first page, like the API returns. */
const page = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => msg(from - i));

describe('ChatStateService', () => {
  let chat: ChatStateService;
  let ctrl: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    chat = TestBed.inject(ChatStateService);
    ctrl = TestBed.inject(HttpTestingController);
  });

  afterEach(() => ctrl.verify());

  it('shows the history oldest first and flags that more exist when a full page returns', async () => {
    const p = chat.selectContact('bob');
    ctrl.expectOne((r) => r.url.endsWith('/conversations/bob/messages') && r.params.get('limit') === '50').flush(page(60, 11));
    await p;
    expect(chat.messages().map((m) => m.id)[0]).toBe(11);
    expect(chat.messages().at(-1)?.id).toBe(60);
    expect(chat.hasMore()).toBe(true);
  });

  it('prepends older messages using beforeId and stops when a short page returns', async () => {
    const p1 = chat.selectContact('bob');
    ctrl.expectOne((r) => r.url.endsWith('/messages')).flush(page(60, 11));
    await p1;

    const p2 = chat.loadOlder();
    const req = ctrl.expectOne((r) => r.url.endsWith('/messages'));
    expect(req.request.params.get('beforeId')).toBe('11');
    req.flush(page(10, 6));
    expect(await p2).toBe(5);

    expect(chat.messages().map((m) => m.id).slice(0, 2)).toEqual([6, 7]);
    expect(chat.messages().length).toBe(55);
    expect(chat.hasMore()).toBe(false);
    expect(await chat.loadOlder()).toBe(0); // no request is made
  });

  it('ignores a late response for a conversation the user already left', async () => {
    const pBob = chat.selectContact('bob');
    const reqBob = ctrl.expectOne((r) => r.url.includes('/bob/'));
    const pCarol = chat.selectContact('carol');
    ctrl.expectOne((r) => r.url.includes('/carol/')).flush([msg(2)]);
    await pCarol;
    reqBob.flush([msg(1)]);
    await pBob;
    expect(chat.messages().map((m) => m.id)).toEqual([2]);
  });
});
