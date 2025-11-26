import React, { useEffect, useMemo, useState } from 'react';
import Card from '../../components/ui/Card.jsx';
import LoadingState from '../../components/common/LoadingState';
import ErrorState from '../../components/common/ErrorState';
import OverviewChartFilters from '../../components/overview/OverviewChartFilters';
import { getOverviewTotals, getCostsOverTime, getActiveUsersTrend, getNewUsersOverTime } from '../../api/overviewAnalytics';
import { useAuth } from '../../context/AuthContext';

/**
 * PUBLIC_INTERFACE
 * OverviewWrapper
 * Minimal overview page rendering totals and three charts with independent filters.
 * Adds day/week/month/custom granularity + custom date range per chart.
 */
export default function OverviewWrapper() {
  const { organizationId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [totals, setTotals] = useState(null);

  // Independent filters (per chart). Each preserves own state and uses organization scope.
  const baseTenant = organizationId ? { organization_id: organizationId } : {};
  const [costFilters, setCostFilters] = useState({ ...baseTenant, granularity: 'day' });
  const [activeUsersFilters, setActiveUsersFilters] = useState({ ...baseTenant, granularity: 'day' });
  const [newUsersFilters, setNewUsersFilters] = useState({ ...baseTenant, granularity: 'day' });

  const [costSeries, setCostSeries] = useState({ labels: [], datasets: [] });
  const [activeUsersSeries, setActiveUsersSeries] = useState({ items: [], meta: {} });
  const [newUsersSeries, setNewUsersSeries] = useState({ items: [], meta: {} });

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
    setActiveUsersFilters((f) => ({ ...f, organization_id: organizationId }));
    setNewUsersFilters((f) => ({ ...f, organization_id: organizationId }));
  }, [organizationId]);

  // Costs
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await getCostsOverTime(costFilters);
        if (!active) return;
        // Ensure safe structure even when empty
        const labels = Array.isArray(res?.labels) ? res.labels : [];
        const datasets = Array.isArray(res?.datasets) ? res.datasets : [];
        const first = datasets[0] || { data: [] };
        const data = Array.isArray(first.data) ? first.data : [];
        const L = Math.min(labels.length, data.length);
        const safe = {
          labels: labels.slice(0, L),
          datasets: [{ label: first.label || 'Total Cost', data: data.slice(0, L) }],
          meta: res?.meta || {},
        };
        setCostSeries(safe);
      } catch (e) {
        if (!active) return;
        setCostSeries({ labels: [], datasets: [{ label: 'Total Cost', data: [] }] });
      }
    })();
    return () => { active = false; };
  }, [costFilters]);

  // Active Users
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // Map 'month' to 'week' for endpoints that don't support month
        const gran = activeUsersFilters.granularity === 'month' ? 'week' : activeUsersFilters.granularity;
        const res = await getActiveUsersTrend({ ...activeUsersFilters, granularity: gran });
        if (!active) return;
        setActiveUsersSeries({
          items: Array.isArray(res?.items) ? res.items : [],
          meta: res?.meta || {},
        });
      } catch (e) {
        if (!active) return;
        setActiveUsersSeries({ items: [], meta: {} });
      }
    })();
    return () => { active = false; };
  }, [activeUsersFilters]);

  // New Users
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // Endpoint expects start/end; helper handles mapping
        const gran = newUsersFilters.granularity === 'month' ? 'month' : (newUsersFilters.granularity || 'day');
        const res = await getNewUsersOverTime({ ...newUsersFilters, granularity: gran, start: newUsersFilters.from, end: newUsersFilters.to });
        if (!active) return;
        setNewUsersSeries({
          items: Array.isArray(res?.items) ? res.items : [],
          meta: res?.meta || {},
        });
      } catch (e) {
        if (!active) return;
        setNewUsersSeries({ items: [], meta: {} });
      }
    })();
    return () => { active = false; };
  }, [newUsersFilters]);

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

        <Card
          title="Active Users Trend"
          actions={
            <OverviewChartFilters
              value={activeUsersFilters}
              onChange={setActiveUsersFilters}
              tenants={tenantsList}
              showGranularity={true}
            />
          }
        >
          <pre>{JSON.stringify(activeUsersSeries, null, 2)}</pre>
        </Card>

        <Card
          title="New Users Over Time"
          actions={
            <OverviewChartFilters
              value={newUsersFilters}
              onChange={(next) => {
                // For this endpoint, we support month/week/day; custom handled via from/to
                setNewUsersFilters(next);
              }}
              tenants={tenantsList}
              showGranularity={true}
            />
          }
        >
          <pre>{JSON.stringify(newUsersSeries, null, 2)}</pre>
        </Card>
      </div>
    </div>
  );
}
