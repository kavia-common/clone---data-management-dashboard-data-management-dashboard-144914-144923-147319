import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { useAuth } from '../../context/AuthContext';
import OverviewChartFilters from './OverviewChartFilters';
import LoadingState from '../common/LoadingState';
import ErrorState from '../common/ErrorState';
import OverviewEmptyState from './OverviewEmptyState';
import UsersByTenantBarChart from '../users/UsersByTenantBarChart';
import './overview.css';
import { fetchUsers, buildCreatedAtDateOnlyFilter } from '../../services/usersService';

/**
 * PUBLIC_INTERFACE
 * UsersByTenantOverviewChart
 * Uses /api/users with organization_id and created_at date-only filter and aggregates counts by tenant client-side.
 * UI controls remain unchanged; we compute date params from them.
 */
export default function UsersByTenantOverviewChart({ className }) {
  const auth = useAuth() || {};
  const organizationIdFromCtx = auth.organizationId || auth?.organization?.id || auth?.organization_id || null;

  // Keep existing UI selections semantic: granularity and custom date range
  const [granularity, setGranularity] = useState('day'); // day | week | month | custom
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [customRange, setCustomRange] = useState({ from: null, to: null });

  const mode = useMemo(() => {
    const g = (granularity || '').toLowerCase();
    return g === 'day' ? 'daily' : g === 'week' ? 'weekly' : g === 'month' ? 'monthly' : 'custom';
  }, [granularity]);

  const serviceFilter = useMemo(
    () =>
      buildCreatedAtDateOnlyFilter({
        mode,
        selectedDate,
        selectedWeekAnchor: selectedDate,
        selectedMonthAnchor: selectedDate,
        customFrom: customRange?.from || undefined,
        customTo: customRange?.to || undefined,
      }),
    [mode, selectedDate, customRange]
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [users, setUsers] = useState([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!organizationIdFromCtx) {
        setUsers([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetchUsers({
          organization_id: organizationIdFromCtx,
          mode,
          filter: serviceFilter || {},
          // preserve other query fields like sort/page if needed in future
        });

        // Normalize common shapes
        const data = Array.isArray(res) ? res : res?.data || res?.items || [];
        if (!cancelled) setUsers(Array.isArray(data) ? data : []);
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
  }, [organizationIdFromCtx, mode, serviceFilter]);

  const byTenant = useMemo(() => {
    const map = new Map();
    for (const u of users || []) {
      const tenantId = u.tenant_id || u.organization_id || 'unknown';
      const tenantName = u.tenant_name || u.organization_name || tenantId;
      const key = tenantId || 'unknown';
      const prev = map.get(key) || { tenant_id: tenantId, tenant_name: tenantName, count: 0 };
      prev.count += 1;
      map.set(key, prev);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [users]);

  const filtersValue = useMemo(
    () => ({
      granularity,
      from: customRange?.from || null,
      to: customRange?.to || null,
      selectedDate,
    }),
    [granularity, customRange, selectedDate]
  );

  const onFiltersChange = (next) => {
    // Expect OverviewChartFilters to pass granularity (day|week|month|custom) and optionally from/to/selectedDate
    if (next?.granularity) setGranularity(next.granularity);
    if (Object.prototype.hasOwnProperty.call(next || {}, 'selectedDate')) setSelectedDate(next.selectedDate);
    if (next?.granularity === 'custom' && (next?.from || next?.to)) {
      setCustomRange({ from: next.from || null, to: next.to || null });
    }
  };

  return (
    <div className={`overview-section users-by-tenant ${className || ''}`}>
      <div className="overview-section-header">
        <h3 className="overview-section-title">Total Users by Tenant</h3>
        <OverviewChartFilters value={filtersValue} onChange={onFiltersChange} showGranularity />
      </div>

      {loading && <LoadingState message="Loading users by tenant..." />}
      {!loading && error && (
        <ErrorState title="Unable to load users" description={error?.message || 'Please try again.'} />
      )}
      {!loading && !error && byTenant.length === 0 && (
        <OverviewEmptyState title="No users found in the selected period." />
      )}
      {!loading && !error && byTenant.length > 0 && (
        <div className="overview-chart-container">
          <UsersByTenantBarChart
            items={byTenant.map((d) => ({
              label: d.tenant_name || d.tenant_id,
              value: d.count,
              tenant_id: d.tenant_id,
            }))}
            onRefresh={() => {
              // no-op; refetch handled by effect via state changes
            }}
          />
        </div>
      )}
    </div>
  );
}

UsersByTenantOverviewChart.propTypes = {
  className: PropTypes.string,
};
