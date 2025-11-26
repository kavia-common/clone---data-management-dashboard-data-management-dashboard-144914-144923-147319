/**
 * Utilities for interacting with app deployments API.
 * Provides helpers for project name resolution and dynamic status counts aggregation.
 */

import { getApiClient, listDeployments } from './index';

/**
 * PUBLIC_INTERFACE
 * Fetch a single deployment by projectId to resolve the projectName.
 * It queries /api/app-deployments with a filter on project_id and limit=1.
 * Returns a string projectName or null if not found.
 */
export async function fetchProjectNameByProjectId(projectId) {
  try {
    if (!projectId) return null;

    const params = new URLSearchParams();
    const filter = { project_id: String(projectId) };
    const filterParam = JSON.stringify(filter);
    params.set('filter', filterParam);
    params.set('limit', '1');

    const api = getApiClient();
    const res = await api.get(`/api/app-deployments?${params.toString()}`);
    const payload = res?.data ?? res;
    const data = Array.isArray(payload) ? payload : payload?.data;

    if (Array.isArray(data) && data.length > 0) {
      const first = data[0] || {};
      return first.projectName || first.project_name || null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Internal: Normalize status into a human-friendly label without constraining to fixed set.
 * Keeps unknown statuses as-is, maps empty to "Unknown".
 */
function normalizeStatusDynamic(raw) {
  if (raw === undefined || raw === null) return 'Unknown';
  const s = String(raw).trim();
  return s.length ? s : 'Unknown';
}

/**
 * Internal: Aggregate counts by status from a list of deployment records.
 * Returns array of { status, count } sorted by count desc then status asc.
 */
function aggregateCountsDynamic(items) {
  const counts = new Map();
  (items || []).forEach((d) => {
    const s = normalizeStatusDynamic(d?.status);
    counts.set(s, (counts.get(s) || 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => (b.count - a.count) || (a.status.localeCompare(b.status)));
}

/**
 * Internal: Fetch deployments in pages and aggregate counts client-side.
 */
async function fetchStatusCountsClientSide({ pageLimit = 200, maxPages = 5 } = {}) {
  let page = 1;
  const all = [];
  while (page <= maxPages) {
    const res = await listDeployments({ page, limit: pageLimit, sort: '-created_at' });
    const items = Array.isArray(res?.items) ? res.items : [];
    all.push(...items);
    if (items.length < pageLimit) break;
    page += 1;
  }
  return aggregateCountsDynamic(all);
}

/**
 * PUBLIC_INTERFACE
 * fetchDeploymentStatusCounts
 * Attempts to fetch deployment counts grouped by status from server, with a client-side fallback.
 *
 * Options:
 * - preferServer?: boolean (default false) Try GET /api/app-deployments/status-counts first.
 * - pageLimit?: number (default 200) When aggregating on client, page size.
 * - maxPages?: number (default 5) When aggregating on client, max number of pages to load.
 *
 * Returns: Promise<Array<{ status: string, count: number }>>
 */
export async function fetchDeploymentStatusCounts(options = {}) {
  const {
    preferServer = false,
    pageLimit = 200,
    maxPages = 5,
  } = options;

  if (preferServer) {
    try {
      const api = getApiClient();
      const res = await api.get('/api/app-deployments/status-counts');
      const payload = res?.data ?? res;
      const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [];
      return (items || []).map((it) => ({
        status: normalizeStatusDynamic(it?.status),
        count: Number(it?.count || 0),
      }));
    } catch {
      // Fallback to client-side aggregation
    }
  }

  return fetchStatusCountsClientSide({ pageLimit, maxPages });
}

const deploymentsApi = {
  fetchProjectNameByProjectId,
  fetchDeploymentStatusCounts,
};
export default deploymentsApi;
