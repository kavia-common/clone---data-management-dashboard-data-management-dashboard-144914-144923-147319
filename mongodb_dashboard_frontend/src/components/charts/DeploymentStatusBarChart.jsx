import React, { useMemo } from "react";
import PropTypes from "prop-types";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  LabelList,
  Legend,
  Cell,
} from "recharts";
import { getChartTheme } from "./chartTheme";
import getOceanColors from "../../theme/colors";
import LoadingState from "../common/LoadingState.jsx";
import ErrorState from "../common/ErrorState.jsx";
import Card from "../ui/Card.jsx";
import { useAuth } from "../../context/AuthContext";

/**
 * INTERNAL
 * Deterministic color generator for unknown statuses: hash -> HSL.
 * Produces pastel-ish colors that are distinct enough for legends.
 */
function colorFromString(key, { saturation = 55, lightness = 55 } = {}) {
  const str = String(key || "");
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    // simple 32-bit hash
    // eslint-disable-next-line no-bitwise
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    // eslint-disable-next-line no-bitwise
    hash |= 0;
  }
  // eslint-disable-next-line no-bitwise
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/**
 * INTERNAL
 * Map a status to a theme-based color where possible; otherwise generate a deterministic color.
 */
function getStatusColor(status, oc) {
  const s = String(status || "").toLowerCase().trim();
  if (["processing", "in_progress", "in-progress", "pending", "queued"].includes(s)) {
    return oc.primary;
  }
  if (["success", "succeeded", "ok", "completed", "complete", "done"].includes(s)) {
    return oc.success || oc.secondary;
  }
  if (["failed", "error", "failure"].includes(s)) {
    return oc.error;
  }
  if (s === "unknown" || s === "" || s === "null" || s === "undefined") {
    // mildly toned secondary for unknown
    return "rgba(245, 158, 11, 0.6)"; // soft amber
  }
  return colorFromString(s);
}

/**
 * PUBLIC_INTERFACE
 * DeploymentStatusBarChart
 * A themed, accessible bar chart showing counts of deployments by status (dynamic).
 *
 * Props:
 * - title?: string
 * - subtitle?: string
 * - data?: Array<{ status: string, count: number }>
 * - loading?: boolean
 * - error?: string
 * - height?: number
 * - onBarClick?: (datum) => void
 */
export default function DeploymentStatusBarChart({
  title = "Deployments by Status",
  subtitle = "Counts by status (dynamic)",
  data = [],
  loading = false,
  error = "",
  height = 320,
  onBarClick,
}) {
  const t = getChartTheme();
  const oc = getOceanColors();
  const auth = useAuth();

  const rows = useMemo(() => {
    const arr = Array.isArray(data) ? data : [];
    // De-duplicate statuses and coerce numeric counts
    return arr.map((d) => {
      const status = String(d?.status ?? "Unknown");
      const count = Number(d?.count || 0);
      const fill = getStatusColor(status, oc);
      return { status, count, fill };
    });
  }, [data, oc]);

  const hasData = rows.some((r) => r.count > 0);
  const gridStroke = t.grid;
  const axisTick = t.axisTick;

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const dp = payload[0]?.payload || {};
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
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{String(dp.status || label)}</div>
          <div>Count: {Number(dp.count || 0)}</div>
        </div>
      );
    }
    return null;
  };

  // Value labels shown above bars
  const ValueLabel = (props) => {
    const { x, y, width, value } = props;
    const label = String(isFinite(value) ? value : 0);
    const textX = (x || 0) + (width || 0) / 2;
    const textY = (y || 0) - 6;
    return (
      <text
        x={textX}
        y={textY}
        fill="var(--color-text-primary)"
        fontSize={12}
        textAnchor="middle"
        aria-hidden="true"
      >
        {label}
      </text>
    );
  };

  // Basic audit console logging for user interactions
  function auditLogInteraction(type, payload) {
    try {
      const entry = {
        ts: new Date().toISOString(),
        userTokenPresent: Boolean(auth?.token),
        action: "READ",
        component: "DeploymentStatusBarChart",
        interaction: type,
        data: payload || null,
      };
      // eslint-disable-next-line no-console
      console.info("[AUDIT] UI Interaction", entry);
    } catch {
      // no-op
    }
  }

  // Dynamic legend payload
  const legendPayload = useMemo(() => {
    return rows.map((r) => ({
      id: r.status,
      value: r.status,
      type: "square",
      color: r.fill,
    }));
  }, [rows]);

  return (
    <Card title={title} subtitle={subtitle} className="block-full">
      {loading ? (
        <LoadingState message="Loading deployment status..." height={height} />
      ) : error ? (
        <ErrorState message={error} />
      ) : !hasData ? (
        <div className="screen-center" style={{ height }}>No data</div>
      ) : (
        <div role="region" aria-label="Deployment status bar chart" style={{ width: "100%", height }}>
          <ResponsiveContainer>
            <BarChart
              data={rows}
              margin={{ top: 12, right: 24, bottom: 12, left: 12 }}
              barCategoryGap={24}
              onClick={(e) => {
                if (e && e.activePayload && e.activePayload[0]?.payload) {
                  const datum = e.activePayload[0].payload;
                  auditLogInteraction("bar-click", { status: datum.status, count: datum.count });
                  if (onBarClick) onBarClick(datum);
                }
              }}
              aria-label="Bar chart of deployments by status"
            >
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis
                dataKey="status"
                tick={{ fontSize: 12, fill: axisTick }}
                tickMargin={8}
              />
              <YAxis
                tick={{ fontSize: 12, fill: axisTick }}
                allowDecimals={false}
              />
              <Tooltip content={<CustomTooltip />} wrapperStyle={{ outline: "none" }} />
              <Legend
                verticalAlign="top"
                height={24}
                wrapperStyle={{ fontSize: 12, color: t.legend.text }}
                payload={legendPayload}
                onClick={(p) => auditLogInteraction("legend-click", { id: p?.id, value: p?.value })}
              />
              <Bar dataKey="count" name="Deployments" isAnimationActive radius={[4, 4, 0, 0]}>
                <LabelList dataKey="count" content={<ValueLabel />} />
                {/* Color each bar individually using 'fill' from datum */}
                {rows.map((entry, idx) => (
                  <Cell key={`cell-${idx}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

DeploymentStatusBarChart.propTypes = {
  title: PropTypes.string,
  subtitle: PropTypes.string,
  data: PropTypes.arrayOf(
    PropTypes.shape({
      status: PropTypes.string.isRequired,
      count: PropTypes.number.isRequired,
    })
  ),
  loading: PropTypes.bool,
  error: PropTypes.string,
  height: PropTypes.number,
  onBarClick: PropTypes.func,
};

DeploymentStatusBarChart.defaultProps = {
  title: "Deployments by Status",
  subtitle: "Counts by status (dynamic)",
  data: [],
  loading: false,
  error: "",
  height: 320,
  onBarClick: undefined,
};
