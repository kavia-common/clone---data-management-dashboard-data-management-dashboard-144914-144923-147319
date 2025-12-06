import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import Card from '../common/Card';
import LoadingState from '../common/LoadingState';
import ErrorState from '../common/ErrorState';
import { buildOverviewQueryParams } from '../../api/buildOverviewFilterParams';
import { getApiClient } from '../../api/baseClient';

/**
 * PUBLIC_INTERFACE
 * ServiceTypeChart
 * This component renders a "Service Type" chart that aggregates counts of session records by service_type.
 * It queries the backend /api/session-tracking endpoint using the same filter/query parameters used by the Overview charts,
 * including the active tenant (organization_id) and date range filters if available.
 */
function ServiceTypeChart({ organizationId, filters, title = 'Service Type', chartRenderer }) {
  const [state, setState] = useState({ loading: true, error: null, items: [] });

  // Build query params consistent with Overview filters and existing charts.
  // Important conventions:
  // - Use relative path (/api/session-tracking), not absolute origins.
  // - Single-encode the filter param (no %25 double-encoding).
  // - Include overview-level fields (organization_id, from/to, granularity).
  const queryParams = useMemo(() => {
    const params = new URLSearchParams();

    const built = buildOverviewQueryParams(
      {
        ...(filters || {}),
        organization_id: organizationId || (filters && filters.organization_id),
      },
      { useStartEnd: false }
    );

    // Append params as-is; do not re-encode.
    Object.entries(built || {}).forEach(([k, v]) => {
      if (v == null || v === '') return;
      params.set(k, String(v));
    });

    return params;
  }, [organizationId, filters]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const qs = queryParams.toString();
        const url = `/api/session-tracking${qs ? `?${qs}` : ''}`; // same-origin relative path
        const res = await getApiClient().get(url);

        const payload = res?.data ?? res;

        // Session-tracking may return an array directly or { success, data, meta }
        const records = Array.isArray(payload) ? payload : (payload && payload.data) || [];

        // Aggregate counts by service_type
        const counts = new Map();
        for (const r of records) {
          const key = (r?.service_type || 'unknown').toString();
          counts.set(key, (counts.get(key) || 0) + 1);
        }

        const items = Array.from(counts.entries()).map(([serviceType, count]) => ({ serviceType, count }));

        if (!cancelled) {
          setState({ loading: false, error: null, items });
        }
      } catch (err) {
        if (!cancelled) {
          setState({ loading: false, error: err, items: [] });
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [queryParams]);

  const { loading, error, items } = state;

  // Default renderer: accessible proportional bar list
  const defaultRenderer = () => {
    if (loading) return <LoadingState label="Loading service types..." />;
    if (error) return <ErrorState message="Failed to load service types" details={error?.message} />;
    if (!items || items.length === 0) {
      return (
        <div style={{ padding: '1rem', color: 'var(--text-muted, #6B7280)' }}>
          No service activity found for the selected filters.
        </div>
      );
    }

    // Compute max for proportional bars
    const max = Math.max(...items.map((i) => i.count));

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ fontSize: 12, color: '#6B7280' }}>Legend: Service Type • Count</div>
        <div role="list" aria-label="Service types by count" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items
            .sort((a, b) => b.count - a.count)
            .map((i) => {
              const pct = max > 0 ? Math.max(2, Math.round((i.count / max) * 100)) : 0;
              return (
                <div key={i.serviceType} role="listitem" aria-label={`${i.serviceType} ${i.count}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600, color: '#111827' }}>{i.serviceType}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: '#374151' }}>{i.count}</span>
                  </div>
                  <div
                    title={`${i.serviceType}: ${i.count}`}
                    style={{
                      height: 10,
                      width: '100%',
                      background: '#E5E7EB',
                      borderRadius: 9999,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: '100%',
                        background: 'linear-gradient(90deg, rgba(37,99,235,0.9), rgba(59,130,246,0.7))',
                      }}
                    />
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    );
  };

  return (
    <Card title={title}>
      <div style={{ width: '100%', minHeight: 220 }}>{chartRenderer ? chartRenderer({ loading, error, items }) : defaultRenderer()}</div>
    </Card>
  );
}

ServiceTypeChart.propTypes = {
  organizationId: PropTypes.string,
  filters: PropTypes.object,
  title: PropTypes.string,
  chartRenderer: PropTypes.func,
};

export default ServiceTypeChart;
