import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import { useSessionsPerDay } from '../../hooks/useSessionsPerDay';
import Card from '../ui/Card';
import LoadingState from '../common/LoadingState';
import ErrorState from '../common/ErrorState';
import { getChartTheme } from './chartTheme';

/**
 * PUBLIC_INTERFACE
 * Renders a responsive bar chart of sessions per day.
 * Props:
 *  - title?: string
 *  - filters?: { tenant_id?, project_id?, status?, start?, end? }
 */
export default function SessionsPerDayBarChart({ title = 'Sessions Per Day', filters = {} }) {
  const { data, loading, error } = useSessionsPerDay(filters);

  const theme = getChartTheme();

  return (
    <Card title={title}>
      {loading && <LoadingState message="Loading sessions…" />}
      {error && <ErrorState message={error.message || 'Failed to load data'} />}
      {!loading && !error && (
        <div style={{ width: '100%', height: 360 }}>
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
              <XAxis
                dataKey="date"
                tick={{ fill: theme.label }}
                tickLine={false}
                axisLine={{ stroke: theme.axisTick }}
                minTickGap={24}
              />
              <YAxis
                tick={{ fill: theme.label }}
                tickLine={false}
                axisLine={{ stroke: theme.axisTick }}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ fill: 'transparent' }}
                contentStyle={{ background: theme.tooltip.bg, border: `1px solid ${theme.tooltip.border}`, borderRadius: 8, color: theme.tooltip.text }}
                formatter={(value) => [value, 'Count']}
                labelFormatter={(label) => `Date: ${label}`}
              />
              <Bar dataKey="count" fill={theme.primary} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
