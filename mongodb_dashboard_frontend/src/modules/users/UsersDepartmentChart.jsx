import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { aggregateUsersByDepartment, useUsers } from '../../hooks/useUsers';
import Card from '../../components/ui/Card';
import '../../styles/theme.css';
import { motion } from 'framer-motion';
import { getOceanTheme, getCategoricalPalette } from '../../theme/oceanTheme';

// Ocean Professional theme tokens
const THEME = getOceanTheme();
const PRIMARY = THEME.colors.primary; // #2563EB
const SECONDARY = THEME.colors.secondary; // #F59E0B
const GRID = THEME.colors.border; // subtle grid on light surface
const TEXT = THEME.colors.text; // #111827
const SUBTLE = THEME.colors.muted; // #6B7280

// Build a categorical palette derived from primary/secondary + tints
function getPalette(n) {
  // Prefer ordered palette ensuring accessible contrast on light backgrounds
  const base = [
    '#2563EB', // primary
    '#1D4ED8',
    '#60A5FA',
    '#93C5FD',
    '#F59E0B', // secondary
    '#D97706',
    '#FBBF24',
  ];
  if (n <= base.length) return base.slice(0, n);
  const extra = getCategoricalPalette(n - base.length);
  return base.concat(extra).slice(0, n);
}

/**
 * PUBLIC_INTERFACE
 * UsersDepartmentChart
 * A responsive chart visualizing user counts by department with Ocean-themed styling.
 */
const UsersDepartmentChart = ({ variant = 'bar', height = 320, maxBars = 12 }) => {
  /** This is a public function.
   * Props:
   *  - variant: 'bar' | 'pie' to switch chart type
   *  - height: number (px)
   *  - maxBars: number; when bar chart, show top N departments
   * Fetches users from /api/users, aggregates by department client-side,
   * and renders a responsive chart with loading/error/empty states in a themed card.
   */
  const { users, loading, error } = useUsers({ limit: 200 }); // fetch up to 200 by default

  const data = React.useMemo(() => aggregateUsersByDepartment(users), [users]);
  const topData = React.useMemo(
    () => (variant === 'bar' ? data.slice(0, maxBars) : data),
    [data, maxBars, variant]
  );

  // Accessible aria labels
  const ariaLabel =
    variant === 'pie'
      ? 'Users by Department pie chart'
      : 'Users by Department bar chart';

  // Empty/loading/error states using themed card
  if (loading) {
    return (
      <Card ariaLabel="Users by Department loading state" className="screen-center">
        <div className="skeleton" style={{ width: '60%', height: 14 }} aria-hidden="true" />
      </Card>
    );
  }

  if (error) {
    return (
      <Card ariaLabel="Users by Department error" >
        <div className="card-header" style={{ paddingBottom: 0 }}>
          <h3 className="card-title">Users by Department</h3>
          <div className="card-subtitle">Distribution of users grouped by department</div>
        </div>
        <div className="card-content">
          <div className="error" role="alert">
            Failed to load users: {error.message}
          </div>
        </div>
      </Card>
    );
  }

  if (!topData.length) {
    return (
      <Card ariaLabel="Users by Department empty state">
        <div className="card-header" style={{ paddingBottom: 0 }}>
          <h3 className="card-title">Users by Department</h3>
          <div className="card-subtitle">Distribution of users grouped by department</div>
        </div>
        <div className="card-content">
          <div className="screen-center" role="status" aria-live="polite">
            No departments to display.
          </div>
        </div>
      </Card>
    );
  }

  // Build color map by department to keep legend stable
  const departments = topData.map(d => d.department);
  const palette = getPalette(departments.length);
  const colorByDept = departments.reduce((acc, name, i) => {
    acc[name] = palette[i % palette.length];
    return acc;
  }, {});

  // Themed tooltip/legend styling
  const tooltipStyle = {
    borderRadius: 8,
    border: `1px solid ${GRID}`,
    background: THEME.colors.surface,
    color: TEXT,
    boxShadow: 'var(--shadow-md)',
  };

  return (
    <Card
      ariaLabel="Users by Department"
      title="Users by Department"
      subtitle="Distribution of users grouped by department"
      className=""
      variant=""
    >
      <div style={{ width: '100%', minHeight: height }} role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height={height}>
          {variant === 'pie' ? (
            <PieChart>
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value/*, name*/ ) => [value, 'Users']}
              />
              <Legend
                verticalAlign="bottom"
                height={28}
                wrapperStyle={{ color: SUBTLE, fontSize: 12 }}
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
                {topData.map((entry) => (
                  <Cell key={`cell-${entry.department}`} fill={colorByDept[entry.department]} />
                ))}
              </Pie>
            </PieChart>
          ) : (
            <BarChart
              data={topData}
              margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
            >
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
                contentStyle={tooltipStyle}
                cursor={{ fill: 'rgba(37, 99, 235, 0.06)' }}
                formatter={(value/*, name*/) => [value, 'Users']}
              />
              <Legend
                verticalAlign="top"
                align="right"
                wrapperStyle={{ color: SUBTLE, fontSize: 12, paddingBottom: 6 }}
              />
              <Bar dataKey="count" name="Users" radius={[6, 6, 0, 0]}>
                {topData.map((entry) => (
                  <motion.g key={entry.department}>
                    <Cell fill={colorByDept[entry.department]} />
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
