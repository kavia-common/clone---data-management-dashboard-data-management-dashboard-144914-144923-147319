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

  // Compute ISO window from selected bucket, keeping current UI intact
  const window = useMemo(() => {
    const now = new Date();
    const startOfDay = (d) => {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      return x;
    };
    const endOfDay = (d) => {
      const x = new Date(d);
      x.setHours(23, 59, 59, 999);
      return x;
    };
    const startOfMonth = (d) => {
      const x = new Date(d);
      x.setDate(1);
      x.setHours(0, 0, 0, 0);
      return x;
    };
    const endOfMonth = (d) => {
      const x = new Date(d);
      x.setMonth(x.getMonth() + 1, 0);
      x.setHours(23, 59, 59, 999);
      return x;
    };

    let from = null;
    let to = null;

    if (filter.bucket === 'daily') {
      from = startOfDay(now);
      to = endOfDay(now);
    } else if (filter.bucket === 'weekly') {
      const s = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
      from = startOfDay(s);
      to = endOfDay(now);
    } else if (filter.bucket === 'monthly') {
      from = startOfMonth(now);
      to = endOfMonth(now);
    } else if (filter.bucket === 'custom') {
      from = startOfDay(filter.from ? new Date(filter.from) : now);
      to = endOfDay(filter.to ? new Date(filter.to) : now);
    } else {
      from = startOfDay(now);
      to = endOfDay(now);
    }

    return {
      from: from ? from.toISOString() : null,
      to: to ? to.toISOString() : null,
    };
  }, [filter]);

  // Fetch users using created_at-based server filter
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
          mode: filter.bucket === 'daily' ? 'daily' : filter.bucket === 'weekly' ? 'weekly' : filter.bucket === 'monthly' ? 'monthly' : 'custom',
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
