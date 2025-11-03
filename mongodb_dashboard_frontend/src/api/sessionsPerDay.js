import { getApiClient } from './baseClient';

/**
 * PUBLIC_INTERFACE
 * Fetches sessions per day analytics from the backend.
 * Supports optional filters: tenant_id, project_id, status, start, end.
 * Returns: { items: Array<{ date: 'YYYY-MM-DD', count: number }>, meta?: object } or a raw array fallback.
 */
export async function getSessionsPerDay(params = {}) {
  const client = getApiClient();
  const { data } = await client.get('/api/analytics/sessions-per-day', { params });

  // Normalize: backend may return { items: [...] } or direct array.
  if (Array.isArray(data)) {
    return { items: data };
  }
  if (data && Array.isArray(data.items)) {
    return data;
  }
  // If backend returns an unexpected shape, try to infer items
  const items = Array.isArray(data?.data) ? data.data : [];
  return { items, meta: data?.meta || undefined };
}
