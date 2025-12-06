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
  const auth = useAuth() || {};
  const ctxOrg = auth.organizationId || auth?.organization?.id || auth?.organization_id || null;

  // bucket: daily|weekly|monthly|custom
  const [bucket, setBucket] = useState('daily');
  const [customRange, setCustomRange] = useState({ from: null, to: null });

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

    if (bucket === 'daily') {
      from = startOfDay(now);
      to = endOfDay(now);
    } else if (bucket === 'weekly') {
      const s = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
      from = startOfDay(s);
      to = endOfDay(now);
    } else if (bucket === 'monthly') {
      from = startOfMonth(now);
      to = endOfMonth(now);
    } else if (bucket === 'custom') {
      from = startOfDay(customRange.from ? new Date(customRange.from) : now);
      to = endOfDay(customRange.to ? new Date(customRange.to) : now);
    } else {
      from = startOfDay(now);
      to = endOfDay(now);
    }

    return {
      from: from ? from.toISOString() : null,
      to: to ? to.toISOString() : null,
    };
  }, [bucket, customRange]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [users, setUsers] = useState([]);

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
        const mode = bucket;
        const res = await listUsersServerFiltered({
          organization_id: ctxOrg,
          mode,
          from: window.from,
          to: window.to,
          limit: 500,
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
  }, [ctxOrg, bucket, window.from, window.to]);

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

  const onFilterChange = (next) => {
    const g = (next?.granularity || '').toLowerCase();
    const nextBucket =
      g === 'day' ? 'daily' : g === 'week' ? 'weekly' : g === 'month' ? 'monthly' : 'custom';
    setBucket(nextBucket);
    setCustomRange({ from: next?.from || null, to: next?.to || null });
  };

  const filtersValue = useMemo(() => {
    const toGranularity = (b) =>
      b === 'daily' ? 'day' : b === 'weekly' ? 'week' : b === 'monthly' ? 'month' : 'custom';
    return {
      granularity: toGranularity(bucket),
      from: customRange.from || window.from,
      to: customRange.to || window.to,
    };
  }, [bucket, customRange, window]);

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
          {/* Note: server endpoint /api/users/tenant-summary was intentionally removed.
              We now fetch /api/users with created_at $gte/$lte and organization_id and aggregate client-side. */}
          <UsersByTenantChart
            data={byTenant.map((d) => ({ label: d.tenant_name || d.tenant_id, value: d.count, tenant_id: d.tenant_id }))}
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
