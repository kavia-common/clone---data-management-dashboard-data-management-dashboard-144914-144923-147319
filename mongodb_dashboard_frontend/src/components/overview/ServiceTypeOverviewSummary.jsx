import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import Card from '../common/Card.jsx';
import LoadingState from '../common/LoadingState.jsx';
import ErrorState from '../common/ErrorState.jsx';
import { getSessionTracking } from '../../api/sessionTracking';

/**
 * PUBLIC_INTERFACE
 * ServiceTypeOverviewSummary
 * Fetches a small sample of session-tracking records and aggregates counts by service_type.
 * - Keeps the API call unchanged (client-side processing only).
 * - Generic: any string value for service_type is counted and shown.
 * - If tenantId is not provided, defaults to 'b2c' per task requirement.
 */
function ServiceTypeOverviewSummary({ tenantId = 'b2c', limit = 5, title = 'Service Types (sample)' }) {
  const [state, setState] = useState({ loading: true, error: null, items: [] });

  // Build stable query per requirements: keep API call simple and unchanged
  const query = useMemo(() => {
    return {
      tenant_id: tenantId,
      limit,
      // We keep other params untouched; only use simple pagination limit as requested.
      // The API will return an array or an envelope { success, data, meta }.
    };
  }, [tenantId, limit]);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      try {
        const payload = await getSessionTracking(query);
        const records = Array.isArray(payload) ? payload : payload?.data || [];

        // Aggregate counts by service_type (generic handling)
        const counts = new Map();
        for (const r of records) {
          const key = r && r.service_type ? String(r.service_type) : 'unknown';
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        const items = Array.from(counts.entries())
          .map(([serviceType, count]) => ({ serviceType, count }))
          .sort((a, b) => b.count - a.count);

        if (!cancelled) setState({ loading: false, error: null, items });
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e, items: [] });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [query]);

  const { loading, error, items } = state;

  return (
    <Card title={title}>
      <div style={{ minHeight: 140 }}>
        {loading && <LoadingState message="Loading service types..." />}
        {!loading && error && (
          <ErrorState
            title="Unable to load service types"
            description={error?.message || 'Please try again later.'}
          />
        )}
        {!loading && !error && (
          <>
            {items.length === 0 ? (
              <div style={{ padding: '0.5rem', color: '#6B7280' }}>
                No items in the sample window.
              </div>
            ) : (
              <div role="list" aria-label="Service type sample counts" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.map((it) => (
                  <div key={it.serviceType} role="listitem" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ fontWeight: 600, color: '#111827' }}>{it.serviceType}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: '#374151' }}>{it.count}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

ServiceTypeOverviewSummary.propTypes = {
  tenantId: PropTypes.string,
  limit: PropTypes.number,
  title: PropTypes.string,
};

export default ServiceTypeOverviewSummary;
