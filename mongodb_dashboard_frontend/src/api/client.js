import axios from "axios";

/**
 * API client configuration
 * Enforces environment-driven API base URL and /api prefix.
 *
 * Priority:
 * 1) REACT_APP_API_URL or REACT_APP_API_BASE_URL (recommended)
 * 2) Soft fallback: same-origin (no port inference, no localhost)
 */

// Build base URLs from environment variables. Avoid hardcoding.
function resolveBackendBase() {
  try {
    const envUrl = "https://vscode-internal-33195-beta.beta01.cloud.kavia.ai:3001" || process.env.REACT_APP_API_BASE_URL;
    if (envUrl) return envUrl;

    // As a safe fallback, use same-origin (e.g., when a reverse proxy serves /api on the same host).
    if (typeof window !== "undefined" && window.location) {
      const { protocol, host } = window.location; // includes port if any
      return `${protocol}//${host}`;
    }
    return "";
  } catch {
    return "";
  }
}

const RAW_BASE_URL = resolveBackendBase();
const API_PREFIX = process.env.REACT_APP_API_PREFIX || "/api";

// Normalize base URL + prefix, avoiding double slashes
function joinUrl(base, path) {
  if (!base) return path || "";
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path ? (path.startsWith("/") ? path : `/${path}`) : "";
  return `${b}${p}`;
}

const API_BASE_URL = joinUrl(RAW_BASE_URL, API_PREFIX);

// Helpful dev log to verify resolved API base URL (won't affect production builds)
if (process.env.NODE_ENV !== "production") {
  try {
    // eslint-disable-next-line no-console
    console.log(
      "[API] baseURL:",
      API_BASE_URL || "/api",
      "(RAW:",
      RAW_BASE_URL || "(same-origin)",
      "PREFIX:",
      API_PREFIX,
      ") — Ensure REACT_APP_API_BASE_URL is set to https://vscode-internal-33195-beta.beta01.cloud.kavia.ai:3001"
    );
  } catch {
    // ignore
  }
}

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
  /**
   * Calls the health endpoint to verify backend connectivity (bypasses /api).
   * Uses the resolved RAW_BASE_URL or same-origin if empty.
   */
  const rootBase = RAW_BASE_URL || "";
  const url = joinUrl(rootBase, "/");
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

/* LLM Costs */
// PUBLIC_INTERFACE
export async function listLlmCosts(params = {}) {
  /** GET /api/llm-costs with optional filters and pagination, returns normalized { items, total, meta }. */
  const res = await api.get("/llm-costs", { params: withStringifiedFilter(params) });
  return normalizeListResponse(res);
}

/* Tenants, Projects, and Usage APIs (new) */

// PUBLIC_INTERFACE
export async function getTenantNavigation(tenantId) {
  /** Returns navigation hierarchy for a tenant: groups, users, projects. */
  const res = await api.get(`/tenants/${encodeURIComponent(tenantId)}/navigation`);
  return res.data?.data ?? res.data;
}

// PUBLIC_INTERFACE
export async function getTenantCreditsSummary(tenantId) {
  /** Tenant-level credit summary and breakdowns by user/project. */
  const res = await api.get(`/tenants/${encodeURIComponent(tenantId)}/credits-summary`);
  return res.data?.data ?? res.data;
}

// PUBLIC_INTERFACE
export async function getTenantUsersUsage(tenantId, params = {}) {
  /** Per-user usage summary for a tenant: total_cost, total_minutes, project splits if available. */
  const res = await api.get(`/tenants/${encodeURIComponent(tenantId)}/users/usage`, {
    params: withStringifiedFilter(params),
  });
  // Could be array or envelope
  return Array.isArray(res.data) ? res.data : res.data?.data ?? res.data;
}

// PUBLIC_INTERFACE
export async function getProjectOverview(projectId) {
  /** Project overview: ownership, access rights, credits allocated/used/balance, and aggregations. */
  const res = await api.get(`/projects/${encodeURIComponent(projectId)}/overview`);
  return res.data?.data ?? res.data;
}

// PUBLIC_INTERFACE
export async function getProjectUsersUsage(projectId) {
  /** Per-user usage summary within a project. */
  const res = await api.get(`/projects/${encodeURIComponent(projectId)}/users/usage`);
  return Array.isArray(res.data) ? res.data : res.data?.data ?? res.data;
}
