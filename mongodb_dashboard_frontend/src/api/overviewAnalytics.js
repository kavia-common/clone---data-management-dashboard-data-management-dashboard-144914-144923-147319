import client from './client';

// PUBLIC_INTERFACE
export async function fetchOverview(range = '30d') {
  /**
   * Fetches dashboard overview analytics. Always uses shared client which
   * attaches Authorization and x-tenant-id headers.
   */
  const res = await client.get('/analytics/overview', { params: { range } });
  return res.data;
}
