import axios from "axios";


const RAW_BASE_URL = "https://vscode-internal-40359-beta.beta01.cloud.kavia.ai:3001";
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

/** PUBLIC_INTERFACE
 * getLlmCostByAgent
 * Fetches pre-aggregated LLM costs by agent.
 * Returns array: [{ agent: string, total_cost: number }]
 */
export async function getLlmCostByAgent() {
  const res = await api.get('/analytics/llm-cost-by-agent');
  return res.data;
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
