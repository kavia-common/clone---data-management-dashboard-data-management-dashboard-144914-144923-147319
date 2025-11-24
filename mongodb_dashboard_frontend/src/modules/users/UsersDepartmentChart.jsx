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

import { getOceanTheme } from '../../theme/oceanTheme';

// Ocean Professional theme tokens
const THEME = getOceanTheme();
const GRID = THEME.colors.border; // subtle grid on light surface
const TEXT = THEME.colors.text; // #111827
const SUBTLE = THEME.colors.muted; // #6B7280

// helper: convert a hex or rgba color to rgba with custom alpha
const withAlphaColor = (color, alpha = 0.6) => {
  try {
    const c = String(color || '').trim();
    if (!c) return `rgba(0,0,0,${alpha})`;
    if (c.startsWith('rgba')) {
      // replace alpha
      const parts = c.replace('rgba(', '').replace(')', '').split(',').map((s) => s.trim());
      const [r, g, b] = parts;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    if (c.startsWith('#')) {
      const raw = c.slice(1);
      const hx = raw.length === 3 ? raw.split('').map((ch) => ch + ch).join('') : raw;
      const n = parseInt(hx, 16);
      /* eslint-disable no-bitwise */
      const r = (n >> 16) & 255;
      const g = (n >> 8) & 255;
      const b = n & 255;
      /* eslint-enable no-bitwise */
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    // fallback assume named color; let browser handle opacity via overlay
    return c;
  } catch {
    return `rgba(0,0,0,${alpha})`;
  }
};

// Fixed Ocean Professional categorical palette (10 colors)
const OCEAN_PALETTE = [
  '#2563EB', // blue-600 (primary)
  '#F59E0B', // amber-500 (secondary)
  '#10B981', // emerald-500
  '#EF4444', // red-500
  '#6366F1', // indigo-500
  '#14B8A6', // teal-500
  '#F97316', // orange-500
  '#84CC16', // lime-500
  '#06B6D4', // cyan-500
  '#A855F7', // purple-500
];

// PUBLIC_INTERFACE
export const OCEAN_DEPT_COLOR = (name, idxHint = 0) => {
  /** This is a public function.
   * Deterministic mapping for department -> Ocean color.
   * - Stable across renders and independent of user interaction.
   */
  const key = String(name ?? '').trim();
  if (!key) return OCEAN_PALETTE[0];
  // Use a simple stable hash seeded mapping so same dept always gets the same color
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0; // unsigned int
  }
  const base = hash % OCEAN_PALETTE.length;
  const idx = (base + (Number.isFinite(idxHint) ? idxHint : 0)) % OCEAN_PALETTE.length;
  return OCEAN_PALETTE[idx];
};

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

  // Aggregate and filter invalid/Unknown/empty departments
  const data = React.useMemo(() => {
    const agg = aggregateUsersByDepartment(users);
    return agg.filter(
      (d) =>
        d?.department &&
        String(d.department).trim() &&
        String(d.department).trim().toLowerCase() !== 'unknown'
    );
  }, [users]);

  // filter and cap for bar variant
  const topData = React.useMemo(
    () => (variant === 'bar' ? data.slice(0, maxBars) : data),
    [data, maxBars, variant]
  );

  // Accessible aria labels
  const ariaLabel =
    variant === 'pie'
      ? 'Users by Department pie chart'
      : 'Users by Department bar chart';

  // Early states
  if (loading) {
    return (
      <Card ariaLabel="Users by Department loading state" className="screen-center">
        <div className="skeleton" style={{ width: '60%', height: 14 }} aria-hidden="true" />
      </Card>
    );
  }

  if (error) {
    return (
      <Card ariaLabel="Users by Department error">
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

  // Tooling styles
  const tooltipStyle = {
    borderRadius: 8,
    border: `1px solid ${GRID}`,
    background: THEME.colors.surface,
    color: TEXT,
    boxShadow: 'var(--shadow-md)',
  };

  // Legend payload aligned with deterministic colors
  const legendPayload = topData.map((d) => ({
    id: d.department,
    type: 'square',
    value: d.department,
    color: OCEAN_DEPT_COLOR(d.department, 0),
  }));

  return (
    <Card
      ariaLabel="Users by Department"
      title="Users by Department"
      subtitle="Distribution of users grouped by department"
    >
      <div style={{ width: '100%', minHeight: height }} role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height={height}>
          {variant === 'pie' ? (
            <PieChart>
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value, name, props) => {
                  const dept = props?.payload?.department ?? name;
                  const color = OCEAN_DEPT_COLOR(dept);
                  return [value, 'Users', { color }];
                }}
              />
              <Legend
                verticalAlign="bottom"
                height={28}
                wrapperStyle={{ color: SUBTLE, fontSize: 12 }}
                payload={legendPayload}
              />
              <Pie
                data={topData}
                dataKey="count"
                nameKey="department"
                cx="50%"
                cy="50%"
                outerRadius="80%"
                paddingAngle={2}
                strokeOpacity={0.9}
              >
                {topData.map((entry) => {
                  const c = OCEAN_DEPT_COLOR(entry.department);
                  return (
                    <Cell
                      key={`cell-${entry.department}`}
                      fill={c}
                      stroke={c}
                      strokeOpacity={0.9}
                      strokeWidth={1.5}
                    />
                  );
                })}
              </Pie>
            </PieChart>
          ) : (
            <BarChart
              data={topData}
              margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={withAlphaColor(GRID, 0.5)} />
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
                cursor={{ fill: withAlphaColor(THEME.colors.primary || '#2563EB', 0.08) }}
                formatter={(value, name, props) => {
                  const dept = props?.payload?.department ?? name;
                  const color = OCEAN_DEPT_COLOR(dept);
                  return [value, 'Users', { color }];
                }}
              />
              <Legend
                verticalAlign="top"
                align="right"
                wrapperStyle={{ color: SUBTLE, fontSize: 12, paddingBottom: 6 }}
                payload={legendPayload}
              />
              <Bar dataKey="count" name="Users" radius={[6, 6, 0, 0]}>
                {topData.map((entry) => {
                  const color = OCEAN_DEPT_COLOR(entry.department);
                  return (
                    <Cell
                      key={`cell-${entry.department}`}
                      fill={color}
                      stroke={color}
                      strokeOpacity={0.9}
                      strokeWidth={1.5}
                    />
                  );
                })}
              </Bar>

            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </Card>
  );
};

export default UsersDepartmentChart;
