import { useCallback, useEffect, useMemo, useState } from 'react';
import { getActiveUsersTrend } from '../api/usersActiveTrend';
import { useAuth } from '../context/AuthContext';
import { getActiveTenant } from '../utils/tenantClient';
import { apiGet } from '../utils/api';

/**
 * PUBLIC_INTERFACE
 * useActiveUsersTrend
 * Hook to fetch and manage the active users trend state.
 *
 * @param {Object} options
 * @param {number} [options.days=30] - Lookback window in days
 * @param {'day'|'week'} [options.granularity='day'] - Time bucket size
 * @returns {{
 *  loading: boolean,
 *  error: string|null,
 *  items: Array<{date: string, total: number}>,
 *  meta: any,
 *  controls: {
 *    days: number,
 *    setDays: Function,
 *    granularity: 'day'|'week',
 *    setGranularity: Function,
 *    refetch: Function
 *  }
 * }}
 */
export default function useActiveUsersTrend({ days = 30, granularity = 'day' } = {}) {
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [rangeDays, setRangeDays] = useState(days);
  const [bucket, setBucket] = useState(granularity);

  const { user } = useAuth?.() || {};
  const activeTenantId = getActiveTenant?.() || null;

  const dateRange = useMemo(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - rangeDays + 1); // inclusive start
    return { from: from.toISOString(), to: to.toISOString() };
  }, [rangeDays]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await getActiveUsersTrend({
        from: dateRange.from,
        to: dateRange.to,
        granularity: bucket,
        tenantId: activeTenantId || undefined,
      });
      setItems(Array.isArray(resp.items) ? resp.items : []);
      setMeta(resp.meta || {});
    } catch (e) {
      // Fallback: try listing users with created_at/last_updated filter and approximate daily counts client-side
      try {
        const filter = encodeURIComponent(JSON.stringify({
          $or: [
            { created_at: { $gte: dateRange.from, $lte: dateRange.to } },
            { createdAt: { $gte: dateRange.from, $lte: dateRange.to } },
            { last_updated: { $gte: dateRange.from, $lte: dateRange.to } },
            { updatedAt: { $gte: dateRange.from, $lte: dateRange.to } },
          ],
        }));
        const url = `/api/users?limit=2000&filter=${filter}`;
        const list = await apiGet(url);
        const rows = Array.isArray(list) ? list : Array.isArray(list?.data) ? list.data : (Array.isArray(list?.items) ? list.items : []);
        const byDay = new Map();
        for (const u of rows) {
          const t = u.last_updated || u.updatedAt || u.created_at || u.createdAt;
          if (!t) continue;
          const d = new Date(t);
          if (Number.isNaN(d.getTime())) continue;
          const key = d.toISOString().slice(0, 10);
          byDay.set(key, (byDay.get(key) || 0) + 1);
        }
        // Fill from-to
        const s = new Date(dateRange.from);
        const e2 = new Date(dateRange.to);
        const filled = [];
        for (let d = new Date(s); d <= e2; d.setDate(d.getDate() + 1)) {
          const key = d.toISOString().slice(0, 10);
          filled.push({ date: key, total: byDay.get(key) || 0 });
        }
        setItems(filled);
        setMeta({ from: dateRange.from, to: dateRange.to, granularity: 'day', fallback: true });
      } catch (inner) {
        setError(e?.message || inner?.message || 'Failed to load trend');
      }
    } finally {
      setLoading(false);
    }
  }, [dateRange.from, dateRange.to, bucket, activeTenantId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    loading,
    error,
    items,
    meta,
    controls: {
      days: rangeDays,
      setDays: setRangeDays,
      granularity: bucket,
      setGranularity: setBucket,
      refetch: fetchData,
    },
  };
}
