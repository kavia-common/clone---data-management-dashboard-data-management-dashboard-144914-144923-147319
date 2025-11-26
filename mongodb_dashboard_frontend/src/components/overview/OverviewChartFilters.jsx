import React from 'react';

/**
 * PUBLIC_INTERFACE
 * OverviewChartFilters
 * A lightweight filter control bar for Overview charts.
 * Mirrors the filter patterns used in Users module analytics (tenant, date range, granularity).
 * Props:
 * - value: { tenantId?, from?, to?, granularity? }
 * - onChange: (next) => void
 * - showGranularity: boolean (default true)
 * - tenants: optional list of tenants [{ id, name }]
 */
export default function OverviewChartFilters({
  value,
  onChange,
  showGranularity = true,
  tenants = [],
}) {
  const v = value || {};
  const update = (patch) => {
    onChange?.({ ...v, ...patch });
  };

  const isCustom = (v.granularity || '').toLowerCase() === 'custom';

  return (
    <div style={{
      display: 'flex',
      gap: 12,
      alignItems: 'center',
      flexWrap: 'wrap',
      marginBottom: 8,
    }}>
      {/* Tenant selector (if provided) */}
      {tenants && tenants.length > 0 && (
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span>Tenant</span>
          <select
            value={v.tenantId || ''}
            onChange={(e) => update({ tenantId: e.target.value || undefined })}
          >
            <option value="">All</option>
            {tenants.map(t => (
              <option key={t.id || t.tenantId || t.value} value={t.id || t.tenantId || t.value}>
                {t.name || t.label || t.id || t.tenantId}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Granularity */}
      {showGranularity && (
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span>Granularity</span>
          <select
            value={v.granularity || 'day'}
            onChange={(e) => {
              const g = e.target.value;
              // When switching away from custom, keep from/to as-is (caller may clear if desired)
              update({ granularity: g });
            }}
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
            <option value="custom">Custom</option>
          </select>
        </label>
      )}

      {/* From (enabled for all, but specifically needed when Custom is chosen) */}
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', opacity: isCustom ? 1 : 0.9 }}>
        <span>From</span>
        <input
          type="date"
          value={v.from ? v.from.slice(0, 10) : ''}
          onChange={(e) => update({ from: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
          aria-disabled={!isCustom ? false : false}
        />
      </label>

      {/* To */}
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', opacity: isCustom ? 1 : 0.9 }}>
        <span>To</span>
        <input
          type="date"
          value={v.to ? v.to.slice(0, 10) : ''}
          onChange={(e) => update({ to: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
          aria-disabled={!isCustom ? false : false}
        />
      </label>
    </div>
  );
}
