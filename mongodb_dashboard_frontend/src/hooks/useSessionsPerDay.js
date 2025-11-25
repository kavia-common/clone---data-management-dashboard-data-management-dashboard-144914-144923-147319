import { useEffect, useMemo, useRef, useState } from 'react';
import { getSessionsPerDay } from '../api/sessionsPerDay';

/**
 * PUBLIC_INTERFACE
 * React hook to fetch sessions-per-day analytics with optional filters.
 * Ensures single fetch per distinct filter set using a stable key + guard.
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

  const key = useMemo(() => {
    try { return JSON.stringify(filters || {}); } catch { return ''; }
  }, [filters]);

  const lastKeyRef = useRef(null);

  async function load(currentKey = key) {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const resp = await getSessionsPerDay(filters);
      const items = Array.isArray(resp?.items) ? resp.items : [];
      const normalized = items.map((it) => {
        if (it && typeof it === 'object') {
          const date = it.date || it._id?.date || it._id || it.day || it.bucket || null;
          const count = it.count ?? it.total ?? it.value ?? 0;
          return { date, count };
        }
        return it;
      }).filter(Boolean);
      // Only update if key matches last requested to avoid race conditions
      if (lastKeyRef.current === currentKey) {
        setState({ data: normalized, loading: false, error: null, meta: resp?.meta || null });
      }
    } catch (err) {
      if (lastKeyRef.current === currentKey) {
        setState({ data: [], loading: false, error: err, meta: null });
      }
    }
  }

  useEffect(() => {
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;
    load(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { ...state, refetch: () => load(key) };
}
