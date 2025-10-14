import axios from "axios";

 // Build base URLs from environment variables. Avoid hardcoding.
 // REACT_APP_API_BASE_URL: e.g., http://localhost:3001
 // REACT_APP_API_PREFIX: default "/api" (backend mounts public routes under /api/*)
 // REACT_APP_BACKEND_PORT: optional (defaults to 3001) used for auto-detection fallback
function inferBackendBase() {
  /**
   * Attempt to infer backend origin when REACT_APP_API_BASE_URL is not provided.
   * In HTTPS previews (or any https origin), do NOT infer a cross-origin http(s)://host:3001,
   * because that often causes mixed-content or TLS handshake failures.
   * Instead return empty string so the client uses a same-origin relative '/api' base,
   * which will be forwarded by CRA's proxy (src/setupProxy.js).
   */
  try {
    if (typeof window === "undefined") return "";
    const { protocol, hostname } = window.location;
    const proto = (protocol || "").replace(":", "");
    // If current page is https, avoid inferring a different origin to prevent mixed content.
    if (proto === "https") {
      return "";
    }
    const backendPort = process.env.REACT_APP_BACKEND_PORT || "3001";
    return `${protocol}//${hostname}:${backendPort}`;
  } catch {
    return "";
  }
}
const RAW_BASE_URL =
  process.env.REACT_APP_API_URL || // allow REACT_APP_API_URL as requested
  process.env.REACT_APP_API_BASE_URL || // backward compatibility with README
  inferBackendBase() ||
  "";
const API_PREFIX = process.env.REACT_APP_API_PREFIX || "/api";

// Normalize base URL + prefix, avoiding double slashes
function joinUrl(base, path) {
  if (!base) return path || "";
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path ? (path.startsWith("/") ? path : `/${path}`) : "";
  return `${b}${p}`;
}

const API_BASE_URL = joinUrl(RAW_BASE_URL, API_PREFIX);

// Keys for localStorage persistence
const LS_TOKEN_KEY = "dashboard_token";
const LS_USER_KEY = "dashboard_user";

/**
 * Internal: get token from localStorage.
 */
