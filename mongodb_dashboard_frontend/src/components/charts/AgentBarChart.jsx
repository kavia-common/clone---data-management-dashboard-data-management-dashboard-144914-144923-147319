import React, { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
  LabelList,
} from "recharts";
import { listLlmCosts } from "../../api/client";
import { getChartTheme } from "./chartTheme";
import { getOceanTheme } from "../../theme/oceanTheme";

/**
// ============================================================================
// REQUIREMENT TRACEABILITY
// ============================================================================
// Requirement ID: REQ-FE-AGENT-BAR-CHART
// User Story: As a dashboard user, I want to view a bar chart grouped by agent name so I can understand agent-level activity.
// Acceptance Criteria:
// - A new chart component exists that renders a bar chart grouped by agent name.
// - Accessible as separate view/section without modifying existing charts.
// - Data is grouped correctly; metrics per agent are shown; clear axes labels.
// - Loading, empty, and error states handled.
// - Ocean Professional theme and responsiveness.
// - Unit tests scaffolded and basic tests provided.
// GxP Impact: NO - Read-only visualization; no data mutation.
// Risk Level: LOW
// Validation Protocol: VP-FE-AGENT-BAR-CHART (visual verification + unit tests)
// ============================================================================

/**
 * PUBLIC_INTERFACE
 * AgentBarChart
 * Renders a responsive bar chart grouped by agent name using LLM cost records.
 *
 * Purpose:
 * - Fetches raw LLM cost items and aggregates them by agent_name.
 * - Supports "count" metric (number of records) and "total_cost" (sum).
 *
 * GxP Critical: No (read-only visualization)
 *
 * Props:
 * - defaultMetric?: 'count' | 'total_cost' (default 'count')
 * - defaultTopN?: number (default 10) - maximum number of agents to display
 * - height?: number (default 320) - chart height
 *
 * Returns:
 * - A chart region rendering statefully; includes loading, error, and empty states.
 *
 * Throws:
 * - No thrown errors; component catches and displays user-friendly messages.
 *
 * Audit:
 * - Logs minimal READ interaction to console (non-PII) with timestamp when legend toggled (for demo).
 */
