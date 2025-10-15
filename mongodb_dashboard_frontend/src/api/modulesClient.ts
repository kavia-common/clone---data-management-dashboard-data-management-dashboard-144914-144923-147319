import { getApiBaseUrl } from './util';
import { getApiClient } from './client';
import { getApiBase } from './utilBase';

/**
 * PUBLIC_INTERFACE
 * getModules fetches modules/overview data for the authenticated user/tenant.
 * Ensures cookies/session are sent (credentials: 'include').
 *
 * Strategy:
 * - Resolve a robust base URL: prefer axios client's baseURL; fall back to REACT_APP_API_BASE_URL; then utilBase heuristic.
 * - Attempt multiple sources for overview content in priority order.
 * - If primary endpoints are missing, derive lightweight modules from other existing endpoints (deployments, users, costs).
 * - Normalize data shape and return available modules (partial rendering enabled).
 */
export async function getModules(): Promise<any[]> {
  // Resolve a reliable base URL
  const axiosClient = getApiClient();
  const axiosBase = (axiosClient?.defaults?.baseURL as string) || '';
  const envBase = getApiBaseUrl() || '';
  const heuristicBase = getApiBase();
  const base = (axiosBase || envBase || heuristicBase || '').replace(/\/*$/, '');

  // Candidate endpoints that may return overview/module-like data
  const endpoints = [
    '/dashboard/overview',   // with axios baseURL already including /api
    '/modules',
    '/app-deployments',
  ];

  // Helper to fetch JSON with credentials
  const fetchJson = async (url: string) => {
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  };

  // Try direct overview/module endpoints first
  for (const ep of endpoints) {
    try {
      const url = `${base}${ep.startsWith('/api') ? '' : ''}/api${ep.startsWith('/') ? ep : `/${ep}`}`.replace(/\/{2,}/g, '/');
      const absolute = url.startsWith('http') ? url : `${base}${ep}`;
      const data = await fetchJson(absolute);
      if (Array.isArray(data)) return data;
      if (data && Array.isArray((data as any).data)) return (data as any).data;
      if (data && Array.isArray((data as any).items)) return (data as any).items;
      if (data && typeof data === 'object') return [data];
    } catch (_e) {
      // Try next
    }
  }

  // Derive modules from other available endpoints to avoid "No modules found"
  const derivedModules: any[] = [];

  // 1) Deployments snapshot (counts)
  try {
    const url = `${base}/api/app-deployments`;
    const data = await fetchJson(url);
    const items = Array.isArray(data) ? data : data?.data || data?.items || [];
    if (Array.isArray(items) && items.length) {
      derivedModules.push({
        key: 'deployments',
        title: 'Deployments',
        description: `Total deployments: ${items.length}`,
        total: items.length,
        sample: items[0],
      });
    }
  } catch {}

  // 2) Users by tenant summary for a users module
  try {
    const url = `${base}/api/users/tenant-summary`;
    const data = await fetchJson(url);
    const items = data?.items || [];
    if (Array.isArray(items) && items.length) {
      const totalUsers = items.reduce((acc: number, it: any) => acc + (it.user_count || 0), 0);
      derivedModules.push({
        key: 'users',
        title: 'Users',
        description: `Active tenants: ${items.length}, total users: ${totalUsers}`,
        tenants: items.length,
        totalUsers,
        sample: items[0],
      });
    }
  } catch {}

  // 3) LLM Costs list for costs module
  try {
    const url = `${base}/api/llm-costs?limit=5`;
    const data = await fetchJson(url);
    const items = Array.isArray(data) ? data : data?.data || data?.items || [];
    if (Array.isArray(items) && items.length) {
      derivedModules.push({
        key: 'costs',
        title: 'LLM Costs',
        description: `Recent cost records: ${items.length}`,
        recent: items.length,
        sample: items[0],
      });
    }
  } catch {}

  return derivedModules;
}

/**
 * PUBLIC_INTERFACE
 * getOverviewMetrics
 * Fetches consolidated totals for the Overview screen.
 * Returns { totalUsers, totalDeployedApps }.
 */
export async function getOverviewMetrics(): Promise<{ totalUsers: number; totalDeployedApps: number }> {
  const axiosClient = getApiClient();
  const axiosBase = (axiosClient?.defaults?.baseURL as string) || '';
  const envBase = getApiBaseUrl() || '';
  const heuristicBase = getApiBase();
  const base = (axiosBase || envBase || heuristicBase || '').replace(/\/*$/, '');

  const url = `${base}/dashboard/overview/metrics`;
  // If axios base includes /api, the relative path will respect it. Otherwise prefix /api.
  const absolute = url.includes('/api/') ? url : `${base}/api/dashboard/overview/metrics`;

  const res = await fetch(absolute, {
    method: 'GET',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch overview metrics (${res.status})`);
  }
  const data = await res.json();
  const totalUsers = Number((data as any)?.totalUsers ?? 0);
  const totalDeployedApps = Number((data as any)?.totalDeployedApps ?? 0);
  return { totalUsers, totalDeployedApps };
}
