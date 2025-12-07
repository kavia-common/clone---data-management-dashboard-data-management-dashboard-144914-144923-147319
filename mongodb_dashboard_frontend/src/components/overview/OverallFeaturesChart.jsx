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
import { useOverviewFilters } from '../../hooks';
import { fetchSessionTracking } from '../../api/sessionTracking';
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

// PUBLIC_INTERFACE
/**
 * OverallFeaturesChart
 * Reuses Overview filter state (granularity/day|week|month and custom date range) and passes
 * tenant/time filters to /api/session-tracking. Aggregates results by service_type.
 */
export default function OverallFeaturesChart({ tenantId: propTenantId, page = 1, limit = 200 }) {
  const filters = useOverviewFilters() || {};
  // Normalize filter shape used across overview components
  // Accept either { granularity, from, to } or { rangeType, dateStart, dateEnd }
  const granularity =
    (filters.granularity ||
      filters.rangeType ||
      (filters.range && filters.range.granularity) ||
      'day')
      .toString()
      .toLowerCase();

  const dateStart =
    filters.from ||
    filters.dateStart ||
    (filters.range && filters.range.from) ||
    null;

  const dateEnd =
    filters.to ||
    filters.dateEnd ||
    (filters.range && filters.range.to) ||
    null;

  const [data, setData] = useState([]);
  const [state, setState] = useState({ loading: false, error: null });

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function load() {
      setState({ loading: true, error: null });
      try {
        // Prefer prop tenant if provided; otherwise rely on global filters (if any)
        const tenantId = propTenantId || filters.organization_id || filters.tenant_id || filters.tenantId || undefined;

        const params = {
          tenant_id: tenantId,
          organization_id: tenantId,
          page,
          limit,
        };

        // Attach time window based on filters; prefer direct from/to when available
        const fromIso = dateStart ? new Date(dateStart).toISOString() : undefined;
        const toIso = dateEnd ? new Date(dateEnd).toISOString() : undefined;
        if (fromIso) params.from = fromIso;
        if (toIso) params.to = toIso;

        // Some pages may expect granularity param for server hints; include when not custom
        if (granularity && granularity !== 'custom') {
          params.granularity = granularity;
        }

        const { items } = await fetchSessionTracking(params, { signal: controller.signal });

        // Aggregate by service_type
        const counts = new Map();
        for (const doc of items || []) {
          const key = (doc && (doc.service_type ?? doc.serviceType)) || 'Unknown';
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        const shaped = Array.from(counts.entries())
          .map(([service_type, count]) => ({ service_type, count }))
          .sort((a, b) => b.count - a.count);

        if (!cancelled) {
          setData(shaped);
          setState({ loading: false, error: null });
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        if (!cancelled) setState({ loading: false, error: e?.message || 'Failed to load Overall Features' });
      }
    }

    load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [propTenantId, filters.tenant_id, filters.organization_id, filters.tenantId, granularity, dateStart, dateEnd, page, limit]);

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
                  <Bar dataKey="count" name="Count" fill={theme.primary} stroke={theme.primary} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
