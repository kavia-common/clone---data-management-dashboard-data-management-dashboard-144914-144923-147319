import React, { useEffect, useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { fetchNewUsersOverTime } from "../../api/usersAnalyticsNewOverTime";

/**
 * PUBLIC_INTERFACE
 * A chart component that renders "New Users Over Time" with a granularity selector.
 * Fetches data from /api/analytics/users/new-over-time?granularity=day|week|month
 */
const UsersOverTimeChart = () => {
  const [granularity, setGranularity] = useState("day");
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Theme colors - Ocean Professional
  const primary = "#2563EB"; // line/area primary
  const accent = "#F59E0B"; // accent for tooltip/controls
  const gridColor = "rgba(17, 24, 39, 0.06)"; // subtle grid
  const surface = "#ffffff";
  const text = "#111827";

  const loadData = async (g) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchNewUsersOverTime(g);
      const items = res?.items || [];
      // Normalize to recharts-friendly format
      const normalized = items.map((d) => ({
        date: d.date, // Expected format YYYY-MM-DD (or period label)
        total: Number(d.total ?? 0),
      }));
      setData(normalized);
    } catch (e) {
      setError(e.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // initial load and when granularity changes
    loadData(granularity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity]);

  const tooltipFormatter = useMemo(
    () => ({
      // display value and label
      formatter: (value) => [`${value}`, "New Users"],
      labelFormatter: (label) => `${label}`,
    }),
    []
  );

  return (
    <div
      style={{
        background: surface,
        borderRadius: 12,
        boxShadow:
          "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(37,99,235,0.05)",
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
            New Users Over Time
          </h3>
          <p
            style={{
              margin: "4px 0 0 0",
              color: "#6B7280",
              fontSize: 12,
            }}
          >
            Track newly registered users aggregated by selected granularity.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {["day", "week", "month"].map((g) => {
            const active = granularity === g;
            return (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: `1px solid ${active ? primary : "rgba(17,24,39,0.1)"}`,
                  background: active ? primary : "#F9FAFB",
                  color: active ? "#fff" : "#111827",
                  fontSize: 12,
                  cursor: "pointer",
                  transition: "all 160ms ease",
                }}
                aria-pressed={active}
              >
                {g[0].toUpperCase() + g.slice(1)}
              </button>
            );
          })}
        </div>
      </div>

      {loading && (
        <div
          style={{
            width: "100%",
            minHeight: 240,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#6B7280",
            fontSize: 14,
          }}
        >
          Loading chart...
        </div>
      )}

      {error && !loading && (
        <div
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
          role="alert"
        >
          {error}
        </div>
      )}

      {!loading && !error && (
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
                formatter={tooltipFormatter.formatter}
                labelFormatter={tooltipFormatter.labelFormatter}
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
      )}
    </div>
  );
};

export default UsersOverTimeChart;
