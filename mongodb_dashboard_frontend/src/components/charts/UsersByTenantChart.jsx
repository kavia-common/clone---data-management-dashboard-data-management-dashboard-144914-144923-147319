import React, { useEffect, useMemo, useState } from "react";
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
import { getTenantUsersSummary } from "../../api/usersAnalytics";
import { getChartTheme } from "./chartTheme";

/**
 * PUBLIC_INTERFACE
 * UsersByTenantChart
 * A reusable, themed horizontal bar chart that visualizes "Users by Tenant".
 *
 * Props:
 * - title?: string - Panel title
 * - subtitle?: string - Optional subtitle
 * - from?: string (ISO)
 * - to?: string (ISO)
 * - status?: string
 * - includeInactive?: boolean
 * - maxBars?: number - Limit number of bars (e.g., top 12)
 * - onBarClick?: (datum) => void
 */
export default function UsersByTenantChart({
  // Title/subtitle are intentionally ignored here to avoid duplicate headers.
  // They are kept in the props for backward compatibility with existing callers.
  title = "Users by Tenant", // deprecated in this component (use page-level Card header)
  subtitle = "Distinct active users by tenant", // deprecated in this component
  from,
  to,
  status = "completed|active",
  includeInactive = false,
  maxBars = 12,
  onBarClick,
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Fetch data
  useEffect(() => {
    let mounted = true;
    async function run() {
      setLoading(true);
      setErr("");
      try {
        const res = await getTenantUsersSummary();
        if (!mounted) return;
        const items = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : [];
        // Sort desc by count
        const sorted = [...items].sort(
          (a, b) => (b?.user_count || 0) - (a?.user_count || 0)
        );
        setRows(sorted.slice(0, maxBars));
      } catch (e) {
        if (!mounted) return;
        setRows([]);
        setErr(e?.message || "Failed to load Users by Tenant");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    run();
    return () => {
      mounted = false;
    };
  }, [from, to, status, includeInactive, maxBars]);

  const totalUsers = useMemo(
    () => rows.reduce((sum, r) => sum + Number(r?.user_count || 0), 0),
    [rows]
  );

  const data = useMemo(
    () =>
      rows.map((r) => {
        const name =
          (r?.tenant_name && String(r.tenant_name).trim()) ||
          r?.tenant_id ||
          "Unknown";
        const count = Number(r?.user_count || 0);
        const pct = totalUsers > 0 ? (count / totalUsers) * 100 : 0;
        return {
          name,
          tenant_id: r?.tenant_id || name,
          user_count: count,
          percent: pct,
        };
      }),
    [rows, totalUsers]
  );

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

  // Value labels for each bar
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

  // Render chart visualization only; outer page provides Card header and layout.
  return (
    <div role="region" aria-label="Users by Tenant chart" style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <span
          style={{
            background: "color-mix(in oklab, var(--color-accent) 12%, transparent)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-primary)",
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
        {loading ? (
          <div aria-busy="true">
            <div className="skeleton" style={{ height: 16, width: "35%", marginBottom: 8 }} />
            <div className="skeleton" style={{ height: 12, width: "55%", marginBottom: 8 }} />
            <div className="skeleton" style={{ height: 12, width: "48%", marginBottom: 8 }} />
            <div className="skeleton" style={{ height: 12, width: "62%", marginBottom: 8 }} />
            <div className="skeleton" style={{ height: 12, width: "40%", marginBottom: 8 }} />
          </div>
        ) : err ? (
          <div className="error" role="alert">
            {err}
          </div>
        ) : data.length === 0 ? (
          <div className="screen-center">No users found</div>
        ) : (
          <ResponsiveContainer>
            <BarChart
              data={data}
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
  title: PropTypes.string,
  subtitle: PropTypes.string,
  from: PropTypes.string,
  to: PropTypes.string,
  status: PropTypes.string,
  includeInactive: PropTypes.bool,
  maxBars: PropTypes.number,
  onBarClick: PropTypes.func,
};
