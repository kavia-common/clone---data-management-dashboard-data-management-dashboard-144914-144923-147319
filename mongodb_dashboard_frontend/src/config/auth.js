/**
 * Auth and API configuration
 * API_BASE_URL must be absolute and point to external FastAPI by default.
 * If REACT_APP_API_BASE_URL is provided, it will override this default.
 */
// PUBLIC_INTERFACE
export const API_BASE_URL =
  (process.env.REACT_APP_API_BASE_URL && String(process.env.REACT_APP_API_BASE_URL).trim()) ||
  'https://kaviaqa-worktool.cloud.kavia.ai';

/**
 * PUBLIC_INTERFACE
 * Tenant secret salt for the frontend.
 * IMPORTANT: organization_id in login payload MUST equal this exact value (no encryption/encoding).
 * Single source of truth: REACT_APP_SECRET_SALT (URL-safe, no padding).
 * This module validates the presence and format of the environment variable and will throw
 * a clear error if it's missing or invalid to prevent insecure defaults.
 */
const ENV_SALT =
  (typeof process !== 'undefined' &&
    process.env &&
    String(process.env.REACT_APP_SECRET_SALT || '').trim()) ||
  '';

function normalizeBase64Url(s) {
  // Ensure a base64url-safe string without padding
  return String(s || '')
    .trim()
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/**
 * Validate env-provided salt strictly:
 * - Must be non-empty
 * - After normalization, must be >= 16 characters to avoid trivial/placeholder values
 * - Only URL-safe base64 characters [-_A-Za-z0-9] (enforced by normalization + regex)
 */
// Validate but do not throw at module import time. Consumers can call validate explicitly.
function validateSaltOrThrow(raw) {
  const normalized = normalizeBase64Url(raw);
  if (!normalized) {
    const msg =
      'REACT_APP_SECRET_SALT is required but was not provided. Please set it in your environment (e.g., .env) before using auth features.';
    throw new Error(msg);
  }
  if (normalized.length < 16) {
    throw new Error(
      'REACT_APP_SECRET_SALT is too short after normalization. Provide a sufficiently random URL-safe string (>=16 chars).'
    );
  }
  if (!/^[A-Za-z0-9\-_]+$/.test(normalized)) {
    throw new Error(
      'REACT_APP_SECRET_SALT contains invalid characters. Use only URL-safe base64 characters (A-Z, a-z, 0-9, -, _).'
    );
  }
  return normalized;
}

// PUBLIC_INTERFACE
export function getValidatedTenantSalt() {
  /** Returns validated tenant salt or throws if invalid/missing. */
  return validateSaltOrThrow(ENV_SALT);
}

// PUBLIC_INTERFACE
export function tryGetTenantSalt() {
  /** Returns normalized tenant salt or null if missing/invalid (no throw). */
  try {
    return validateSaltOrThrow(ENV_SALT);
  } catch {
    return null;
  }
}

// PUBLIC_INTERFACE
export const VALIDATED_TENANT_SALT = undefined; // deprecated constant to prevent import-time evaluation

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
