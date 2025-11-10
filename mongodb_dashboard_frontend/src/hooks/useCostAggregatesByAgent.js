import { useEffect, useState } from 'react';
import api from '../utils/api';

/**
 * PUBLIC_INTERFACE
 * useCostAggregatesByAgent
 * Fetches agent cost distribution from backend and returns { data, loading, error }.
 * Uses GET /api/analytics/llm-cost-by-agent from backend OpenAPI.
 * Optional from/to currently unused by backend endpoint; kept for future compatibility.
 */
export default function useCostAggregatesByAgent({ from, to } = {}) {
  const [data, setData] = useState({ items: [], meta: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await api.get('/api/analytics/llm-cost-by-agent');
        const arr = Array.isArray(res?.data) ? res.data : [];
        const items = arr.map((row) => ({
          agent: row.agent ?? 'unknown',
          total_cost: typeof row.total_cost === 'number' ? row.total_cost : 0,
        }));
        if (!cancelled) {
          setData({ items, meta: { from: from || null, to: to || null } });
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e);
          setData({ items: [], meta: { from: from || null, to: to || null } });
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  return { data, loading, error };
}
