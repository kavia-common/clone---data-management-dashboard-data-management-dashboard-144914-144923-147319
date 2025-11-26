import React, { useEffect, useMemo, useState } from 'react';
import Card from '../../components/common/Card';
import LoadingState from '../../components/common/LoadingState';
import ErrorState from '../../components/common/ErrorState';
import OverviewChartFilters from '../../components/overview/OverviewChartFilters';
import { getOverviewTotals, getCostsOverTime, getActiveUsersTrend, getNewUsersOverTime } from '../../api/overviewAnalytics';
import { useAuth } from '../../context/AuthContext';

/**
 * PUBLIC_INTERFACE
 * OverviewWrapper
 * Minimal overview page rendering totals and three charts with independent filters.
 * This does not change existing chart components; it renders JSON to keep logic intact.
 */
export default function OverviewWrapper() {
  const { organizationId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [totals, setTotals] = useState(null);

  // Independent filters
  const [costFilters, setCostFilters] = useState({ granularity: 'day' });
  const [activeUsersFilters, setActiveUsersFilters] = useState({ granularity: 'day' });
  const [newUsersFilters, setNewUsersFilters] = useState({ granularity: 'day' });

  const [costSeries, setCostSeries] = useState(null);
  const [activeUsersSeries, setActiveUsersSeries] = useState(null);
  const [newUsersSeries, setNewUsersSeries] = useState(null);

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

  // Costs
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await getCostsOverTime(costFilters);
        if (!active) return;
        setCostSeries(res);
      } catch (e) {
        if (!active) return;
      }
    })();
    return () => { active = false; };
  }, [costFilters]);

  // Active Users
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await getActiveUsersTrend(activeUsersFilters);
        if (!active) return;
        setActiveUsersSeries(res);
      } catch (e) {
        if (!active) return;
      }
    })();
    return () => { active = false; };
  }, [activeUsersFilters]);

  // New Users
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await getNewUsersOverTime(newUsersFilters);
        if (!active) return;
        setNewUsersSeries(res);
      } catch (e) {
        if (!active) return;
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

        <Card title="LLM Costs Over Time">
          <OverviewChartFilters
            value={costFilters}
            onChange={setCostFilters}
            tenants={tenantsList}
            showGranularity={true}
          />
          <pre>{JSON.stringify(costSeries, null, 2)}</pre>
        </Card>

        <Card title="Active Users Trend">
          <OverviewChartFilters
            value={activeUsersFilters}
            onChange={setActiveUsersFilters}
            tenants={tenantsList}
            showGranularity={true}
          />
          <pre>{JSON.stringify(activeUsersSeries, null, 2)}</pre>
        </Card>

        <Card title="New Users Over Time">
          <OverviewChartFilters
            value={newUsersFilters}
            onChange={setNewUsersFilters}
            tenants={tenantsList}
            showGranularity={true}
          />
          <pre>{JSON.stringify(newUsersSeries, null, 2)}</pre>
        </Card>
      </div>
    </div>
  );
}
