import React, { useMemo } from "react";
import PropTypes from "prop-types";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
  LabelList,
} from "recharts";
import { getChartTheme } from "./chartTheme";

/**
 * PUBLIC_INTERFACE
 * UsersByTenantChart
 * Presentational, themed horizontal bar chart for "Users by Tenant".
 *
 * Note: This component no longer fetches any data itself. The previous
 * tenant-summary backend call was intentionally removed. Data must be provided
 * by the parent component (e.g. UsersByTenantOverviewChart) which queries
 * /api/users with created_at $gte/$lte and organization_id, and aggregates
 * users by tenant client-side.
 */
export default function UsersByTenantChart({
  data = [],
  onBarClick,
}) {
  // compute totals and derived fields for tooltip display
  const totalUsers = useMemo(
    () => data.reduce((sum, r) => sum + Number(r?.value || r?.user_count || 0), 0),
    [data]
  );

  const shaped = useMemo(() => {
    return data.map((d) => {
      const count = Number(d?.value ?? d?.user_count ?? 0);
      const pct = totalUsers > 0 ? (count / totalUsers) * 100 : 0;
      return {
        name: d?.label ?? d?.name ?? d?.tenant_name ?? d?.tenant_id ?? "Unknown",
        tenant_id: d?.tenant_id || d?.id || d?.label || d?.name,
        user_count: count,
        percent: pct,
      };
    });
  }, [data, totalUsers]);

  const t = getChartTheme();
  const primary = t.primary;
  const primaryDark = t.primaryActive;
  const gridStroke = t.grid;

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const d = payload[0]?.payload || {};
      const count = d?.user_count ?? 0;
      const pct = d?.percent ?? 0;
      return (
        <div
          role="dialog"
          aria-live="polite"
          style={{
            background: t.tooltip.bg,
            border: `1px solid ${t.tooltip.border}`,
            borderRadius: 8,
            padding: "8px 10px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
            color: t.tooltip.text,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
          <div>Users: {count}</div>
          <div>Share: {pct.toFixed(1)}%</div>
        </div>
      );
    }
    return null;
  };

  const valueLabel = (props) => {
    const { x, y, width, height, value } = props;
    const label = String(value);
    const padding = 6;
    const textX = (x || 0) + (width || 0) + padding;
    const textY = (y || 0) + (height || 0) / 2 + 3;
    return (
      <text
        x={textX}
        y={textY}
        fill="var(--color-text-primary)"
        fontSize={12}
        textAnchor="start"
        aria-hidden="true"
      >
        {label}
      </text>
    );
  };

  return (
    <div role="region" aria-label="Users by Tenant chart" style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <span
          style={{
            background: "color-mix(in oklab, var(--color-accent) 12%, transparent)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-secondary)",
            fontSize: 12,
            padding: "6px 8px",
            borderRadius: 999,
          }}
          title={`Total users summed across shown tenants: ${totalUsers}`}
          aria-label={`Total users displayed: ${totalUsers}`}
        >
          Total: {totalUsers}
        </span>
      </div>
      <div style={{ height: 360 }}>
        {shaped.length === 0 ? (
          <div className="screen-center">No users found</div>
        ) : (
          <ResponsiveContainer>
            <BarChart
              data={shaped}
              layout="vertical"
              margin={{ top: 8, right: 40, bottom: 8, left: 80 }}
              barCategoryGap={12}
              aria-label="Horizontal bar chart showing users by tenant"
            >
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis
                type="number"
                tick={{ fontSize: 12, fill: t.axisTick }}
                allowDecimals={false}
                label={{
                  value: "Users",
                  position: "insideBottomRight",
                  offset: -4,
                  fill: t.axisTick,
                  fontSize: 12,
                }}
              />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: t.axisTick }} width={80} />
              <Tooltip
                content={<CustomTooltip />}
                wrapperStyle={{ outline: "none" }}
                contentStyle={{
                  background: "transparent",
                  border: "none",
                  boxShadow: "none",
                }}
                cursor={{ fill: "transparent" }}
              />
              <Legend
                verticalAlign="top"
                height={24}
                wrapperStyle={{ fontSize: 12, color: t.legend.text }}
                payload={[{ id: "Users", value: "Users", type: "square", color: primary }]}
              />
              <Bar
                dataKey="user_count"
                name="Users"
                fill={primary}
                stroke={primaryDark}
                radius={[4, 4, 4, 4]}
                onClick={(d) => {
                  if (onBarClick && d && d.activePayload && d.activePayload[0]?.payload) {
                    onBarClick(d.activePayload[0].payload);
                  }
                }}
              >
                <LabelList dataKey="user_count" content={valueLabel} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

UsersByTenantChart.propTypes = {
  data: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string,
      value: PropTypes.number,
      tenant_id: PropTypes.string,
    })
  ),
  onBarClick: PropTypes.func,
};
