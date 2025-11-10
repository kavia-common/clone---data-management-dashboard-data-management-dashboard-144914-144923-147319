import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { shapeAgentGroupedSeries } from "../../utils/costs/shapeAgentGroupedSeries";
import { getOceanTheme, getCategoryColorMap } from "../../theme/oceanTheme";

/**
 * PUBLIC_INTERFACE
 * CostsGroupedBarChart (JS)
 * A responsive grouped bar chart that displays total_cost per agent_name,
 * grouped by environment or cost_category (side-by-side bars per agent).
 *
 * Usage:
 * <CostsGroupedBarChart
 *   records={[
 *     { agent_name: "Agent A", environment: "prod", cost_category: "compute", total_cost: 4.2 },
 *     { agent_name: "Agent B", environment: "prod", cost_category: "compute", total_cost: 2.1 },
 *     { agent_name: "Agent A", environment: "staging", cost_category: "egress", total_cost: 1.0 },
 *   ]}
 *   groupBy="environment" // "environment" | "cost_category"
 *   height={320}
 * />
 *
 * Accessibility:
 * - Renders as a region with an aria-label (title used by default)
 * - Includes descriptive tooltips and legend text
 *
 * Notes:
 * - Zero-fills missing agent/category combinations so each agent displays the same category bars.
 * - Uses Ocean Professional theme palette for consistent visuals.
 */
export default function CostsGroupedBarChart({
  records = [],
  groupBy = "environment",
  categories,
  colorMap,
  height = 320,
  loading = false,
  error,
  title = "Agent Costs (grouped)",
  showSelector = false,
  onGroupByChange,
  ariaLabel,
}) {
  // Lightweight runtime input validation with warnings (no prop-types dependency).
  if (process.env.NODE_ENV !== "production") {
    if (groupBy !== "environment" && groupBy !== "cost_category") {
      // eslint-disable-next-line no-console
      console.warn('CostsGroupedBarChart: groupBy must be "environment" or "cost_category". Defaulting to "environment".');
      groupBy = "environment";
    }
  }

  const safeRecords = Array.isArray(records)
    ? records.map((r) => ({
        agent_name: r?.agent_name ?? "Unknown",
        environment: r?.environment ?? null,
        cost_category: r?.cost_category ?? null,
        total_cost: Number(r?.total_cost ?? 0),
      }))
    : [];

  const effectiveRecords = safeRecords;

  const shaped = React.useMemo(() => {
    const base = shapeAgentGroupedSeries(effectiveRecords, groupBy);
    let cats = base.categories.slice();
    if (Array.isArray(categories) && categories.length) {
      const set = new Set(categories);
      base.categories.forEach((c) => set.add(c));
      cats = Array.from(set);
    }
    return {
      ...base,
      categories: cats,
      data: base.data.map((row) => {
        const out = { ...row };
        cats.forEach((c) => {
          if (typeof out[c] !== "number") out[c] = 0;
        });
        return out;
      }),
    };
  }, [effectiveRecords, groupBy, categories]);

  const theme = getOceanTheme();
  const gridStroke = theme.colors.grid;
  const tickStyle = { fontSize: 12, fill: theme.colors.text };
  const paletteMap =
    colorMap && Object.keys(colorMap).length
      ? colorMap
      : getCategoryColorMap(shaped.categories);

  if (error) {
    return <div className="error" role="alert">{error}</div>;
  }
  if (loading) {
    return (
      <div
        className="skeleton"
        style={{ width: "100%", height, borderRadius: 12 }}
        aria-busy="true"
        aria-label="Loading grouped cost chart"
      />
    );
  }
  if (!effectiveRecords.length) {
    return (
      <div
        className="screen-center"
        aria-label="No grouped cost data available"
        style={{ minHeight: height }}
      >
        No cost data available.
      </div>
    );
  }

  return (
    <section
      role="region"
      aria-label={ariaLabel || title}
      style={{
        background: theme.colors.surface,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: 12,
        boxShadow: theme.elevation.sm,
        padding: 12,
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: theme.colors.text }}>
          {title}
        </h3>
        <div style={{ flex: 1 }} />
        {showSelector && (
          <label style={{ fontSize: 12, color: theme.colors.muted, display: "inline-flex", alignItems: "center", gap: 6 }}>
            Group by:
            <select
              aria-label="Select grouped by dimension"
              value={groupBy}
              onChange={(e) => onGroupByChange && onGroupByChange(e.target.value)}
              style={{
                padding: "6px 8px",
                borderRadius: 8,
                border: `1px solid ${theme.colors.border}`,
                background: theme.colors.surface,
                color: theme.colors.text,
              }}
            >
              <option value="environment">Environment</option>
              <option value="cost_category">Cost category</option>
            </select>
          </label>
        )}
      </header>
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer>
          <BarChart
            data={shaped.data}
            margin={{ top: 8, right: 24, bottom: 4, left: 0 }}
            aria-label="Grouped cost bar chart"
          >
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis dataKey="agent_name" tick={tickStyle} />
            <YAxis
              tick={tickStyle}
              tickFormatter={(v) => `$${Number(v).toFixed(2)}`}
              width={80}
            />
            <Tooltip
              formatter={(v, name) => [`$${Number(v).toFixed(4)}`, name]}
              labelFormatter={(label) => `Agent: ${label}`}
              contentStyle={{
                background: "transparent",
                border: "none",
                boxShadow: "none",
                color: theme.colors.text,
              }}
              cursor={{ fill: "transparent" }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: theme.colors.muted }} />
            {shaped.categories.map((cat) => (
              <Bar
                key={cat}
                dataKey={cat}
                name={cat}
                fill={paletteMap[cat]}
                radius={[6, 6, 0, 0]}
                data-testid={`bar-series-${cat}`}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
