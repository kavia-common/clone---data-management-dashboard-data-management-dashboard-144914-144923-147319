import { getApiBase } from './utilBase';

// PUBLIC_INTERFACE
export async function fetchOverviewAnalytics({ metric = 'creates', range = '7d', from, to } = {}) {
  /** Fetch time-bucketed overview analytics.
   * Params:
   * - metric: 'creates' | 'updates' | 'deletes' | 'total'
   * - range: '7d' | '14d' | '30d' | '12w' | '12m' | 'custom'
   * - from/to: ISO date-time bounds when range='custom'
   * Returns: { buckets: [{ label, value }], kpis: { totalRecords, newInRange, updatesInRange, deletionsInRange } }
   */
  const query = new URLSearchParams();
  if (metric) query.set('metric', metric);
  if (range) query.set('range', range);
  if (range === 'custom' && from) query.set('from', typeof from === 'string' ? from : new Date(from).toISOString());
  if (range === 'custom' && to) query.set('to', typeof to === 'string' ? to : new Date(to).toISOString());
  const params = query.toString();
  const base = getApiBase(); // e.g., http://localhost:3001
  const url = `${base}/api/analytics/overview?${params}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    // Gracefully fallback with empty payload if endpoint is missing
    return { buckets: [], kpis: { totalRecords: 0, newInRange: 0, updatesInRange: 0, deletionsInRange: 0 } };
  }
  return res.json();
}
