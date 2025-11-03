import React, { useEffect, useState, useCallback } from 'react';
import { getDepartmentAggregation } from './api/analyticsAgents';
import DateRangeFilter from '../components/filters/DateRangeFilter';

export default function OverviewAgents() {
  const [state, setState] = useState({ loading: true, error: null, items: [] });
  const [dates, setDates] = useState(() => {
    // Persist across reloads
    try {
      const raw = localStorage.getItem('overviewAgentsDates');
      if (raw) return JSON.parse(raw);
    } catch {}
    return { startDate: '', endDate: '' };
  });

  const load = useCallback(async (currentDates) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const params = {};
      if (currentDates.startDate) params.startDate = currentDates.startDate;
      if (currentDates.endDate) params.endDate = currentDates.endDate;
      const res = await getDepartmentAggregation(params);
      const items = Array.isArray(res.items) ? res.items : [];
      setState({ loading: false, error: null, items });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'Failed to load', items: [] });
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      await load(dates);
    })();
    return () => { active = false; };
  }, [load]); // initial only

  const handleDatesChange = (next) => {
    setDates(next);
    try {
      localStorage.setItem('overviewAgentsDates', JSON.stringify(next));
    } catch {}
    load(next);
  };

  return (
    <div>
      <h3>Costs by Department</h3>
      <DateRangeFilter
        startDate={dates.startDate}
        endDate={dates.endDate}
        onChange={handleDatesChange}
      />
      {state.loading && <div>Loading agents by department…</div>}
      {state.error && <div style={{ color: '#EF4444' }}>Error: {state.error}</div>}
      {!state.loading && !state.error && !state.items.length && <div>No data</div>}
      {!state.loading && !state.error && state.items.length > 0 && (
        <ul>
          {state.items.map((row) => (
            <li key={row.department || 'unknown'}>
              <strong>{row.department || 'unknown'}</strong>: ${Number(row.total_cost || 0).toFixed(2)} ({row.user_count || 0} users)
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
