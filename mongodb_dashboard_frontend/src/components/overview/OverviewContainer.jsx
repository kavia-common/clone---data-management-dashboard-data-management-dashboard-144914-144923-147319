import React, { useEffect, useMemo, useState } from 'react';
import OverviewTimeControls from './OverviewTimeControls';
import OverviewKpiCards from './OverviewKpiCards';
import OverviewTrendChart from './OverviewTrendChart';
import { fetchOverviewAnalytics } from '../../api/overviewAnalytics';
import LoadingState from '../common/LoadingState';
import ErrorState from '../common/ErrorState';
import './overview.css';
import UsersByTenantChart from './UsersByTenantChart';

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
          {chartData?.length === 0 && (
            <div style={{ color: '#6B7280', fontSize: 14, textAlign: 'center' }}>
              No data available for the selected range.
            </div>
          )}
        </>
      )}

      {/* UsersByTenantChart must always render under cards/trend regardless of container loading/error */}
      <div className="overview-section">
        <UsersByTenantChart />
      </div>
    </div>
  );
}
