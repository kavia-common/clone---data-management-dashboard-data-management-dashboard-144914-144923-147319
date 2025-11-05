import { useEffect, useState } from 'react';
import api from '../utils/api';

/**
 * PUBLIC_INTERFACE
 * useCostAggregates
 * Fetches cost aggregates from backend and returns { data, loading, error }.
 * Params:
 *  - from: ISO string lower bound
 *  - to: ISO string upper bound
 *  - groupBy: grouping key (e.g., "service" | "agent")
 *
 * Backend alignment notes:
 *  - For agent grouping, aligns with GET /api/analytics/llm-cost-by-agent
 *  - For service grouping, there is no explicit endpoint in the current OpenAPI.
 *    TODO: Confirm or add an endpoint like GET /api/analytics/llm-cost-by-service.
 *    For now, we fallback to listing /api/llm-costs and aggregating client-side when groupBy!=='agent'.
 */
export default function useCostAggregates({ from, to, groupBy = 'service' } = {}) {
  const [data, setData] = useState({ items: [], meta: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        let items = [];
        if (groupBy === 'agent') {
          // Use live backend endpoint for agent cost distribution
          const res = await api.get('/api/analytics/llm-cost-by-agent');
          const arr = Array.isArray(res?.data) ? res.data : [];
          // Normalize to [{ key, total }]
          items = arr.map((row) => ({
            key: row.agent ?? 'unknown',
            total: typeof row.total_cost === 'number' ? row.total_cost : 0,
          }));
        } else {
          // Fallback path: fetch raw costs and aggregate client-side by "service" (or provided groupBy)
          // TODO: Replace with server-side aggregate endpoint when available.
          const params = {};
          if (from || to) {
            // Pass through filter as JSON if supported by backend
            const f = {};
            if (from && to) {
              f.timestamp = { $gte: from, $lte: to };
            } else if (from) {
              f.timestamp = { $gte: from };
            } else if (to) {
              f.timestamp = { $lte: to };
            }
            params.filter = JSON.stringify(f);
          }
          const res = await api.get('/api/llm-costs', { params });
          const records = Array.isArray(res?.data) ? res.data : res?.data?.data || [];
          const byKey = new Map();
          for (const r of records) {
            // Common possible fields: service/provider/model. Try "service" first, fallback to llm_provider/model.
            const key =
              r.service ||
              r.provider ||
              r.llm_provider ||
              r.llm_model ||
              r.model ||
              'unknown';
            const cost =
              typeof r.total_cost === 'number'
                ? r.total_cost
                : typeof r.cost === 'number'
                ? r.cost
                : 0;
            byKey.set(key, (byKey.get(key) || 0) + cost);
          }
          items = Array.from(byKey.entries()).map(([key, total]) => ({ key, total }));
          // Sort descending for consistency
          items.sort((a, b) => b.total - a.total);
        }

        if (!cancelled) {
          setData({
            items,
            meta: { from: from || null, to: to || null, groupBy },
          });
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e);
          setData({ items: [], meta: { from: from || null, to: to || null, groupBy } });
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [from, to, groupBy]);

  return { data, loading, error };
}
