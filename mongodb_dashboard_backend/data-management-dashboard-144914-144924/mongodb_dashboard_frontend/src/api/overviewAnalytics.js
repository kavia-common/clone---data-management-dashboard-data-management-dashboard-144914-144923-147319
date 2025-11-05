import { apiFetch } from './client';

// PUBLIC_INTERFACE
export async function fetchOverviewAnalytics() {
  const res = await apiFetch('/api/analytics/users/new-over-time');
  try {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('fetchOverviewAnalytics failed:', e);
    return { items: [], meta: { granularity: 'day' } };
  }
}
