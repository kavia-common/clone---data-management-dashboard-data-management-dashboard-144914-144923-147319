import React, { useEffect, useMemo, useState } from 'react';
import OverviewTimeControls from './OverviewTimeControls';
import OverviewKpiCards from './OverviewKpiCards';
import OverviewTrendChart from './OverviewTrendChart';
import { fetchOverviewAnalytics } from '../../api/overviewAnalytics';
import LoadingState from '../common/LoadingState';
import ErrorState from '../common/ErrorState';
import './overview.css';

// PUBLIC_INTERFACE
export default function OverviewContainer() {
  /** Container for time-based analytics on Overview tab */
  const [range, setRange] = useState('7d'); // default to daily preset
  const [metric, setMetric] = useState('creates');
  const [loading, setLoading] = useState(false);
  const [kpis, setKpis] = useState(null);
  const [buckets, setBuckets] = useState([]);
  const [error, setError] = useState(null);

  const chartData = useMemo(() => {
    return (buckets || []).map((b) => ({ label: b.label, value: b.value }));
  }, [buckets]);

  // Allow optional custom date range state for overview charts
  const [customRange, setCustomRange] = useState({ start: null, end: null });

  useEffect(() => {
    let ignore = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchOverviewAnalytics({
          metric,
          range,
          from: range === 'custom' ? customRange.start : undefined,
          to: range === 'custom' ? customRange.end : undefined,
        });
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
  }, [metric, range, customRange.start, customRange.end]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <OverviewTimeControls range={range} setRange={setRange} metric={metric} setMetric={setMetric} showMetricSelector />
      {range === 'custom' && (
        <div style={{ marginTop: 8, background: '#fff', padding: 12, borderRadius: 12, border: '1px solid #E5E7EB' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, color: '#6B7280' }}>
              Start:
              <input
                type="datetime-local"
                onChange={(e) => setCustomRange((r) => ({ ...r, start: e.target.value ? new Date(e.target.value).toISOString() : null }))}
                style={{ marginLeft: 6 }}
                aria-label="Overview custom range start date time"
              />
            </label>
            <label style={{ fontSize: 12, color: '#6B7280' }}>
              End:
              <input
                type="datetime-local"
                onChange={(e) => setCustomRange((r) => ({ ...r, end: e.target.value ? new Date(e.target.value).toISOString() : null }))}
                style={{ marginLeft: 6 }}
                aria-label="Overview custom range end date time"
              />
            </label>
          </div>
        </div>
      )}
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
    </div>
  );
}
