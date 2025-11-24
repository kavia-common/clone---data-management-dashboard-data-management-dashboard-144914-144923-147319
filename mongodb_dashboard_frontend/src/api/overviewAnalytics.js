import { getApiBase } from './utilBase';

// PUBLIC_INTERFACE
export async function fetchOverviewAnalytics({ metric = 'creates', range = '30d' } = {}) {
  /** Fetch time-bucketed overview analytics.
   * Params:
   * - metric: 'creates' | 'updates' | 'deletes' | 'total'
   * - range: '7d' | '30d' | '12w' | '12m'
   * Returns: { buckets: [{ label, value }], kpis: { totalRecords, newInRange, updatesInRange, deletionsInRange } }
   */
  const params = new URLSearchParams({ metric, range }).toString();
  const base = getApiBase(); // e.g., http://localhost:3001
  const url = `${base}/api/analytics/overview?${params}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    // Gracefully fallback with empty payload if endpoint is missing
    return { buckets: [], kpis: { totalRecords: 0, newInRange: 0, updatesInRange: 0, deletionsInRange: 0 } };
  }
  return res.json();
}
