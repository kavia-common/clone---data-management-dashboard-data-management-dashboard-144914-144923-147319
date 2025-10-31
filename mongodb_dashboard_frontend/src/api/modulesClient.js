import { getApiBaseUrl } from './util';
import { getApiBase } from './utilBase';

/**
 * Resolve a reliable API base URL.
 * Overridden to always use the static backend.
 */
function resolveBase() {
  return 'https://kavia-dashboard-kavia-dev.cloud.kavia.ai/api';
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
    const msg =
      (payload && payload.message) ||
      (typeof payload === 'string' ? payload : `Request failed (${res.status})`);
    const err = new Error(msg);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

function toArray(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

// PUBLIC_INTERFACE
export async function getModules() {
  const base = resolveBase();

  const tryEndpoints = [
    `${base}/dashboard/overview`,
    `${base}/modules`,
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

  const derived = [];

  try {
    const dep = await fetchJson(`${base}/app-deployments`);
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
  } catch {}

  try {
    const us = await fetchJson(`${base}/users/tenant-summary`);
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
  } catch {}

  try {
    const costs = await fetchJson(`${base}/llm-costs?limit=5`);
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
  } catch {}

  return derived;
}

export async function getOverviewMetrics() {
  const base = resolveBase();
  const url = `${base}/dashboard/overview/metrics`;
  const data = await fetchJson(url);
  return {
    totalUsers: Number(data?.totalUsers ?? 0),
    totalDeployedApps: Number(data?.totalDeployedApps ?? 0),
  };
}

export default { getModules, getOverviewMetrics };
