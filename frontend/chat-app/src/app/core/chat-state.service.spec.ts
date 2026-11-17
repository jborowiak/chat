import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { AuthService } from './auth.service';
import { ChatHubService } from './chat-hub.service';
import { ChatStateService, Contact, Message, TYPING_IDLE_MS, TYPING_SAFETY_MS, TYPING_THROTTLE_MS } from './chat-state.service';

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
  let loggedIn: ReturnType<typeof signal<boolean>>;
  let hub: {
    messageReceived: Subject<Message>;
    reconnected: Subject<void>;
    userTyping: Subject<string>;
    userStoppedTyping: Subject<string>;
    sendTyping: ReturnType<typeof vi.fn>;
    sendStopTyping: ReturnType<typeof vi.fn>;
    connected: ReturnType<typeof signal<boolean>>;
    reconnecting: ReturnType<typeof signal<boolean>>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    loggedIn = signal(false);
    hub = {
      messageReceived: new Subject<Message>(),
      reconnected: new Subject<void>(),
      userTyping: new Subject<string>(),
      userStoppedTyping: new Subject<string>(),
      sendTyping: vi.fn(),
      sendStopTyping: vi.fn(),
      connected: signal(true),
      reconnecting: signal(false),
      start: vi.fn(() => Promise.resolve()),
      stop: vi.fn(() => Promise.resolve()),
      sendMessage: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ChatHubService, useValue: hub },
        { provide: AuthService, useValue: { user: signal({ id: 'me', displayName: 'Me', email: null }), isLoggedIn: loggedIn } },
      ],
    });
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

  describe('live messaging', () => {
    const contact = (userId: string, extra: Partial<Contact> = {}): Contact => ({
      userId,
      displayName: userId,
      conversationId: null,
      lastMessagePreview: null,
      lastMessageAt: null,
      unreadCount: 0,
      isOnline: false,
      ...extra,
    });
    const live = (id: number, senderId: string, extra: Partial<Message> = {}): Message => ({
      id,
      conversationId: 7,
      senderId,
      body: `live${id}`,
      sentAt: '2026-01-02T00:00:00Z',
      clientMessageId: `cm${id}`,
      ...extra,
    });

    async function setup(open: string | null) {
      const pc = chat.loadContacts();
      ctrl.expectOne((r) => r.url.endsWith('/contacts')).flush([contact('bob'), contact('carol', { conversationId: 7 })]);
      await pc;
      if (open) {
        const po = chat.selectContact(open);
        ctrl.expectOne((r) => r.url.includes(`/${open}/messages`)).flush([]);
        await po;
      }
    }

    it('starts the connection on login and stops it on logout', () => {
      TestBed.tick();
      expect(hub.stop).toHaveBeenCalledTimes(1);
      loggedIn.set(true);
      TestBed.tick();
      expect(hub.start).toHaveBeenCalledTimes(1);
      loggedIn.set(false);
      TestBed.tick();
      expect(hub.stop).toHaveBeenCalledTimes(2);
    });

    it('appends a pushed message to the open conversation and moves that contact to the top', async () => {
      await setup('carol');
      hub.messageReceived.next(live(10, 'carol'));
      expect(chat.messages().map((m) => m.id)).toEqual([10]);
      expect(chat.contacts()[0].userId).toBe('carol');
      expect(chat.contacts()[0].lastMessagePreview).toBe('live10');
      expect(chat.contacts()[0].unreadCount).toBe(0);
    });

    it('counts a message for a conversation that is not open as unread', async () => {
      await setup('bob');
      hub.messageReceived.next(live(10, 'carol'));
      expect(chat.messages()).toEqual([]);
      expect(chat.contacts().find((c) => c.userId === 'carol')?.unreadCount).toBe(1);
    });

    it('shows a sent message as sending, then replaces it with the saved one (push and ack are de-duplicated)', async () => {
      await setup('carol');
      let ack!: (m: Message) => void;
      hub.sendMessage.mockImplementation(() => new Promise<Message>((r) => (ack = r)));

      const sending = chat.send('  hi  ');
      expect(chat.messages().map((m) => [m.body, m.status])).toEqual([['hi', 'sending']]);
      const [, clientMessageId, body] = hub.sendMessage.mock.calls[0].slice(0, 3);
      expect(body).toBe('hi');

      const saved = live(20, 'me', { clientMessageId, body: 'hi' });
      hub.messageReceived.next(saved); // the push from the server arrives first...
      ack(saved); // ...then the acknowledgement
      await sending;

      expect(chat.messages().map((m) => [m.id, m.status])).toEqual([[20, undefined]]);
    });

    it('marks a send as failed and retries with the same clientMessageId', async () => {
      await setup('carol');
      hub.sendMessage.mockRejectedValueOnce(new Error('Timed out'));
      await chat.send('hello');
      expect(chat.messages()[0].status).toBe('failed');
      const firstId = chat.messages()[0].clientMessageId;

      hub.sendMessage.mockResolvedValueOnce(live(30, 'me', { clientMessageId: firstId, body: 'hello' }));
      await chat.retry(firstId);

      expect(hub.sendMessage.mock.calls[1][1]).toBe(firstId);
      expect(chat.messages().map((m) => [m.id, m.status])).toEqual([[30, undefined]]);
    });

    it('keeps a live message that arrives while the history is still loading', async () => {
      await setup(null);
      const p = chat.selectContact('carol');
      const req = ctrl.expectOne((r) => r.url.includes('/carol/messages'));
      hub.messageReceived.next(live(12, 'carol'));
      req.flush([live(11, 'carol')]);
      await p;
      expect(chat.messages().map((m) => m.id)).toEqual([11, 12]);
    });

    it('after a reconnect refreshes contacts and fills the gap after the newest known message', async () => {
      await setup('carol');
      hub.messageReceived.next(live(10, 'carol'));

      hub.reconnected.next();
      ctrl.expectOne((r) => r.url.endsWith('/contacts')).flush([contact('bob'), contact('carol', { conversationId: 7, unreadCount: 2 })]);
      await vi.waitFor(() => ctrl.expectOne((r) => r.url.includes('/carol/messages') && r.params.get('afterId') === '10').flush([live(11, 'carol'), live(12, 'carol')]));
      await vi.waitFor(() => expect(chat.messages().map((m) => m.id)).toEqual([10, 11, 12]));
    });
  });

  describe('typing indicator (BR-07)', () => {
    async function open(userId: string) {
      const p = chat.selectContact(userId);
      ctrl.expectOne((r) => r.url.includes(`/${userId}/messages`)).flush([]);
      await p;
    }

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    describe('sending side', () => {
      it('sends Typing on the first keystroke and at most once every 2 s afterwards', async () => {
        await open('bob');
        chat.notifyTyping('h');
        chat.notifyTyping('he');
        chat.notifyTyping('hel');
        expect(hub.sendTyping).toHaveBeenCalledTimes(1);
        expect(hub.sendTyping).toHaveBeenCalledWith('bob');

        vi.advanceTimersByTime(TYPING_THROTTLE_MS - 1);
        chat.notifyTyping('hell');
        expect(hub.sendTyping).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(1);
        chat.notifyTyping('hello');
        expect(hub.sendTyping).toHaveBeenCalledTimes(2);
      });

      it('sends StopTyping after 3 s without keystrokes, and each keystroke restarts that wait', async () => {
        await open('bob');
        chat.notifyTyping('a');
        vi.advanceTimersByTime(TYPING_IDLE_MS - 1);
        chat.notifyTyping('ab');
        vi.advanceTimersByTime(TYPING_IDLE_MS - 1);
        expect(hub.sendStopTyping).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(hub.sendStopTyping).toHaveBeenCalledTimes(1);
        expect(hub.sendStopTyping).toHaveBeenCalledWith('bob');

        vi.advanceTimersByTime(10_000);
        expect(hub.sendStopTyping).toHaveBeenCalledTimes(1); // only once
      });

      it('sends Typing again right away when typing resumes after a stop', async () => {
        await open('bob');
        chat.notifyTyping('a');
        vi.advanceTimersByTime(TYPING_IDLE_MS);
        chat.notifyTyping('ab');
        expect(hub.sendTyping).toHaveBeenCalledTimes(2);
      });

      it('sends StopTyping when the input is cleared (or only whitespace)', async () => {
        await open('bob');
        chat.notifyTyping('a');
        chat.notifyTyping('  ');
        expect(hub.sendStopTyping).toHaveBeenCalledWith('bob');
        chat.notifyTyping(''); // nothing more to stop
        expect(hub.sendStopTyping).toHaveBeenCalledTimes(1);
      });

      it('sends StopTyping on send, without waiting for the idle timer', async () => {
        await open('bob');
        hub.sendMessage.mockResolvedValue(msg(1));
        chat.notifyTyping('hi');
        void chat.send('hi');
        expect(hub.sendStopTyping).toHaveBeenCalledWith('bob');
        expect(hub.sendStopTyping).toHaveBeenCalledTimes(1);
      });

      it('sends StopTyping to the old contact when the conversation is switched or closed', async () => {
        await open('bob');
        chat.notifyTyping('hi');
        const p = chat.selectContact('carol');
        ctrl.expectOne((r) => r.url.includes('/carol/messages')).flush([]);
        await p;
        expect(hub.sendStopTyping).toHaveBeenCalledWith('bob');

        chat.notifyTyping('yo');
        chat.closeConversation();
        expect(hub.sendStopTyping).toHaveBeenCalledWith('carol');
      });

      it('never sends anything when no conversation is open', () => {
        chat.notifyTyping('x');
        expect(hub.sendTyping).not.toHaveBeenCalled();
      });
    });

    describe('receiving side', () => {
      it('shows the dots on UserTyping and hides them on UserStoppedTyping', () => {
        hub.userTyping.next('bob');
        expect(chat.isTyping('bob')).toBe(true);
        expect(chat.isTyping('carol')).toBe(false);
        hub.userStoppedTyping.next('bob');
        expect(chat.isTyping('bob')).toBe(false);
      });

      it('hides the dots after the 5 s safety timeout', () => {
        hub.userTyping.next('bob');
        vi.advanceTimersByTime(TYPING_SAFETY_MS - 1);
        expect(chat.isTyping('bob')).toBe(true);
        vi.advanceTimersByTime(1);
        expect(chat.isTyping('bob')).toBe(false);
      });

      it('restarts the safety timer on every UserTyping', () => {
        hub.userTyping.next('bob');
        vi.advanceTimersByTime(4000);
        hub.userTyping.next('bob');
        vi.advanceTimersByTime(4000);
        expect(chat.isTyping('bob')).toBe(true);
        vi.advanceTimersByTime(1000);
        expect(chat.isTyping('bob')).toBe(false);
      });

      it('hides the dots when a message from that user arrives, but not for other users or own messages', async () => {
        const pc = chat.loadContacts();
        ctrl.expectOne((r) => r.url.endsWith('/contacts')).flush([
          { userId: 'bob', displayName: 'bob', conversationId: 7, lastMessagePreview: null, lastMessageAt: null, unreadCount: 0, isOnline: false },
        ]);
        await pc;
        const m = (senderId: string): Message => ({ ...msg(5), conversationId: 7, senderId });
        hub.userTyping.next('bob');
        hub.userTyping.next('carol');

        hub.messageReceived.next(m('me')); // an echo of my own message says nothing about Bob
        expect(chat.isTyping('bob')).toBe(true);

        hub.messageReceived.next(m('bob'));
        expect(chat.isTyping('bob')).toBe(false);
        expect(chat.isTyping('carol')).toBe(true);
      });

      it('forgets all typing state on logout/clear', () => {
        hub.userTyping.next('bob');
        chat.clear();
        expect(chat.isTyping('bob')).toBe(false);
        vi.advanceTimersByTime(TYPING_SAFETY_MS); // no timer fires afterwards
      });
    });
  });
});
