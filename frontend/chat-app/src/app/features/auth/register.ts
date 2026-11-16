import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink],
  styleUrl: './auth.scss',
  template: `
    <form class="card" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <div class="brand">Chat</div>
      <h1>Create account</h1>

      <label for="displayName">Display name</label>
      <input id="displayName" formControlName="displayName" autocomplete="nickname" />
      @if (showError('displayName')) { <p class="error">Use 2 to 50 characters.</p> } @else { <p class="error"></p> }

      <label for="email">E-mail</label>
      <input id="email" type="email" formControlName="email" autocomplete="username" />
      @if (showError('email')) { <p class="error">Enter a valid e-mail address.</p> } @else { <p class="error"></p> }

      <label for="password">Password</label>
      <input id="password" type="password" formControlName="password" autocomplete="new-password" />
      @if (showError('password')) {
        <p class="error">At least 8 characters, with an upper-case letter, a lower-case letter, a digit and a symbol.</p>
      } @else { <p class="error"></p> }

      @for (m of serverErrors(); track m) { <p class="error" role="alert">{{ m }}</p> }
      <button type="submit" [disabled]="busy()">Create account</button>
      <p class="switch">Already registered? <a routerLink="/login">Log in</a></p>
    </form>
  `,
})
export class Register {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly busy = signal(false);
  protected readonly serverErrors = signal<string[]>([]);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    displayName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(50)]],
    email: ['', [Validators.required, Validators.email]],
    password: [
      '',
      [Validators.required, Validators.minLength(8), Validators.pattern(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])/)],
    ],
  });

  protected showError(name: 'displayName' | 'email' | 'password'): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || c.dirty);
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.serverErrors.set([]);
    const { email, password, displayName } = this.form.getRawValue();
    this.auth.register(email, password, displayName).subscribe({
      // Registering also logs the user in (US-01).
      next: () =>
        this.auth.login(email, password).subscribe({
          next: () => void this.router.navigate(['/']),
          error: () => void this.router.navigate(['/login']),
        }),
      error: (e: HttpErrorResponse) => {
        this.busy.set(false);
        const errors = (e.error?.errors ?? {}) as Record<string, string[]>;
        const messages = Object.values(errors).flat();
        this.serverErrors.set(messages.length ? messages : ['Could not register. Try again.']);
      },
    });
  }
}
