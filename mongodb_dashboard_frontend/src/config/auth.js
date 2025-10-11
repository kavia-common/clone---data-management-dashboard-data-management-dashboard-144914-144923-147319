/**
 * Auth and API configuration
 * API_BASE_URL must be absolute and point to external FastAPI by default.
 * If REACT_APP_API_BASE_URL is provided, it will override this default.
 */
export const API_BASE_URL =
  (process.env.REACT_APP_API_BASE_URL && String(process.env.REACT_APP_API_BASE_URL).trim()) ||
  'https://kaviaqa-worktool.cloud.kavia.ai';

// Storage keys and helpers for auth/session
export const AUTH_STORAGE_KEY = 'auth';

// PUBLIC_INTERFACE
export function getStoredAuth() {
  /** Returns the stored auth object from localStorage or null if missing/invalid. */
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('Invalid auth storage format', e);
    return null;
  }
}

// PUBLIC_INTERFACE
export function isAuthenticated() {
  /** Returns true if user is logged in based on localStorage flag. */
  const auth = getStoredAuth();
  return !!(auth && auth.loggedIn);
}

// PUBLIC_INTERFACE
export function saveAuthSession(token) {
  /** Saves login session into localStorage. Includes token if provided. */
  const data = token ? { loggedIn: true, token } : { loggedIn: true };
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data));
}

// PUBLIC_INTERFACE
export function clearAuthSession() {
  /** Clears login session from localStorage. */
  localStorage.removeItem(AUTH_STORAGE_KEY);
}
