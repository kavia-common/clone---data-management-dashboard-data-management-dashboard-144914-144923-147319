import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import Card from '../common/Card';
import LoadingState from '../common/LoadingState';
import ErrorState from '../common/ErrorState';
import { getApiClient } from '../../api/baseClient';
import useOverviewFilters from '../../hooks/useOverviewFilters';
import { startOfUtcDay, endOfUtcDay } from '../../utils/dateUtc';

/**
 * PUBLIC_INTERFACE
 * ServiceTypeChart
 * This component renders a "Service Type" chart that aggregates counts of session records by service_type.
 *
 * Today-only on refresh behavior (per user request):
 * - On initial mount, we request only today's (UTC) sessions from /api/session-tracking to avoid heavy queries.
 * - We include: tenant_id, limit=500, q="", sort="-session_start" (as in server logs), and mode='daily' (or provided).
 * - Date bounds are passed as start/end in UTC: 00:00:00 to 23:59:59 for today, matching backend expectations.
 * - The effect is stabilized to avoid repeated fetches:
 *    * memoized params
 *    * AbortController cancellation on unmount
 *    * guard ref to avoid double state updates in React.StrictMode
 * - Only refetch when relevant filters actually change (tenant/mode or the computed today range).
 */
function ServiceTypeChart({ tenantId, title = 'Service Type', chartRenderer }) {
  const [state, setState] = useState({ loading: true, error: null, items: [] });

  // Pull global overview filters (tenant, mode, etc.). We intentionally scope to "today" on initial load.
  const overviewFilters = useOverviewFilters();

  // Compute today's UTC range; memoized so it remains stable within a render unless the day changes.
  const todayRange = useMemo(() => {
    const now = new Date();
    const start = startOfUtcDay(now).toISOString();
    const end = endOfUtcDay(now).toISOString();
    return { start, end };
  }, []);

  // Build params for the request:
  // tenant_id, limit=500, q="", sort="-session_start", mode (if available), and start/end (UTC today).
  // Only include dependencies that should trigger refetches when they truly change.
  const requestParams = useMemo(() => {
    const resolvedTenant =
      (tenantId && String(tenantId)) ||
      (overviewFilters?.tenantId && String(overviewFilters.tenantId)) ||
      (overviewFilters?.organization_id && String(overviewFilters.organization_id)) ||
      undefined;

    const params = {
      tenant_id: resolvedTenant,
      limit: 500,
      q: '', // explicit empty search for consistency with server logs
      sort: '-session_start',
      start: todayRange.start,
      end: todayRange.end,
    };

    const mode = overviewFilters?.mode || 'daily';
    if (mode) params.mode = mode;

    return params;
  }, [
    tenantId,
    overviewFilters?.tenantId,
    overviewFilters?.organization_id,
    overviewFilters?.mode,
    todayRange.start,
    todayRange.end,
  ]);

  // Guard ref to avoid setting state from stale requests (StrictMode may double-invoke effects)
  const inFlight = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    inFlight.current = controller;

    async function load() {
      // Skip fetch if no tenant scope is resolved yet
      if (!requestParams?.tenant_id) {
        setState((s) => ({ ...s, loading: false }));
        return;
      }

      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        // Base client preserves params and ensures proper scoping
        const res = await getApiClient().get('/api/session-tracking', {
          params: requestParams,
          signal: controller.signal,
        });
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
        if (!cancelled && err?.name !== 'AbortError') {
          setState({ loading: false, error: err, items: [] });
        }
      }
    }

    load();

    return () => {
      cancelled = true;
      if (inFlight.current === controller) {
        controller.abort();
        inFlight.current = null;
      }
    };
    // Only refetch when requestParams changes (which is memoized and stable)
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
