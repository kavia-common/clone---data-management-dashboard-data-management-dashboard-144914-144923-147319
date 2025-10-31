import React, { useEffect, useState } from 'react';
import { getDepartmentAggregation } from './api/analyticsAgents';

export default function OverviewAgents() {
  const [state, setState] = useState({ loading: true, error: null, items: [] });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await getDepartmentAggregation({});
        if (!active) return;
        const items = Array.isArray(res.items) ? res.items : [];
        setState({ loading: false, error: null, items });
      } catch (e) {
        setState({ loading: false, error: e?.message || 'Failed to load', items: [] });
      }
    })();
    return () => { active = false; };
  }, []);

  if (state.loading) return <div>Loading agents by department…</div>;
  if (state.error) return <div style={{ color: '#EF4444' }}>Error: {state.error}</div>;
  if (!state.items.length) return <div>No data</div>;

  return (
    <div>
      <h3>Costs by Department</h3>
      <ul>
        {state.items.map((row) => (
          <li key={row.department || 'unknown'}>
            <strong>{row.department || 'unknown'}</strong>: ${Number(row.total_cost || 0).toFixed(2)} ({row.user_count || 0} users)
          </li>
        ))}
      </ul>
    </div>
  );
}
