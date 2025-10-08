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
  title = "Users by Tenant",
  subtitle = "Distinct active users by tenant",
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
        const res = await getTenantUsersSummary({
          from,
          to,
          status,
          includeInactive,
        });
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

  const primary = "#2563EB";
  const primaryDark = "#1E40AF";
  const secondary = "#F59E0B";
  const gridStroke = "rgba(0,0,0,0.08)";

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
            background: "#fff",
            border: "1px solid #E2E8F0",
            borderRadius: 8,
            padding: "8px 10px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
            color: "#0F172A",
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
        fill="#111827"
        fontSize={12}
        textAnchor="start"
        aria-hidden="true"
      >
        {label}
      </text>
    );
  };

  return (
    <section
      className="card"
      role="region"
      aria-label="Users by Tenant chart"
      style={{ width: "100%" }}
    >
      <header className="card-header" style={{ paddingBottom: 8 }}>
        <div>
          <h3 className="card-title">{title}</h3>
          {subtitle && <div className="card-subtitle">{subtitle}</div>}
        </div>
        <div className="card-actions" aria-hidden="true">
          <span
            style={{
              background: "linear-gradient(90deg, rgba(37,99,235,0.08), rgba(245,158,11,0.08))",
              border: "1px solid #E5E7EB",
              color: "#111827",
              fontSize: 12,
              padding: "6px 8px",
              borderRadius: 999,
            }}
            title={`Total users summed across shown tenants: ${totalUsers}`}
          >
            Total: {totalUsers}
          </span>
        </div>
      </header>

      <div className="card-content" style={{ height: 360 }}>
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
                tick={{ fontSize: 12 }}
                allowDecimals={false}
                label={{
                  value: "Users",
                  position: "insideBottomRight",
                  offset: -4,
                  fill: "#6B7280",
                  fontSize: 12,
                }}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 12 }}
                width={80}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                verticalAlign="top"
                height={24}
                wrapperStyle={{ fontSize: 12 }}
                payload={[
                  { id: "Users", value: "Users", type: "square", color: primary },
                ]}
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
    </section>
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
