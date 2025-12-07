import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import Card from '../common/Card';
import LoadingState from '../common/LoadingState';
import ErrorState from '../common/ErrorState';
import './overview.css';
import { useOverviewFilters } from '../../hooks/useOverviewFilters';
import { getSessionTracking } from '../../api/sessionTracking';

/**
 * PUBLIC_INTERFACE
 * OverallFeaturesChart
 * Subscribes to shared Overview filter state and fetches session-tracking grouped by service_type.
 * Priority of filters:
 *   1) Shared Overview filters via useOverviewFilters (day|week|month|custom)
 *   2) Local toolbar/props as optional overrides when shared not available (defensive)
 *
 * API:
 *   GET /api/session-tracking with query:
 *     { tenant_id, start, end, filter? (service_type) }
 * Aggregation:
 *   Group by service_type using session_start in [start,end]
 *
 * Props:
 *   - serviceType (optional): If provided, included as API filter; otherwise all types are aggregated.
 */
export default function OverallFeaturesChart({ serviceType }) {
  const { tenantId, timeRange, granularity, lastEventId } = useOverviewFilters?.() || {};
  const [series, setSeries] = useState([]);
  const [status, setStatus] = useState({ loading: true, error: null, empty: false });

  // Track last fetch params to avoid duplicate calls when both local and shared filters exist
  const lastParamsRef = useRef(null);
  const abortRef = useRef(null);

  // Compute start/end from shared timeRange
  // timeRange structure expectation: { mode: 'day'|'week'|'month'|'custom', start: Date|ISO, end: Date|ISO }
  const { startISO, endISO } = useMemo(() => {
    const start = timeRange?.start ? new Date(timeRange.start) : null;
    const end = timeRange?.end ? new Date(timeRange.end) : null;
    const toISO = (d) => (d instanceof Date && !isNaN(d) ? d.toISOString() : typeof d === 'string' ? new Date(d).toISOString() : null);
    return {
      startISO: start ? toISO(start) : null,
      endISO: end ? toISO(end) : null,
    };
  }, [timeRange?.start, timeRange?.end]);

  const fetchAndAggregate = useCallback(async (params) => {
    const { tenant_id, start, end, service_type } = params || {};
    if (!tenant_id || !start || !end) {
      setSeries([]);
      setStatus((s) => ({ ...s, loading: false, error: null, empty: true }));
      return;
    }

    // Deduplicate identical calls
    const key = JSON.stringify({ tenant_id, start, end, service_type });
    if (lastParamsRef.current === key) return;
    lastParamsRef.current = key;

    // Abort any in-flight request
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setStatus({ loading: true, error: null, empty: false });
      // Build query for server-side filtering by session_start in [start,end]
      const filter = service_type ? JSON.stringify({ service_type }) : undefined;
      const query = {
        tenant_id,
        start,
        end,
        ...(filter ? { filter } : {}),
        sort: '-session_start',
        // no explicit pagination so backend returns raw array when limit/page not provided
      };

      const res = await getSessionTracking(query, { signal: controller.signal });
      // Response can be array or envelope; normalize to array
      const items = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : Array.isArray(res?.items) ? res.items : [];

      // Aggregate by service_type
      const counts = {};
      for (const it of items) {
        const stype = it?.service_type || 'unknown';
        const ts = it?.session_start || it?.created_at || it?.last_updated;
        if (!ts) continue;
        const t = new Date(ts).getTime();
        if (isNaN(t)) continue;
        counts[stype] = (counts[stype] || 0) + 1;
      }

      const entries = Object.entries(counts)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);

      setSeries(entries);
      setStatus({ loading: false, error: null, empty: entries.length === 0 });
    } catch (err) {
      if (err?.name === 'AbortError') {
        return;
      }
      setSeries([]);
      setStatus({ loading: false, error: err?.message || 'Failed to load', empty: false });
    }
  }, []);

  // Trigger fetch on relevant changes
  useEffect(() => {
    const finalTenant = tenantId || null;
    const start = startISO;
    const end = endISO;
    const stype = serviceType || null;

    if (!finalTenant || !start || !end) {
      setSeries([]);
      setStatus({ loading: false, error: null, empty: true });
      return;
    }
    fetchAndAggregate({ tenant_id: finalTenant, start, end, service_type: stype });
  }, [tenantId, startISO, endISO, serviceType, lastEventId, fetchAndAggregate]);

  // Cleanup abort on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  const theme = {
    primary: '#2563EB',
    secondary: '#F59E0B',
    background: '#f9fafb',
    surface: '#ffffff',
    text: '#111827',
    grid: '#E5E7EB',
  };

  return (
    <Card>
      {status.loading && <LoadingState message="Loading Overall Features..." />}
      {!status.loading && status.error && <ErrorState message={status.error} />}
      {!status.loading && !status.error && (
        <>
          {status.empty ? (
            <div className="overview-empty-state">
              <p>No sessions for selected range</p>
            </div>
          ) : (
            <div
              className="overview-card overview-section users-overall-features overall-features-card"
              style={{ width: '100%', height: 360, background: theme.surface, borderRadius: 8 }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series} margin={{ top: 16, right: 24, left: 0, bottom: 24 }}>
                  <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    stroke={theme.text}
                    tick={{ fontSize: 12 }}
                    interval={0}
                    angle={-15}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis stroke={theme.text} tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar
                    dataKey="value"
                    name="Count"
                    fill={theme.primary}
                    stroke={theme.primary}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
