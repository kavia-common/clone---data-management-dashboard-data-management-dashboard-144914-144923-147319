/**
 * Auth and API configuration
 * API_BASE_URL must be absolute and point to external FastAPI by default.
 * If REACT_APP_API_BASE_URL is provided, it will override this default.
 */

import { generateOrganizationId, isTenantSaltValid } from "../utils/crypto";

// ---------------------------------------------
// API base URL (from .env or fallback default)
// ---------------------------------------------
export const API_BASE_URL =
  (process.env.REACT_APP_API_BASE_URL && String(process.env.REACT_APP_API_BASE_URL).trim()) ||
  "https://kaviaqa-worktool.cloud.kavia.ai";

// ---------------------------------------------
// Tenant salt (from environment or default)
// ---------------------------------------------
export const VALIDATED_TENANT_SALT =
  (process.env.REACT_APP_SECRET_SALT && String(process.env.REACT_APP_SECRET_SALT).trim()) ||
  "67486f90cb935d7165b796ba397e1c23"; // safe fallback for local dev

// ---------------------------------------------
// LocalStorage keys and helpers for auth/session
// ---------------------------------------------
export const AUTH_STORAGE_KEY = "auth";

/**
 * Retrieve auth session from localStorage
 */
export function getStoredAuth() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn("Invalid auth storage format", err);
    return null;
  }
}

/**
 * Save auth session to localStorage
 */
export function saveAuthSession(token) {
  const data = token ? { loggedIn: true, token } : { loggedIn: true };
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data));
}

/**
 * Clear stored auth session
 */
export function clearAuthSession() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated() {
  const auth = getStoredAuth();
  return !!(auth && auth.loggedIn);
}

// ---------------------------------------------
// Exports from crypto.js
// ---------------------------------------------
export { generateOrganizationId, isTenantSaltValid };
