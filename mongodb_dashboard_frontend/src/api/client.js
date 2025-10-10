import axios from "axios";
/**
 * STATIC BACKEND CONFIGURATION
 * This connects directly to the backend running in your specific pod.
 * Replace RAW_BASE_URL with your active pod if it changes.
 */
const RAW_BASE_URL = "https://vscode-internal-39919-beta.beta01.cloud.kavia.ai:3001";
const API_PREFIX = "/api";
/** Combine base + prefix safely */
function joinUrl(base, path) {
  if (!base) return path || "";
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path ? (path.startsWith("/") ? path : `/${path}`) : "";
  return `${b}${p}`;
}
const API_BASE_URL = joinUrl(RAW_BASE_URL, API_PREFIX);
/** Axios instance configured with base URL and JSON headers */
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
});
/** Helper: normalize list/envelope responses */
function normalizeListResponse(res) {
  const payload = res?.data || {};
  const items = Array.isArray(payload) ? payload : payload.data || [];
  const total =
    (payload.meta && typeof payload.meta.total === "number" && payload.meta.total) ||
    (Array.isArray(items) ? items.length : 0);
  return { items, total, meta: payload.meta || null };
}
/** PUBLIC_INTERFACE: returns the configured Axios instance */
export function getApiClient() {
  return api;
}
/** PUBLIC_INTERFACE: authenticate user */
export async function loginUser(credentials) {
  const res = await getApiClient().post("/auth/login", credentials);
  return res?.data;
}
/** PUBLIC_INTERFACE: health check */
export async function health() {
  const res = await axios.get(RAW_BASE_URL);
  return res.data;
}
/** === USERS === */
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
/** === SESSION TRACKING === */
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
/** === APP DEPLOYMENTS === */
export async function listDeployments(params = {}) {
  const res = await api.get("/app-deployments", { params });
  return normalizeListResponse(res);
}
/** === LLM COSTS === */
export async function listLlmCosts(params = {}) {
  const res = await api.get("/llm-costs", { params });
  return normalizeListResponse(res);
}
/** === USER COSTS === */
export async function getUserCosts(userId) {
  if (!userId) throw new Error("userId is required");
  const res = await api.get(`/users`);
  return res.data?.data ?? res.data;
}
/** === USER PROJECT COSTS === */
export async function getUserProjectsCosts(userId) {
  if (!userId) throw new Error("userId is required");
  const res = await api.get(`/users`);
  return res.data?.data ?? res.data;
}
/** Default export for direct Axios usage */
export default api;