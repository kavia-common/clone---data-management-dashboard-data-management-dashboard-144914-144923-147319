import React, { useEffect, useMemo, useState } from 'react';
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
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
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
function computeWindowLocal({ mode, startDate, endDate }) {
  const now = new Date();
  const m = (mode || 'day').toLowerCase();
  if (m === 'day') return { from: startOfDay(now), to: endOfDay(now), g: 'day' };
  if (m === 'week') return { from: startOfWeek(now), to: endOfWeek(now), g: 'week' };
  if (m === 'month') return { from: startOfMonth(now), to: endOfMonth(now), g: 'month' };
  // custom
  const from = startDate ? startOfDay(new Date(startDate)) : null;
  const to = endDate ? endOfDay(new Date(endDate)) : null;
  if (!from && !to) {
    // fallback: last 7 days
    const seven = new Date(now);
    seven.setDate(now.getDate() - 6);
    return { from: startOfDay(seven), to: endOfDay(now), g: 'custom' };
  }
  return { from, to, g: 'custom' };
}
async function fetchSessionTrackingPaged({ tenantId, from, to, limit = 200, maxPages = 50, signal }) {
  let page = 1;
  const all = [];
  const sort = '-session_start';

  while (page <= maxPages) {
    const { items } = await fetchSessionTracking(
      { page, limit, tenant_id: tenantId, sort },
      { signal }
    );
    const returned = items || [];
    all.push(...returned);

    if (returned.length < limit) break;

    const last = returned[returned.length - 1];
    const lastDate = parseDateSafe(last?.session_start || last?.last_updated || last?.created_at);
    if (from && lastDate && lastDate < from) break;

    page += 1;
  }

  const filtered = all.filter((doc) => {
    const dt = parseDateSafe(doc?.session_start || doc?.last_updated || doc?.created_at);
    return inRange(dt, from, to);
  });
  return filtered;
}
function shapeBarDataByServiceType(docs) {
  const map = new Map();
  for (const doc of docs) {
    const key = normalizeServiceType(doc?.service_type);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([service_type, count]) => ({ service_type, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Local toolbar component for Overall Features chart.
 * Independent from Users chart filters.
 */
function OverallFeaturesToolbar({ value, onChange, disabled }) {
  const v = value || {};
  const m = (v.mode || 'day').toLowerCase();

  return (
    <div className="overview-card-header" style={{ marginBottom: 12 }}>
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
  /** This public component renders an 'Overall Features' bar chart using Recharts with its own toolbar.
   * The toolbar provides Day/Week/Month/Custom options and a local Custom range (startDate,endDate).
   * It fetches /api/session-tracking with tenant scope and pagination, filters by session_start,
   * groups by service_type, and renders the chart.
   */
  const tenantId = getTenantId();

  // Independent local toolbar/filter state (does not affect Users chart)
  const [toolbar, setToolbar] = useState({
    mode: 'day',
    startDate: '',
    endDate: '',
  });

  const [data, setData] = useState([]);
  const [state, setState] = useState({ loading: false, error: null });

  const { from, to } = useMemo(() => {
    return computeWindowLocal(toolbar);
  }, [toolbar.mode, toolbar.startDate, toolbar.endDate]);

  useEffect(() => {
    if (!tenantId) return;
    const ctrl = new AbortController();
    setState({ loading: true, error: null });

    fetchSessionTrackingPaged({
      tenantId,
      from,
      to,
      limit: 200,
      maxPages: 50,
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
      {/* Toolbar with loading/disabled consideration */}
      <OverallFeaturesToolbar
        value={toolbar}
        onChange={setToolbar}
        disabled={state.loading}
      />

      {state.loading && <LoadingState message="Loading Overall Features..." />}
      {!state.loading && state.error && <ErrorState message={state.error} />}

      {!state.loading && !state.error && (
        <>
          {data.length === 0 ? (
            <div className="overview-empty-state">
              <p>No feature usage found in the selected period.</p>
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
                    dataKey="service_type"
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
                    dataKey="count"
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
