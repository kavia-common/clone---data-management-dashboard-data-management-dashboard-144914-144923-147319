import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import Card from '../common/Card';
import LoadingState from '../common/LoadingState';
import ErrorState from '../common/ErrorState';
import { getApiClient } from '../../api/baseClient';
import { buildOverviewQueryParams } from '../../api/buildOverviewFilterParams';
import useOverviewFilters from '../../hooks/useOverviewFilters';

/**
 * PUBLIC_INTERFACE
 * ServiceTypeChart
 * This component renders a "Service Type" chart that aggregates counts of session records by service_type.
 * It queries the backend /api/session-tracking endpoint using the same filter model as the Users chart,
 * including: tenant_id, limit=500, optional mode, and created_at date window via filter {$gte,$lte}.
 * It refetches when overview filters change.
 */
function ServiceTypeChart({ tenantId, title = 'Service Type', chartRenderer }) {
  const [state, setState] = useState({ loading: true, error: null, items: [] });

  // Pull global overview filters (date window, mode, tenant, etc.)
  const overviewFilters = useOverviewFilters();

  // Build request params aligned with Overview: include tenant_id, limit=500, mode (if present),
  // and pass created_at date constraints through the filter JSON using $gte/$lte based on from/to.
  const requestParams = useMemo(() => {
    // Base params from overview query helper (keeps from/to, granularity, etc.)
    const base = buildOverviewQueryParams(
      {
        tenantId: tenantId || overviewFilters?.tenantId || overviewFilters?.organization_id,
        organization_id: overviewFilters?.organization_id, // preserved by helper as organization_id
        from: overviewFilters?.from,
        to: overviewFilters?.to,
        granularity: overviewFilters?.granularity,
        // Allow passing through any extra filter fields if the context provided them
        extra: overviewFilters?.extra || {},
      },
      { useStartEnd: false } // use from/to naming (not start/end)
    );

    // Ensure limit=500 and tenant_id for /api/session-tracking; use mode when present.
    const params = {
      ...base,
      limit: 500,
    };

    // The /api/baseClient ensures tenant scoping via tenant_id. Provide explicitly to be clear.
    if (tenantId) params.tenant_id = String(tenantId);
    else if (overviewFilters?.tenantId) params.tenant_id = String(overviewFilters.tenantId);
    else if (overviewFilters?.organization_id) params.tenant_id = String(overviewFilters.organization_id);

    if (overviewFilters?.mode) params.mode = overviewFilters.mode;

    // Build created_at window filter: { created_at: { $gte: fromISO, $lte: toISO } }
    const f = {};
    if (overviewFilters?.from || overviewFilters?.to) {
      const createdRange = {};
      if (overviewFilters?.from) createdRange.$gte = overviewFilters.from;
      if (overviewFilters?.to) createdRange.$lte = overviewFilters.to;
      f.created_at = createdRange;
    }

    // If there was already a filter supplied via base.filter (JSON-string from helper), merge them.
    // base.filter, if present, is already JSON-stringified; parse, merge, then re-stringify.
    if (base.filter) {
      try {
        const existing = JSON.parse(base.filter);
        const merged = { ...(existing || {}) };
        if (f.created_at) {
          merged.created_at = {
            ...(existing?.created_at || {}),
            ...f.created_at,
          };
        }
        params.filter = JSON.stringify(merged);
      } catch {
        // If parse fails, just set our created_at filter
        if (f.created_at) params.filter = JSON.stringify({ created_at: f.created_at });
      }
    } else if (f.created_at) {
      params.filter = JSON.stringify({ created_at: f.created_at });
    }

    return params;
  }, [tenantId, overviewFilters]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        // Same-origin path; baseClient will handle scoping and single-encoding
        const res = await getApiClient().get('/api/session-tracking', { params: requestParams, signal: controller.signal });
        const payload = res?.data ?? res;

        // /api/session-tracking may return an array or an envelope { success, data, meta }
        const records = Array.isArray(payload) ? payload : payload?.data || [];

        // Aggregate counts by service_type
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

    load(); // fetch on mount and whenever filters change
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [requestParams]);

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
