import { useEffect, useState } from 'react';
import { buildAuthHeaders, getTenantId } from '../api/authTokenProvider';

/**
 * PUBLIC_INTERFACE
 * useProjectUsage
 * Hook to fetch usage totals for a project (creditsUsed, cost, currency) from backend.
 * - Calls GET /api/projects/:projectId/usage
 * - Returns { data, loading, error, refetch }
 */
export function useProjectUsage(projectId, options = {}) {
  const enabled = options.enabled ?? Boolean(projectId);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState(null);

  async function fetchUsage() {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const base = process.env.REACT_APP_API_BASE_URL || '';
      const tid = getTenantId();
      let url = `${base}/api/projects/${encodeURIComponent(projectId)}/usage`;
      if (tid && !/[?&]tenant_id=/.test(url)) {
        const sep = url.includes('?') ? '&' : '?';
        url = `${url}${sep}tenant_id=${encodeURIComponent(tid)}`;
      }
      const res = await fetch(url, {
        method: 'GET',
        headers: buildAuthHeaders({ Accept: 'application/json' }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Failed to load usage (${res.status}): ${txt || res.statusText}`);
      }
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e.message || 'Failed to load usage');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setData(null);
    setError(null);
    if (enabled) {
      fetchUsage();
    } else {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, enabled]);

  return { data, loading, error, refetch: fetchUsage };
}
