import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import Card from '../ui/Card';
import Skeleton from '../ui/Skeleton';
import useTheme from '../../theme/oceanTheme';
import './FeaturesUsageCharts.css';

/**
 * PUBLIC_INTERFACE
 * FeaturesUsageCharts
 * Renders two bar charts side-by-side (or stacked on mobile) for Most and Least Used Features.
 * Props:
 * - loading: boolean - whether data is loading (shows skeletons)
 * - mostUsed: Array<{ name?: string, feature?: string, count: number }>
 * - leastUsed: Array<{ name?: string, feature?: string, count: number }>
 * - className?: string - optional extra class
 */
export default function FeaturesUsageCharts({ loading, mostUsed, leastUsed, className = '' }) {
  const theme = useTheme();
  const colors = theme.colors || {
    primary: '#2563EB',
    secondary: '#F59E0B',
    text: '#111827',
    grid: '#e5e7eb',
    surface: '#ffffff',
    background: '#f9fafb',
  };

  // ✅ Normalize field name so chart always uses "feature"
  const normalizedMost = (mostUsed || []).map((item) => ({
    feature: item.feature || item.name || item._id || 'Unknown',
    count: item.count ?? 0,
  }));

  const normalizedLeast = (leastUsed || []).map((item) => ({
    feature: item.feature || item.name || item._id || 'Unknown',
    count: item.count ?? 0,
  }));

  const emptyMost = !loading && normalizedMost.length === 0;
  const emptyLeast = !loading && normalizedLeast.length === 0;

  const chartCard = (title, data, empty) => (
    <Card className="features-usage-card" title={title}>
      {loading ? (
        <div className="features-usage-skeleton">
          <Skeleton height={20} width="40%" style={{ marginBottom: 16 }} />
          <Skeleton height={180} width="100%" />
        </div>
      ) : empty ? (
        <div className="features-usage-empty">
          <div className="empty-badge">No data</div>
          <div className="empty-subtext">Try adjusting filters like date, user, or tenant.</div>
        </div>
      ) : (
        <div className="features-usage-chart-wrap">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data} margin={{ top: 10, right: 10, bottom: 24, left: 0 }}>
              <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" />
              <XAxis
                dataKey="feature"
                tick={{ fill: colors.text, fontSize: 12 }}
                interval={0}
                height={50}
                tickLine={false}
                axisLine={{ stroke: colors.grid }}
                angle={-20}
                textAnchor="end"
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: colors.text, fontSize: 12 }}
                tickLine={false}
                axisLine={{ stroke: colors.grid }}
              />
              <Tooltip
                cursor={{ fill: 'transparent' }}
                contentStyle={{
                  backgroundColor: colors.surface,
                  border: '1px solid #e5e7eb',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                }}
                wrapperStyle={{ outline: 'none' }}
                formatter={(value) => [value, 'Count']}
                labelFormatter={(label) => `Feature: ${label}`}
              />
              <Bar
                dataKey="count"
                name="Count"
                radius={[6, 6, 0, 0]}
                fill="url(#gradPrimary)"
                isAnimationActive={false}
              />
              <defs>
                <linearGradient id="gradPrimary" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colors.primary} stopOpacity="0.9" />
                  <stop offset="100%" stopColor={colors.primary} stopOpacity="0.6" />
                </linearGradient>
              </defs>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );

  return (
    <div className={`features-usage-grid ${className}`}>
      {chartCard('Most Used Features', normalizedMost, emptyMost)}
      {chartCard('Least Used Features', normalizedLeast, emptyLeast)}
    </div>
  );
}
