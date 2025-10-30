import React from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

type Point = { date: string; total: number };

interface Props {
  data: Point[];
}

// PUBLIC_INTERFACE
export default function UsersActivityChart({ data }: Props) {
  /** Line chart for active users trend */
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" />
        <YAxis allowDecimals={false} />
        <Tooltip />
        <Line type="monotone" dataKey="total" stroke="#2563EB" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
