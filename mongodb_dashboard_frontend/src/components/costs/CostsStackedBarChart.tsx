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
import type { CostRecord, StackBy } from "../../utils/costs/shapeStackedSeries";
import { shapeStackedSeries } from "../../utils/costs/shapeStackedSeries";
import { getOceanTheme, getCategoryColorMap } from "../../theme/oceanTheme";

/**
// ============================================================================
// REQUIREMENT TRACEABILITY
// ============================================================================
// Requirement ID: REQ-FE-COSTS-STACKED-001
// User Story: As a user, I want to compare total cost per service with stacks by environment or cost category.
// Acceptance Criteria:
// - X-axis service_name; Y-axis total_cost; stacks by environment or cost_category
// - Toggle stackBy prop; robust zero-fill
// - Ocean Professional styling; accessibility-friendly; friendly empty state.
// GxP Impact: NO (UI visualization)
// Risk Level: LOW
// Validation Protocol: VP-FE-COSTS-STACKED-001
// ============================================================================ 
 */

export interface CostsStackedBarChartProps {
  /**
   * Raw aggregate records. Each item should include:
   *  - service_name (x-axis label)
   *  - environment or cost_category (stack key selected by stackBy)
   *  - total_cost (numeric value)
   */
  records?: CostRecord[];
  /**
   * Choose the stacking dimension.
   * - "environment" (default)
   * - "cost_category"
   */
  stackBy?: StackBy;
  /**
   * Optional fixed list of categories to enforce order in the legend and stacks.
   * When provided, zero-fill will also consider these categories.
   */
  categories?: string[];
  /**
   * Optional explicit color map for categories (category -> color).
   * If omitted, colors are generated from Ocean theme.
   */
  colorMap?: Record<string, string>;
  /**
   * Height of the chart container.
   */
  height?: number;
  /**
   * Loading flag for parent to pass-through; displays a loading placeholder.
   */
  loading?: boolean;
  /**
   * Error text; shown inline when present.
   */
  error?: string;
  /**
   * Optional title rendered above the chart (visually and via aria-label).
   */
  title?: string;
  /**
   * When true, renders a small selector to toggle stackBy between environment and cost_category.
   */
  showSelector?: boolean;
  /**
   * Callback invoked when stackBy selection is changed by the built-in selector.
   */
  onStackByChange?: (v: StackBy) => void;
  /**
   * Accessible aria-label override for the chart region.
   */
  ariaLabel?: string;
}

/**
 * PUBLIC_INTERFACE
 * CostsStackedBarChart
 * A responsive stacked bar chart that displays total_cost per service_name, stacked by environment or cost_category.
 *
 * Usage:
 * <CostsStackedBarChart
 *   records={[
 *     { service_name: "Auth", environment: "prod", cost_category: "compute", total_cost: 10 },
 *     { service_name: "Auth", environment: "staging", cost_category: "compute", total_cost: 5 },
 *     { service_name: "Gateway", environment: "prod", cost_category: "egress", total_cost: 2 },
 *   ]}
 *   stackBy="environment"
 *   height={320}
 * />
 */
export default function CostsStackedBarChart({
  records = [],
  stackBy = "environment",
  categories,
  colorMap,
  height = 320,
  loading = false,
  error,
  title = "Service Costs (stacked)",
  showSelector = false,
  onStackByChange,
  ariaLabel,
}: CostsStackedBarChartProps) {
  // Ensure runtime safety for input
  const safeRecords: CostRecord[] = Array.isArray(records)
    ? records.map((r) => ({
        service_name: r?.service_name ?? "Unknown",
        environment: r?.environment ?? null,
        cost_category: r?.cost_category ?? null,
        total_cost: Number(r?.total_cost ?? 0),
      }))
    : [];

  // Shape data with zero-fill across discovered or provided categories
  const shaped = React.useMemo(() => {
    const base = shapeStackedSeries(safeRecords, stackBy);
    let cats = base.categories.slice();
    if (Array.isArray(categories) && categories.length) {
      // Ensure union of provided categories and discovered ones, preserving provided order
      const set = new Set<string>(categories);
      base.categories.forEach((c) => set.add(c));
      cats = Array.from(set);
    }
    return {
      ...base,
      categories: cats,
      data: base.data.map((row) => {
        // zero-fill any extra categories that may have been provided
        const out = { ...row };
        cats.forEach((c) => {
          if (typeof out[c] !== "number") (out as any)[c] = 0;
        });
        return out;
      }),
    };
  }, [safeRecords, stackBy, categories]);

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
      <div className="skeleton" style={{ width: "100%", height, borderRadius: 12 }} aria-busy="true" aria-label="Loading stacked cost chart" />
    );
  }
  if (!safeRecords.length) {
    return (
      <div
        className="screen-center"
        aria-label="No stacked cost data available"
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
            Stack by:
            <select
              aria-label="Select stack by dimension"
              value={stackBy}
              onChange={(e) => onStackByChange?.(e.target.value as StackBy)}
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
            aria-label="Stacked cost bar chart"
          >
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis dataKey="service_name" tick={tickStyle} />
            <YAxis
              tick={tickStyle}
              tickFormatter={(v) => `$${Number(v).toFixed(2)}`}
              width={80}
            />
            <Tooltip
              formatter={(v: number, name: string) => [`$${Number(v).toFixed(4)}`, name]}
              labelFormatter={(label) => `Service: ${label}`}
              contentStyle={{
                borderRadius: 10,
                border: `1px solid ${theme.colors.border}`,
                background: theme.colors.surface,
                color: theme.colors.text,
                boxShadow: theme.elevation.md,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: theme.colors.muted }} />
            {shaped.categories.map((cat) => (
              <Bar
                key={cat}
                dataKey={cat}
                name={cat}
                stackId="total"
                fill={paletteMap[cat]}
                radius={[6, 6, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
