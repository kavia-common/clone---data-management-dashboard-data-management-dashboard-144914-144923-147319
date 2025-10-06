import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";

/**
 * PUBLIC_INTERFACE
 * SessionsByOrganization
 * Bar chart for session counts grouped by organization name.
 *
 * Props:
 * - data: Array<{ organization_name: string, session_count: number }>
 * - loading?: boolean
 * - error?: string
 * - onFilterChange?: (filter: any) => void (reserved for future use)
 */
export default function SessionsByOrganization({
  data = [],
  loading = false,
  error = "",
  onFilterChange, // eslint-disable-line no-unused-vars
}) {
  /** This component renders a responsive bar chart: X=organization_name, Y=session_count. */

  const brandBlue = "#2563EB";
  const brandBlueDarker = "#1E40AF"; // hover/active stroke
  const gridStroke = "rgba(0,0,0,0.08)";

  function truncateLabel(label, max = 14) {
    const s = String(label ?? "");
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const item = payload[0];
      const count = item?.value ?? 0;
      const fullLabel = String(label ?? "Unknown");
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
      aria-label="Bar chart of sessions by organization"
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
            data={data}
            margin={{ top: 8, right: 24, bottom: 0, left: 0 }}
            barCategoryGap={18}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis
              dataKey="organization_name"
              tick={{ fontSize: 12 }}
              minTickGap={10}
              interval="preserveStartEnd"
              tickFormatter={(v) => truncateLabel(v, 14)}
            />
            <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              verticalAlign="top"
              height={24}
              wrapperStyle={{ fontSize: 12 }}
            />
            <Bar
              dataKey="session_count"
              name="Sessions"
              fill={brandBlue}
              stroke={brandBlueDarker}
              aria-label="Sessions count"
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
