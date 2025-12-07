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
 * Single render path. Fetches session-tracking with dynamic tenant + date range and
 * aggregates counts by service_type using session_start within the selected window.
 *
 * API usage (unchanged shape, only query params):
 *   GET /api/session-tracking?tenant_id=<id>&from=<ISO>&to=<ISO>&date_field=session_start&sort=-session_start
 */
export default function OverallFeaturesChart({ serviceType }) {
  // Pull shared filters (if provided via DataContext). Safe optional usage.
  const { tenantId, timeRange, granularity, lastEventId } = (useOverviewFilters?.() || {});

  // Local UI and data state
  const [series, setSeries] = useState([]);
  const [status, setStatus] = useState({ loading: true, error: null, empty: false });
  const [rangeMode, setRangeMode] = useState('day'); // day|week|month|custom
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // Prevent duplicate calls and cancel in-flight
  const lastParamsRef = useRef(null);
  const abortRef = useRef(null);

  // Compute effective window: prefer global timeRange, otherwise derive from local rangeMode
  const { fromISO, toISO } = useMemo(() => {
    const toIso = (v) => {
      if (!v) return null;
      const d = typeof v === 'string' ? new Date(v) : v;
      return d instanceof Date && !isNaN(d) ? d.toISOString() : null;
    };

    if (timeRange?.start && timeRange?.end) {
      return { fromISO: toIso(timeRange.start), toISO: toIso(timeRange.end) };
    }

    const now = new Date();
    const end = now;
    const start = new Date(now);
    switch (rangeMode) {
      case 'day':
        start.setDate(now.getDate() - 1);
        break;
      case 'week':
        start.setDate(now.getDate() - 6);
        break;
      case 'month':
        start.setMonth(now.getMonth() - 1);
        break;
      case 'custom': {
        const s = customStart ? new Date(customStart) : null;
        const e = customEnd ? new Date(customEnd) : null;
        return {
          fromISO: s && !isNaN(s) ? s.toISOString() : null,
          toISO: e && !isNaN(e) ? e.toISOString() : null,
        };
      }
      default:
        break;
    }
    return { fromISO: start.toISOString(), toISO: end.toISOString() };
  }, [timeRange?.start, timeRange?.end, rangeMode, customStart, customEnd]);

  const effectiveRangeLabel = useMemo(() => {
    if (rangeMode !== 'custom') return rangeMode;
    return customStart && customEnd ? 'custom' : 'custom-pending';
  }, [rangeMode, customStart, customEnd]);

  // Fetch and aggregate by service_type using unified API
  const fetchAndAggregate = useCallback(async ({ tenant_id, from, to, service_type }) => {
    if (!tenant_id || !from || !to) {
      setSeries([]);
      setStatus({ loading: false, error: null, empty: true });
      return;
    }

    const key = JSON.stringify({ tenant_id, from, to, service_type });
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
        from,
        to,
        date_field: 'session_start',
        ...(filter ? { filter } : {}),
        sort: '-session_start',
      };

      const res = await getSessionTracking(query, { signal: controller.signal });
      const data = Array.isArray(res)
        ? res
        : Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res?.items)
        ? res.items
        : [];

      // Aggregate counts by service_type (ensuring range via session_start)
      const fromT = new Date(from).getTime();
      const toT = new Date(to).getTime();

      const byType = data.reduce((acc, item) => {
        const ts = item?.session_start ? new Date(item.session_start).getTime() : NaN;
        if (!isNaN(ts) && !isNaN(fromT) && !isNaN(toT)) {
          if (ts < fromT || ts > toT) return acc;
        }
        const k = item?.service_type || 'unknown';
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {});

      const shaped = Object.entries(byType)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);

      setSeries(shaped);
      setStatus({ loading: false, error: null, empty: shaped.length === 0 });
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setSeries([]);
      setStatus({ loading: false, error: err?.message || 'Failed to load', empty: false });
    }
  }, []);

  // Effect: trigger on relevant changes and avoid duplicates
  useEffect(() => {
    // Dynamic tenant: prefer DataContext, else attempt URL param (?tenant_id), else fallback 'b2c'
    let finalTenant = tenantId;
    if (!finalTenant) {
      try {
        const url = new URL(window.location.href);
        finalTenant = url.searchParams.get('tenant_id') || url.searchParams.get('organization_id') || undefined;
      } catch {
        // noop
      }
    }
    finalTenant = finalTenant || 'b2c';

    const from = fromISO;
    const to = toISO;
    const stype = serviceType || null;

    // For local custom, fetch only when both are selected (when not using global timeRange)
    if (!timeRange?.start && rangeMode === 'custom' && (!customStart || !customEnd)) {
      setSeries([]);
      setStatus({ loading: false, error: null, empty: true });
      return;
    }

    if (!finalTenant || !from || !to) {
      setSeries([]);
      setStatus({ loading: false, error: null, empty: true });
      return;
    }

    fetchAndAggregate({ tenant_id: finalTenant, from, to, service_type: stype });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tenantId,
    fromISO,
    toISO,
    serviceType,
    lastEventId,
    granularity,
    rangeMode,
    customStart,
    customEnd,
    timeRange?.start,
    timeRange?.end,
  ]);

  // Cleanup in-flight fetch
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
      aria-label={`Select ${label} range`}
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
