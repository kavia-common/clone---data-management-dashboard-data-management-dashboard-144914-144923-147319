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
import apiClient from '../../api/client';
import Card from '../common/Card';
import LoadingState from '../common/LoadingState';
import ErrorState from '../common/ErrorState';
import '../../components/charts/ActiveUsersTrendChart.css';

/**
 * Helpers
 */
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
  // We rely on existing api client base URL and headers (no hard-coded CORS/headers).
  let page = 1;
  const all = [];

  // Construct filter to limit tenant server-side and reduce bandwidth
  const filter = {
    tenant_id: tenantId,
  };
  // We filter by date on client as required, but try to hint server sort by recent first for early exits
  const sort = '-session_start';

  while (page <= maxPages) {
    const params = {
      page,
      limit,
      sort,
      // send JSON filter string; server supports it
      filter: JSON.stringify(filter),
    };

    const res = await apiClient.get('/api/session-tracking', { params, signal });
    const payload = res.data;

    let items;
    let meta;

    if (Array.isArray(payload)) {
      items = payload;
      meta = { page, limit, total: payload.length };
    } else if (payload && payload.data) {
      items = payload.data;
      meta = payload.meta || {};
    } else {
      items = [];
      meta = { page, limit, total: 0 };
    }

    all.push(...items);

    // Stop if fewer than limit records returned (no more pages)
    if (!items || items.length < limit) break;

    // If we suspect we've covered the date range due to sorting by newest first and
    // current page last item's date is older than 'from', we can stop.
    const last = items[items.length - 1];
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
  /** This is a public component that renders an 'Overall Features' bar chart using Recharts. It fetches paginated session tracking data scoped to the current tenant and filtered by the Overview page's date controls, aggregates counts by service_type, and displays the result. */

  const { range, granularity } = useOverviewFilters(); // reuse existing filters
  const tenantId = getTenantId(); // same source as existing charts

  const [data, setData] = useState([]);
  const [state, setState] = useState({ loading: false, error: null });

  const { from, to } = useMemo(() => {
    // range is expected to contain from/to as Date or ISO string depending on existing implementation
    const fromDate = range?.from ? parseDateSafe(range.from) : null;
    const toDate = range?.to ? parseDateSafe(range.to) : null;
    return { from: fromDate, to: toDate };
  }, [range]);

  useEffect(() => {
    if (!tenantId) return;
    let abort = new AbortController();
    setState({ loading: true, error: null });

    fetchSessionTrackingPaged({
      tenantId,
      from,
      to,
      limit: 200,
      maxPages: 50,
      signal: abort.signal,
    })
      .then((docs) => {
        const shaped = shapeBarDataByServiceType(docs);
        setData(shaped);
        setState({ loading: false, error: null });
      })
      .catch((err) => {
        if (abort.signal.aborted) return;
        setState({
          loading: false,
          error: err?.message || 'Failed to load Overall Features',
        });
      });

    return () => {
      abort.abort();
    };
  }, [tenantId, from, to, granularity]);

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
      {!state.loading && state.error && (
        <ErrorState message={state.error} />
      )}
      {!state.loading && !state.error && (
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
    </Card>
  );
}
