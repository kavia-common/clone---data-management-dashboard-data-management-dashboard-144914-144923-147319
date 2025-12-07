import React, { useEffect, useMemo, useState, useCallback } from 'react';
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
import { getTenantId } from '../../utils/tenantSelection';
import { fetchSessionTracking } from '../../api/sessionTracking';
import Card from '../common/Card';
import LoadingState from '../common/LoadingState';
import ErrorState from '../common/ErrorState';
import './overview.css';

/**
 * Helpers
 * All date calculations are normalized to local time and filtering is STRICTLY by session_start.
 */
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function startOfWeek(d) {
  const x = new Date(d);
  const day = x.getDay(); // 0 Sun..6 Sat
  const diff = (day + 6) % 7; // Monday start
  x.setDate(x.getDate() - diff);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfWeek(d) {
  const s = startOfWeek(d);
  const x = new Date(s);
  x.setDate(s.getDate() + 6);
  x.setHours(23, 59, 59, 999);
  return x;
}
function startOfMonth(d) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfMonth(d) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + 1, 0);
  x.setHours(23, 59, 59, 999);
  return x;
}
function parseDateSafe(value) {
  if (!value) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  return new Date(t);
}
function inRange(date, from, to) {
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}
function normalizeServiceType(v) {
  if (v === null || v === undefined || v === '') return 'Unknown';
  return String(v);
}
/**
 * Computes date window for filter modes:
 * - day/week/month: relative to now (can be extended to accept anchor).
 * - custom: uses local date picker values, inclusive.
 */
function computeWindowLocal({ mode, startDate, endDate }) {
  const now = new Date();
  const m = (mode || 'day').toLowerCase();
  if (m === 'day') return { from: startOfDay(now), to: endOfDay(now), granularity: 'day' };
  if (m === 'week') return { from: startOfWeek(now), to: endOfWeek(now), granularity: 'week' };
  if (m === 'month') return { from: startOfMonth(now), to: endOfMonth(now), granularity: 'month' };
  // custom
  const from = startDate ? startOfDay(new Date(startDate)) : null;
  const to = endDate ? endOfDay(new Date(endDate)) : null;
  if (!from && !to) {
    // sensible fallback: last 7 days
    const seven = new Date(now);
    seven.setDate(now.getDate() - 6);
    return { from: startOfDay(seven), to: endOfDay(now), granularity: 'custom' };
  }
  return { from, to, granularity: 'custom' };
}

/**
 * Fetches /api/session-tracking pages client-side and filters strictly by session_start.
 * Respects tenant_id and paginates up to maxPages or until records are out of window.
 */
async function fetchSessionTrackingPaged({
  tenantId,
  from,
  to,
  limit = 200,
  maxPages = 10,
  signal,
}) {
  let page = 1;
  const all = [];
  const sort = '-session_start'; // newest first to early-exit when below window

  while (page <= maxPages) {
    const { items } = await fetchSessionTracking(
      { page, limit, tenant_id: tenantId, sort },
      { signal }
    );
    const returned = items || [];
    all.push(...returned);

    // stop if page not full
    if (returned.length < limit) break;

    // early stop if we've paged past the window start
    const last = returned[returned.length - 1];
    const lastDate = parseDateSafe(last?.session_start);
    if (from && lastDate && lastDate < from) break;

    page += 1;
  }

  // Strict session_start filtering
  const filtered = all.filter((doc) => {
    const dt = parseDateSafe(doc?.session_start);
    return inRange(dt, from, to);
  });
  return filtered;
}

/**
 * Groups results by service_type (fallback 'Unknown') and returns array for chart.
 */
function shapeBarDataByServiceType(docs) {
  const map = new Map();
  for (const doc of docs) {
    const key = normalizeServiceType(doc?.service_type);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Toolbar for Overall Features chart with Day/Week/Month/Custom and custom date-range.
 */
function OverallFeaturesToolbar({ value, onChange, disabled }) {
  const v = value || {};
  const m = (v.mode || 'day').toLowerCase();

  return (
    <div className="overview-card-header overall-features-toolbar" style={{ marginBottom: 12 }}>
      <div className="overview-card-title">Overall Features</div>
      <div className="users-by-tenant-controls">
        <div className="segmented" role="tablist" aria-label="Time range">
          {['day', 'week', 'month', 'custom'].map((opt) => (
            <button
              key={opt}
              type="button"
              className={`seg-btn ${m === opt ? 'active' : ''}`}
              aria-pressed={m === opt}
              onClick={() => onChange?.({ ...v, mode: opt })}
              disabled={disabled}
            >
              {opt[0].toUpperCase() + opt.slice(1)}
            </button>
          ))}
        </div>
        {m === 'custom' && (
          <div className="custom-range" aria-live="polite">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>From</span>
              <input
                type="date"
                value={v.startDate ? v.startDate : ''}
                onChange={(e) => onChange?.({ ...v, startDate: e.target.value || '' })}
                disabled={disabled}
              />
            </label>
            <span className="to-sep">to</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>To</span>
              <input
                type="date"
                value={v.endDate ? v.endDate : ''}
                onChange={(e) => onChange?.({ ...v, endDate: e.target.value || '' })}
                disabled={disabled}
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

// PUBLIC_INTERFACE
export default function OverallFeaturesChart() {
  /**
   * This public component renders the 'Overall Features' bar chart using Recharts.
   * - Fetches GET /api/session-tracking scoped by tenant, paginated.
   * - Filters strictly by session_start across modes (day/week/month/custom).
   * - Aggregates counts by service_type -> [{ name, value }].
   * - Shows robust loading/empty/error states with retry.
   */
  const tenantId = getTenantId();

  // Local filter state
  const [toolbar, setToolbar] = useState({
    mode: 'day',
    startDate: '',
    endDate: '',
  });

  const [data, setData] = useState([]);
  const [state, setState] = useState({ loading: false, error: null });

  const { from, to } = useMemo(() => computeWindowLocal(toolbar), [
    toolbar.mode,
    toolbar.startDate,
    toolbar.endDate,
  ]);

  const load = useCallback(() => {
    if (!tenantId) return;
    const ctrl = new AbortController();
    setState({ loading: true, error: null });

    fetchSessionTrackingPaged({
      tenantId,
      from,
      to,
      limit: 200,
      maxPages: 10,
      signal: ctrl.signal,
    })
      .then((docs) => {
        const shaped = shapeBarDataByServiceType(docs);
        setData(shaped);
        setState({ loading: false, error: null });
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setState({
          loading: false,
          error: err?.message || 'Failed to load Overall Features',
        });
      });

    return () => ctrl.abort();
  }, [tenantId, from?.getTime?.(), to?.getTime?.()]);

  useEffect(() => {
    const cleanup = load();
    return () => {
      if (typeof cleanup === 'function') cleanup();
    };
  }, [load]);

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
      <OverallFeaturesToolbar value={toolbar} onChange={setToolbar} disabled={state.loading} />

      {state.loading && <LoadingState message="Loading Overall Features..." />}
      {!state.loading && state.error && (
        <ErrorState message={state.error} onRetry={load} />
      )}

      {!state.loading && !state.error && (
        <>
          {data.length === 0 ? (
            <div className="overview-empty-state">
              <p>No sessions for selected range</p>
            </div>
          ) : (
            <div
              className="overview-card overview-section users-overall-features overall-features-card"
              style={{ width: '100%', height: 360, background: theme.surface, borderRadius: 8 }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 16, right: 24, left: 0, bottom: 24 }}>
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
