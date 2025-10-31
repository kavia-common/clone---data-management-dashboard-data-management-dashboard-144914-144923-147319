import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { aggregateUsersByDepartment, useUsers } from '../../hooks/useUsers';
import Card from '../../components/ui/Card';
import '../../styles/theme.css';
import { motion } from 'framer-motion';

// Theme colors
const PRIMARY = '#2563EB'; // blue
const SECONDARY = '#F59E0B'; // amber
const GRID = '#E5E7EB'; // gray-200
const TEXT = '#111827'; // gray-900
const SUBTLE = '#6B7280'; // gray-500

/**
 * PUBLIC_INTERFACE
 * UsersDepartmentChart
 * A responsive chart visualizing user counts by department.
 */
const UsersDepartmentChart = ({ variant = 'bar', height = 320, maxBars = 12 }) => {
  /** This is a public function.
   * Props:
   *  - variant: 'bar' | 'pie' to switch chart type
   *  - height: number (px)
   *  - maxBars: number; when bar chart, show top N departments
   * Fetches users from /api/users, aggregates by department client-side,
   * and renders a responsive chart with loading/error states.
   */
  const { users, loading, error } = useUsers({ limit: 200 }); // fetch up to 200 by default

  const data = React.useMemo(() => aggregateUsersByDepartment(users), [users]);
  const topData = React.useMemo(
    () => (variant === 'bar' ? data.slice(0, maxBars) : data),
    [data, maxBars, variant]
  );

  if (loading) {
    return (
      <Card style={{ padding: 16 }}>
        <div style={{ color: SUBTLE }}>Loading department distribution…</div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card style={{ padding: 16 }}>
        <div style={{ color: '#EF4444' }}>Failed to load users: {error.message}</div>
      </Card>
    );
  }

  if (!topData.length) {
    return (
      <Card style={{ padding: 16 }}>
        <div style={{ color: SUBTLE }}>No users found.</div>
      </Card>
    );
  }

  const COLORS = [PRIMARY, SECONDARY, '#10B981', '#8B5CF6', '#EC4899', '#F43F5E', '#06B6D4', '#84CC16'];

  return (
    <Card style={{ padding: 0 }}>
      <div style={{ padding: '16px 16px 0 16px' }}>
        <h3 style={{ margin: 0, color: TEXT, fontWeight: 600 }}>Users by Department</h3>
        <p style={{ margin: '6px 0 0', color: SUBTLE, fontSize: 12 }}>
          Distribution of users grouped by department
        </p>
      </div>
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">
          {variant === 'pie' ? (
            <PieChart>
              <Tooltip
                contentStyle={{ borderRadius: 8, border: '1px solid #E5E7EB' }}
                formatter={(value, name) => [value, 'Users']}
              />
              <Pie
                data={topData}
                dataKey="count"
                nameKey="department"
                cx="50%"
                cy="50%"
                outerRadius="80%"
                paddingAngle={2}
              >
                {topData.map((entry, index) => (
                  <Cell key={`cell-${entry.department}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          ) : (
            <BarChart data={topData} margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis
                dataKey="department"
                tick={{ fill: SUBTLE, fontSize: 12 }}
                axisLine={{ stroke: GRID }}
                tickLine={{ stroke: GRID }}
                interval={0}
                angle={-25}
                textAnchor="end"
                height={50}
              />
              <YAxis
                tick={{ fill: SUBTLE, fontSize: 12 }}
                axisLine={{ stroke: GRID }}
                tickLine={{ stroke: GRID }}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: '1px solid #E5E7EB' }}
                cursor={{ fill: 'rgba(37, 99, 235, 0.06)' }}
                formatter={(value, name) => [value, 'Users']}
              />
              <Bar dataKey="count" name="Users" radius={[6, 6, 0, 0]}>
                {topData.map((entry, index) => (
                  <motion.g key={entry.department}>
                    <Cell fill={index % 2 === 0 ? PRIMARY : SECONDARY} />
                  </motion.g>
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </Card>
  );
};

export default UsersDepartmentChart;
