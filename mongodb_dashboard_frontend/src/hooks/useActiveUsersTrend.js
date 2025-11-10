import { useCallback, useEffect, useMemo, useState } from 'react';
import { getActiveUsersTrend } from '../api/usersActiveTrend';
import { useAuth } from '../context/AuthContext';
import { getActiveTenant } from '../utils/tenantClient';

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
      setError(e?.message || 'Failed to load trend');
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
