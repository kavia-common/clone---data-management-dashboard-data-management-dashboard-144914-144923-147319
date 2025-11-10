import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchSessionTracking } from '../api/sessionTracking';
import { getActiveTenant } from '../utils/tenantClient';

/**
 * PUBLIC_INTERFACE
 * useMostActiveUsers
 * Aggregates Most Active Users from /api/session-tracking on the frontend.
 *
 * Options:
 * - window: number of days lookback (default 30)
 * - topN: number of users to return (default 10)
 * - statusFilter: pipe separated string of allowed statuses (default "completed|active")
 *
 * Returns:
 *  { data: Array<{ user_id: string, count: number, user_name?: string }>,
 *    loading: boolean,
 *    error: string|null,
 *    controls: { window: number, setWindow, topN: number, setTopN, setCustomRange, dateRange: { from: string, to: string }, refetch } }
 */
export default function useMostActiveUsers(options = {}) {
  const { window: initialWindow = 30, topN: initialTopN = 10, statusFilter = 'completed|active' } = options;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [series, setSeries] = useState([]);
  const [daysWindow, setDaysWindow] = useState(initialWindow);
  const [n, setN] = useState(initialTopN);
  const [customRange, setCustomRange] = useState(null); // { from: Date|string, to: Date|string }

  const tenantId = getActiveTenant?.() || undefined;

  const dateRange = useMemo(() => {
    if (customRange?.from && customRange?.to) {
      const from = new Date(customRange.from);
      const to = new Date(customRange.to);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    const now = new Date();
    const from = new Date(now.getTime() - daysWindow * 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), to: now.toISOString() };
  }, [customRange, daysWindow]);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Build filter for date range and status
      const statuses = (statusFilter || 'completed|active').split('|').map((s) => s.trim()).filter(Boolean);
      // Server supports generic JSON filter; we will match:
      // - status in statuses
      // - timestamp window using last_updated if present else session_start; in generic filter, we attempt $or on fields.
      const filter = {
        $and: [
          {
            $or: [
              { last_updated: { $gte: dateRange.from, $lte: dateRange.to } },
              { session_start: { $gte: dateRange.from, $lte: dateRange.to } },
            ],
          },
          { status: { $in: statuses } },
        ],
      };
      if (tenantId) {
        filter.$and.push({ tenant_id: tenantId });
      }

      // Pull enough rows for the window; if envelope pagination is enforced, request a larger limit
      const { items } = await fetchSessionTracking({
        limit: 5000,
        sort: '-last_updated',
        filter,
      });

      // Group by user_id and count sessions
      const counts = new Map();
      for (const s of items) {
        const st = (s?.status || '').toLowerCase();
        if (!statuses.map((x) => x.toLowerCase()).includes(st)) continue;

        // date filter safety on client-side as well
        const tsRaw = s?.last_updated || s?.session_start;
        if (!tsRaw) continue;
        const ts = new Date(tsRaw).getTime();
        const fromMs = new Date(dateRange.from).getTime();
        const toMs = new Date(dateRange.to).getTime();
        if (Number.isFinite(ts) && (ts < fromMs || ts > toMs)) continue;

        const uid = String(s?.user_id ?? s?.user?.id ?? s?.user ?? 'unknown');
        if (!counts.has(uid)) {
          counts.set(uid, { user_id: uid, user_name: s?.user_name || s?.user?.name || null, count: 0 });
        }
        counts.get(uid).count += 1;
      }

      const arr = Array.from(counts.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, n);

      setSeries(arr);
    } catch (e) {
      setError(e?.message || 'Failed to load most active users');
    } finally {
      setLoading(false);
    }
  }, [dateRange.from, dateRange.to, statusFilter, tenantId, n]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return {
    data: series,
    loading,
    error,
    controls: {
      window: daysWindow,
      setWindow: setDaysWindow,
      topN: n,
      setTopN: setN,
      setCustomRange: (from, to) => setCustomRange({ from, to }),
      dateRange,
      refetch,
    },
  };
}
