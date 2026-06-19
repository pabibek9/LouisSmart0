// login-page.js

import { AuthClient } from './auth-client.js';
import { getAuth, sendPasswordResetEmail } from 'firebase/auth';

function onReady(fn) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn);
  } else {
    fn();
  }
}

onReady(() => {
  const form = document.getElementById('loginForm');
  const nameFieldGroup = document.getElementById('nameFieldGroup');
  const nameInput = document.getElementById('authName');
  const emailInput = document.getElementById('authEmail');
  const passwordInput = document.getElementById('authPassword');
  const errorMsg = document.getElementById('errorMsg');
  const submitBtn = document.getElementById('submitBtn');
  const submitBtnText = document.getElementById('submitBtnText');
  const googleBtn = document.getElementById('googleLoginBtn');
  const tabLogin = document.getElementById('tabLogin');
  const tabRegister = document.getElementById('tabRegister');
  const authTitle = document.getElementById('authTitle');
  const authSubtitle = document.getElementById('authSubtitle');
  const sandboxBadge = document.getElementById('sandboxBadge');
  const sandboxTip = document.getElementById('sandboxTip');
  const socialAuthSection = document.getElementById('socialAuthSection');

  let mode = 'login'; // 'login' or 'register'
  let failedAttempts = 0;
  let lockoutUntil = 0;

  function redirectToChat(reason) {
    const lastActiveChatId = localStorage.getItem('mls.chatId');
    const target = lastActiveChatId ? `/chat/${lastActiveChatId}` : '/chat';
    window.location.replace(target);
  }

  // Initial check to see if user is already logged in
  async function init() {
    const isMock = AuthClient.isMock;
    
    // Configure sandbox warning texts based on Mock vs Firebase state
    if (isMock) {
      if (sandboxBadge) sandboxBadge.style.display = 'block';
      if (sandboxTip) sandboxTip.textContent = 'Frontend test mode. Any email/password works for now.';
    } else {
      if (sandboxBadge) sandboxBadge.style.display = 'none';
      if (sandboxTip) sandboxTip.textContent = 'Authentication secured by Firebase.';
    }

    const token = AuthClient.getToken();
    const cachedUser = AuthClient.getUser();
    
    // Optimistic redirect: if cached session exists, bypass forms and direct to chat
    if (token && cachedUser) {
      redirectToChat('Cached Session Found');
      return;
    }

    // Background verification: check if a valid session exists in Firebase (e.g. cookies/IndexedDB)
    try {
      console.log('[login-page.js] No cached session. Checking background verification...');
      const user = await AuthClient.me();
      if (user) {
        redirectToChat('Background Verification Succeeded');
        return;
      }
    } catch (err) {
      console.warn('Initial session restoration failed:', err);
    }

    // Unauthenticated: hide bootstrap loader and show form smoothly
    const loader = document.getElementById('app-bootstrap-loader');
    if (loader) {
      loader.style.opacity = '0';
      loader.style.pointerEvents = 'none';
      setTimeout(() => loader.remove(), 400);
    }
    const wrapper = document.querySelector('.login-wrapper');
    if (wrapper) {
      wrapper.style.opacity = '1';
    }
  }

  // Handle switching modes (Login vs Register tabs)
  function setMode(nextMode) {
    mode = nextMode;
    errorMsg.textContent = '';

    if (mode === 'register') {
      tabLogin.classList.remove('active');
      tabRegister.classList.add('active');
      
      nameFieldGroup.style.display = 'flex';
      nameInput.setAttribute('required', 'required');
      
      submitBtnText.textContent = 'Create account';
      authTitle.textContent = 'Create account';
      authSubtitle.textContent = 'Sign up to start using Louis Smart.';
    } else {
      tabLogin.classList.add('active');
      tabRegister.classList.remove('active');
      
      nameFieldGroup.style.display = 'none';
      nameInput.removeAttribute('required');
      
      submitBtnText.textContent = 'Login';
      authTitle.textContent = 'Welcome back';
      authSubtitle.textContent = 'Login to continue using Louis Smart.';
    }
  }

  // Add click listeners to tabs
  tabLogin.addEventListener('click', () => setMode('login'));
  tabRegister.addEventListener('click', () => setMode('register'));

  // Google sign in click handler
  if (googleBtn) {
    googleBtn.addEventListener('click', async () => {
      errorMsg.textContent = '';
      googleBtn.disabled = true;
      googleBtn.style.opacity = '0.7';
      
      try {
        await AuthClient.loginWithGoogle();
        const user = AuthClient.getUser();
        if (user) {
          const lastActiveChatId = localStorage.getItem('mls.chatId');
          if (lastActiveChatId) {
            window.location.replace(`/chat/${lastActiveChatId}`);
          } else {
            window.location.replace('/chat');
          }
        } else {
          throw new Error('Google sign in did not return user information.');
        }
      } catch (error) {
        errorMsg.textContent = error.message || 'Google sign in failed.';
      } finally {
        googleBtn.disabled = false;
        googleBtn.style.opacity = '1';
      }
    });
  }

  // Handle email form submission
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorMsg.textContent = '';

    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      errorMsg.textContent = 'Please enter your email and password.';
      return;
    }

    if (mode === 'register' && !name) {
      errorMsg.textContent = 'Please enter your name.';
      return;
    }

    // Password strength validation for registration
    if (mode === 'register') {
      if (password.length < 8) {
        errorMsg.textContent = 'Password must be at least 8 characters.';
        return;
      }
      if (!/[A-Z]/.test(password)) {
        errorMsg.textContent = 'Password must contain at least one uppercase letter.';
        return;
      }
      if (!/[0-9]/.test(password)) {
        errorMsg.textContent = 'Password must contain at least one number.';
        return;
      }
    }

    // Brute force protection
    const now = Date.now();
    if (lockoutUntil > now) {
      const waitSec = Math.ceil((lockoutUntil - now) / 1000);
      errorMsg.textContent = `Too many failed attempts. Please wait ${waitSec} seconds.`;
      return;
    }

    // Set loading button states
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;

    try {
      if (mode === 'register') {
        await AuthClient.register(name, email, password);
      } else {
        await AuthClient.login(email, password);
      }

      const user = AuthClient.getUser();
      if (user) {
        const lastActiveChatId = localStorage.getItem('mls.chatId');
        if (lastActiveChatId) {
          window.location.replace(`/chat/${lastActiveChatId}`);
        } else {
          window.location.replace('/chat');
        }
      } else {
        throw new Error('Authentication succeeded but user session is missing.');
      }
    } catch (error) {
      failedAttempts++;
      if (failedAttempts >= 5) {
        const lockoutSeconds = Math.min(60, Math.pow(2, failedAttempts - 4));
        lockoutUntil = Date.now() + lockoutSeconds * 1000;
        errorMsg.textContent = `Too many failed attempts. Please wait ${lockoutSeconds} seconds.`;
      } else {
        errorMsg.textContent = error.message || 'Something went wrong.';
      }
    } finally {
      // Clear loading state
      submitBtn.classList.remove('loading');
      submitBtn.disabled = false;
    }
  });

  // Floating Bubbles click and blast animation logic
  const bubbles = document.querySelectorAll('.floating-bubble');
  bubbles.forEach(bubble => {
    bubble.style.cursor = 'pointer';
    
    bubble.addEventListener('click', (e) => {
      if (bubble.classList.contains('popping')) return;
      
      const rect = bubble.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      // Create expanding ring
      const ring = document.createElement('div');
      ring.className = 'pop-ring';
      ring.style.left = `${centerX}px`;
      ring.style.top = `${centerY}px`;
      document.body.appendChild(ring);
      
      // Create flying particles
      for (let i = 0; i < 8; i++) {
        const particle = document.createElement('div');
        particle.className = 'pop-particle';
        particle.style.left = `${centerX}px`;
        particle.style.top = `${centerY}px`;
        
        const angle = (i * 360 / 8) * (Math.PI / 180);
        const distance = 30 + Math.random() * 20;
        const tx = Math.cos(angle) * distance;
        const ty = Math.sin(angle) * distance;
        
        particle.style.setProperty('--tx', `${tx}px`);
        particle.style.setProperty('--ty', `${ty}px`);
        
        // Random pastel particle color same theme
        particle.style.backgroundColor = `hsl(${Math.random() * 40 + 250}, 80%, 70%)`;
        
        document.body.appendChild(particle);
        
        setTimeout(() => particle.remove(), 600);
      }
      
      setTimeout(() => ring.remove(), 400);
      
      bubble.classList.add('popping');
      setTimeout(() => {
        bubble.remove();
      }, 300);
    });
  });

  // Forgot password handler
  const forgotBtn = document.getElementById('forgotPasswordBtn');
  if (forgotBtn) {
    forgotBtn.addEventListener('click', async () => {
      const email = emailInput.value.trim();
      if (!email) {
        errorMsg.textContent = 'Please enter your email address first.';
        return;
      }
      forgotBtn.disabled = true;
      forgotBtn.textContent = 'Sending...';
      try {
        const auth = getAuth();
        await sendPasswordResetEmail(auth, email);
        errorMsg.textContent = 'Password reset email sent! Check your inbox.';
        errorMsg.style.color = '#22c55e';
      } catch (err) {
        errorMsg.textContent = err.message || 'Could not send password reset email.';
        errorMsg.style.color = '';
      } finally {
        forgotBtn.disabled = false;
        forgotBtn.textContent = 'Forgot password?';
      }
    });
  }

  // Execute initialization
  init();
});
