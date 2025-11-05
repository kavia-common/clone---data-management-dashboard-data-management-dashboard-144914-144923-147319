import { getApiBaseUrl, buildQueryString } from './utilBase';

// PUBLIC_INTERFACE
export async function getOverviewAnalytics({ metric = 'creates', range = '30d' } = {}) {
  /** Calls /api/analytics/overview with metric and range. */
  const qs = buildQueryString({ metric, range });
  const url = `${getApiBaseUrl().replace(/\\/api$/, '')}/api/analytics/overview${qs}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    // Allow caller to handle 404 to render empty state
    const text = await res.text();
    throw new Error(text || `Failed to fetch overview analytics (${res.status})`);
  }
  return res.json();
}
