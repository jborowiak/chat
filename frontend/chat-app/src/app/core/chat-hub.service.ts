import { Injectable, computed, inject, signal } from '@angular/core';
import { HubConnection, HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { Subject, firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import type { Message } from './chat-state.service';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

const RECONNECT_DELAYS_MS = [0, 2000, 5000, 10000, 30000];
/** After SignalR gives up its automatic attempts (about 47 s), keep trying at this pace. */
const RETRY_MS = 30_000;
const SEND_TIMEOUT_MS = 10_000;

/** Thin wrapper around the SignalR HubConnection: lifecycle, reconnect state and the typed calls the app needs. */
@Injectable({ providedIn: 'root' })
export class ChatHubService {
  private readonly auth = inject(AuthService);

  private connection: HubConnection | null = null;
  private wanted = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly _state = signal<ConnectionState>('disconnected');
  readonly state = this._state.asReadonly();
  readonly connected = computed(() => this._state() === 'connected');
  /** True while a connection was lost and is being re-established (drives the banner). */
  readonly reconnecting = computed(() => this._state() === 'reconnecting');

  /** Every ReceiveMessage pushed by the server (including echoes of our own sends). */
  readonly messageReceived = new Subject<Message>();
  /** Emits after the connection came back, so the app can resync with the database. */
  readonly reconnected = new Subject<void>();

  /** Starts the connection. Called when the user is logged in. */
  async start(): Promise<void> {
    if (this.wanted) return;
    this.wanted = true;
    const conn = this.build();
    this.connection = conn;
    this._state.set('connecting');
    await this.run(conn, false);
  }

  /** Stops the connection and forgets it. Called on logout. */
  async stop(): Promise<void> {
    this.wanted = false;
    clearTimeout(this.retryTimer);
    const conn = this.connection;
    this.connection = null;
    this._state.set('disconnected');
    if (conn) await conn.stop();
  }

  /** Sends a message and resolves with the saved message (the server's acknowledgement). Rejects after 10 s. */
  sendMessage(recipientId: string, clientMessageId: string, body: string): Promise<Message> {
    const conn = this.connection;
    if (!conn || this._state() !== 'connected') return Promise.reject(new Error('Not connected'));
    return new Promise<Message>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out')), SEND_TIMEOUT_MS);
      conn.invoke<Message>('SendMessage', recipientId, clientMessageId, body).then(
        (m) => {
          clearTimeout(timer);
          resolve(m);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }

  private build(): HubConnection {
    const conn = new HubConnectionBuilder()
      .withUrl(`${environment.apiBaseUrl}/hubs/chat`, {
        // Called for every (re)connect, so an expiring token is refreshed first.
        accessTokenFactory: async () => (await firstValueFrom(this.auth.getValidAccessToken())) ?? '',
      })
      .withAutomaticReconnect(RECONNECT_DELAYS_MS)
      .configureLogging(LogLevel.Warning)
      .build();

    conn.on('ReceiveMessage', (m: Message) => this.messageReceived.next(m));
    conn.onreconnecting(() => {
      if (this.connection === conn) this._state.set('reconnecting');
    });
    conn.onreconnected(() => {
      if (this.connection !== conn) return;
      this._state.set('connected');
      this.reconnected.next();
    });
    conn.onclose(() => {
      // Automatic reconnect gave up: keep retrying on a slow timer for as long as the user is logged in.
      if (!this.wanted || this.connection !== conn) return;
      this._state.set('reconnecting');
      this.scheduleRetry(conn);
    });
    return conn;
  }

  private async run(conn: HubConnection, afterOutage: boolean): Promise<void> {
    try {
      await conn.start();
    } catch {
      if (this.wanted && this.connection === conn) {
        this._state.set('reconnecting');
        this.scheduleRetry(conn);
      }
      return;
    }
    if (!this.wanted || this.connection !== conn) {
      void conn.stop();
      return;
    }
    this._state.set('connected');
    if (afterOutage) this.reconnected.next();
  }

  private scheduleRetry(conn: HubConnection): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      if (this.wanted && this.connection === conn) void this.run(conn, true);
    }, RETRY_MS);
  }
}
