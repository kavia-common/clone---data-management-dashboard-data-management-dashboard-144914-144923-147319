import axios from "axios";
import { getApiBase, getHealthUrl } from "./config";

// Resolve base dynamically (env -> window -> relative)
const API_BASE_URL = getApiBase();

// Log in dev only
if (typeof window !== "undefined" && process?.env?.NODE_ENV !== "production") {
  // eslint-disable-next-line no-console
  console.log(`[API] baseURL: ${API_BASE_URL}`);
}

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
// PUBLIC_INTERFACE
export function getApiClient() {
  /** Returns the configured Axios instance */
  return api;
}

// === HEALTH CHECK ===
// PUBLIC_INTERFACE
export async function health() {
  /** GET / - backend health check (uses computed origin) */
  const res = await axios.get(getHealthUrl());
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
