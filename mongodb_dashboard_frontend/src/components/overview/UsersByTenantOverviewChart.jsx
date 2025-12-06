import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { useAuth } from '../../context/AuthContext';
import OverviewChartFilters from './OverviewChartFilters';
import LoadingState from '../common/LoadingState';
import ErrorState from '../common/ErrorState';
import OverviewEmptyState from './OverviewEmptyState';
import UsersByTenantChart from '../charts/UsersByTenantChart';
import './overview.css';
import { listUsersServerFiltered } from '../../services/usersService';

/**
 * PUBLIC_INTERFACE
 * UsersByTenantOverviewChart
 * Overview widget that requests users from /api/users with server-side filtering (organization_id + date range),
 * aggregates per-tenant counts from filtered results, and re-fetches when filters change.
 */
function UsersByTenantOverviewChart({ className }) {
  const { organizationId: ctxOrg } = useAuth() || {};
  const [filter, setFilter] = useState({ bucket: 'daily', from: null, to: null }); // bucket: daily|weekly|monthly|custom
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [users, setUsers] = useState([]);

  // Compute ISO window from selected bucket
  const window = useMemo(() => {
    const now = new Date();
    let from = null;
    let to = now;
    if (filter.bucket === 'daily') {
      from = new Date(now);
      from.setDate(from.getDate() - 1);
    } else if (filter.bucket === 'weekly') {
      from = new Date(now);
      from.setDate(from.getDate() - 7);
    } else if (filter.bucket === 'monthly') {
      from = new Date(now);
      from.setMonth(from.getMonth() - 1);
    } else if (filter.bucket === 'custom') {
      if (filter.from) from = new Date(filter.from);
      if (filter.to) to = new Date(filter.to);
    } else {
      from = new Date(now);
      from.setDate(from.getDate() - 1);
    }
    return {
      from: from ? from.toISOString() : null,
      to: to ? to.toISOString() : null,
    };
  }, [filter]);

  // Fetch users from backend with server-side filters
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!ctxOrg) {
        setUsers([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await listUsersServerFiltered({
          organization_id: ctxOrg,
          from: window.from,
          to: window.to,
          limit: 500, // adequate for chart aggregation
        });
        if (!cancelled) {
          setUsers(res || []);
        }
      } catch (e) {
        if (!cancelled) setError(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [ctxOrg, window.from, window.to]);

  // Aggregate counts per tenant from filtered users
  const byTenant = useMemo(() => {
    const map = new Map();
    for (const u of users) {
      const tenantId = u.tenant_id || u.organization_id || 'unknown';
      const tenantName = u.tenant_name || u.organization_name || tenantId;
      const key = tenantId || 'unknown';
      const prev = map.get(key) || { tenant_id: tenantId, tenant_name: tenantName, count: 0 };
      prev.count += 1;
      map.set(key, prev);
    }
    const entries = Array.from(map.values());
    entries.sort((a, b) => b.count - a.count);
    return entries;
  }, [users]);

  // Handle filter changes from OverviewChartFilters
  const onFilterChange = (next) => {
    const g = (next?.granularity || '').toLowerCase();
    const bucket =
      g && ['day', 'week', 'month', 'custom'].includes(g)
        ? g === 'day'
          ? 'daily'
          : g === 'week'
          ? 'weekly'
          : g === 'month'
          ? 'monthly'
          : 'custom'
        : filter.bucket || 'daily';

    setFilter({
      bucket,
      from: next?.from || null,
      to: next?.to || null,
    });
  };

  // Compose value for the filters component
  const filtersValue = useMemo(() => {
    const toGranularity = (b) =>
      b === 'daily' ? 'day' : b === 'weekly' ? 'week' : b === 'monthly' ? 'month' : 'custom';
    return {
      granularity: toGranularity(filter.bucket),
      from: filter.from || window.from,
      to: filter.to || window.to,
    };
  }, [filter, window]);

  return (
    <div className={`overview-section users-by-tenant ${className || ''}`}>
      <div className="overview-section-header">
        <h3 className="overview-section-title">Total Users by Tenant</h3>
        <OverviewChartFilters value={filtersValue} onChange={onFilterChange} showGranularity />
      </div>

      {loading && <LoadingState message="Loading users by tenant..." />}
      {!loading && error && (
        <ErrorState
          title="Unable to load users"
          description={error?.message || 'Please try again later.'}
        />
      )}
      {!loading && !error && byTenant.length === 0 && (
        <OverviewEmptyState title="No users found in the selected period." />
      )}
      {!loading && !error && byTenant.length > 0 && (
        <div className="overview-chart-container">
          <UsersByTenantChart
            data={byTenant.map((d) => ({ label: d.tenant_name || d.tenant_id, value: d.count }))}
            variant="donut"
            ariaLabel="Users by Tenant"
          />
        </div>
      )}
    </div>
  );
}

UsersByTenantOverviewChart.propTypes = {
  className: PropTypes.string,
};

export default UsersByTenantOverviewChart;
