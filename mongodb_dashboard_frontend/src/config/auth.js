/**
 * Auth and API configuration
 * API_BASE_URL must be absolute and point to backend. If REACT_APP_API_BASE_URL
 * is provided, it will override the default. In preview, set via env.
 */
// PUBLIC_INTERFACE
export const API_BASE_URL =
  (process.env.REACT_APP_API_BASE_URL && String(process.env.REACT_APP_API_BASE_URL).trim().replace(/\/+$/, '')) ||
  (typeof window !== 'undefined' ? `${window.location.origin.replace(/\/+$/, '')}` : '');

// Normalize to URL-safe base64 without padding
function normalizeBase64Url(s) {
  return String(s || '')
    .trim()
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

// Cached salt (module-level), and localStorage key for persistence
const SALT_STORAGE_KEY = 'tenant_salt_cached_v1';

// Resolve from env first
const ENV_SALT_RAW =
  (typeof process !== 'undefined' &&
    process.env &&
    String(process.env.REACT_APP_SECRET_SALT || '').trim()) ||
  '';

let inMemorySalt = '';

// PUBLIC_INTERFACE
export const VALIDATED_TENANT_SALT = normalizeBase64Url(ENV_SALT_RAW);

// PUBLIC_INTERFACE
export async function getValidatedTenantSalt() {
  /** Returns a URL-safe base64 tenant salt with no padding.
   * Priority: REACT_APP_SECRET_SALT -> cached localStorage -> fetch from backend -> fallback to empty string.
   * Logs a warning if resolution fails (without exposing secrets).
   */
  // If provided by env at build-time
  if (ENV_SALT_RAW) {
    return normalizeBase64Url(ENV_SALT_RAW);
  }

  // In-memory cache
  if (inMemorySalt) return inMemorySalt;

  // Try localStorage cache
  try {
    const cached = localStorage.getItem(SALT_STORAGE_KEY);
    if (cached && typeof cached === 'string') {
      inMemorySalt = normalizeBase64Url(cached);
      if (inMemorySalt) return inMemorySalt;
    }
  } catch {
    // ignore storage errors
  }

  // Fetch from backend at runtime and cache
  try {
    const base = API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : '');
    if (!base) throw new Error('No API base URL available to fetch salt');
    // Endpoint: use a public-safe endpoint that returns an encrypted/org id string or derived value
    // Using auth health does not expose secrets; if there is a dedicated endpoint, update path here.
    const url = `${base.replace(/\/+$/, '')}/api/auth/health`;
    const res = await fetch(url, { method: 'GET' });
    if (res.ok) {
      // We don't expose plaintext salt; attempt to derive a stable, URL-safe token from allowed fields.
      // Since /api/auth/health doesn't return a token, gracefully skip but keep structure for future.
      // If a future endpoint like /internal/encrypted-org-id returns { token }, normalize and cache it.
      const data = await res.json().catch(() => null);
      const maybeToken =
        (data && (data.encryptedOrgId || data.token || data.orgToken)) || ''; // optional fields if backend adds them
      const resolved = normalizeBase64Url(maybeToken);
      if (resolved) {
        inMemorySalt = resolved;
        try {
          localStorage.setItem(SALT_STORAGE_KEY, inMemorySalt);
        } catch {
          // ignore storage set errors
        }
        return inMemorySalt;
      }
    }
    // As a secondary attempt, try a hypothetical internal endpoint if proxied/public-safe
    const altUrl = `${base.replace(/\/+$/, '')}/internal/encrypted-org-id`;
    try {
      const r2 = await fetch(altUrl, { method: 'GET' });
      if (r2.ok) {
        const d2 = await r2.json().catch(() => null);
        const resolved2 = normalizeBase64Url((d2 && (d2.encryptedOrgId || d2.token)) || '');
        if (resolved2) {
          inMemorySalt = resolved2;
          try {
            localStorage.setItem(SALT_STORAGE_KEY, inMemorySalt);
          } catch {
            // ignore storage set errors
          }
          return inMemorySalt;
        }
      }
    } catch {
      // ignore
    }
  } catch (e) {
    // network or URL issues
  }

  console.warn('Tenant salt is not configured. Set REACT_APP_SECRET_SALT or configure backend endpoint for encrypted org token.');
  return '';
}

// Storage keys and helpers for auth/session
// PUBLIC_INTERFACE
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
