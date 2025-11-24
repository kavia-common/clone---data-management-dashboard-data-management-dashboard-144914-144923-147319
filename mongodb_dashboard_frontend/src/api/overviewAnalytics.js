import { getApiBase } from './utilBase';

/**
 * PUBLIC_INTERFACE
 * fetchOverviewAnalytics
 * Fetch time-bucketed overview analytics with time range controls.
 */
export async function fetchOverviewAnalytics({ metric = 'creates', range = '7d', from, to } = {}) {
  // Build query string
  const query = new URLSearchParams();
  query.set('metric', metric || 'creates');
  query.set('range', range || '7d');
  if (range === 'custom') {
    if (from) query.set('from', typeof from === 'string' ? from : new Date(from).toISOString());
    if (to) query.set('to', typeof to === 'string' ? to : new Date(to).toISOString());
  }
  const base = getApiBase(); // e.g., http://localhost:3001
  const url = `${base}/api/analytics/overview?${query.toString()}`;

  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    // Return empty dataset but in expected shape to avoid front-end breakage
    return { buckets: [], kpis: { totalRecords: 0, newInRange: 0, updatesInRange: 0, deletionsInRange: 0 } };
  }
  return res.json();
}
