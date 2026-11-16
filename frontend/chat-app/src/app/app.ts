import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterOutlet } from '@angular/router';
import { environment } from '../environments/environment';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  private readonly http = inject(HttpClient);

  protected readonly health = signal('checking...');

  constructor() {
    // Phase 0 smoke test: proves the SPA can reach the API through CORS.
    this.http.get<{ status: string }>(`${environment.apiBaseUrl}/health`).subscribe({
      next: (r) => this.health.set(r.status),
      error: () => this.health.set('unreachable'),
    });
  }
}
