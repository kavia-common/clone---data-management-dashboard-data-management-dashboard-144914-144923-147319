/* eslint-disable no-console */
import axios from 'axios';

// PUBLIC_INTERFACE
export function setAuthContext({ token, tenant_id }) {
  /**
   * Store the auth context in localStorage.
   * token: ID token (JWT)
   * tenant_id: active tenant id
   */
  const ctx = { token: token || null, tenant_id: tenant_id || null };
  localStorage.setItem('authContext', JSON.stringify(ctx));
}

// PUBLIC_INTERFACE
export function getAuthContext() {
  /**
   * Retrieve the auth context from localStorage.
   * Returns { token, tenant_id } or { token:null, tenant_id:null } if missing.
   */
  try {
    const raw = localStorage.getItem('authContext');
    if (!raw) return { token: null, tenant_id: null };
    const parsed = JSON.parse(raw);
    return { token: parsed?.token || null, tenant_id: parsed?.tenant_id || null };
  } catch {
    return { token: null, tenant_id: null };
  }
}

/**
 * Axios instance that automatically attaches Authorization and x-tenant-id headers.
 * Also logs missing headers in development to aid diagnostics.
 */
const axiosInstance = axios.create({
  baseURL: process.env.REACT_APP_API_BASE_URL || '/api',
  withCredentials: false,
});

axiosInstance.interceptors.request.use((config) => {
  const cfg = { ...config };
  const { token, tenant_id } = getAuthContext();
  if (token && !cfg.headers?.Authorization) {
    cfg.headers = cfg.headers || {};
    cfg.headers.Authorization = `Bearer ${token}`;
  }
  if (tenant_id && !cfg.headers?.['x-tenant-id']) {
    cfg.headers = cfg.headers || {};
    cfg.headers['x-tenant-id'] = tenant_id;
  }

  if (process.env.NODE_ENV !== 'production') {
    const hasAuth = !!cfg.headers?.Authorization;
    const xtenant = cfg.headers?.['x-tenant-id'] || null;
    if (!hasAuth || !xtenant) {
      console.debug(`[api-client] ${cfg.method?.toUpperCase?.() || 'GET'} ${cfg.url} Authorization=${hasAuth ? 'yes' : 'no'} x-tenant-id=${xtenant || 'n/a'}`);
    }
  }

  return cfg;
});

export default axiosInstance;
