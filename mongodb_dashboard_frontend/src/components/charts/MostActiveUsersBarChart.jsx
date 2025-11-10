import React, { useMemo, useState } from 'react';
import useMostActiveUsers from '../../hooks/useMostActiveUsers';
import './MostActiveUsersBarChart.css';

/**
 * PUBLIC_INTERFACE
 * MostActiveUsersBarChart
 * Renders a bar chart of users with highest session counts within a selectable window and Top N.
 *
 * Props:
 * - initialWindow?: number (days) default 30
 * - initialTopN?: number default 10
 * - height?: number default 320
 */
export default function MostActiveUsersBarChart({ initialWindow = 30, initialTopN = 10, height = 320 }) {
  const { data, loading, error, controls } = useMostActiveUsers({
    window: initialWindow,
    topN: initialTopN,
  });

  const [customMode, setCustomMode] = useState(false);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const maxVal = useMemo(() => Math.max(...(data?.map((d) => d.count) || [0, 1])), [data]);

  const applyCustom = () => {
    if (customFrom && customTo) {
      controls.setCustomRange(customFrom, customTo);
      setCustomMode(true);
      controls.refetch();
    }
  };

  const clearCustom = () => {
    setCustomMode(false);
    setCustomFrom('');
    setCustomTo('');
    // Reset to current window
    controls.setCustomRange(null, null);
    controls.refetch();
  };

  return (
    <div className="card most-active-users">
      <div className="card-header" style={{ paddingBottom: 0 }}>
        <div>
          <h3 className="card-title">Most Active Users</h3>
          <div className="card-subtitle">Top users by session count (completed | active)</div>
        </div>
        <div className="card-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="segmented small">
            <button className={!customMode && controls.window === 7 ? 'active' : ''} onClick={() => { setCustomMode(false); controls.setWindow(7); }}>
              7d
            </button>
            <button className={!customMode && controls.window === 30 ? 'active' : ''} onClick={() => { setCustomMode(false); controls.setWindow(30); }}>
              30d
            </button>
            <button className={!customMode && controls.window === 90 ? 'active' : ''} onClick={() => { setCustomMode(false); controls.setWindow(90); }}>
              90d
            </button>
          </div>

          <div className="topn">
            <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginRight: 6 }}>Top</label>
            <select
              aria-label="Top N"
              className="ui-input"
              value={controls.topN}
              onChange={(e) => controls.setTopN(Number(e.target.value))}
            >
              {[5, 10, 15, 20, 25].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          <div className="custom-range" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Custom</label>
            <input
              type="datetime-local"
              className="ui-input"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              aria-label="Custom from"
            />
            <span style={{ fontSize: 12 }}>to</span>
            <input
              type="datetime-local"
              className="ui-input"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              aria-label="Custom to"
            />
            <button className="ui-button" onClick={applyCustom} disabled={!customFrom || !customTo}>
              Apply
            </button>
            {customMode && (
              <button className="ui-button ghost" onClick={clearCustom}>
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card-content">
        {loading && <div className="state">Loading...</div>}
        {error && !loading && <div className="state error">Error: {error}</div>}
        {!loading && !error && (!data || data.length === 0) && (
          <div className="state">No activity in the selected range</div>
        )}

        {!loading && !error && data && data.length > 0 && (
          <div className="bars" style={{ display: 'grid', gap: 10, paddingTop: 8 }}>
            {data.map((row) => {
              const pct = maxVal > 0 ? (row.count / maxVal) * 100 : 0;
              const label = row.user_name || row.user_id || 'unknown';
              return (
                <div key={row.user_id} className="bar-row" style={{ display: 'grid', gridTemplateColumns: '200px 1fr 60px', alignItems: 'center', gap: 8 }}>
                  <div className="label" title={label} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {label}
                  </div>
                  <div className="bar-track" style={{ height: 10, background: 'var(--chart-grid, #e5e7eb)', borderRadius: 6, overflow: 'hidden' }}>
                    <div
                      className="bar-fill"
                      style={{
                        width: `${pct}%`,
                        height: '100%',
                        background: 'var(--color-primary, #2563EB)',
                        transition: 'width 260ms ease',
                      }}
                      aria-label={`${label} ${row.count}`}
                    />
                  </div>
                  <div className="value" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.count}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
