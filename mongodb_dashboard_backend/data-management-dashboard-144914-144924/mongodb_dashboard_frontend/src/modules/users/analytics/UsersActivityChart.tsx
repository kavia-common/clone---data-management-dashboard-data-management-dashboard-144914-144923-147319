import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

type DataPoint = {
  date: string;
  total: number;
  admin: number;
  user: number;
};

export interface UsersActivityChartProps {
  data: DataPoint[];
  loading?: boolean;
  emptyMessage?: string;
}

const UsersActivityChart: React.FC<UsersActivityChartProps> = ({ data, loading, emptyMessage }) => {
  if (loading) {
    return <div style={{ padding: 16 }}>Loading activity…</div>;
  }
  if (!data || data.length === 0) {
    return <div style={{ padding: 16, color: '#6b7280' }}>{emptyMessage || 'No activity for the selected range.'}</div>;
  }

  return (
    <div style={{ width: '100%', height: 320, background: '#ffffff', borderRadius: 8, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: 16, right: 16, top: 16, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="total" stroke="#2563EB" strokeWidth={2} dot={false} name="Total" />
          <Line type="monotone" dataKey="admin" stroke="#F59E0B" strokeWidth={2} dot={false} name="Admin" />
          <Line type="monotone" dataKey="user" stroke="#10B981" strokeWidth={2} dot={false} name="User" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default UsersActivityChart;
