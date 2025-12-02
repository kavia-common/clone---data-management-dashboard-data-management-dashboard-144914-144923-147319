import React, { useEffect, useMemo, useState } from 'react';
import Card from '../../components/common/Card.jsx';
import LoadingState from '../../components/common/LoadingState';
import ErrorState from '../../components/common/ErrorState';
import OverviewChartFilters from '../../components/overview/OverviewChartFilters';
import { getOverviewTotals } from '../../api/overviewAnalytics';
import { getLlmCostsOverTime } from '../../api/llmCostsAnalytics';
import { useAuth } from '../../context/AuthContext';

/**
 * PUBLIC_INTERFACE
 * OverviewWrapper
 * Simplified overview wrapper showing totals and LLM costs only.
 */
export default function OverviewWrapper() {
  const { organizationId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [totals, setTotals] = useState(null);

  const baseTenant = organizationId ? { organization_id: organizationId } : {};
  const [costFilters, setCostFilters] = useState({ ...baseTenant, granularity: 'day' });
  const [costSeries, setCostSeries] = useState({ labels: [], datasets: [] });

  const tenantsList = useMemo(() => {
    if (!organizationId) return [];
    return [{ id: organizationId, name: organizationId }];
  }, [organizationId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const totalsRes = await getOverviewTotals();
        if (!mounted) return;
        setTotals(totalsRes);
        setError(null);
      } catch (e) {
        if (!mounted) return;
        setError(e);
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Keep organization scope in filters when auth changes
  useEffect(() => {
    if (!organizationId) return;
    setCostFilters((f) => ({ ...f, organization_id: organizationId }));
  }, [organizationId]);

  // Costs
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await getLlmCostsOverTime({
          granularity: costFilters?.granularity || 'day',
          from: costFilters?.from,
          to: costFilters?.to,
        });
        if (!active) return;
        const labels = Array.isArray(res?.labels) ? res.labels : [];
        const datasets = Array.isArray(res?.datasets) ? res.datasets : [{ label: 'Total Cost', data: [] }];
        const first = datasets[0] || { data: [] };

        const num = (v) => {
          if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
          if (typeof v === 'string') {
            const n = Number(v.replace(/[$,]/g, ''));
            return Number.isFinite(n) ? n : 0;
          }
          const n = Number(v);
          return Number.isFinite(n) ? n : 0;
        };

        const data = Array.isArray(first.data) ? first.data.map(num) : [];
        const L = Math.min(labels.length, data.length);
        setCostSeries({
          labels: labels.slice(0, L),
          datasets: [{ label: first.label || 'Total Cost', data: data.slice(0, L) }],
          meta: res?.meta || {},
        });
      } catch (e) {
        if (!active) return;
        setCostSeries({ labels: [], datasets: [{ label: 'Total Cost', data: [] }] });
      }
    })();
    return () => { active = false; };
  }, [costFilters]);

  if (loading) return <LoadingState message="Loading overview..." />;
  if (error) return <ErrorState error={error} />;

  return (
    <div className="page-container">
      <div className="grid grid-2">
        <Card title="Totals">
          <pre>{JSON.stringify(totals, null, 2)}</pre>
        </Card>

        <Card
          title="LLM Costs Over Time"
          actions={
            <OverviewChartFilters
              value={costFilters}
              onChange={setCostFilters}
              tenants={tenantsList}
              showGranularity={true}
            />
          }
        >
          <pre>{JSON.stringify(costSeries, null, 2)}</pre>
        </Card>
      </div>
    </div>
  );
}
