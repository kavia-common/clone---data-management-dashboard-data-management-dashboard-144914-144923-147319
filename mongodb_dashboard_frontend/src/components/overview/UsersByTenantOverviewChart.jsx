import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { fetchWithTenant } from '../../utils/tenantClient';
import { useAuth } from '../../context/AuthContext';
import OverviewChartFilters from './OverviewChartFilters';
import LoadingState from '../common/LoadingState';
import ErrorState from '../common/ErrorState';
import OverviewEmptyState from './OverviewEmptyState';
import UsersByTenantChart from '../charts/UsersByTenantChart';
import './overview.css';

/**
 * PUBLIC_INTERFACE
 * UsersByTenantOverviewChart
 * A self-contained Overview widget that fetches users via /api/users scoped to the current user's organization_id,
 * supports Daily/Weekly/Monthly/Custom (date range) filters, aggregates counts per tenant client-side,
 * and renders a responsive donut/bar chart following the Ocean Professional theme.
 */
function UsersByTenantOverviewChart({ className }) {
  const { user } = useAuth() || {};
  const [range, setRange] = useState({ type: 'daily', from: null, to: null }); // type: daily|weekly|monthly|custom
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [users, setUsers] = useState([]);

  // Build time window based on range selection
  const window = useMemo(() => {
    const now = new Date();
    let from = null;
    let to = now;
    if (range.type === 'daily') {
      from = new Date(now);
      from.setDate(from.getDate() - 1);
    } else if (range.type === 'weekly') {
      from = new Date(now);
      from.setDate(from.getDate() - 7);
    } else if (range.type === 'monthly') {
      from = new Date(now);
      from.setMonth(from.getMonth() - 1);
    } else if (range.type === 'custom' && range.from && range.to) {
      from = new Date(range.from);
      to = new Date(range.to);
    } else {
      // default daily
      from = new Date(now);
      from.setDate(from.getDate() - 1);
    }
    return { from, to };
  }, [range]);

  const organizationId = user?.organization_id || user?.tenantId || null;

  useEffect(() => {
    let isCancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Build filter for date range; assume users.created_at exists (or registered_at)
        // Backend /api/users supports a JSON filter param; we filter by created_at in range when provided.
        const filter = {};
        if (window.from || window.to) {
          // Try created_at primary, fallback will still return all if field absent
          filter['created_at'] = {};
          if (window.from) filter['created_at'].$gte = window.from.toISOString();
          if (window.to) filter['created_at'].$lte = window.to.toISOString();
        }

        const params = new URLSearchParams();
        params.set('limit', '200'); // get enough to chart
        if (Object.keys(filter).length > 0) {
          params.set('filter', JSON.stringify(filter));
        }

        // fetchWithTenant attaches organization_id from context consistently with other calls
        const res = await fetchWithTenant(`/api/users?${params.toString()}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          organization_id: organizationId,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(text || `Request failed with status ${res.status}`);
        }
        const data = await res.json();

        // Server may return envelope when page/limit present; handle both array and envelope
        const items = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
        if (!isCancelled) {
          setUsers(items);
        }
      } catch (e) {
        if (!isCancelled) setError(e);
      } finally {
        if (!isCancelled) setLoading(false);
      }
    }
    if (organizationId) {
      load();
    } else {
      setUsers([]);
    }
    return () => {
      isCancelled = true;
    };
  }, [organizationId, window.from, window.to]);

  // Aggregate counts per tenant_id (or organization_id if tenant_id missing)
  const byTenant = useMemo(() => {
    const map = new Map();
    for (const u of users) {
      const tenantId = u.tenant_id || u.organization_id || 'unknown';
      const tenantName = u.tenant_name || u.organization_name || tenantId;
      const key = tenantId;
      const prev = map.get(key) || { tenant_id: tenantId, tenant_name: tenantName, count: 0 };
      prev.count += 1;
      map.set(key, prev);
    }
    const entries = Array.from(map.values());
    // sort desc by count
    entries.sort((a, b) => b.count - a.count);
    return entries;
  }, [users]);

  const onFilterChange = (type, customRange) => {
    if (type === 'custom') {
      setRange({ type, from: customRange?.from || null, to: customRange?.to || null });
    } else {
      setRange({ type, from: null, to: null });
    }
  };

  return (
    <div className={`overview-section users-by-tenant ${className || ''}`}>
      <div className="overview-section-header">
        <h3 className="overview-section-title">Total Users by Tenant</h3>
        <OverviewChartFilters
          selected={range.type}
          onChange={onFilterChange}
          showCustom
        />
      </div>

      {loading && (
        <LoadingState message="Loading users by tenant..." />
      )}
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
            data={byTenant.map(d => ({ label: d.tenant_name || d.tenant_id, value: d.count }))}
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
