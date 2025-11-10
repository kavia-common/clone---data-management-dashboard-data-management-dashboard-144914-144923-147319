import React, { useEffect, useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';
import { fetchMostActiveUsers } from '../../api/usersAnalytics';

// PUBLIC_INTERFACE
export default function MostActiveUsersChart({
  range = '30d',
  granularity = 'daily',
  topN = 5,
  token,
  tenantId,
  title = 'Most Active Users (Last 30 Days)'
}) {
  const [loading, setLoading] = useState(true);
  const [buckets, setBuckets] = useState([]);
  const [series, setSeries] = useState([]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchMostActiveUsers({ range, granularity, topN, token, tenantId })
      .then((data) => {
        if (!mounted) return;
        setBuckets(Array.isArray(data?.buckets) ? data.buckets : []);
        setSeries(Array.isArray(data?.series) ? data.series : []);
      })
      .catch(() => {
        if (!mounted) return;
        setBuckets([]);
        setSeries([]);
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });
    return () => { mounted = false; };
  }, [range, granularity, topN, token, tenantId]);

  // Transform into recharts-friendly array: [{ date, userLabel1: count, userLabel2: count, ... }]
  const chartData = useMemo(() => {
    const rows = buckets.map((b) => ({ date: b }));
    const byLabel = series.map((s) => ({ key: s.label || s.user, values: s.data || [] }));
    rows.forEach((row, idx) => {
      byLabel.forEach((l) => {
        row[l.key] = l.values[idx] || 0;
      });
    });
    return rows;
  }, [buckets, series]);

  const palette = ['#2563EB', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6', '#14B8A6', '#F97316', '#3B82F6'];

  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: 12,
        padding: 16,
        boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
        border: '1px solid #E5E7EB',
        minHeight: 300
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#111827', marginRight: 12 }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: '#6B7280' }}>
          {granularity === 'weekly' ? 'Weekly' : 'Daily'} over {range}
        </div>
      </div>
      <div style={{ width: '100%', height: 340 }}>
        {loading ? (
          <div style={{ color: '#6B7280', fontSize: 14 }}>Loading...</div>
        ) : chartData.length === 0 ? (
          <div style={{ color: '#6B7280', fontSize: 14 }}>No activity found for the selected range.</div>
        ) : (
          <ResponsiveContainer>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#6B7280' }} />
              <YAxis tick={{ fontSize: 12, fill: '#6B7280' }} />
              <Tooltip />
              <Legend />
              {series.map((s, idx) => (
                <Line
                  key={s.user}
                  type="monotone"
                  dataKey={s.label || s.user}
                  stroke={palette[idx % palette.length]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
