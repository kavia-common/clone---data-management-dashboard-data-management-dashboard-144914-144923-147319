import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { getDurationHistogram } from '../../api/sessionsAnalytics';
import '../charts/KPIChart.jsx'; // ensure folder exists in build graph (no import usage)
 // Lightweight inline styles updated to match dark theme tokens (surface, border, accent)
const styles = {
  container: {
    background: 'var(--color-surface)',
    borderRadius: 8,
    boxShadow: 'var(--shadow-elev-1, 0 1px 0 rgba(0,0,0,0.5), 0 6px 12px rgba(0,0,0,0.25))',
    border: '1px solid var(--color-border)',
    padding: 16,
    marginBottom: 16,
  },
  header: {
    display: 'flex',
    gap: 12,
    flexWrap: 'wrap',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--color-text-primary)',
    marginRight: 'auto',
  },
  controlGroup: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  select: {
    padding: '6px 8px',
    borderRadius: 8,
    border: '1px solid var(--color-border)',
    background: 'var(--color-surface)',
    color: 'var(--color-text-primary)',
  },
  toggleGroup: {
    display: 'inline-flex',
    border: '1px solid var(--color-border)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  toggleBtn: (active) => ({
    padding: '6px 10px',
    background: active ? 'var(--color-accent)' : 'var(--color-surface)',
    color: active ? '#ffffff' : 'var(--color-text-primary)',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 600,
    transition: 'background 150ms ease',
  }),
  chartWrap: {
    width: '100%',
    height: 220,
    position: 'relative',
  },
  svg: {
    width: '100%',
    height: '100%',
  },
  axisLabel: {
    fontSize: 11,
    fill: 'var(--chart-axis)',
  },
  bar: {
    fill: 'var(--chart-primary)',
    opacity: 0.3,
  },
  barHover: {
    fill: 'var(--chart-primary)',
    opacity: 1,
  },
  tooltip: {
    position: 'absolute',
    pointerEvents: 'none',
    background: 'var(--chart-tooltip-bg)',
    color: 'var(--color-text-primary)',
    padding: '6px 8px',
    borderRadius: 6,
    fontSize: 12,
    border: '1px solid var(--chart-tooltip-border)',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    zIndex: 2,
    transform: 'translate(-50%, -120%)',
    whiteSpace: 'nowrap',
  },
  footer: {
    display: 'flex',
    gap: 16,
    marginTop: 10,
    borderTop: '1px solid var(--color-border)',
    paddingTop: 10,
    color: 'var(--color-text-secondary)',
    fontSize: 13,
    flexWrap: 'wrap',
  },
  stat: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 8px',
    background: 'color-mix(in oklab, var(--color-accent) 8%, var(--color-surface))',
    borderRadius: 6,
  },
  statBadge: {
    fontSize: 11,
    fontWeight: 700,
    color: '#ffffff',
    background: 'var(--color-accent)',
    padding: '2px 6px',
    borderRadius: 999,
  },
  error: {
    background: '#3b1f1f',
    color: '#fca5a5',
    border: '1px solid #f87171',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  empty: {
    color: 'var(--color-text-secondary)',
    fontSize: 13,
    padding: 12,
  },
  loading: {
    color: 'var(--color-text-secondary)',
    fontSize: 13,
    padding: 12,
  },
};

/**
// PUBLIC_INTERFACE
 */
