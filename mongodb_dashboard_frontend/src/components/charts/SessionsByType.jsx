import React, { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { getChartTheme } from "./chartTheme";
import getOceanColors from "../../theme/colors";
import { getStatusColor } from "../../utils/statusColors";
import { formatStatusLabel } from "../../utils/formatStatusLabel";

/**
 * PUBLIC_INTERFACE
 * SessionsByType
 * Bar chart for session counts grouped by session type.
 *
 * Props:
 * - data: Array<{ session_type: string, session_count: number }>
 * - loading?: boolean
 * - error?: string
 * - onFilterChange?: (filter: any) => void (reserved for future use)
 */
export default function SessionsByType({
  data = [],
  loading = false,
  error = "",
  onFilterChange, // eslint-disable-line no-unused-vars
}) {
  /** This component renders a responsive bar chart: X=session_type, Y=session_count. */

  const t = getChartTheme();
  const oc = getOceanColors();
  const gridStroke = t.grid;

  const rows = useMemo(() => {
    const arr = Array.isArray(data) ? data : [];
    return arr.map((d) => {
      const session_type = String(d?.session_type ?? "Unknown");
      const session_count = Number(d?.session_count || 0);
      const fill = getStatusColor(session_type, oc);
      return { ...d, session_type, session_count, fill };
    });
  }, [data, oc]);

  function truncateLabel(label, max = 14) {
    const s = String(label ?? "");
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }

  const legendPayload = useMemo(() => {
    return rows.map((r) => ({
      id: r.session_type,              // keep raw key for mapping
      value: formatStatusLabel(r.session_type), // display formatted label
      type: "square",
      color: r.fill,
    }));
  }, [rows]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const dp = payload[0]?.payload || {};
      const count = Number(dp.session_count || payload[0]?.value || 0);
      const fullLabel = formatStatusLabel(dp.session_type || label || "Unknown");
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
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{fullLabel}</div>
          <div>Sessions: {count}</div>
        </div>
      );
    }
    return null;
  };

  return (
    <div
      style={{ width: "100%", height: 320 }}
      role="img"
      aria-label="Bar chart of sessions by type"
    >
      {loading ? (
        <div className="screen-center" aria-busy="true">
          Loading chart...
        </div>
      ) : error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : (Array.isArray(data) ? data.length : 0) === 0 ? (
        <div className="screen-center">No data</div>
      ) : (
        <ResponsiveContainer>
          <BarChart
            data={rows}
            margin={{ top: 8, right: 24, bottom: 0, left: 0 }}
            barCategoryGap={18}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis
              dataKey="session_type"
              tick={{ fontSize: 12, fill: t.axisTick }}
              minTickGap={10}
              interval="preserveStartEnd"
              tickFormatter={(v) => truncateLabel(formatStatusLabel(v), 14)}
            />
            <YAxis tick={{ fontSize: 12, fill: t.axisTick }} allowDecimals={false} />
            <Tooltip
              content={<CustomTooltip />}
              wrapperStyle={{ outline: "none" }}
            />
            <Legend
              verticalAlign="top"
              height={24}
              wrapperStyle={{ fontSize: 12, color: t.legend.text }}
              payload={legendPayload}
            />
            <Bar
              dataKey="session_count"
              name="Sessions"
              aria-label="Sessions count"
              radius={[4, 4, 0, 0]}
            >
              {rows.map((entry, idx) => (
                <Cell key={`cell-${idx}`} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
