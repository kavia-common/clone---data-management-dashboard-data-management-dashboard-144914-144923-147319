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
import { useOverviewFilters } from '../../hooks/useOverviewFilters';
import { getTenantId } from '../../utils/tenantSelection';
import { fetchSessionTracking } from '../../api/sessionTracking';
import Card from '../common/Card';
import LoadingState from '../common/LoadingState';
import ErrorState from '../common/ErrorState';
import '../../components/charts/ActiveUsersTrendChart.css';

/**
 * Helpers
 */
// Compute window by granularity/day/week/month/custom when Overview filters may only pass partial data
function computeWindow(range, granularity) {
  const now = new Date();
  const startOfDay = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const endOfDay = (d) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  };
  const startOfWeek = (d) => {
    const x = new Date(d);
    const day = x.getDay(); // 0 Sun..6 Sat
    const diff = (day + 6) % 7; // Monday as week start
    x.setDate(x.getDate() - diff);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const endOfWeek = (d) => {
    const s = startOfWeek(d);
    const x = new Date(s);
    x.setDate(s.getDate() + 6);
    x.setHours(23, 59, 59, 999);
    return x;
  };
  const startOfMonth = (d) => {
    const x = new Date(d);
    x.setDate(1);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const endOfMonth = (d) => {
    const x = new Date(d);
    x.setMonth(x.getMonth() + 1, 0);
    x.setHours(23, 59, 59, 999);
    return x;
  };

  const g = (granularity || range?.granularity || '').toString().toLowerCase();
  const fromProp = range?.from ? new Date(range.from) : null;
  const toProp = range?.to ? new Date(range.to) : null;

  if (g === 'day') {
    const f = startOfDay(toProp || now);
    const t = endOfDay(toProp || now);
    return { from: f, to: t, g: 'day' };
  }
  if (g === 'week') {
    const ref = toProp || now;
    return { from: startOfWeek(ref), to: endOfWeek(ref), g: 'week' };
  }
  if (g === 'month') {
    const ref = toProp || now;
    return { from: startOfMonth(ref), to: endOfMonth(ref), g: 'month' };
  }
  // custom: if from/to given, use them; else fallback to last 7 days
  if (fromProp || toProp) {
    return {
      from: fromProp ? startOfDay(fromProp) : null,
      to: toProp ? endOfDay(toProp) : null,
      g: 'custom',
    };
  }
  const seven = new Date(now);
  seven.setDate(now.getDate() - 6);
  return { from: startOfDay(seven), to: endOfDay(now), g: 'custom' };
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

async function fetchSessionTrackingPaged({ tenantId, from, to, limit = 200, maxPages = 50, signal }) {
  // We call our API client that returns envelope/array
  let page = 1;
  const all = [];

  const baseParams = {
    tenant_id: tenantId,
    sort: '-session_start',
  };

  while (page <= maxPages) {
    const { items } = await fetchSessionTracking(
      { page, limit, tenant_id: tenantId, sort: baseParams.sort },
      { signal }
    );

    const returned = items || [];
    all.push(...returned);

    if (returned.length < limit) break;

    const last = returned[returned.length - 1];
    const lastDate = parseDateSafe(last?.session_start || last?.last_updated || last?.created_at);
    if (from && lastDate && lastDate < from) {
      break;
    }
    page += 1;
  }

  // Client-side date range filter using session_start (fallbacks included)
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
  // Convert to array sorted by count desc
  return Array.from(map.entries())
    .map(([service_type, count]) => ({ service_type, count }))
    .sort((a, b) => b.count - a.count);
}

// PUBLIC_INTERFACE
export default function OverallFeaturesChart() {
  /** This is a public component that renders an 'Overall Features' bar chart using Recharts. It:
   * 1) Reads active date-range and granularity from Overview filters (DataContext),
   * 2) Computes start/end timestamps for day/week/month/custom,
   * 3) Fetches /api/session-tracking with tenant and pagination,
   * 4) Filters records client-side by session_start,
   * 5) Aggregates counts by service_type,
   * 6) Renders the chart; and
   * 7) Displays proper loading/empty/error states.
   */

  const filters = useOverviewFilters();
  const granularity = (filters?.granularity || filters?.range?.granularity || '').toString();
  const tenantId = getTenantId();

  const [data, setData] = useState([]);
  const [state, setState] = useState({ loading: false, error: null });

  const { from, to } = useMemo(() => {
    const win = computeWindow(filters?.range || filters, granularity);
    return { from: win.from, to: win.to };
  }, [filters, granularity]);

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
  }, [tenantId, from?.getTime?.(), to?.getTime?.(), granularity]);

  const theme = {
    primary: '#2563EB',
    secondary: '#F59E0B',
    background: '#f9fafb',
    surface: '#ffffff',
    text: '#111827',
    grid: '#E5E7EB',
  };

  return (
    <Card title="Overall Features">
      {state.loading && <LoadingState message="Loading Overall Features..." />}
      {!state.loading && state.error && <ErrorState message={state.error} />}
      {!state.loading && !state.error && (
        <>
          {data.length === 0 ? (
            <div className="overview-empty-state">
              <p>No feature usage found in the selected period.</p>
            </div>
          ) : (
            <div style={{ width: '100%', height: 360, background: theme.surface, borderRadius: 8 }}>
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
