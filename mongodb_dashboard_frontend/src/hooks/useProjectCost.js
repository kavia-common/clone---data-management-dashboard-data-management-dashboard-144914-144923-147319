import { useEffect, useState } from 'react';

/**
 * PUBLIC_INTERFACE
 * useProjectCost
 * Fetches aggregated cost for a project from backend (/api/projects/:projectId/cost).
 * Returns { data, loading, error, refetch } where data = { projectId, cost, currency }.
 */
export function useProjectCost(projectId, options = {}) {
  const enabled = options.enabled ?? Boolean(projectId);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState(null);

  async function fetchCost() {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const base = process.env.REACT_APP_API_BASE_URL || '';
      const res = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/cost`);
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Failed to load cost (${res.status}): ${txt || res.statusText}`);
      }
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e.message || 'Failed to load cost');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setData(null);
    setError(null);
    if (enabled) {
      fetchCost();
    } else {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, enabled]);

  return { data, loading, error, refetch: fetchCost };
}
