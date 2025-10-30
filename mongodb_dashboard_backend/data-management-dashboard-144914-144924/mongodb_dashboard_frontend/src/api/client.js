import axios from "axios";

/**
 * PUBLIC_INTERFACE
 * API client configured with base URL and safe path joining that avoids double '/api'.
 * In this environment, RAW_BASE_URL points at the backend service (port 3001) and API_PREFIX is '/api'.
 * If deploying elsewhere, set REACT_APP_API_BASE_URL to override RAW_BASE_URL.
 */
const ENV_BASE = process.env.REACT_APP_API_BASE_URL || "";
const RAW_BASE_URL = ENV_BASE || "https://vscode-internal-24166-beta.beta01.cloud.kavia.ai:3001";
const API_PREFIX = "/api";

// Combine base + prefix safely
function joinUrl(base, path) {
  if (!base) return path || "";
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path ? (path.startsWith("/") ? path : `/${path}`) : "";
  return `${b}${p}`;
}

const API_BASE_URL = joinUrl(RAW_BASE_URL, API_PREFIX);

/**
 * Always use via getApiClient() rather than importing a default client.
 * This avoids confusion between named/default exports and ensures interceptors are applied.
 */
// ✅ Create configured Axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
});

// Attach auth token and active tenant headers from localStorage for all requests
api.interceptors.request.use((config) => {
  try {
    const raw = localStorage.getItem('auth');
    if (raw) {
      const auth = JSON.parse(raw);
      if (auth?.token) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${auth.token}`;
      } else if (auth?.loggedIn) {
        // fallback token for stub flow
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ok`;
      }
    }
    const activeTenant = localStorage.getItem('activeTenant');
    if (activeTenant) {
      config.headers = config.headers || {};
      config.headers['X-Active-Tenant'] = activeTenant;
    }
  } catch {
    // ignore storage parsing errors
  }
  return config;
});

// Helper: normalize list/envelope responses
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
  /** Returns the configured Axios instance */
  return api;
}

// HEALTH CHECK
// PUBLIC_INTERFACE
export async function health() {
  /** GET / - backend health check */
  const url = RAW_BASE_URL.endsWith('/') ? RAW_BASE_URL.slice(0, -1) : RAW_BASE_URL;
  const res = await axios.get(url);
  return res.data;
}

// === USERS ===
// PUBLIC_INTERFACE
export async function listUsers(params = {}) {
  const res = await api.get("/users", { params });
  return normalizeListResponse(res);
}

// PUBLIC_INTERFACE
export async function createUser(body) {
  const res = await api.post("/users", body);
  return res.data?.data ?? res.data;
}

// PUBLIC_INTERFACE
export async function updateUser(id, body) {
  const res = await api.put(`/users/${id}`, body);
  return res.data?.data ?? res.data;
}

// PUBLIC_INTERFACE
export async function deleteUser(id) {
  const res = await api.delete(`/users/${id}`);
  return res.data?.data ?? res.data;
}

// === SESSION TRACKING ===
// PUBLIC_INTERFACE
export async function listSessions(params = {}) {
  const res = await api.get("/session-tracking", { params });
  return normalizeListResponse(res);
}

// PUBLIC_INTERFACE
export async function createSession(body) {
  const res = await api.post("/session-tracking", body);
  return res.data?.data ?? res.data;
}

// PUBLIC_INTERFACE
export async function updateSession(id, body) {
  const res = await api.put(`/session-tracking/${id}`, body);
  return res.data?.data ?? res.data;
}

// PUBLIC_INTERFACE
export async function deleteSession(id) {
  const res = await api.delete(`/session-tracking/${id}`);
  return res.data?.data ?? res.data;
}

// === APP DEPLOYMENTS ===
// PUBLIC_INTERFACE
export async function listDeployments(params = {}) {
  const res = await api.get("/app-deployments", { params });
  return normalizeListResponse(res);
}

/**
 * PUBLIC_INTERFACE
 * listLlmCosts
 */
export async function listLlmCosts(params = {}) {
  const res = await api.get("/llm-costs", { params });
  return normalizeListResponse(res);
}

// === USER COSTS (placeholders using /users list) ===
// PUBLIC_INTERFACE
export async function getUserCosts(userId) {
  if (!userId) throw new Error("userId is required");
  const res = await api.get(`/users`);
  return res.data?.data ?? res.data;
}

// PUBLIC_INTERFACE
export async function getUserProjectsCosts(userId) {
  if (!userId) throw new Error("userId is required");
  const res = await api.get(`/users`);
  return res.data?.data ?? res.data;
}
