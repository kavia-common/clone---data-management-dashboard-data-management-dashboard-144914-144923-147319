import axios from 'axios';

const resolveBaseURL = () => {
  const env = process.env.REACT_APP_API_BASE;
  if (env && env.trim().length > 0) return env;
  // Fallback: if frontend on 3000, backend on 3001 same host
  try {
    const url = new URL(window.location.href);
    return `${url.protocol}//${url.hostname}:3001`;
  } catch {
    return 'http://localhost:3001';
  }
};

const createClient = () => {
  const instance = axios.create({
    baseURL: resolveBaseURL().replace(/\/+$/, '') + '/api',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Attach token from localStorage if present
  instance.interceptors.request.use((config) => {
    try {
      const token = localStorage.getItem('auth_token');
      if (token) {
        // Use Bearer header if needed; backend stub may ignore
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      // ignore
    }
    return config;
  });

  return instance;
};

const api = createClient();

/**
 * PUBLIC_INTERFACE
 * getApiClient - returns a configured axios instance (singleton by default).
 */
export const getApiClient = () => api;

/**
 * PUBLIC_INTERFACE
 * listUsers - fetch users list with optional query params.
 * Accepts an object with optional { page, limit, sort, filter } matching backend.
 * Returns data directly (array or envelope based on backend response).
 */
export async function listUsers(params = {}) {
  const res = await api.get('/users', { params });
  return res.data;
}

/**
 * PUBLIC_INTERFACE
 * listDeployments - fetch application deployments list with optional query params.
 * Mirrors backend GET /api/app-deployments
 */
export async function listDeployments(params = {}) {
  const res = await api.get('/app-deployments', { params });
  return res.data;
}

/**
 * PUBLIC_INTERFACE
 * listSessions - fetch session tracking list with optional query params.
 * Mirrors backend GET /api/session-tracking
 */
export async function listSessions(params = {}) {
  const res = await api.get('/session-tracking', { params });
  return res.data;
}

/**
 * PUBLIC_INTERFACE
 * listLlmCosts - fetch LLM costs list with optional query params.
 * Mirrors backend GET /api/llm-costs
 */
export async function listLlmCosts(params = {}) {
  const res = await api.get('/llm-costs', { params });
  return res.data;
}

export default api;
