import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink],
  styleUrl: './auth.scss',
  template: `
    <form class="card" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <div class="brand">Chat</div>
      <h1>Welcome back</h1>

      <label for="email">E-mail</label>
      <input id="email" type="email" formControlName="email" autocomplete="username" />
      @if (showError('email')) { <p class="error">Enter a valid e-mail address.</p> } @else { <p class="error"></p> }

      <label for="password">Password</label>
      <input id="password" type="password" formControlName="password" autocomplete="current-password" />
      @if (showError('password')) { <p class="error">Password is required.</p> } @else { <p class="error"></p> }

      @if (error()) { <p class="error form-error" role="alert">{{ error() }}</p> }
      <button type="submit" [disabled]="busy()">Log in</button>
      <p class="switch">No account? <a routerLink="/register">Create one</a></p>
    </form>
  `,
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  protected showError(name: 'email' | 'password'): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || c.dirty);
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set('');
    const { email, password } = this.form.getRawValue();
    this.auth.login(email, password).subscribe({
      next: () => void this.router.navigate(['/']),
      error: (e: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(
          e.status === 401
            ? 'Incorrect e-mail or password, or the account is temporarily locked.'
            : 'Could not log in. Try again.',
        );
      },
    });
  }
}
