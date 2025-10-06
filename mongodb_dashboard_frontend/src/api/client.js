import axios from "axios";
import { getApiBaseUrl } from "./util";

/**
 * PUBLIC API CLIENT (pre-229 baseline)
 * Simple axios client configured from REACT_APP_API_BASE_URL and '/api' prefix.
 * Provides basic endpoints used across the app without recent additions.
 */

// Resolve base URL once from util (env-driven)
const API_BASE_URL = getApiBaseUrl();

if (process.env.NODE_ENV !== "production") {
  // eslint-disable-next-line no-console
  console.debug("[API] Axios baseURL:", API_BASE_URL);
}
// Axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
});

// PUBLIC_INTERFACE
export function getApiClient() {
  /** Returns the configured Axios instance. */
  return api;
}

// Normalize list/envelope responses
function normalizeListResponse(res) {
  const payload = res?.data || {};
  const items = Array.isArray(payload) ? payload : payload.data || [];
  const total =
    (payload.meta && typeof payload.meta.total === "number" && payload.meta.total) ||
    (Array.isArray(items) ? items.length : 0);
  return { items, total, meta: payload.meta || null };
}

// PUBLIC_INTERFACE
export async function health() {
  /** GET / (same-origin) health endpoint via absolute fetch (not axios base). */
  const res = await fetch("/");
  return res.json();
}

// Users
// PUBLIC_INTERFACE
export async function listUsers(params = {}) {
  /** GET /api/users with optional query params. */
  const res = await api.get("/users", { params });
  return normalizeListResponse(res);
}

// PUBLIC_INTERFACE
export async function createUser(body) {
  /** POST /api/users to create a user. */
  const res = await api.post("/users", body);
  return res.data?.data ?? res.data;
}

// PUBLIC_INTERFACE
export async function updateUser(id, body) {
  /** PUT /api/users/:id to update a user. */
  const res = await api.put(`/users/${id}`, body);
  return res.data?.data ?? res.data;
}

// PUBLIC_INTERFACE
export async function deleteUser(id) {
  /** DELETE /api/users/:id to remove a user. */
  const res = await api.delete(`/users/${id}`);
  return res.data?.data ?? res.data;
}

// Sessions (session-tracking)
// PUBLIC_INTERFACE
export async function listSessions(params = {}) {
  /** GET /api/session-tracking with optional query params. */
  const res = await api.get("/session-tracking", { params });
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
  /** DELETE /api/session-tracking/:id to delete a session record. */
  const res = await api.delete(`/session-tracking/${id}`);
  return res.data?.data ?? res.data;
}

// App Deployments
// PUBLIC_INTERFACE
export async function listDeployments(params = {}) {
  /** GET /api/app-deployments with optional query params. */
  const res = await api.get("/app-deployments", { params });
  return normalizeListResponse(res);
}

 // LLM Costs
// PUBLIC_INTERFACE
export async function listLlmCosts(params = {}) {
  /** GET /api/llm-costs with optional query params. */
  const res = await api.get("/llm-costs", { params });
  return normalizeListResponse(res);
}

// PUBLIC_INTERFACE
export async function getUserCosts(userId) {
  /** GET /api/users/:userId/costs - returns user total_cost and breakdowns if available. */
  if (!userId) throw new Error("userId is required");
  const res = await api.get(`/users/${encodeURIComponent(userId)}/costs`);
  return res.data?.data ?? res.data;
}

// PUBLIC_INTERFACE
export async function getUserProjectsCosts(userId) {
  /** GET /api/users/:userId/projects/costs - returns per-project costs for a user. */
  if (!userId) throw new Error("userId is required");
  const res = await api.get(`/users/${encodeURIComponent(userId)}/projects/costs`);
  return res.data?.data ?? res.data;
}
