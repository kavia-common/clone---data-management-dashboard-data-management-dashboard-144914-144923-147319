import { getApiBaseUrl } from './util';
import { getApiBase } from './utilBase';

/**
 * Resolve a reliable API base URL.
 * Priority:
 * - REACT_APP_API_BASE_URL via util.getApiBaseUrl()
 * - Heuristic base via utilBase.getApiBase()
 * - Fallback from window to http://localhost:3001
 */
function resolveBase() {
  const envBase = (typeof getApiBaseUrl === 'function' && getApiBaseUrl()) || '';
  if (envBase) return String(envBase).replace(/\/*$/, '');
  try {
    const u = new URL(window.location.href);
    return `${u.protocol}//${u.hostname}:3001`;
  } catch {
    const heur = (typeof getApiBase === 'function' && getApiBase()) || 'http://localhost:3001';
    return String(heur).replace(/\/*$/, '');
  }
}

async function fetchJson(url, { credentials = 'include' } = {}) {
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials,
  });
  const ct = res.headers.get('content-type') || '';
  const isJson = ct.includes('application/json');
  const payload = isJson ? await res.json().catch(() => ({})) : await res.text().catch(() => '');
  if (!res.ok) {
    const msg = (payload && payload.message) || (typeof payload === 'string' ? payload : `Request failed (${res.status})`);
    const err = new Error(msg);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

/**
 * Normalize various shapes to array: [items] from raw | {data}|{items}.
 */
function toArray(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

// PUBLIC_INTERFACE
export async function getModules() {
  /**
   * Fetches a modules overview for the dashboard.
   * Attempts dedicated endpoints; if unavailable, derives a minimal overview
   * from deployments, users summary, and LLM costs.
   *
   * Returns an array of module summaries:
   * [{ key, title, description, ... }].
   */
  const base = resolveBase();

  // Try overview endpoints if available
  const tryEndpoints = [
    `${base}/api/dashboard/overview`, // optional
    `${base}/api/modules`,            // optional
  ];
  for (const url of tryEndpoints) {
    try {
      const data = await fetchJson(url);
      const arr = toArray(data);
      if (arr.length) return arr;
      if (data && typeof data === 'object') return [data];
    } catch {
      // ignore and continue
    }
  }

  // Derive minimal modules snapshot
  const derived = [];

  // Deployments
  try {
    const dep = await fetchJson(`${base}/api/app-deployments`);
    const items = toArray(dep);
    if (items.length) {
      derived.push({
        key: 'deployments',
        title: 'Deployments',
        description: `Total deployments: ${items.length}`,
        total: items.length,
        sample: items[0],
      });
    }
  } catch { /* ignore */ }

  // Users summary
  try {
    const us = await fetchJson(`${base}/api/users/tenant-summary`);
    const items = Array.isArray(us?.items) ? us.items : toArray(us);
    if (items.length) {
      const totalUsers = items.reduce((acc, it) => acc + Number(it.user_count || 0), 0);
      derived.push({
        key: 'users',
        title: 'Users',
        description: `Active tenants: ${items.length}, total users: ${totalUsers}`,
        tenants: items.length,
        totalUsers,
        sample: items[0],
      });
    }
  } catch { /* ignore */ }

  // LLM Costs
  try {
    const costs = await fetchJson(`${base}/api/llm-costs?limit=5`);
    const items = toArray(costs);
    if (items.length) {
      derived.push({
        key: 'costs',
        title: 'LLM Costs',
        description: `Recent cost records: ${items.length}`,
        recent: items.length,
        sample: items[0],
      });
    }
  } catch { /* ignore */ }

  return derived;
}

// PUBLIC_INTERFACE
export async function getOverviewMetrics() {
  /**
   * Fetch consolidated totals for the Overview screen.
   * Returns { totalUsers, totalDeployedApps } with numeric values.
   */
  const base = resolveBase();
  const url = `${base}/api/dashboard/overview/metrics`;
  const data = await fetchJson(url);
  return {
    totalUsers: Number(data?.totalUsers ?? 0),
    totalDeployedApps: Number(data?.totalDeployedApps ?? 0),
  };
}

export default { getModules, getOverviewMetrics };
