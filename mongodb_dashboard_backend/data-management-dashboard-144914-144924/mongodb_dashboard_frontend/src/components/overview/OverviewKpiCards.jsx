import React from 'react';

// PUBLIC_INTERFACE
export default function OverviewKpiCards({ kpis = {}, loading }) {
  /** Displays KPI cards for Overview KPIs */
  const {
    activeUsers = 0,
    sessions = 0,
    deploySuccessRate = 0,
    errorRate = 0,
    totalLlmCost = 0,
    avgCostPerSession = 0,
  } = kpis || {};

  const items = [
    { key: 'sessions', label: 'Sessions', color: '#2563EB', value: sessions, format: 'int' },
    { key: 'activeUsers', label: 'Active Users', color: '#0EA5E9', value: activeUsers, format: 'int' },
    { key: 'deploySuccessRate', label: 'Deploy Success Rate', color: '#10B981', value: deploySuccessRate, format: 'pct' },
    { key: 'errorRate', label: 'Error Rate', color: '#EF4444', value: errorRate, format: 'pct' },
    { key: 'totalLlmCost', label: 'Total LLM Cost', color: '#F59E0B', value: totalLlmCost, format: 'currency' },
    { key: 'avgCostPerSession', label: 'Avg Cost / Session', color: '#6366F1', value: avgCostPerSession, format: 'currency' },
  ];

  const formatValue = (val, format) => {
    if (loading) return '—';
    if (format === 'pct') {
      const pct = Math.round((Number(val) || 0) * 1000) / 10;
      return `${pct}%`;
    }
    if (format === 'currency') {
      const n = Number(val) || 0;
      return `$${n.toFixed(2)}`;
    }
    return Number(val || 0).toLocaleString();
  };

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
              {formatValue(it.value, it.format)}
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
