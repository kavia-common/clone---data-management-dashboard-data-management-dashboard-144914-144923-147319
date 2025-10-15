/**
 * PUBLIC_INTERFACE
 * useLlmCostsSummary
 * Fetches /api/llm-costs/summary and returns { user_cost, project_cost, currency } with loading and error state.
 */
import { useEffect, useState } from 'react';

export default function useLlmCostsSummary() {
  const [data, setData] = useState({ user_cost: 0, project_cost: 0, currency: 'USD' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/llm-costs/summary');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (mounted) {
          setData({
            user_cost: Number(json.user_cost || 0),
            project_cost: Number(json.project_cost || 0),
            currency: json.currency || 'USD',
          });
        }
      } catch (e) {
        if (mounted) setError(e?.message || 'Failed to load summary');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return { data, loading, error };
}
