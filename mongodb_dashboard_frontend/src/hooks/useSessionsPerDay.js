import { useEffect, useMemo, useState } from 'react';
import { getSessionsPerDay } from '../api/sessionsPerDay';

/**
 * PUBLIC_INTERFACE
 * React hook to fetch sessions-per-day analytics with optional filters.
 * Params:
 *  - filters: { tenant_id?, project_id?, status?, start?, end? }
 * Returns:
 *  - { data, loading, error, refetch }
 *  - data: Array<{ date: 'YYYY-MM-DD', count: number }>
 */
export function useSessionsPerDay(filters = {}) {
  const [state, setState] = useState({
    data: [],
    loading: true,
    error: null,
    meta: null,
  });

  const stableFilters = useMemo(() => ({ ...filters }), [JSON.stringify(filters)]);

  async function load() {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const resp = await getSessionsPerDay(stableFilters);
      const items = Array.isArray(resp?.items) ? resp.items : [];
      // Normalize item keys to { date, count }
      const normalized = items.map((it) => {
        if (it && typeof it === 'object') {
          const date = it.date || it._id?.date || it._id || it.day || it.bucket || null;
          const count = it.count ?? it.total ?? it.value ?? 0;
          return { date, count };
        }
        return it;
      }).filter(Boolean);
      setState({ data: normalized, loading: false, error: null, meta: resp?.meta || null });
    } catch (err) {
      setState({ data: [], loading: false, error: err, meta: null });
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(stableFilters)]);

  return { ...state, refetch: load };
}
