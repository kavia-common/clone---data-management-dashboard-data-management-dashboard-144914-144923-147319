import React, { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  LabelList,
} from "recharts";
import { getReferralSources } from "../../api/usersAnalytics";
import { getChartTheme } from "../charts/chartTheme";

/**
 * PUBLIC_INTERFACE
 * TopReferralSourcesBarChart
 * A compact, responsive horizontal bar chart showing top referral sources with counts.
 *
 * Props:
 * - from?: string (ISO lower bound)
 * - to?: string (ISO upper bound)
 * - top?: number (limit number of sources; backend "limit")
 * - height?: number (chart area height; default 260)
 */
export default function TopReferralSourcesBarChart({
  top = 10,
  height = 260,
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
        const res = await getReferralSources({ limit: top });
        if (!mounted) return;
        const items = Array.isArray(res?.items) ? res.items : [];
        // Sort desc by count
        const sorted = [...items].sort(
          (a, b) => (b?.count || 0) - (a?.count || 0)
        );
        setRows(sorted.slice(0, typeof top === "number" ? top : 10));
      } catch (e) {
        if (!mounted) return;
        setRows([]);
        setErr(e?.message || "Failed to load Top Referral Sources");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    run();
    return () => {
      mounted = false;
    };
  }, [top]);

  const t = getChartTheme();
  const primary = t.primary;
  const primaryDark = t.primaryActive;
  const gridStroke = t.grid;

  const data = useMemo(
    () =>
      rows.map((r) => {
        const name = (r?.source && String(r.source).trim()) || "Unknown";
        const count = Number(r?.count || 0);
        return { name, count };
      }),
    [rows]
  );

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const d = payload[0]?.payload || {};
      const c = d?.count ?? 0;
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
          <div>Users: {c}</div>
        </div>
      );
    }
    return null;
  };

  // Render small value labels to the right of bars
  const valueLabel = (props) => {
    const { x, y, width, height: h, value } = props;
    const label = String(value);
    const padding = 6;
    const textX = (x || 0) + (width || 0) + padding;
    const textY = (y || 0) + (h || 0) / 2 + 3;
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

  // Truncate long Y-axis labels w/ title tooltip
  const TruncatedTick = ({ x, y, payload }) => {
    const full = String(payload?.value || "");
    const max = 20;
    const truncated = full.length > max ? `${full.slice(0, max - 1)}…` : full;
    return (
      <g transform={`translate(${x},${y})`}>
        <text
          x={0}
          y={0}
          dy={4}
          textAnchor="end"
          fill="var(--color-text-primary)"
          fontSize={12}
          title={full}
        >
          {truncated}
        </text>
      </g>
    );
  };

  return (
    <div role="region" aria-label="Top referral sources chart" style={{ width: "100%" }}>
      <div style={{ height }}>
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
          <div className="screen-center">No data</div>
        ) : (
          <ResponsiveContainer>
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 8, right: 40, bottom: 8, left: 100 }}
              barCategoryGap={10}
              aria-label="Horizontal bar chart showing top referral sources"
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
              <YAxis
                type="category"
                dataKey="name"
                width={100}
                tick={<TruncatedTick />}
              />
              <Tooltip
                content={<CustomTooltip />}
                contentStyle={{
                  background: "transparent",
                  border: "none",
                  boxShadow: "none",
                }}
                cursor={{ fill: "transparent" }}
              />
              <Bar
                dataKey="count"
                name="Users"
                fill={primary}
                stroke={primaryDark}
                radius={[4, 4, 4, 4]}
              >
                <LabelList dataKey="count" content={valueLabel} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

TopReferralSourcesBarChart.propTypes = {
  top: PropTypes.number,
  height: PropTypes.number,
};
