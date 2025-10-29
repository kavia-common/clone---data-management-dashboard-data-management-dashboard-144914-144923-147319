import React, { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { getApiClient } from "../../api";
import { getChartTheme, withAlpha } from "./chartTheme";

/**
 * PUBLIC_INTERFACE
 * ActiveUsersTrendChart
 * Renders a responsive line chart for active users trend over time.
 *
 * Props:
 * - from?: string (ISO)
 * - to?: string (ISO)
 * - granularity?: 'day' | 'week' (default 'day')
 * - status?: string (default 'completed|active')
 * - tenant_id?: string (optional scope)
 */
export default function ActiveUsersTrendChart({
  from,
  to,
  granularity = "day",
  status = "completed|active",
  tenant_id,
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let mounted = true;
    async function run() {
      setLoading(true);
      setErr("");
      try {
        const api = getApiClient();
        const params = {};
        if (from) params.from = from;
        if (to) params.to = to;
        if (granularity) params.granularity = granularity;
        if (status) params.status = status;
        if (tenant_id) params.tenant_id = tenant_id;
        const res = await api.get("/users/active-trend", { params });
        if (!mounted) return;
        const data = res?.data;
        const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
        // console debug to verify backend payload for troubleshooting empty states
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.debug("[ActiveUsersTrendChart] items received:", items.length);
        }
        // Ensure sorted by date asc and coerce shapes
        const sorted = [...items]
          .map((it) => ({
            date: String(it?.date || ""),
            total: Number(isFinite(it?.total) ? it.total : 0),
          }))
          .sort((a, b) => String(a.date).localeCompare(String(b.date)));
        setRows(sorted);
      } catch (e) {
        if (!mounted) return;
        setErr(e?.message || "Failed to load Active Users Trend");
        setRows([]);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    run();
    return () => {
      mounted = false;
    };
  }, [from, to, granularity, status, tenant_id]);

  const data = useMemo(
    () =>
      rows.map((r) => ({
        date: r?.date || "",
        active_users: Number(r?.total || 0),
      })),
    [rows]
  );

  const t = getChartTheme();
  const primary = t.primary;
  const primaryDark = t.primaryActive;
  const gridStroke = t.grid;
  const anim = t.animation; // centralized animation settings

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const d = payload[0]?.payload || {};
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
          <div>Active users: {d?.active_users ?? 0}</div>
        </div>
      );
    }
    return null;
  };

  return (
    <div role="region" aria-label="Active users trend chart" style={{ width: "100%" }}>
      <div style={{ height: 280 }}>
        {loading ? (
          <div aria-busy="true">
            <div className="skeleton" style={{ height: 14, width: "35%", marginBottom: 8 }} />
            <div className="skeleton" style={{ height: 12, width: "65%", marginBottom: 8 }} />
            <div className="skeleton" style={{ height: 12, width: "55%", marginBottom: 8 }} />
          </div>
        ) : err ? (
          <div className="error" role="alert">
            {err}
          </div>
        ) : data.length === 0 ? (
          <div className="screen-center">No data</div>
        ) : (
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12, fill: t.axisTick }}
                tickMargin={8}
                minTickGap={28}
                label={{
                  value: granularity === "week" ? "Week start" : "Date",
                  position: "insideBottomRight",
                  offset: -4,
                  fill: t.axisTick,
                  fontSize: 12,
                }}
              />
              <YAxis
                tick={{ fontSize: 12, fill: t.axisTick }}
                allowDecimals={false}
                label={{
                  value: "Active users",
                  angle: -90,
                  position: "insideLeft",
                  fill: t.axisTick,
                  fontSize: 12,
                }}
              />
              <Tooltip
                content={<CustomTooltip />}
                wrapperStyle={{ outline: "none" }}
              />
              <Legend
                verticalAlign="top"
                height={24}
                wrapperStyle={{ fontSize: 12, color: t.legend.text }}
                payload={[{ id: "Active users", value: "Active users", type: "line", color: primary }]}
              />
              <Line
                type="monotone"
                dataKey="active_users"
                name="Active users"
                stroke={primary}
                strokeWidth={2}
                // Enable smooth animations on mount and on data changes
                isAnimationActive={Boolean(anim?.isActive)}
                animationBegin={anim?.begin ?? 0}
                animationDuration={anim?.duration ?? 450}
                animationEasing={anim?.easing ?? "ease-out"}
                dot={{ r: 2, stroke: primaryDark, strokeWidth: 1, fill: withAlpha(primary, 0.1) }}
                activeDot={{ r: 4, stroke: primaryDark, strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

ActiveUsersTrendChart.propTypes = {
  from: PropTypes.string,
  to: PropTypes.string,
  granularity: PropTypes.oneOf(["day", "week"]),
  status: PropTypes.string,
  tenant_id: PropTypes.string,
};
