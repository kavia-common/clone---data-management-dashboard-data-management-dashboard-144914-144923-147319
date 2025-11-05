import React, { useMemo } from 'react';
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
} from 'recharts';
import { getOceanTheme } from '../../theme/oceanTheme';

// PUBLIC_INTERFACE
export default function OverviewTrendChart({
  data = [],
  metric = 'creates',
  variant = 'area',
  showMovingAverage = true,
  movingAverageWindow, // optional override, default based on bucket/range
  bucket = 'day', // 'day' | 'week' | 'month'
}) {
  /**
   * Primary time-series chart for the selected metric with optional moving average overlay.
   * Client-side SMA is computed from provided series to avoid backend changes.
   */
  const theme = getOceanTheme();
  const baseColor =
    metric === 'updates'
      ? theme.colors.secondary
      : metric === 'deletes'
      ? theme.colors.error
      : theme.colors.primary;

  // Determine default MA window if not provided
  const windowSize = useMemo(() => {
    if (movingAverageWindow && movingAverageWindow > 1) return movingAverageWindow;
    if (bucket === 'week') return 4; // 4-period MA for weekly
    if (bucket === 'month') return 3; // light smoothing for monthly
    return 7; // 7-period MA for daily
  }, [movingAverageWindow, bucket]);

  // Compute SMA over value key
  const seriesWithMA = useMemo(() => {
    if (!Array.isArray(data) || data.length === 0) return [];
    const vals = data.map(d => Number(d?.value ?? 0));
    const ma = [];
    let running = 0;
    for (let i = 0; i < vals.length; i++) {
      running += vals[i];
      if (i >= windowSize) {
        running -= vals[i - windowSize];
      }
      const denom = i + 1 < windowSize ? i + 1 : windowSize;
      ma[i] = running / denom;
    }
    return data.map((d, i) => ({ ...d, ma: Number.isFinite(ma[i]) ? Number(ma[i].toFixed(3)) : null }));
  }, [data, windowSize]);

  const legendFormatter = (value) => {
    if (value === 'value') return 'Primary';
    if (value === 'ma') return `${windowSize}-period MA`;
    return value;
  };

  return (
    <div
      style={{
        background: theme.colors.surface,
        borderRadius: theme.radius.md,
        padding: 16,
        boxShadow: theme.elevation.sm,
        border: `1px solid ${theme.colors.border}`,
        minHeight: 300,
      }}
    >
      <div style={{ fontSize: 14, color: theme.colors.muted, marginBottom: 8 }}>
        {metric.charAt(0).toUpperCase() + metric.slice(1)} over time
      </div>
      <div style={{ width: '100%', height: 340 }}>
        <ResponsiveContainer>
          {variant === 'line' ? (
            <LineChart data={seriesWithMA}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.colors.grid} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: theme.colors.muted }} />
              <YAxis tick={{ fontSize: 12, fill: theme.colors.muted }} />
              <Tooltip
                contentStyle={{ borderRadius: 10, border: `1px solid ${theme.colors.border}` }}
                labelStyle={{ color: theme.colors.text }}
              />
              <Legend formatter={legendFormatter} />
              <Line type="monotone" name="Primary" dataKey="value" stroke={baseColor} strokeWidth={2} dot={false} />
              {showMovingAverage && (
                <Line
                  type="monotone"
                  name={`${windowSize}-period MA`}
                  dataKey="ma"
                  stroke="#0EA5E9"
                  strokeDasharray="6 4"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              )}
            </LineChart>
          ) : (
            <AreaChart data={seriesWithMA}>
              <defs>
                <linearGradient id="colorMetric" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={baseColor} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={baseColor} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.colors.grid} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: theme.colors.muted }} />
              <YAxis tick={{ fontSize: 12, fill: theme.colors.muted }} />
              <Tooltip
                contentStyle={{ borderRadius: 10, border: `1px solid ${theme.colors.border}` }}
                labelStyle={{ color: theme.colors.text }}
              />
              <Legend formatter={legendFormatter} />
              <Area type="monotone" name="Primary" dataKey="value" stroke={baseColor} fill="url(#colorMetric)" strokeWidth={2} />
              {showMovingAverage && (
                <Line
                  type="monotone"
                  name={`${windowSize}-period MA`}
                  dataKey="ma"
                  stroke="#0EA5E9"
                  strokeDasharray="6 4"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              )}
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
