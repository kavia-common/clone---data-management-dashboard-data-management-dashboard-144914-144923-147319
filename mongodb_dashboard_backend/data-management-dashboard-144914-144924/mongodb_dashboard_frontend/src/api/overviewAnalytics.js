import { getApiBase } from './utilBase';

// PUBLIC_INTERFACE
export async function fetchOverviewAnalytics({ metric = 'sessions', range = '30d' } = {}) {
  /**
   * Fetch overview analytics with KPI row and primary time series.
   * Returns: { kpis, series, meta }
   */
  const params = new URLSearchParams({ metric, range }).toString();
  const base = getApiBase(); // e.g., http://localhost:3001
  const url = `${base}/api/analytics/overview?${params}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    // Gracefully fallback with empty payload if endpoint is missing
    return {
      kpis: {
        activeUsers: 0,
        sessions: 0,
        deploySuccessRate: 0,
        errorRate: 0,
        totalLlmCost: 0,
        avgCostPerSession: 0,
      },
      series: [],
      meta: { range, bucket: 'daily' },
    };
  }
  return res.json();
}
