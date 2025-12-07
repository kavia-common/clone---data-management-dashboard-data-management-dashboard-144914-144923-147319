import React, { useEffect, useState } from 'react';
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

// PUBLIC_INTERFACE
/**
 * OverallFeaturesChart
 * Reuses Overview filter state (granularity/day|week|month and custom date range) and passes
 * tenant/time filters to /api/session-tracking. Aggregates results by service_type.
 */
export default function OverallFeaturesChart({ tenantId: propTenantId, page = 1, limit = 200 }) {
  const filters = useOverviewFilters() || {};

  // Normalize filters received from Overview components
  const granularity = String(
    (filters.granularity || filters.rangeType || filters?.range?.granularity || 'day') ?? 'day'
  ).toLowerCase();

  const dateStart = filters.from || filters.dateStart || filters?.range?.from || null;
  const dateEnd = filters.to || filters.dateEnd || filters?.range?.to || null;

  const [data, setData] = useState([]);
  const [state, setState] = useState({ loading: false, error: null });

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function load() {
      setState({ loading: true, error: null });
      try {
        // Prefer prop tenant if provided; fallback to filter context aliases
        const tenantId =
          propTenantId ||
          filters.organization_id ||
          filters.tenant_id ||
          filters.tenantId ||
          filters.organizationId ||
          undefined;

        const params = {
          // Include both aliases for backend compatibility
          tenant_id: tenantId,
          organization_id: tenantId,
          // Pagination (optional): when page exists, backend returns envelope
          page,
          limit,
        };

        // Time window
        if (dateStart) params.from = new Date(dateStart).toISOString();
        if (dateEnd) params.to = new Date(dateEnd).toISOString();

        // Some endpoints support granularity hints; include if not custom
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
        if (!cancelled) {
          const msg =
            e?.message ||
            (typeof e === 'string' ? e : 'Failed to load Overall Features');
          setState({ loading: false, error: msg });
          if (process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console
            console.warn('[OverallFeaturesChart] load failed:', e);
          }
        }
      }
    }

    load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    propTenantId,
    filters.tenant_id,
    filters.organization_id,
    filters.tenantId,
    filters.organizationId,
    granularity,
    dateStart,
    dateEnd,
    page,
    limit,
  ]);

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
