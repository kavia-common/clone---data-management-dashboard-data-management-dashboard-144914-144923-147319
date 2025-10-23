import axios from "axios";


const RAW_BASE_URL = "https://vscode-internal-21707-beta.beta01.cloud.kavia.ai:3001";
const API_PREFIX = "/api";

// Combine base + prefix safely
function joinUrl(base, path) {
  if (!base) return path || "";
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path ? (path.startsWith("/") ? path : `/${path}`) : "";
  return `${b}${p}`;
}

const API_BASE_URL = joinUrl(RAW_BASE_URL, API_PREFIX);

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

// === PUBLIC INTERFACE ===
export function getApiClient() {
  /** Returns the configured Axios instance */
  return api;
}

// === HEALTH CHECK ===
export async function health() {
  /** GET / - backend health check */
  const res = await axios.get(RAW_BASE_URL);
  return res.data;
}

// === USERS ===
export async function listUsers(params = {}) {
  const res = await api.get("/users", { params });
  return normalizeListResponse(res);
}

export async function createUser(body) {
  const res = await api.post("/users", body);
  return res.data?.data ?? res.data;
}

export async function updateUser(id, body) {
  const res = await api.put(`/users/${id}`, body);
  return res.data?.data ?? res.data;
}

export async function deleteUser(id) {
  const res = await api.delete(`/users/${id}`);
  return res.data?.data ?? res.data;
}

// === SESSION TRACKING ===
export async function listSessions(params = {}) {
  const res = await api.get("/session-tracking", { params });
  return normalizeListResponse(res);
}

export async function createSession(body) {
  const res = await api.post("/session-tracking", body);
  return res.data?.data ?? res.data;
}

export async function updateSession(id, body) {
  const res = await api.put(`/session-tracking/${id}`, body);
  return res.data?.data ?? res.data;
}

export async function deleteSession(id) {
  const res = await api.delete(`/session-tracking/${id}`);
  return res.data?.data ?? res.data;
}

// === APP DEPLOYMENTS ===
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



// === USER COSTS ===
export async function getUserCosts(userId) {
  if (!userId) throw new Error("userId is required");
  const res = await api.get(`/users`);
  return res.data?.data ?? res.data;
}

// === USER PROJECT COSTS ===
export async function getUserProjectsCosts(userId) {
  if (!userId) throw new Error("userId is required");
  const res = await api.get(`/users`);
  return res.data?.data ?? res.data;
}
