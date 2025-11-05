import React from 'react';

// PUBLIC_INTERFACE
export default function OverviewKpiCards({ kpis, loading }) {
  /** Displays KPI cards for totals and range stats */
  const items = [
    {
      key: 'totalRecords',
      label: 'Total Records',
      color: '#2563EB',
      value: kpis?.totalRecords ?? 0,
    },
    {
      key: 'newInRange',
      label: 'New in Range',
      color: '#10B981',
      value: kpis?.newInRange ?? 0,
    },
    {
      key: 'updatesInRange',
      label: 'Updates in Range',
      color: '#F59E0B',
      value: kpis?.updatesInRange ?? 0,
    },
    {
      key: 'deletionsInRange',
      label: 'Deletions in Range',
      color: '#EF4444',
      value: kpis?.deletionsInRange ?? 0,
    },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
      {items.map((it) => (
        <div
          key={it.key}
          style={{
            background: '#ffffff',
            borderRadius: 12,
            padding: 16,
            boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
            border: '1px solid #E5E7EB',
          }}
        >
          <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 6 }}>{it.label}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#111827' }}>
              {loading ? '—' : Number(it.value).toLocaleString()}
            </div>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: it.color,
                marginLeft: 'auto',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
