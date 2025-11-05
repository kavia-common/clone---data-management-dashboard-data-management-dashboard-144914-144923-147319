import React, { useEffect, useMemo, useState } from 'react';
import OverviewTimeControls from './OverviewTimeControls';
import OverviewKpiCards from './OverviewKpiCards';
import OverviewTrendChart from './OverviewTrendChart';
import { getOverviewAnalytics } from '../../api/analyticsOverview';
import LoadingState from '../common/LoadingState';
import ErrorState from '../common/ErrorState';
import './overview.css';

// PUBLIC_INTERFACE
export default function OverviewContainer() {
  /** Container for time-based analytics on Overview tab */
  const [range, setRange] = useState('30d');
  const [metric, setMetric] = useState('creates');
  const [showMA, setShowMA] = useState(true);
  const [loading, setLoading] = useState(false);
  const [kpis, setKpis] = useState(null);
  const [buckets, setBuckets] = useState([]);
  const [error, setError] = useState(null);

  // Determine bucket based on selected range for MA defaults and backend aggregation hints (if needed later)
  const bucket = useMemo(() => {
    if (range === '12w') return 'week';
    if (range === '12m') return 'month';
    return 'day';
  }, [range]);

  const chartData = useMemo(() => {
    return (buckets || []).map((b) => ({ label: b.label, value: b.value }));
  }, [buckets]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await getOverviewAnalytics({ metric, range });
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
      <OverviewTimeControls
        range={range}
        setRange={setRange}
        metric={metric}
        setMetric={setMetric}
        showMetricSelector
        showMA={showMA}
        setShowMA={setShowMA}
      />
      {loading && !kpis && <LoadingState message="Loading overview analytics..." />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (
        <>
          <OverviewKpiCards kpis={kpis} loading={loading} />
          <OverviewTrendChart data={chartData} metric={metric} showMovingAverage={showMA} bucket={bucket} />
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
