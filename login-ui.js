// login-ui.js

import { AuthClient } from './auth-client.js';

export function createLoginScreen({ onAuthenticated }) {
  const root = document.createElement('div');
  root.className = 'auth-screen';
  
  const isMock = AuthClient.isMock;
  const mockBadge = isMock 
    ? `<div class="auth-mock-badge" title="Set Firebase config in .env to connect to production Firebase">Sandbox Mode</div>` 
    : '';

  root.innerHTML = `
    <div class="auth-card">
      ${mockBadge}
      <div class="auth-brand">
        <div class="auth-logo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v3"/><path d="M12 19v3"/><path d="M4.93 4.93l2.12 2.12"/><path d="M16.95 16.95l2.12 2.12"/><path d="M2 12h3"/><path d="M19 12h3"/><path d="M4.93 19.07l2.12-2.12"/><path d="M16.95 7.05l2.12-2.12"/><circle cx="12" cy="12" r="3"/></svg>
        </div>
        <h1>Welcome back</h1>
        <p>Login to continue using Mate Louis Smart.</p>
      </div>

      <button type="button" class="auth-google-btn" id="authGoogleBtn">
        <svg class="google-icon" viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
        </svg>
        <span>Sign in with Google</span>
      </button>

      <div class="auth-divider">
        <span>or use email</span>
      </div>

      <div class="auth-tabs">
        <button type="button" class="auth-tab active" data-mode="login">Login</button>
        <button type="button" class="auth-tab" data-mode="register">Create account</button>
      </div>

      <form class="auth-form" id="authForm">
        <div class="auth-field auth-name-field" style="display:none;">
          <label for="authName">Name</label>
          <input id="authName" type="text" placeholder="Your name" autocomplete="name" />
        </div>

        <div class="auth-field">
          <label for="authEmail">Email</label>
          <input id="authEmail" type="email" placeholder="you@example.com" autocomplete="email" required />
        </div>

        <div class="auth-field">
          <label for="authPassword">Password</label>
          <input id="authPassword" type="password" placeholder="••••••••" autocomplete="current-password" required />
        </div>

        <button class="auth-submit" type="submit">
          <span class="auth-submit-text">Login</span>
          <span class="auth-spinner" aria-hidden="true"></span>
        </button>

        <p class="auth-error" id="authError"></p>
      </form>
      
      ${isMock ? `<p class="auth-sandbox-tip">Running in offline sandbox. Set environment variables to enable Firebase production.</p>` : ''}
    </div>
  `;

  let mode = 'login';
  let failedAttempts = 0;
  let lockoutUntil = 0;

  const form = root.querySelector('#authForm');
  const nameField = root.querySelector('.auth-name-field');
  const nameInput = root.querySelector('#authName');
  const emailInput = root.querySelector('#authEmail');
  const passwordInput = root.querySelector('#authPassword');
  const errorEl = root.querySelector('#authError');
  const submitBtn = root.querySelector('.auth-submit');
  const submitText = root.querySelector('.auth-submit-text');
  const tabs = root.querySelectorAll('.auth-tab');
  const googleBtn = root.querySelector('#authGoogleBtn');

  function setMode(nextMode) {
    mode = nextMode;

    tabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.mode === mode);
    });

    nameField.style.display = mode === 'register' ? 'block' : 'none';
    submitText.textContent = mode === 'register' ? 'Create account' : 'Login';
    errorEl.textContent = '';

    if (mode === 'register') {
      nameInput.setAttribute('required', 'required');
    } else {
      nameInput.removeAttribute('required');
    }
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => setMode(tab.dataset.mode));
  });

  // Google Sign-In click handler
  googleBtn.addEventListener('click', async () => {
    errorEl.textContent = '';
    googleBtn.disabled = true;
    googleBtn.style.opacity = '0.7';
    
    try {
      await AuthClient.loginWithGoogle();
      onAuthenticated?.(AuthClient.getUser());
    } catch (error) {
      errorEl.textContent = error.message || 'Google sign in failed.';
    } finally {
      googleBtn.disabled = false;
      googleBtn.style.opacity = '1';
    }
  });

  // Form submit handler
  form.addEventListener('submit', async event => {
    event.preventDefault();

    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    errorEl.textContent = '';

    if (!email || !password) {
      errorEl.textContent = 'Please enter your email and password.';
      return;
    }

    if (mode === 'register' && !name) {
      errorEl.textContent = 'Please enter your name.';
      return;
    }

    // Password strength validation for registration
    if (mode === 'register') {
      if (password.length < 8) {
        errorEl.textContent = 'Password must be at least 8 characters.';
        return;
      }
      if (!/[A-Z]/.test(password)) {
        errorEl.textContent = 'Password must contain at least one uppercase letter.';
        return;
      }
      if (!/[0-9]/.test(password)) {
        errorEl.textContent = 'Password must contain at least one number.';
        return;
      }
    }

    // Brute force protection
    const now = Date.now();
    if (lockoutUntil > now) {
      const waitSec = Math.ceil((lockoutUntil - now) / 1000);
      errorEl.textContent = `Too many failed attempts. Please wait ${waitSec} seconds.`;
      return;
    }


    submitBtn.classList.add('loading');
    submitBtn.disabled = true;

    try {
      if (mode === 'register') {
        await AuthClient.register(name, email, password);
      } else {
        await AuthClient.login(email, password);
      }

      onAuthenticated?.(AuthClient.getUser());
    } catch (error) {
      failedAttempts++;
      if (failedAttempts >= 5) {
        const lockoutSeconds = Math.min(60, Math.pow(2, failedAttempts - 4));
        lockoutUntil = Date.now() + lockoutSeconds * 1000;
        errorEl.textContent = `Too many failed attempts. Please wait ${lockoutSeconds} seconds.`;
      } else {
        errorEl.textContent = error.message || 'Something went wrong.';
      }
    } finally {
      submitBtn.classList.remove('loading');
      submitBtn.disabled = false;
    }
  });

  return root;
}