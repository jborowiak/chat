import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, finalize, map, of, shareReplay, switchMap, tap } from 'rxjs';
import { environment } from '../../environments/environment';

export interface CurrentUser {
  id: string;
  displayName: string;
  email: string | null;
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds at which the access token expires. */
  expiresAt: number;
}

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const STORAGE_KEY = 'chat.auth';
/** Refresh this long before the access token actually expires. */
const EXPIRY_SKEW_MS = 60_000;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly api = `${environment.apiBaseUrl}/api`;

  private readonly _user = signal<CurrentUser | null>(null);
  private readonly _tokens = signal<Tokens | null>(this.readStorage());
  private refreshInFlight: Observable<string> | null = null;

  readonly user = this._user.asReadonly();
  readonly tokens = this._tokens.asReadonly();
  readonly isLoggedIn = computed(() => this._tokens() !== null);

  /** Called at startup: restores the user profile if tokens are stored. */
  restoreSession(): Observable<unknown> {
    if (!this._tokens()) return of(null);
    return this.loadMe().pipe(catchError(() => of(null)));
  }

  register(email: string, password: string, displayName: string): Observable<unknown> {
    return this.http.post(`${this.api}/auth/register`, { email, password, displayName });
  }

  login(email: string, password: string): Observable<CurrentUser> {
    return this.http.post<TokenResponse>(`${this.api}/auth/login`, { email, password }).pipe(
      tap((r) => this.setTokens(r)),
      switchMap(() => this.loadMe()),
    );
  }

  logout(): void {
    this.clear();
    void this.router.navigate(['/login']);
  }

  /** Returns a valid access token, refreshing first if it is about to expire. */
  getValidAccessToken(): Observable<string | null> {
    const t = this._tokens();
    if (!t) return of(null);
    if (t.expiresAt - EXPIRY_SKEW_MS > Date.now()) return of(t.accessToken);
    return this.refresh().pipe(catchError(() => of(null)));
  }

  /** Exchanges the refresh token for new tokens. Concurrent callers share one request. */
  refresh(): Observable<string> {
    const t = this._tokens();
    if (!t) throw new Error('Not logged in');
    this.refreshInFlight ??= this.http
      .post<TokenResponse>(`${this.api}/auth/refresh`, { refreshToken: t.refreshToken })
      .pipe(
        tap((r) => this.setTokens(r)),
        map((r) => r.accessToken),
        finalize(() => (this.refreshInFlight = null)),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    return this.refreshInFlight;
  }

  /** Clears local session state without navigating. */
  clear(): void {
    this._tokens.set(null);
    this._user.set(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
  }

  private loadMe(): Observable<CurrentUser> {
    return this.http.get<CurrentUser>(`${this.api}/me`).pipe(tap((u) => this._user.set(u)));
  }

  private setTokens(r: TokenResponse): void {
    const tokens: Tokens = {
      accessToken: r.accessToken,
      refreshToken: r.refreshToken,
      expiresAt: Date.now() + r.expiresIn * 1000,
    };
    this._tokens.set(tokens);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    } catch {
      /* storage unavailable */
    }
  }

  private readStorage(): Tokens | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Tokens) : null;
    } catch {
      return null;
    }
  }
}
