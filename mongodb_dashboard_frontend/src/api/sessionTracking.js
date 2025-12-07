import client from './client';

/**
 * PUBLIC_INTERFACE
 * getSessionTracking
 * Fetches session tracking records. Accepts query object and optional fetch options.
 * - query: { page?, limit?, sort?, filter?, q?, pageSize?, tenant_id?, start?, end? }
 * - options: { signal? }
 * Notes:
 * - Backend supports raw array response when page/limit not provided, else envelope.
 * - start/end should be ISO strings; filtering applies to session_start on server.
 */
export async function getSessionTracking(query = {}, options = {}) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    params.append(k, v);
  });

  const res = await client.get(`/api/session-tracking?${params.toString()}`, {
    signal: options.signal,
  });
  // Axios wraps response in { data }, fetch may return body directly via client wrapper
  return res?.data ?? res;
}

// PUBLIC_INTERFACE
// Backward-compatibility alias to avoid build breaks if any old import remains
export const fetchSessionTracking = getSessionTracking;