export default function AgentBarChart({
  defaultMetric = "count",
  defaultTopN = 10,
  height = 320,
}) {
  // Validation controls: sanitize defaults
  const initialMetric =
    defaultMetric === "total_cost" ? "total_cost" : "count";
  const initialTopN =
    Number.isFinite(defaultTopN) && defaultTopN > 0 ? Math.min(defaultTopN, 50) : 10;

  const [metric, setMetric] = useState(initialMetric);
  const [topN, setTopN] = useState(initialTopN);
  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // Fetch raw records from backend; we prefer raw array shape (no pagination) for simplicity
  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setErr("");
      try {
        const res = await listLlmCosts({});
        const items = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : [];
        if (!mounted) return;
        setRaw(items);
      } catch (e) {
        if (!mounted) return;
        setErr(e?.message || "Failed to load agent metrics.");
        setRaw([]);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  // PUBLIC_INTERFACE
  // aggregateByAgent: exposed for testability via static property at bottom
  function aggregateByAgent(records, mode) {
    const source = Array.isArray(records) ? records : [];
    const m = (mode === "total_cost") ? "total_cost" : "count";
    const map = new Map();
    for (const r of source) {
      const key = (r && r.agent_name ? String(r.agent_name) : "Unknown") || "Unknown";
      if (!map.has(key)) map.set(key, 0);
      if (m === "count") {
        map.set(key, map.get(key) + 1);
      } else {
        const val = Number(r?.total_cost ?? 0);
        map.set(key, map.get(key) + (Number.isFinite(val) ? val : 0));
      }
    }
    const rows = Array.from(map.entries()).map(([agent_name, value]) => ({
      agent_name,
      value: m === "count" ? Number(value) : Number(value),
    }));
    // Sort desc by value
    rows.sort((a, b) => b.value - a.value);
    return rows;
  }

  const rows = useMemo(() => {
    const agg = aggregateByAgent(raw, metric);
    const n = Math.max(1, Math.min(50, Number(topN) || 10));
    return agg.slice(0, n);
  }, [raw, metric, topN]);

  const t = getChartTheme();
  const theme = getOceanTheme();

  const gridStroke = t.grid;
  const axisTick = t.axisTick;
  const barColor = theme.colors.primary;
  const barStroke = "#1E40AF"; // darker variant of primary
  const numberFormatter = (v) => {
    if (metric === "count") return Number(v).toFixed(0);
    const num = Number(v);
    if (Math.abs(num) >= 1000) return `$${num.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    return `$${num.toFixed(2)}`;
  };

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
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{String(label || d?.agent_name)}</div>
          <div>
            {metric === "count" ? "Records: " : "Total cost: "}
            {metric === "count" ? d?.value : numberFormatter(d?.value)}
          </div>
        </div>
      );
    }
    return null;
  };

  // Value labels above bars
  const ValueLabel = (props) => {
    const { x, y, width, value } = props;
    const label = metric === "count" ? String(value) : numberFormatter(value);
    const textX = (x || 0) + (width || 0) / 2;
    const textY = (y || 0) - 6;
    return (
      <text
        x={textX}
        y={textY}
        fill={theme.colors.text}
        fontSize={11}
        textAnchor="middle"
        aria-hidden="true"
      >
        {label}
      </text>
    );
  };

  function onMetricChange(next) {
    const v = String(next) === "total_cost" ? "total_cost" : "count";
    setMetric(v);
  }

  function onTopNChange(e) {
    const rawVal = e?.target?.value;
    const n = Number(rawVal);
    if (!Number.isFinite(n)) {
      // basic input validation - ignore non-numeric updates
      return;
    }
    const clamped = Math.max(1, Math.min(50, Math.floor(n)));
    setTopN(clamped);
  }

  function auditLogInteraction(type, payload) {
    try {
      const entry = {
        ts: new Date().toISOString(),
        action: "READ",
        component: "AgentBarChart",
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
    <section
      role="region"
      aria-label="Agent-wise Overview"
      aria-labelledby="agent-wise-overview-title"
      style={{
        background: theme.colors.surface,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: 12,
        boxShadow: theme.elevation.sm,
        padding: 12,
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <h3 id="agent-wise-overview-title" style={{ margin: 0, fontSize: 16, fontWeight: 700, color: theme.colors.text }}>
          Agent-wise Overview
        </h3>
        <div style={{ flex: 1 }} />
        {/* Metric selector */}
        <label
          style={{
            fontSize: 12,
            color: theme.colors.muted,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          Metric:
          <select
            aria-label="Select agent metric"
            value={metric}
            onChange={(e) => onMetricChange(e.target.value)}
            style={{
              padding: "6px 8px",
              borderRadius: 8,
              border: `1px solid ${theme.colors.border}`,
              background: theme.colors.surface,
              color: theme.colors.text,
            }}
          >
            <option value="count">Count</option>
            <option value="total_cost">Total cost</option>
          </select>
        </label>
        {/* Top N control */}
        <label
          style={{
            fontSize: 12,
            color: theme.colors.muted,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          Top N:
          <input
            aria-label="Top N agents to display"
            type="number"
            inputMode="numeric"
            min={1}
            max={50}
            value={topN}
            onChange={onTopNChange}
            style={{
              width: 72,
              padding: "6px 8px",
              borderRadius: 8,
              border: `1px solid ${theme.colors.border}`,
              background: theme.colors.surface,
              color: theme.colors.text,
            }}
          />
        </label>
      </header>

      <div style={{ width: "100%", height }}>
        {loading ? (
          <div
            className="skeleton"
            style={{ width: "100%", height: "100%", borderRadius: 12 }}
            aria-busy="true"
            aria-label="Loading agent chart"
          />
        ) : err ? (
          <div className="error" role="alert">
            {err}
          </div>
        ) : rows.length === 0 ? (
          <div className="screen-center" style={{ minHeight: height }} aria-label="No agent data">
            No agent data
          </div>
        ) : (
          <ResponsiveContainer>
            <BarChart
              data={rows}
              margin={{ top: 12, right: 24, bottom: 12, left: 12 }}
              aria-label="Bar chart of agents by selected metric"
            >
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis
                dataKey="agent_name"
                tick={{ fontSize: 12, fill: axisTick }}
                tickMargin={8}
                interval={0}
                angle={0}
                height={46}
                label={{
                  value: "Agent name",
                  position: "insideBottom",
                  offset: -2,
                  fill: axisTick,
                  fontSize: 12,
                }}
              />
              <YAxis
                tick={{ fontSize: 12, fill: axisTick }}
                allowDecimals={metric !== "count"}
                tickFormatter={(v) => (metric === "count" ? String(v) : numberFormatter(v))}
                width={80}
                label={{
                  value: metric === "count" ? "Count" : "Total cost (USD)",
                  angle: -90,
                  position: "insideLeft",
                  fill: axisTick,
                  fontSize: 12,
                }}
              />
              <Tooltip content={<CustomTooltip />} wrapperStyle={{ outline: "none" }} />
              <Legend
                verticalAlign="top"
                height={24}
                wrapperStyle={{ fontSize: 12, color: t.legend.text }}
                payload={[
                  {
                    id: metric,
                    value: metric === "count" ? "Count" : "Total cost",
                    type: "square",
                    color: barColor,
                  },
                ]}
                onClick={(p) => auditLogInteraction("legend-click", { id: p?.id, value: p?.value })}
              />
              <Bar
                dataKey="value"
                name={metric === "count" ? "Count" : "Total cost"}
                fill={barColor}
                stroke={barStroke}
                radius={[6, 6, 0, 0]}
              >
                <LabelList dataKey="value" content={<ValueLabel />} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

AgentBarChart.propTypes = {
  defaultMetric: PropTypes.oneOf(["count", "total_cost"]),
  defaultTopN: PropTypes.number,
  height: PropTypes.number,
};

// Expose aggregator for tests
AgentBarChart.__private__ = {
  // PUBLIC_INTERFACE
  aggregateByAgent(records, mode) {
    const map = new Map();
    const m = (mode === "total_cost") ? "total_cost" : "count";
    for (const r of Array.isArray(records) ? records : []) {
      const key = (r && r.agent_name ? String(r.agent_name) : "Unknown") || "Unknown";
      if (!map.has(key)) map.set(key, 0);
      if (m === "count") map.set(key, map.get(key) + 1);
      else {
        const v = Number(r?.total_cost ?? 0);
        map.set(key, map.get(key) + (Number.isFinite(v) ? v : 0));
      }
    }
    return Array.from(map.entries()).map(([agent_name, value]) => ({ agent_name, value }));
  },
};
