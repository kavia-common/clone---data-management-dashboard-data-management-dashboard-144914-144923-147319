import axios from "axios";
import { resolveApiBaseUrl } from "./index";

/**
 * API client configuration (environment-driven)
 * Uses resolveApiBaseUrl() to compute API origin and prefix:
 * - REACT_APP_API_URL, or
 * - REACT_APP_API_BASE_URL + REACT_APP_API_PREFIX (default "/api"), or
 * - window inferred host with port 3001 + prefix
 */
const API_BASE_URL = resolveApiBaseUrl();

// Create configured Axios instance
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

// PUBLIC_INTERFACE
export function getApiClient() {
  /** Returns the configured Axios instance */
  return api;
}

// Health endpoint (root '/')
export async function health() {
  const root = API_BASE_URL.replace(/\/api\/?$/, "");
  const res = await axios.get(root);
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

// === LLM COSTS ===
export async function listLlmCosts(params = {}) {
  const res = await api.get("/llm-costs", { params });
  return normalizeListResponse(res);
}

// === USER COSTS (placeholder examples kept consistent) ===
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