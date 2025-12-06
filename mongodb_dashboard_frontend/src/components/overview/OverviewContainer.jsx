import React, { useEffect, useMemo, useState } from 'react';
import OverviewTimeControls from './OverviewTimeControls';
import OverviewKpiCards from './OverviewKpiCards';
import OverviewTrendChart from './OverviewTrendChart';
import { fetchOverviewAnalytics } from '../../api/overviewAnalytics';
import LoadingState from '../common/LoadingState';
import ErrorState from '../common/ErrorState';
import './overview.css';
// Use the robust, API-aggregated chart from charts/
import UsersByTenantChart from '../charts/UsersByTenantChart.jsx';
import Card from '../ui/Card.jsx';

// PUBLIC_INTERFACE
export default function OverviewContainer() {
  /** Container for time-based analytics on Overview tab */
  const [range, setRange] = useState('30d');
  const [metric, setMetric] = useState('creates');
  const [loading, setLoading] = useState(false);
  const [kpis, setKpis] = useState(null);
  const [buckets, setBuckets] = useState([]);
  const [error, setError] = useState(null);

  const chartData = useMemo(() => {
    return (buckets || []).map((b) => ({ label: b.label, value: b.value }));
  }, [buckets]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchOverviewAnalytics({ metric, range });
        if (!ignore) {
          setBuckets(res?.buckets || []);
          setKpis(res?.kpis || {});
        }
      } catch (e) {
        if (!ignore) setError(e?.message || 'Failed to fetch analytics');
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [metric, range]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <OverviewTimeControls range={range} setRange={setRange} metric={metric} setMetric={setMetric} showMetricSelector />
      {loading && !kpis && <LoadingState message="Loading overview analytics..." />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (
        <>
          <OverviewKpiCards kpis={kpis} loading={loading} />
          <OverviewTrendChart data={chartData} metric={metric} />
          <Card title="Users by Tenant" subtitle="Distinct active users per tenant (server aggregated)">
            <div style={{ width: '100%' }}>
              <UsersByTenantChart maxBars={12} />
            </div>
          </Card>
          {chartData?.length === 0 && (
            <div style={{ color: '#6B7280', fontSize: 14, textAlign: 'center' }}>
              No data available for the selected range.
            </div>
          )}
        </>
      )}
    </div>
  );
}
