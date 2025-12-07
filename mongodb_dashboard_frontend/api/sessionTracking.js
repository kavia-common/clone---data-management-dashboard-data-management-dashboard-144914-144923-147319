import client from './client';

/**
 * PUBLIC_INTERFACE
 * getSessionTracking
 * Fetches session tracking records. Accepts query object and optional fetch options.
 * - query: { page?, limit?, sort?, filter?, q?, pageSize? }
 * - options: { signal? }
 */
export async function getSessionTracking(query = {}, options = {}) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    params.append(k, v);
  });

  // The underlying client should support abort signals if using fetch; for axios, map to CancelToken where available.
  // Here, we forward the signal via client wrapper; if unsupported, it will be ignored safely.
  const res = await client.get(`/api/session-tracking?${params.toString()}`, {
    signal: options.signal,
  });
  return res?.data ?? res;
}
