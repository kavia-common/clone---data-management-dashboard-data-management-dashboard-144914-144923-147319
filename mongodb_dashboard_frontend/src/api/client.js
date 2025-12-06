/* eslint-disable no-console */
import axios from 'axios';
import { getApiBase, joinUrl } from './config';

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
 * Build a safe URL for axios request URL relative to base.
 * Rules:
 * - If path starts with '/api', don't prepend '/api' again; just join with base root.
 * - If path doesn't start with '/api', prepend '/api'.
 * - Collapse duplicate slashes.
 */
function normalizePathWithBase(base, path) {
  const baseRoot = String(base || '').replace(/\/+$/, '');
  const p = String(path || '');
  if (/^https?:\/\//i.test(p)) return p;
  if (p.startsWith('/api')) {
    // Strip trailing '/api' from base if present
    const root = /\/api$/i.test(baseRoot) ? baseRoot.replace(/\/api$/i, '') : baseRoot;
    return joinUrl(root, p);
  }
  const apiBase = /\/api$/i.test(baseRoot) ? baseRoot : `${baseRoot}/api`;
  const rel = p.startsWith('/') ? p : `/${p}`;
  return joinUrl(apiBase, rel);
}

/**
 * Axios instance that automatically attaches Authorization and x-tenant-id headers.
 * Uses centralized base resolution (env vars with fallback to relative '/api').
 */
const axiosInstance = axios.create({
  baseURL: getApiBase(),
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

  // Normalize URL against base to avoid '/api/api'
  const base = cfg.baseURL ?? getApiBase();
  if (typeof cfg.url === 'string') {
    cfg.url = normalizePathWithBase(base, cfg.url);
    // Axios with baseURL + absolute url may override baseURL; ensure baseURL is cleared for absolute URLs
    if (/^https?:\/\//i.test(cfg.url)) {
      cfg.baseURL = '';
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    const hasAuth = !!cfg.headers?.Authorization;
    const xtenant = cfg.headers?.['x-tenant-id'] || null;
    console.debug(
      `[api-client] ${cfg.method?.toUpperCase?.() || 'GET'} ${cfg.url} Authorization=${hasAuth ? 'yes' : 'no'} x-tenant-id=${xtenant || 'n/a'}`
    );
  }

  return cfg;
});

export default axiosInstance;
