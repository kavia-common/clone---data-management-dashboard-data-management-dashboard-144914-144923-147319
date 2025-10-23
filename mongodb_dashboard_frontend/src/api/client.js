import axios from "axios";


const RAW_BASE_URL = "https://vscode-internal-32715-beta.beta01.cloud.kavia.ai:3001";
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

/**
 * PUBLIC_INTERFACE
 * getLlmUsageOverTime
 * Fetch aggregated LLM usage over time for stacked area chart.
 * @param {number} days number of days (default 90)
 * @returns {{ items: Array<{date: string, series: Record<string, number>}>, meta: { models: string[], start: string, end: string, days: number } }}
 */
export async function getLlmUsageOverTime(days = 90) {
  const d = Math.max(1, Math.min(180, parseInt(days, 10) || 90));
  const res = await api.get(`/llm-costs/usage-over-time`, { params: { days: d } });
  return res.data;
}

/**
 * PUBLIC_INTERFACE
 * seedLlmCostsDemo
 * Seed demo LLM costs in dev environments to populate charts.
 * Returns a summary of before/inserted/after counts and a sample document.
 */
export async function seedLlmCostsDemo() {
  const res = await api.get(`/dev/seed-llm-costs`);
  return res.data;
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
