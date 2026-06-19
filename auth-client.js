// auth-client.js

import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  onAuthStateChanged,
  updateProfile
} from 'firebase/auth';

const AUTH_TOKEN_KEY = 'mls.auth_token';
const AUTH_USER_KEY = 'mls.auth_user';

// Firebase Config loaded from server endpoint (never embedded in client bundle)
let firebaseConfig = {};
let isFirebaseConfigured = false;

let app;
let auth;
let googleProvider;

try {
  const configRes = await fetch('/api/config');
  firebaseConfig = await configRes.json();
  isFirebaseConfigured = !!firebaseConfig.apiKey;
} catch (err) {
  console.error('Failed to load Firebase config:', err);
}

if (isFirebaseConfigured) {
  try {
    app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    auth = getAuth(app);
    googleProvider = new GoogleAuthProvider();
  } catch (err) {
    console.error('Firebase Initialization Error:', err);
  }
} else {
  console.warn('Firebase configuration is missing. Running in Mock Authentication mode.');
}

// Track state for synchronous lookups
let currentFirebaseUser = null;
let authStateResolved = false;

// If Firebase is configured, listen to auth state changes
if (isFirebaseConfigured && auth) {
  console.log('[AuthClient] Registering global onAuthStateChanged listener');
  onAuthStateChanged(auth, async (user) => {
    console.log('[AuthClient] onAuthStateChanged callback fired. User:', user ? user.email : 'null');
    if (user) {
      currentFirebaseUser = user;
      authStateResolved = true;
      try {
        const token = await user.getIdToken();
        console.log('[AuthClient] Storing user and token in localStorage');
        localStorage.setItem(AUTH_TOKEN_KEY, token);
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(AuthClient._mapFirebaseUser(user)));
      } catch (err) {
        console.error('[AuthClient] Error getting user token:', err);
      }
    } else {
      console.log('[AuthClient] User is null. Awaiting authStateReady...');
      // Wait for Firebase Auth to be ready before concluding the user is signed out
      await auth.authStateReady();
      console.log('[AuthClient] authStateReady resolved in listener. currentUser:', auth.currentUser ? auth.currentUser.email : 'null');
      // Double check if the user is still null after authStateReady
      if (!auth.currentUser) {
        currentFirebaseUser = null;
        authStateResolved = true;
        const hadUser = localStorage.getItem(AUTH_USER_KEY);
        console.log('[AuthClient] User is truly null. hadUser in cache:', hadUser ? 'yes' : 'no');
        if (hadUser) {
          console.log('[AuthClient] Dispatching session-expired event');
          window.dispatchEvent(new CustomEvent('session-expired'));
        }
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_USER_KEY);
      } else {
        console.log('[AuthClient] auth.currentUser is not null. Ignoring initial null state.');
      }
    }
  });
}

export const AuthClient = {
  isMock: !isFirebaseConfigured,

  getToken() {
    // If Firebase is active and user exists, trigger async token refresh
    if (isFirebaseConfigured && auth?.currentUser) {
      auth.currentUser.getIdToken().then(freshToken => {
        localStorage.setItem(AUTH_TOKEN_KEY, freshToken);
      }).catch(() => {});
    }
    return localStorage.getItem(AUTH_TOKEN_KEY);
  },

  getUser() {
    try {
      return JSON.parse(localStorage.getItem(AUTH_USER_KEY) || 'null');
    } catch {
      return null;
    }
  },

  setSession(token, user) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  },

  clearSession() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
  },

  _mapFirebaseUser(user) {
    if (!user) return null;
    return {
      uid: user.uid, // Capture permanent unique identifier
      id: user.uid,  // Deprecated fallback ID for compatibility
      name: user.displayName || user.email.split('@')[0],
      email: user.email,
      photoURL: user.photoURL,
      role: 'user'
    };
  },

  async login(email, password) {
    if (!isFirebaseConfigured || !auth) {
      throw new Error('Authentication service is unavailable. Please check your configuration and try again.');
    }

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = this._mapFirebaseUser(userCredential.user);
      const token = await userCredential.user.getIdToken();
      this.setSession(token, user);
      return { success: true, token, user };
    } catch (error) {
      console.error('Firebase Login Error:', error);
      throw new Error(this._getFriendlyErrorMessage(error));
    }
  },

  async register(name, email, password) {
    if (!isFirebaseConfigured || !auth) {
      throw new Error('Authentication service is unavailable. Please check your configuration and try again.');
    }

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      // Update the user's displayName in Firebase
      await updateProfile(userCredential.user, { displayName: name });
      
      const user = this._mapFirebaseUser(userCredential.user);
      const token = await userCredential.user.getIdToken();
      this.setSession(token, user);
      return { success: true, token, user };
    } catch (error) {
      console.error('Firebase Registration Error:', error);
      throw new Error(this._getFriendlyErrorMessage(error));
    }
  },

  async loginWithGoogle() {
    if (!isFirebaseConfigured || !auth) {
      throw new Error('Google sign-in is unavailable. Firebase is not configured.');
    }

    try {
      const userCredential = await signInWithPopup(auth, googleProvider);
      const user = this._mapFirebaseUser(userCredential.user);
      const token = await userCredential.user.getIdToken();
      this.setSession(token, user);
      return { success: true, token, user };
    } catch (error) {
      console.error('Firebase Google Sign-In Error:', error);
      throw new Error(this._getFriendlyErrorMessage(error));
    }
  },

  async me() {
    console.log('[AuthClient] me() called. isFirebaseConfigured:', isFirebaseConfigured, 'auth exists:', !!auth);
    if (!isFirebaseConfigured || !auth) {
      // Validate cached session exists
      const cached = this.getUser();
      console.log('[AuthClient] me() [Mock/Missing Config] cached user:', cached ? cached.email : 'null');
      if (!cached) return null;
      const token = this.getToken();
      if (!token) {
        this.clearSession();
        return null;
      }
      return cached;
    }

    // Wait for the Firebase Auth state to resolve initially
    console.log('[AuthClient] me() awaiting authStateReady...');
    await auth.authStateReady();
    console.log('[AuthClient] me() authStateReady resolved. currentUser:', auth.currentUser ? auth.currentUser.email : 'null');
    currentFirebaseUser = auth.currentUser;
    authStateResolved = true;
    return currentFirebaseUser ? this._mapFirebaseUser(currentFirebaseUser) : null;
  },

  async logout() {
    if (isFirebaseConfigured && auth) {
      try {
        await signOut(auth);
      } catch (err) {
        console.error('Firebase SignOut Error:', err);
      }
    }
    this.clearSession();
    window.location.href = '/login';
  },

  authHeaders() {
    const token = this.getToken();
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  },

  _getFriendlyErrorMessage(error) {
    switch (error.code) {
      case 'auth/invalid-email':
        return 'The email address is badly formatted.';
      case 'auth/user-disabled':
        return 'This user account has been disabled.';
      case 'auth/user-not-found':
        return 'No user found with this email.';
      case 'auth/wrong-password':
        return 'Incorrect password. Please try again.';
      case 'auth/email-already-in-use':
        return 'An account already exists with this email.';
      case 'auth/weak-password':
        return 'The password is too weak. Must be at least 6 characters.';
      case 'auth/operation-not-allowed':
        return 'Email/password accounts are not enabled in Firebase Console.';
      case 'auth/popup-closed-by-user':
        return 'The login popup was closed before completing.';
      case 'auth/cancelled-popup-request':
        return 'The sign-in popup was cancelled.';
      default:
        return error.message || 'An error occurred during authentication.';
    }
  }
};
