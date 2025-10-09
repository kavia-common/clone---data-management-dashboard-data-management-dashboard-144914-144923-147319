import React from 'react';

/**
 * PUBLIC_INTERFACE
 * Overview page that shows modules area after login.
 */
export default function Overview() {
  const modules = [
    { key: 'users', title: 'Users', description: 'Manage and analyze users' },
    { key: 'sessions', title: 'Sessions', description: 'Track sessions and activity' },
    { key: 'deployments', title: 'Deployments', description: 'View application deployments' },
    { key: 'costs', title: 'Costs', description: 'Analyze LLM costs and usage' },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16, color: '#111827' }}>Overview</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
        {modules.map((m) => (
          <div key={m.key} style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #E5E7EB', padding: 16, boxShadow: '0 6px 14px rgba(0,0,0,0.04)' }}>
            <div style={{ fontWeight: 700, color: '#2563EB', marginBottom: 6 }}>{m.title}</div>
            <div style={{ color: '#4B5563', fontSize: 14 }}>{m.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
