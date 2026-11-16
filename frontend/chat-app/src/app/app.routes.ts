import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth.guard';
import { Login } from './features/auth/login';
import { Register } from './features/auth/register';
import { ChatShell } from './features/chat/chat-shell';

export const routes: Routes = [
  { path: 'login', component: Login, canActivate: [guestGuard] },
  { path: 'register', component: Register, canActivate: [guestGuard] },
  { path: '', component: ChatShell, canActivate: [authGuard], pathMatch: 'full' },
  { path: '**', redirectTo: '' },
];
