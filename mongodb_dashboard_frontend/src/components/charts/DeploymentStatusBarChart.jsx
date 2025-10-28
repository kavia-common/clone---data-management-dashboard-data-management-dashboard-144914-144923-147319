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
import { formatStatusLabel } from "../../utils/formatStatusLabel";
import { getStatusColor } from "../../utils/statusColors";

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
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{formatStatusLabel(dp.status || label)}</div>
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
      id: r.status, // keep raw status as id for mapping/interaction
      value: formatStatusLabel(r.status), // display formatted label
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
                tickFormatter={(value) => formatStatusLabel(value)}
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
