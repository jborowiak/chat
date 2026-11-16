import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../environments/environment';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';

const api = environment.apiBaseUrl;

describe('authInterceptor', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;
  let auth: AuthService;

  beforeEach(() => {
    localStorage.setItem(
      'chat.auth',
      JSON.stringify({ accessToken: 'old', refreshToken: 'r1', expiresAt: Date.now() + 3_600_000 }),
    );
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'login', children: [] }]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => localStorage.clear());

  it('adds the bearer token to API calls', () => {
    http.get(`${api}/api/me`).subscribe();
    const req = ctrl.expectOne(`${api}/api/me`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer old');
    req.flush({});
  });

  it('refreshes once on a 401 and retries with the new token', () => {
    let result: unknown;
    http.get(`${api}/api/me`).subscribe((r) => (result = r));
    ctrl.expectOne(`${api}/api/me`).flush(null, { status: 401, statusText: 'Unauthorized' });

    const refresh = ctrl.expectOne(`${api}/api/auth/refresh`);
    expect(refresh.request.body).toEqual({ refreshToken: 'r1' });
    refresh.flush({ accessToken: 'new', refreshToken: 'r2', expiresIn: 3600 });

    const retry = ctrl.expectOne(`${api}/api/me`);
    expect(retry.request.headers.get('Authorization')).toBe('Bearer new');
    retry.flush({ ok: true });
    expect(result).toEqual({ ok: true });
  });

  it('logs out when the refresh fails', () => {
    http.get(`${api}/api/me`).subscribe({ error: () => undefined });
    ctrl.expectOne(`${api}/api/me`).flush(null, { status: 401, statusText: 'Unauthorized' });
    ctrl.expectOne(`${api}/api/auth/refresh`).flush(null, { status: 401, statusText: 'Unauthorized' });
    expect(auth.isLoggedIn()).toBe(false);
    expect(localStorage.getItem('chat.auth')).toBeNull();
  });
});
