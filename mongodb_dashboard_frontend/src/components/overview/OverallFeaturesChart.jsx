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
  // Pull shared filters (matches how UsersByTenantOverviewChart responds)
  const { tenantId, timeRange, granularity, lastEventId } = useOverviewFilters?.() || {};

  const [series, setSeries] = useState([]);
  const [status, setStatus] = useState({ loading: true, error: null, empty: false });

  // Local toolbar state mirrors OverviewChartFilters options
  const [rangeMode, setRangeMode] = useState('day'); // day|week|month|custom
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // Track last fetch params to avoid duplicate calls
  const lastParamsRef = useRef(null);
  const abortRef = useRef(null);

  // Derive window: prefer shared timeRange if present; otherwise use local selection
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
    if (rangeMode === 'day') {
      start.setDate(now.getDate() - 1);
    } else if (rangeMode === 'week') {
      start.setDate(now.getDate() - 6);
    } else if (rangeMode === 'month') {
      start.setMonth(now.getMonth() - 1);
    } else if (rangeMode === 'custom') {
      const s = customStart ? new Date(customStart) : null;
      const e = customEnd ? new Date(customEnd) : null;
      return {
        fromISO: s && !isNaN(s) ? s.toISOString() : null,
        toISO: e && !isNaN(e) ? e.toISOString() : null,
      };
    }
    return { fromISO: start.toISOString(), toISO: end.toISOString() };
  }, [timeRange?.start, timeRange?.end, rangeMode, customStart, customEnd]);

  const effectiveRangeLabel = useMemo(() => {
    if (rangeMode !== 'custom') return rangeMode;
    return customStart && customEnd ? 'custom' : 'custom-pending';
  }, [rangeMode, customStart, customEnd]);

  const fetchAndAggregate = useCallback(async ({ tenant_id, from, to, service_type }) => {
    // Defensive: need tenant and valid range to fetch
    if (!tenant_id || !from || !to) {
      setSeries([]);
      setStatus((s) => ({ ...s, loading: false, error: null, empty: true }));
      return;
    }

    // Avoid duplicate fetches with same params
    const key = JSON.stringify({ tenant_id, from, to, service_type });
    if (lastParamsRef.current === key) return;
    lastParamsRef.current = key;

    // Abort any in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setStatus({ loading: true, error: null, empty: false });

      // Unify to single API call to /api/session-tracking with from/to + date_field=session_start
      const filter = service_type ? JSON.stringify({ service_type }) : undefined;
      const query = {
        tenant_id,
        from,
        to,
        date_field: 'session_start',
        ...(filter ? { filter } : {}),
        sort: '-session_start',
      };

      // eslint-disable-next-line no-console
      console.log('[OverallFeaturesChart] Fetch session-tracking', query);

      const res = await getSessionTracking(query, { signal: controller.signal });
      const data = Array.isArray(res)
        ? res
        : Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res?.items)
        ? res.items
        : [];

      // Aggregate by service_type (unified source of truth)
      const counts = data.reduce((acc, item) => {
        const k = item?.service_type || 'unknown';
        // Optional: ensure item is within range by timestamp fields if backend didn't filter by specified date_field
        const ts = item?.session_start || item?.last_updated || item?.created_at;
        if (ts) {
          const t = new Date(ts).getTime();
          const f = new Date(from).getTime();
          const toT = new Date(to).getTime();
          if (!isNaN(t) && !isNaN(f) && !isNaN(toT)) {
            if (t < f || t > toT) {
              return acc;
            }
          }
        }
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {});

      const labels = Object.keys(counts);
      const seriesValues = Object.values(counts);

      // Shape for recharts: [{ name, value }, ...]
      const shaped = labels
        .map((name, idx) => ({ name, value: seriesValues[idx] }))
        .sort((a, b) => b.value - a.value);

      setSeries(shaped);
      setStatus({ loading: false, error: null, empty: labels.length === 0 });
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setSeries([]);
      setStatus({ loading: false, error: err?.message || 'Failed to load', empty: false });
    }
  }, []);

  // Trigger fetch on changes but guard to avoid duplicate calls
  useEffect(() => {
    const finalTenant = tenantId || 'b2c'; // keep default tenant when selector not present
    const from = fromISO;
    const to = toISO;
    const stype = serviceType || null;

    // For local custom, fetch only when both dates are selected
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
    // We intentionally avoid adding fetchAndAggregate as a dependency to keep its identity stable.
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
      onClick={() => {
        // eslint-disable-next-line no-console
        console.log('[OverallFeaturesChart] Range mode change ->', mode);
        setRangeMode(mode);
      }}
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
              onChange={(e) => {
                const v = e.target.value ? new Date(e.target.value).toISOString() : '';
                // eslint-disable-next-line no-console
                console.log('[OverallFeaturesChart] Custom start changed ->', v);
                setCustomStart(v);
              }}
              aria-label="Start date"
            />
            <span className="to-sep">to</span>
            <input
              type="date"
              value={customEnd ? customEnd.slice(0, 10) : ''}
              onChange={(e) => {
                const v = e.target.value ? new Date(e.target.value).toISOString() : '';
                // eslint-disable-next-line no-console
                console.log('[OverallFeaturesChart] Custom end changed ->', v);
                setCustomEnd(v);
              }}
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
