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
 * Adds Day/Week/Month/Custom toolbar and fetches session-tracking grouped by service_type
 * using session_start within selected window. For Custom, shows date pickers and only fetches
 * once both start and end are picked.
 *
 * API query:
 *   GET /api/session-tracking?tenant_id=<id>&start=<ISO>&end=<ISO>[&filter=<JSON>]
 * Response can be array or envelope; normalize to array.
 */
export default function OverallFeaturesChart({ serviceType }) {
  const { tenantId, timeRange, granularity, lastEventId } = useOverviewFilters?.() || {};
  const [series, setSeries] = useState([]);
  const [status, setStatus] = useState({ loading: true, error: null, empty: false });

  // Local toolbar state
  const [rangeMode, setRangeMode] = useState('day'); // 'day' | 'week' | 'month' | 'custom'
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // Track last fetch params to avoid duplicate calls
  const lastParamsRef = useRef(null);
  const abortRef = useRef(null);

  // Derive window from shared filters OR local rangeMode when shared not present.
  const { startISO, endISO } = useMemo(() => {
    // If shared timeRange exists and aligns with known modes, prefer it
    if (timeRange?.start && timeRange?.end) {
      const toISO = (v) => {
        if (!v) return null;
        const d = typeof v === 'string' ? new Date(v) : v;
        return d instanceof Date && !isNaN(d) ? d.toISOString() : null;
      };
      return { startISO: toISO(timeRange.start), endISO: toISO(timeRange.end) };
    }

    // Compute based on local rangeMode
    const now = new Date();
    const end = now;
    const start = new Date(now);
    if (rangeMode === 'day') {
      start.setDate(now.getDate() - 1);
    } else if (rangeMode === 'week') {
      start.setDate(now.getDate() - 7);
    } else if (rangeMode === 'month') {
      start.setMonth(now.getMonth() - 1);
    } else if (rangeMode === 'custom') {
      const s = customStart ? new Date(customStart) : null;
      const e = customEnd ? new Date(customEnd) : null;
      return {
        startISO: s && !isNaN(s) ? s.toISOString() : null,
        endISO: e && !isNaN(e) ? e.toISOString() : null,
      };
    }
    return { startISO: start.toISOString(), endISO: end.toISOString() };
  }, [timeRange?.start, timeRange?.end, rangeMode, customStart, customEnd]);

  const effectiveRangeLabel = useMemo(() => {
    if (rangeMode !== 'custom') return rangeMode;
    return customStart && customEnd ? 'custom' : 'custom-pending';
  }, [rangeMode, customStart, customEnd]);

  const fetchAndAggregate = useCallback(async (params) => {
    const { tenant_id, start, end, service_type } = params || {};
    if (!tenant_id || !start || !end) {
      setSeries([]);
      setStatus((s) => ({ ...s, loading: false, error: null, empty: true }));
      return;
    }

    const key = JSON.stringify({ tenant_id, start, end, service_type });
    if (lastParamsRef.current === key) return;
    lastParamsRef.current = key;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setStatus({ loading: true, error: null, empty: false });

      const filter = service_type ? JSON.stringify({ service_type }) : undefined;
      const query = {
        tenant_id,
        start,
        end,
        ...(filter ? { filter } : {}),
        sort: '-session_start',
      };

      const res = await getSessionTracking(query, { signal: controller.signal });
      const items = Array.isArray(res)
        ? res
        : Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res?.items)
        ? res.items
        : [];

      // Aggregate by service_type using session_start
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
      if (err?.name === 'AbortError') return;
      setSeries([]);
      setStatus({ loading: false, error: err?.message || 'Failed to load', empty: false });
    }
  }, []);

  // Trigger fetch on changes
  useEffect(() => {
    const finalTenant = tenantId || null;
    const start = startISO;
    const end = endISO;
    const stype = serviceType || null;

    // For custom, only fetch when both dates selected or shared timeRange provided
    if (rangeMode === 'custom' && !timeRange?.start && (!customStart || !customEnd)) {
      setSeries([]);
      setStatus({ loading: false, error: null, empty: true });
      return;
    }

    if (!finalTenant || !start || !end) {
      setSeries([]);
      setStatus({ loading: false, error: null, empty: true });
      return;
    }
    fetchAndAggregate({ tenant_id: finalTenant, start, end, service_type: stype });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, startISO, endISO, serviceType, lastEventId, rangeMode, customStart, customEnd]);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
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

  const RangeButton = ({ mode, label }) => (
    <button
      type="button"
      onClick={() => setRangeMode(mode)}
      className={`seg-btn ${rangeMode === mode ? 'active' : ''}`}
      aria-pressed={rangeMode === mode}
    >
      {label}
    </button>
  );

  return (
    <Card title="Overall Features" subtitle="Session counts grouped by service type">
      <div className="overall-features-toolbar">
        <div className="segmented" role="tablist" aria-label="Time range filters">
          <RangeButton mode="day" label="Day" />
          <RangeButton mode="week" label="Week" />
          <RangeButton mode="month" label="Month" />
          <RangeButton mode="custom" label="Custom" />
        </div>

        {rangeMode === 'custom' && (
          <div className="custom-range" aria-label="Custom date range">
            <input
              type="date"
              value={customStart ? customStart.slice(0, 10) : ''}
              onChange={(e) => setCustomStart(e.target.value ? new Date(e.target.value).toISOString() : '')}
              aria-label="Start date"
            />
            <span className="to-sep">to</span>
            <input
              type="date"
              value={customEnd ? customEnd.slice(0, 10) : ''}
              onChange={(e) => setCustomEnd(e.target.value ? new Date(e.target.value).toISOString() : '')}
              aria-label="End date"
            />
          </div>
        )}
      </div>

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
      <div className="overview-footer-note" aria-hidden>
        <span className="kpi-pill">Range: {effectiveRangeLabel}</span>
      </div>
    </Card>
  );
}
