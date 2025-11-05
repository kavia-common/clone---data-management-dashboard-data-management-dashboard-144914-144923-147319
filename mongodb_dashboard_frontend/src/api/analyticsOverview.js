import { getApiBase } from './utilBase';

// PUBLIC_INTERFACE
export async function getOverviewAnalytics({ metric = 'creates', range = '30d' } = {}) {
  /** Calls /api/analytics/overview with metric and range.
   * Query:
   * - metric: 'creates' | 'updates' | 'deletes' | 'total'
   * - range: '7d' | '30d' | '12w' | '12m'
   * Returns JSON payload as provided by backend.
   */
  const params = new URLSearchParams({ metric, range }).toString();
  const url = `${getApiBase()}/api/analytics/overview?${params}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to fetch overview analytics (${res.status})`);
  }
  return res.json();
}
