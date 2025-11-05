import React from 'react';
import { getOceanTheme } from '../../theme/oceanTheme';

const RANGES = [
  { key: '7d', label: 'Last 7 days (daily)', bucket: 'day' },
  { key: '30d', label: 'Last 30 days (daily)', bucket: 'day' },
  { key: '12w', label: 'Last 12 weeks (weekly)', bucket: 'week' },
  { key: '12m', label: 'Last 12 months (monthly)', bucket: 'month' },
];

const METRICS = [
  { key: 'creates', label: 'Creations' },
  { key: 'updates', label: 'Updates' },
  { key: 'deletes', label: 'Deletions' },
  { key: 'total', label: 'Total Records' },
];

// PUBLIC_INTERFACE
export default function OverviewTimeControls({
  range,
  setRange,
  metric,
  setMetric,
  showMetricSelector = true,
  showMA = true,
  setShowMA = () => {},
}) {
  /** Time controls to select range, metric and moving average overlay */
  const theme = getOceanTheme();
  const selected = RANGES.find(r => r.key === range);

  return (
    <div
      style={{
        display: 'flex',
        gap: '12px',
        flexWrap: 'wrap',
        alignItems: 'center',
        background: theme.colors.surface,
        padding: '12px',
        borderRadius: theme.radius.md,
        boxShadow: theme.elevation.sm,
        border: `1px solid ${theme.colors.border}`,
        width: '100%',
      }}
      aria-label="Overview time controls"
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            style={{
              padding: '8px 12px',
              borderRadius: 10,
              border: range === r.key ? `1px solid ${theme.colors.primary}` : `1px solid ${theme.colors.border}`,
              background: range === r.key ? theme.colors.primary : theme.colors.surface,
              color: range === r.key ? '#fff' : theme.colors.text,
              transition: 'all 160ms ease',
              cursor: 'pointer',
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: theme.colors.text }}>
          <input
            type="checkbox"
            checked={!!showMA}
            onChange={(e) => setShowMA(e.target.checked)}
            aria-label="Toggle moving average"
          />
          <span style={{ fontSize: 13, color: theme.colors.muted }}>
            Moving average ({selected?.bucket === 'week' ? '4' : selected?.bucket === 'month' ? '3' : '7'}-period)
          </span>
        </label>

        {showMetricSelector && (
          <div style={{ display: 'flex', gap: 8 }}>
            {METRICS.map((m) => (
              <button
                key={m.key}
                onClick={() => setMetric(m.key)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: metric === m.key ? `1px solid ${theme.colors.secondary}` : `1px solid ${theme.colors.border}`,
                  background: metric === m.key ? theme.colors.secondary : theme.colors.surface,
                  color: metric === m.key ? theme.colors.text : theme.colors.text,
                  transition: 'all 160ms ease',
                  cursor: 'pointer',
                }}
                aria-pressed={metric === m.key}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
