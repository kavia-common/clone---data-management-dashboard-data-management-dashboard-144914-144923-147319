import React from 'react';
import './ActiveUsersTrendChart.css';

/**
 * Minimal responsive SVG area/line chart for active users trend.
 *
 * PUBLIC_INTERFACE
 * ActiveUsersTrendChart
 * @param {Object} props
 * @param {Array<{date:string,total:number}>} props.data - Time series points
 * @param {boolean} [props.loading]
 * @param {string|null} [props.error]
 * @param {Object} props.controls - { days, setDays, granularity, setGranularity, refetch }
 */
export default function ActiveUsersTrendChart({ data = [], loading, error, controls }) {
  const width = 800;
  const height = 220;
  const padding = { top: 16, right: 16, bottom: 28, left: 40 };

  const values = data.map(d => d.total || 0);
  const dates = data.map(d => d.date);

  const minX = 0;
  const maxX = Math.max(data.length - 1, 1);
  const minY = 0;
  const maxY = Math.max(Math.max(...values, 1), 5);

  const xScale = (i) =>
    padding.left + (i - minX) * ((width - padding.left - padding.right) / (maxX - minX || 1));
  const yScale = (v) =>
    height - padding.bottom - (v - minY) * ((height - padding.top - padding.bottom) / (maxY - minY || 1));

  const areaPath = () => {
    if (!data.length) return '';
    let p = `M ${xScale(0)} ${yScale(0)} L ${xScale(0)} ${yScale(values[0])}`;
    for (let i = 1; i < data.length; i++) {
      p += ` L ${xScale(i)} ${yScale(values[i])}`;
    }
    p += ` L ${xScale(maxX)} ${yScale(0)} Z`;
    return p;
  };

  const linePath = () => {
    if (!data.length) return '';
    let p = `M ${xScale(0)} ${yScale(values[0])}`;
    for (let i = 1; i < data.length; i++) {
      p += ` L ${xScale(i)} ${yScale(values[i])}`;
    }
    return p;
  };

  return (
    <div className="active-users-chart card">
      <div className="header">
        <div className="title">
          <h3>Active Users Trend</h3>
          <p className="subtitle">Distinct active users per {controls?.granularity || 'day'}</p>
        </div>
        <div className="controls">
          <div className="segmented">
            <button
              className={controls?.days === 7 ? 'active' : ''}
              onClick={() => controls?.setDays?.(7)}
            >
              7d
            </button>
            <button
              className={controls?.days === 30 ? 'active' : ''}
              onClick={() => controls?.setDays?.(30)}
            >
              30d
            </button>
            <button
              className={controls?.days === 90 ? 'active' : ''}
              onClick={() => controls?.setDays?.(90)}
            >
              90d
            </button>
          </div>
          <div className="segmented">
            <button
              className={controls?.granularity === 'day' ? 'active' : ''}
              onClick={() => controls?.setGranularity?.('day')}
            >
              Day
            </button>
            <button
              className={controls?.granularity === 'week' ? 'active' : ''}
              onClick={() => controls?.setGranularity?.('week')}
            >
              Week
            </button>
          </div>
        </div>
      </div>

      {loading && <div className="state">Loading...</div>}
      {error && !loading && <div className="state error">Error: {error}</div>}
      {!loading && !error && data.length === 0 && (
        <div className="state">No data in selected range</div>
      )}

      {!loading && !error && data.length > 0 && (
        <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label="Active users trend chart">
          {/* Axes */}
          <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} className="axis" />
          <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} className="axis" />

          {/* Y ticks */}
          {[0, 0.25, 0.5, 0.75, 1].map((t, idx) => {
            const v = Math.round(minY + t * (maxY - minY));
            const y = yScale(v);
            return (
              <g key={idx}>
                <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} className="grid" />
                <text x={padding.left - 8} y={y} textAnchor="end" alignmentBaseline="middle" className="tick">
                  {v}
                </text>
              </g>
            );
          })}

          {/* X ticks (sparse to avoid clutter) */}
          {dates.map((d, i) => {
            const show = i === 0 || i === maxX || i % Math.ceil(dates.length / 6) === 0;
            if (!show) return null;
            const x = xScale(i);
            return (
              <text key={i} x={x} y={height - padding.bottom + 18} textAnchor="middle" className="tick">
                {d}
              </text>
            );
          })}

          {/* Area */}
          <path d={areaPath()} className="area" />

          {/* Line */}
          <path d={linePath()} className="line" />

          {/* Dots */}
          {values.map((v, i) => (
            <circle key={i} cx={xScale(i)} cy={yScale(v)} r="2.5" className="dot" />
          ))}
        </svg>
      )}
    </div>
  );
}