function UsersDurationHistogram({
  selectedUserId = null,
  selectedTenantId = null,
  onTenantChange,
  tenantOptions = [],
  defaultDays = 30,
  defaultBinSizeMin = 10,
}) {
  /**
   * UsersDurationHistogram renders a histogram of session durations (minutes).
   * Controls:
   * - Scope: "All users" vs "Selected user"
   * - Tenant selector (if tenantOptions provided)
   * - Date range (relative window): 7/14/30/90 days; default 30
   * - Bin size (minutes) default 10
   *
   * Data source: getDurationHistogram from src/api/sessionsAnalytics.js
   * Expects response { bins: [{binStartMin, binEndMin, count}], summary: { medianMin, p90Min, totalSessions } }
   * Loading, error states handled; debounced fetch to reduce API traffic.
   */

  const [scope, setScope] = useState(selectedUserId ? 'selected' : 'all');
  const [days, setDays] = useState(defaultDays);
  const [binSize, setBinSize] = useState(defaultBinSizeMin);
  const [tenantId, setTenantId] = useState(selectedTenantId || (tenantOptions[0]?.value ?? ''));
  const [data, setData] = useState({ bins: [], summary: { medianMin: null, p90Min: null, totalSessions: 0 } });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // tooltip
  const [hover, setHover] = useState(null); // { x,y, label }
  const containerRef = useRef(null);

  // Debounce utility
  const useDebounced = (fn, delay = 450) => {
    const timer = useRef();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useCallback((...args) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => fn(...args), delay);
    }, [fn, delay]);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const now = new Date();
      const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      const to = now;

      const params = {
        tenant_id: tenantId || undefined,
        user_id: scope === 'selected' ? selectedUserId : undefined,
        from: from.toISOString(),
        to: to.toISOString(),
        bin_size_min: binSize,
        unit: 'minutes', // enforce minutes
      };

      // Remove undefined
      const cleanParams = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));

      const resp = await getDurationHistogram(cleanParams);
      // Normalize response shape
      const bins = (resp?.bins || []).map((b, i) => ({
        index: i,
        binStartMin: b.binStartMin ?? b.bin_start_min ?? b.start ?? 0,
        binEndMin: b.binEndMin ?? b.bin_end_min ?? b.end ?? 0,
        count: b.count ?? 0,
      }));
      const summary = {
        medianMin: resp?.summary?.medianMin ?? resp?.summary?.median_min ?? null,
        p90Min: resp?.summary?.p90Min ?? resp?.summary?.p90_min ?? null,
        totalSessions: resp?.summary?.totalSessions ?? resp?.summary?.total_sessions ?? bins.reduce((a, c) => a + (c.count || 0), 0),
      };
      setData({ bins, summary });
    } catch (e) {
      setError(e?.message || 'Failed to load histogram');
      setData({ bins: [], summary: { medianMin: null, p90Min: null, totalSessions: 0 } });
    } finally {
      setLoading(false);
    }
  }, [binSize, days, scope, selectedUserId, tenantId]);

  const debouncedFetch = useDebounced(fetchData, 500);

  useEffect(() => {
    debouncedFetch();
  }, [debouncedFetch, binSize, days, scope, selectedUserId, tenantId]);

  // Notify parent on tenant change if handler provided
  const handleTenantChange = (e) => {
    setTenantId(e.target.value);
    if (onTenantChange) onTenantChange(e.target.value);
  };

  // Chart sizing and scales
  const { maxCount, xTicks, xMin, xMax } = useMemo(() => {
    const max = data.bins.reduce((m, b) => Math.max(m, b.count || 0), 0);
    const minStart = data.bins.length ? Math.min(...data.bins.map((b) => b.binStartMin)) : 0;
    const maxEnd = data.bins.length ? Math.max(...data.bins.map((b) => b.binEndMin)) : 0;
    const extentMin = Math.floor(minStart / binSize) * binSize;
    const extentMax = Math.ceil(maxEnd / binSize) * binSize;
    const ticks = [];
    for (let t = extentMin; t <= extentMax; t += binSize) ticks.push(t);
    return { maxCount: max || 1, xTicks: ticks, xMin: extentMin, xMax: extentMax };
  }, [data.bins, binSize]);

  // Chart dimensions
  const padding = { left: 40, right: 12, top: 10, bottom: 28 };
  const width = 760; // will scale via viewBox
  const height = 220;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const xScale = useCallback(
    (minVal) => {
      if (xMax === xMin) return padding.left;
      const t = (minVal - xMin) / (xMax - xMin);
      return padding.left + t * chartWidth;
    },
    [xMin, xMax, chartWidth, padding.left]
  );

  const yScale = useCallback(
    (count) => {
      const t = (count || 0) / (maxCount || 1);
      return padding.top + chartHeight - t * chartHeight;
    },
    [chartHeight, maxCount, padding.top]
  );

  const handleBarMouse = (evt, b) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const x = evt.clientX - (rect?.left || 0);
    const y = evt.clientY - (rect?.top || 0);
    setHover({
      x,
      y,
      label: `${b.binStartMin}–${b.binEndMin} min: ${b.count} sessions`,
    });
  };

  const handleMouseLeave = () => setHover(null);

  const canShowSelectedScope = Boolean(selectedUserId);

  return (
    <div style={styles.container} ref={containerRef}>
      <div style={styles.header}>
        <div style={styles.title}>Session Duration Histogram (minutes)</div>

        <div style={styles.controlGroup}>
          <div style={styles.toggleGroup} role="group" aria-label="Scope toggle">
            <button
              type="button"
              style={styles.toggleBtn(scope === 'all')}
              onClick={() => setScope('all')}
              title="Show all users"
            >
              All users
            </button>
            <button
              type="button"
              style={{ ...styles.toggleBtn(scope === 'selected'), opacity: canShowSelectedScope ? 1 : 0.5, cursor: canShowSelectedScope ? 'pointer' : 'not-allowed' }}
              onClick={() => canShowSelectedScope && setScope('selected')}
              title={canShowSelectedScope ? 'Show selected user' : 'Select a user in the table to enable'}
            >
              Selected user
            </button>
          </div>

          <label>
            <span className="sr-only">Date Range</span>
            <select
              aria-label="Date range"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              style={styles.select}
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </label>

          <label>
            <span className="sr-only">Bin size</span>
            <select
              aria-label="Bin size minutes"
              value={binSize}
              onChange={(e) => setBinSize(Number(e.target.value))}
              style={styles.select}
            >
              <option value={5}>Bin: 5 min</option>
              <option value={10}>Bin: 10 min</option>
              <option value={15}>Bin: 15 min</option>
              <option value={30}>Bin: 30 min</option>
              <option value={60}>Bin: 60 min</option>
            </select>
          </label>

          {tenantOptions && tenantOptions.length > 0 && (
            <label>
              <span className="sr-only">Tenant</span>
              <select
                aria-label="Tenant selector"
                value={tenantId}
                onChange={handleTenantChange}
                style={styles.select}
              >
                {tenantOptions.map((t) => (
                  <option key={t.value || t.id} value={t.value ?? t.id}>
                    {t.label ?? t.name ?? t.value ?? t.id}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {loading && <div style={styles.loading}>Loading histogram…</div>}
      {error && <div style={styles.error}>Error: {error}</div>}

      {!loading && !error && (
        <>
          {data.bins.length === 0 ? (
            <div style={styles.empty}>No session data for the selected range.</div>
          ) : (
            <div style={styles.chartWrap} onMouseLeave={handleMouseLeave}>
              <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={styles.svg} role="img" aria-label="Session duration histogram in minutes">
                {/* X axis line */}
                <line x1={padding.left} y1={padding.top + chartHeight} x2={padding.left + chartWidth} y2={padding.top + chartHeight} stroke="var(--chart-grid)" />
                {/* Y axis line */}
                <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + chartHeight} stroke="var(--chart-grid)" />

                {/* X ticks */}
                {xTicks.map((t) => {
                  const x = xScale(t);
                  return (
                    <g key={`xt-${t}`}>
                      <line x1={x} y1={padding.top + chartHeight} x2={x} y2={padding.top + chartHeight + 4} stroke="var(--chart-axis)" />
                      <text x={x} y={padding.top + chartHeight + 16} textAnchor="middle" style={styles.axisLabel}>
                        {t}
                      </text>
                    </g>
                  );
                })}

                {/* Y ticks (3) */}
                {[0, 0.5, 1].map((r, i) => {
                  const v = Math.round(r * maxCount);
                  const y = yScale(v);
                  return (
                    <g key={`yt-${i}`}>
                      <line x1={padding.left - 4} y1={y} x2={padding.left} y2={y} stroke="var(--chart-axis)" />
                      <text x={padding.left - 8} y={y + 4} textAnchor="end" style={styles.axisLabel}>
                        {v}
                      </text>
                    </g>
                  );
                })}

                {/* Bars */}
                {data.bins.map((b) => {
                  const x0 = xScale(b.binStartMin);
                  const x1 = xScale(b.binEndMin);
                  const w = Math.max(1, x1 - x0 - 2);
                  const y = yScale(b.count);
                  const h = padding.top + chartHeight - y;
                  const isHover = hover?.label?.startsWith(`${b.binStartMin}–`);
                  return (
                    <rect
                      key={`bar-${b.index}`}
                      x={x0 + 1}
                      y={y}
                      width={w}
                      height={Math.max(0, h)}
                      fill={styles.bar.fill}
                      opacity={isHover ? styles.barHover.opacity : styles.bar.opacity}
                      rx="2"
                      onMouseMove={(evt) => handleBarMouse(evt, b)}
                      onFocus={(evt) => handleBarMouse(evt, b)}
                      tabIndex={0}
                      role="img"
                      aria-label={`${b.binStartMin} to ${b.binEndMin} minutes: ${b.count} sessions`}
                    />
                  );
                })}

                {/* Axis labels */}
                <text x={padding.left + chartWidth / 2} y={height - 4} textAnchor="middle" style={styles.axisLabel}>
                  Duration (minutes)
                </text>
                <text transform={`translate(12 ${padding.top + chartHeight / 2}) rotate(-90)`} textAnchor="middle" style={styles.axisLabel}>
                  Sessions
                </text>
              </svg>

              {hover && (
                <div style={{ ...styles.tooltip, left: hover.x, top: hover.y }}>
                  {hover.label}
                </div>
              )}
            </div>
          )}

          <div style={styles.footer}>
            <div style={styles.stat}>
              <span style={styles.statBadge}>Median</span>
              <span>{data.summary.medianMin != null ? `${data.summary.medianMin} min` : '—'}</span>
            </div>
            <div style={styles.stat}>
              <span style={styles.statBadge}>p90</span>
              <span>{data.summary.p90Min != null ? `${data.summary.p90Min} min` : '—'}</span>
            </div>
            <div style={styles.stat}>
              <span style={styles.statBadge}>Sessions</span>
              <span>{data.summary.totalSessions ?? 0}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

UsersDurationHistogram.propTypes = {
  /** Selected user id to scope when "Selected user" toggle is active */
  selectedUserId: PropTypes.string,
  /** Selected tenant id to filter */
  selectedTenantId: PropTypes.string,
  /** Optional handler to bubble tenant change up */
  onTenantChange: PropTypes.func,
  /** Tenant options to show a selector: [{value, label}] */
  tenantOptions: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.string,
      label: PropTypes.string,
      id: PropTypes.string,
      name: PropTypes.string,
    })
  ),
  /** Default date range in days; default 30 */
  defaultDays: PropTypes.number,
  /** Default bin size in minutes; default 10 */
  defaultBinSizeMin: PropTypes.number,
};

export default UsersDurationHistogram;
