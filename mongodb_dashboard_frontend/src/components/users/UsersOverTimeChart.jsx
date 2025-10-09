import React from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

/**
 * PUBLIC_INTERFACE
 * UsersOverTimeChart renders a full-range series of new users over time (daily aggregation).
 * Props:
 * - data: Array<{ date: string (YYYY-MM-DD), total: number }>
 * - loading: boolean
 * - error: any
 */
export default function UsersOverTimeChart({
  data = [],
  loading = false,
  error = null,
}) {
  // Theme colors - Ocean Professional
  const primary = "#2563EB"; // line/area primary
  const accent = "#F59E0B"; // accent for tooltip
  const gridColor = "rgba(17, 24, 39, 0.06)"; // subtle grid
  const surface = "#ffffff";
  const text = "#111827";

  if (loading) {
    return (
      <div
        style={{
          width: "100%",
          minHeight: 240,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#6B7280",
          fontSize: 14,
          background: surface,
          borderRadius: 12,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(37,99,235,0.05)",
        }}
      >
        Loading chart...
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        style={{
          width: "100%",
          minHeight: 240,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#EF4444",
          background: "rgba(239,68,68,0.06)",
          border: "1px solid rgba(239,68,68,0.2)",
          borderRadius: 8,
          padding: 12,
          fontSize: 14,
        }}
      >
        {String(error)}
      </div>
    );
  }

  return (
    <div
      style={{
        background: surface,
        borderRadius: 12,
        boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(37,99,235,0.05)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          justifyContent: "space-between",
        }}
      >
        <div>
          <h3
            style={{
              margin: 0,
              color: text,
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            New Users Over Time – All Data
          </h3>
          <p
            style={{
              margin: "4px 0 0 0",
              color: "#6B7280",
              fontSize: 12,
            }}
          >
            Daily aggregation over full available history
          </p>
        </div>
      </div>

      <div style={{ width: "100%", height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorPrimary" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={primary} stopOpacity={0.36} />
                <stop offset="95%" stopColor={primary} stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis
              dataKey="date"
              tick={{ fill: "#6B7280", fontSize: 12 }}
              axisLine={{ stroke: gridColor }}
              tickLine={{ stroke: gridColor }}
            />
            <YAxis
              tick={{ fill: "#6B7280", fontSize: 12 }}
              axisLine={{ stroke: gridColor }}
              tickLine={{ stroke: gridColor }}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 8,
                borderColor: "rgba(17,24,39,0.1)",
                boxShadow: "0 4px 18px rgba(0,0,0,0.08)",
              }}
              labelStyle={{ color: text }}
              itemStyle={{ color: accent }}
              formatter={(value) => [`${value}`, "New Users"]}
              labelFormatter={(label) => `${label}`}
            />
            <Area
              type="monotone"
              dataKey="total"
              name="New Users"
              stroke={primary}
              fillOpacity={1}
              fill="url(#colorPrimary)"
              strokeWidth={2}
              dot={{ r: 2, stroke: primary }}
              activeDot={{ r: 4, strokeWidth: 0, fill: accent }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
