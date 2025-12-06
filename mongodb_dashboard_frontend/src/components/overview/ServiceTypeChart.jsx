import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import Card from '../common/Card';
import LoadingState from '../common/LoadingState';
import ErrorState from '../common/ErrorState';
import { getApiClient } from '../../api/baseClient';

/**
 * PUBLIC_INTERFACE
 * ServiceTypeChart
 * This component renders a "Service Type" chart that aggregates counts of session records by service_type.
 * It queries the backend /api/session-tracking endpoint with tenant_id only (no organization_id, no filter unless specified),
 * and aggregates service_type occurrences from the response items.
 */
function ServiceTypeChart({ tenantId, title = 'Service Type', chartRenderer }) {
  const [state, setState] = useState({ loading: true, error: null, items: [] });

  // Build query string with only tenant_id as requested.
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (tenantId) params.set('tenant_id', String(tenantId));
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }, [tenantId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const url = `/api/session-tracking${queryString}`;
        const res = await getApiClient().get(url);
        const payload = res?.data ?? res;

        // /api/session-tracking may return an array or an envelope { success, data, meta }
        const records = Array.isArray(payload) ? payload : payload?.data || [];

        // Aggregate counts by service_type (e.g., code-generation, code-query)
        const counts = new Map();
        for (const r of records) {
          const key = (r && r.service_type) ? String(r.service_type) : 'unknown';
          counts.set(key, (counts.get(key) || 0) + 1);
        }

        const items = Array.from(counts.entries()).map(([serviceType, count]) => ({ serviceType, count }));

        if (!cancelled) setState({ loading: false, error: null, items });
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err, items: [] });
      }
    }

    load(); // single correct API call on mount/change
    return () => {
      cancelled = true;
    };
  }, [queryString]);

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
  tenantId: PropTypes.string,
  title: PropTypes.string,
  chartRenderer: PropTypes.func,
};

export default ServiceTypeChart;
