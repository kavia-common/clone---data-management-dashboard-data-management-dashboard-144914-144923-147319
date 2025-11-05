import React from 'react';
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line
} from 'recharts';

// PUBLIC_INTERFACE
export default function OverviewTrendChart({ data = [], metric = 'creates', variant = 'area' }) {
  /** Primary time-series chart for the selected metric */
  const color = metric === 'updates' ? '#F59E0B' : metric === 'deletes' ? '#EF4444' : metric === 'total' ? '#2563EB' : '#2563EB';

  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: 12,
        padding: 16,
        boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
        border: '1px solid #E5E7EB',
        minHeight: 300,
      }}
    >
      <div style={{ fontSize: 14, color: '#6B7280', marginBottom: 8 }}>
        {metric.charAt(0).toUpperCase() + metric.slice(1)} over time
      </div>
      <div style={{ width: '100%', height: 320 }}>
        <ResponsiveContainer>
          {variant === 'line' ? (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#6B7280' }} />
              <YAxis tick={{ fontSize: 12, fill: '#6B7280' }} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} />
            </LineChart>
          ) : (
            <AreaChart data={data}>
              <defs>
                <linearGradient id="colorMetric" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#6B7280' }} />
              <YAxis tick={{ fontSize: 12, fill: '#6B7280' }} />
              <Tooltip />
              <Area type="monotone" dataKey="value" stroke={color} fill="url(#colorMetric)" strokeWidth={2} />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
