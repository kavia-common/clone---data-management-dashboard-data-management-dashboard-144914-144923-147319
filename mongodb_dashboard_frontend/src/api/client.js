import axios from "axios";

// Read base URL from environment variable. Do not hardcode endpoints.
// If not set, default to same-origin which works with reverse proxy setups.
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "";

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

// Create configured axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
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
  /** Calls the health endpoint to verify backend connectivity. */
  const res = await api.get("/");
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

// PUBLIC_INTERFACE
export async function listUsers(params = {}) {
  /** GET /users with optional query params for filtering/pagination. */
  const res = await api.get("/users", { params });
  return res.data;
}

// PUBLIC_INTERFACE
export async function createUser(body) {
  /** POST /users to create a new user/referral record. */
  const res = await api.post("/users", body);
  return res.data;
}

// PUBLIC_INTERFACE
export async function updateUser(id, body) {
  /** PUT /users/:id to update a user/referral record. */
  const res = await api.put(`/users/${id}`, body);
  return res.data;
}

// PUBLIC_INTERFACE
export async function deleteUser(id) {
  /** DELETE /users/:id to remove a user/referral record. */
  const res = await api.delete(`/users/${id}`);
  return res.data;
}

// PUBLIC_INTERFACE
export async function listSessions(params = {}) {
  /** GET /session-tracking with optional filters. */
  const res = await api.get("/session-tracking", { params });
  return res.data;
}

// PUBLIC_INTERFACE
export async function createSession(body) {
  /** POST /session-tracking to create a session record. */
  const res = await api.post("/session-tracking", body);
  return res.data;
}

// PUBLIC_INTERFACE
export async function updateSession(id, body) {
  /** PUT /session-tracking/:id to update a session record. */
  const res = await api.put(`/session-tracking/${id}`, body);
  return res.data;
}

// PUBLIC_INTERFACE
export async function deleteSession(id) {
  /** DELETE /session-tracking/:id to remove a session record. */
  const res = await api.delete(`/session-tracking/${id}`);
  return res.data;
}

// PUBLIC_INTERFACE
export async function listDeployments(params = {}) {
  /** GET /app-deployments with optional filters. */
  const res = await api.get("/app-deployments", { params });
  return res.data;
}

// PUBLIC_INTERFACE
export async function createDeployment(body) {
  /** POST /app-deployments to create a new deployment record. */
  const res = await api.post("/app-deployments", body);
  return res.data;
}

// PUBLIC_INTERFACE
export async function updateDeployment(id, body) {
  /** PUT /app-deployments/:id to update a deployment record. */
  const res = await api.put(`/app-deployments/${id}`, body);
  return res.data;
}

// PUBLIC_INTERFACE
export async function deleteDeployment(id) {
  /** DELETE /app-deployments/:id to remove a deployment record. */
  const res = await api.delete(`/app-deployments/${id}`);
  return res.data;
}
