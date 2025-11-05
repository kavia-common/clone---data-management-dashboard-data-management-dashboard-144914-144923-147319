import React from 'react';

const RANGES = [
  { key: '7d', label: 'Last 7 days (daily)' },
  { key: '30d', label: 'Last 30 days (daily)' },
  { key: '12w', label: 'Last 12 weeks (weekly)' },
  { key: '12m', label: 'Last 12 months (monthly)' },
];

const METRICS = [
  { key: 'creates', label: 'Creations' },
  { key: 'updates', label: 'Updates' },
  { key: 'deletes', label: 'Deletions' },
  { key: 'total', label: 'Total Records' },
];

// PUBLIC_INTERFACE
export default function OverviewTimeControls({ range, setRange, metric, setMetric, showMetricSelector = true }) {
  /** Time controls to select range and metric */
  return (
    <div
      style={{
        display: 'flex',
        gap: '12px',
        flexWrap: 'wrap',
        alignItems: 'center',
        background: '#ffffff',
        padding: '12px',
        borderRadius: 12,
        boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
      }}
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            style={{
              padding: '8px 12px',
              borderRadius: 10,
              border: range === r.key ? '1px solid #2563EB' : '1px solid #E5E7EB',
              background: range === r.key ? '#2563EB' : '#fff',
              color: range === r.key ? '#fff' : '#111827',
              transition: 'all 160ms ease',
              cursor: 'pointer',
            }}
          >
            {r.label}
          </button>
        ))}
      </div>
      {showMetricSelector && (
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              style={{
                padding: '8px 12px',
                borderRadius: 10,
                border: metric === m.key ? '1px solid #F59E0B' : '1px solid #E5E7EB',
                background: metric === m.key ? '#F59E0B' : '#fff',
                color: metric === m.key ? '#111827' : '#111827',
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
  );
}