function getToken() {
  try {
    return localStorage.getItem(LS_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

/**
 * Internal: persist auth token.
 */
function setToken(token) {
  try {
    if (token) localStorage.setItem(LS_TOKEN_KEY, token);
    else localStorage.removeItem(LS_TOKEN_KEY);
  } catch {
    // ignore storage errors in restrictive environments
  }
}

/**
 * Internal: persist user profile (optional).
 */
function setUser(user) {
  try {
    if (user) localStorage.setItem(LS_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(LS_USER_KEY);
  } catch {
    // ignore storage errors
  }
}

/**
 * Internal: get persisted user profile or null.
 */
function getUser() {
  try {
    const raw = localStorage.getItem(LS_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Create configured axios instance for API routes under /api
const api = axios.create({
  baseURL: API_BASE_URL || "/api",
  headers: {
    "Content-Type": "application/json",
  },
});

// Attach Authorization header on each request if token exists
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    // Use Bearer token as standard
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 globally by clearing token to force re-login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      setToken("");
      setUser(null);
      // soft redirect hint for callers
      error.isAuthError = true;
    }
    return Promise.reject(error);
  }
);

// Helper to normalize list responses from backend { success, data, meta }
function normalizeListResponse(res) {
  const payload = res?.data || {};
  const items = Array.isArray(payload) ? payload : payload.data || [];
  const total =
    (payload.meta && typeof payload.meta.total === "number" && payload.meta.total) ||
    (Array.isArray(items) ? items.length : 0);
  return { items, total, meta: payload.meta || null };
}

// PUBLIC_INTERFACE
export function getApiClient() {
  /** Returns the configured Axios instance for advanced usage. */
  return api;
}

// PUBLIC_INTERFACE
export function getStoredAuth() {
  /** Returns the currently stored user and token from localStorage. */
  return { token: getToken(), user: getUser() };
}

// PUBLIC_INTERFACE
export function persistAuth(token, user) {
  /** Persists token and user to localStorage (used after login/register). */
  setToken(token);
  setUser(user || null);
}

// PUBLIC_INTERFACE
export async function health() {
  /** Calls /openapi.json to verify backend connectivity (proxied when using dev server). */
  const rootBase = RAW_BASE_URL || ""; // same-origin if empty (relies on setupProxy)
  const url = rootBase ? joinUrl(rootBase, "/openapi.json") : "/openapi.json";
  const res = await axios.get(url);
  return res.data;
}

// PUBLIC_INTERFACE
export async function loginApi(credentials) {
  /** POST /auth/login with { email, password } and returns { token, user }. */
  const res = await api.post("/auth/login", credentials);
  return res.data;
}

// PUBLIC_INTERFACE
export async function registerApi(payload) {
  /** POST /auth/register with { name, email, password } and returns { token, user }. */
  const res = await api.post("/auth/register", payload);
  return res.data;
}

// Collection APIs

/** Internal helper: ensure filter param is JSON.stringified when provided. */
function withStringifiedFilter(params = {}) {
  const p = { ...(params || {}) };
  if (p.filter && typeof p.filter === "object") {
    try {
      p.filter = JSON.stringify(p.filter);
    } catch {
      // leave as-is if stringify fails
    }
  }
  return p;
}

// PUBLIC_INTERFACE
export async function listUsers(params = {}) {
  /** GET /api/users with optional query params for filtering/pagination. */
  const res = await api.get("/users", { params: withStringifiedFilter(params) });
  return normalizeListResponse(res);
}

// PUBLIC_INTERFACE
export async function createUser(body) {
  /** POST /api/users to create a new user/referral record. */
  const res = await api.post("/users", body);
  return res.data?.data ?? res.data;
}

// PUBLIC_INTERFACE
export async function updateUser(id, body) {
  /** PUT /api/users/:id to update a user/referral record. */
  const res = await api.put(`/users/${id}`, body);
  return res.data?.data ?? res.data;
}

// PUBLIC_INTERFACE
export async function deleteUser(id) {
  /** DELETE /api/users/:id to remove a user/referral record. */
  const res = await api.delete(`/users/${id}`);
  return res.data?.data ?? res.data;
}

/* See withStringifiedFilter above */
// PUBLIC_INTERFACE
export async function listSessions(params = {}) {
  /** GET /api/session-tracking with optional filters. */
  const res = await api.get("/session-tracking", { params: withStringifiedFilter(params) });
  return normalizeListResponse(res);
}

// PUBLIC_INTERFACE
export async function createSession(body) {
  /** POST /api/session-tracking to create a session record. */
  const res = await api.post("/session-tracking", body);
  return res.data?.data ?? res.data;
}

// PUBLIC_INTERFACE
export async function updateSession(id, body) {
  /** PUT /api/session-tracking/:id to update a session record. */
  const res = await api.put(`/session-tracking/${id}`, body);
  return res.data?.data ?? res.data;
}

// PUBLIC_INTERFACE
export async function deleteSession(id) {
  /** DELETE /api/session-tracking/:id to remove a session record. */
  const res = await api.delete(`/session-tracking/${id}`);
  return res.data?.data ?? res.data;
}

/* See withStringifiedFilter above */
// PUBLIC_INTERFACE
export async function listDeployments(params = {}) {
  /** GET /api/app-deployments with optional filters. */
  const res = await api.get("/app-deployments", { params: withStringifiedFilter(params) });
  return normalizeListResponse(res);
}

// PUBLIC_INTERFACE
export async function createDeployment(body) {
  /** POST /api/app-deployments to create a new deployment record. */
  const res = await api.post("/app-deployments", body);
  return res.data?.data ?? res.data;
}

// PUBLIC_INTERFACE
export async function updateDeployment(id, body) {
  /** PUT /api/app-deployments/:id to update a deployment record. */
  const res = await api.put(`/app-deployments/${id}`, body);
  return res.data?.data ?? res.data;
}

// PUBLIC_INTERFACE
export async function deleteDeployment(id) {
  /** DELETE /api/app-deployments/:id to remove a deployment record. */
  const res = await api.delete(`/app-deployments/${id}`);
  return res.data?.data ?? res.data;
}
