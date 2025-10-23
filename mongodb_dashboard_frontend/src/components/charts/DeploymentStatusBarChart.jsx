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
 * Validate and normalize input data to ensure exactly three statuses in a stable order.
 */
function validateData(data) {
  const source = Array.isArray(data) ? data : [];
  const map = new Map(source.map((d) => [String(d?.status), Number(d?.count || 0)]));
  const statuses = ["Processing", "Success", "Failed"];
  return statuses.map((s) => ({ status: s, count: isFinite(map.get(s)) ? Number(map.get(s)) : 0 }));
}

/**
 * PUBLIC_INTERFACE
 * DeploymentStatusBarChart
 * A themed, accessible bar chart showing counts of deployments by status.
 *
 * Props:
 * - title?: string
 * - subtitle?: string
 * - data?: Array<{ status: 'Processing'|'Success'|'Failed', count: number }>
 * - loading?: boolean
 * - error?: string
 * - height?: number
 * - onBarClick?: (datum) => void
 */
export default function DeploymentStatusBarChart({
  title = "Deployments by Status",
  subtitle = "Counts across Processing, Success and Failed",
  data = [],
  loading = false,
  error = "",
  height = 320,
  onBarClick,
}) {
  const t = getChartTheme();
  const oc = getOceanColors();
  const auth = useAuth();

  // Apply per-bar colors based on status
  const rows = useMemo(() => {
    return validateData(data).map((d) => {
      let fill = oc.primary; // default to Processing
      if (d.status === "Success") fill = oc.success || oc.secondary;
      if (d.status === "Failed") fill = oc.error;
      return { ...d, fill };
    });
  }, [data, oc]);

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

  return (
    <Card title={title} subtitle={subtitle} className="block-full">
      {loading ? (
        <LoadingState message="Loading deployment status..." height={height} />
      ) : error ? (
        <ErrorState message={error} />
      ) : (
        <div role="region" aria-label="Deployment status bar chart" style={{ width: "100%", height }}>
          {rows.length === 0 ? (
            <div className="screen-center" style={{ height }}>No data</div>
          ) : (
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
                  payload={[
                    { id: "Processing", value: "Processing", type: "square", color: oc.primary },
                    { id: "Success", value: "Success", type: "square", color: oc.success || oc.secondary },
                    { id: "Failed", value: "Failed", type: "square", color: oc.error },
                  ]}
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
          )}
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
      status: PropTypes.oneOf(["Processing", "Success", "Failed"]).isRequired,
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
  subtitle: "Counts across Processing, Success and Failed",
  data: [],
  loading: false,
  error: "",
  height: 320,
  onBarClick: undefined,
};
