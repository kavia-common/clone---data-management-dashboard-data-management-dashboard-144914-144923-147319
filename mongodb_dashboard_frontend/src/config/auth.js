// src/config/auth.js
// central auth/config for frontend

// API base URL (env or default)
export const API_BASE_URL =
  (process.env.REACT_APP_API_BASE_URL && String(process.env.REACT_APP_API_BASE_URL).trim()) ||
  "https://kaviaqa-worktool.cloud.kavia.ai";

// Read salt from either common env names (compatibility)
const RAW_SALT =
  String(process.env.REACT_APP_AUTH_SECRET_SALT || "").trim();

// Expose salt value (frontend will use it in crypto helpers)
export const VALIDATED_TENANT_SALT = RAW_SALT;

// Storage helpers used across app
export const AUTH_STORAGE_KEY = "auth";

export function getStoredAuth() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn("Invalid auth storage format", e);
    return null;
  }
}

export function saveAuthSession(token) {
  const data = token ? { loggedIn: true, token } : { loggedIn: true };
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("Failed to store auth session:", e);
  }
}

export function clearAuthSession() {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch (e) {
    console.warn("Failed to clear auth session:", e);
  }
}

export function isAuthenticated() {
  const a = getStoredAuth();
  return !!(a && a.loggedIn);
}
