import React, { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { getChartTheme } from "./chartTheme";
import getOceanColors from "../../theme/colors";
import { getStatusColor } from "../../utils/statusColors";
import { formatStatusLabel } from "../../utils/formatStatusLabel";

/**
 * PUBLIC_INTERFACE
 * SessionsByType
 * Bar chart for session counts grouped by session type.
 *
 * Props:
 * - data: Array<{ session_type: string, session_count: number }>
 * - loading?: boolean
 * - error?: string
 * - maxItems?: number (default 5) -> controls length of Most/Least Used lists
 * - onFilterChange?: (filter: any) => void (reserved for future use)
 */
export default function SessionsByType({
  data = [],
  loading = false,
  error = "",
  maxItems = 5,
  onFilterChange, // eslint-disable-line no-unused-vars
}) {
  /** This component renders a responsive bar chart: X=session_type, Y=session_count,
   *  and below it, two compact lists for Most Used and Least Used services derived from data.
   */

  const t = getChartTheme();
  const oc = getOceanColors();
  const gridStroke = t.grid;

  // Normalize rows + attach colors
  const rows = useMemo(() => {
    const arr = Array.isArray(data) ? data : [];
    return arr.map((d) => {
      const session_type = String(d?.session_type ?? "Unknown");
      const session_count = Number(d?.session_count || 0);
      const fill = getStatusColor(session_type, oc);
      return { ...d, session_type, session_count, fill };
    });
  }, [data, oc]);

  // Compute top/bottom lists from rows (respects current filters/date because 'data' already reflects them)
  const { mostUsed, leastUsed } = useMemo(() => {
    const sortedDesc = [...rows].sort((a, b) => b.session_count - a.session_count);
    // Filter out zeros for least used to avoid noise; if all are zero, keep as-is to show empty gracefully
    const nonZeroAsc = rows
      .filter((r) => r.session_count > 0)
      .sort((a, b) => a.session_count - b.session_count);

    const top = sortedDesc.slice(0, Math.max(0, Number(maxItems) || 5));
    const bottomSource = nonZeroAsc.length ? nonZeroAsc : [...rows].sort((a, b) => a.session_count - b.session_count);
    const bottom = bottomSource.slice(0, Math.max(0, Number(maxItems) || 5));
    return { mostUsed: top, leastUsed: bottom };
  }, [rows, maxItems]);

  function truncateLabel(label, max = 14) {
    const s = String(label ?? "");
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }

  const legendPayload = useMemo(() => {
    return rows.map((r) => ({
      id: r.session_type,              // keep raw key for mapping
      value: formatStatusLabel(r.session_type), // display formatted label
      type: "square",
      color: r.fill,
    }));
  }, [rows]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const dp = payload[0]?.payload || {};
      const count = Number(dp.session_count || payload[0]?.value || 0);
      const fullLabel = formatStatusLabel(dp.session_type || label || "Unknown");
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
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{fullLabel}</div>
          <div>Sessions: {count}</div>
        </div>
      );
    }
    return null;
  };

  // Minimal list item component to keep consistent style with app theme
  const ListItem = ({ item }) => {
    const label = formatStatusLabel(item.session_type);
    return (
      <div
        className="hover-row"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 10px",
          borderRadius: 8,
          border: "1px solid var(--border-subtle, #E5E7EB)",
          background: "var(--bg-surface, #fff)",
        }}
      >
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span
            aria-hidden
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              background: item.fill,
              boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.05)",
              flex: "0 0 auto",
            }}
          />
          <span
            title={label}
            style={{
              fontWeight: 600,
              color: "var(--text-primary, #111827)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 240,
            }}
          >
            {label}
          </span>
        </div>
        <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-secondary, #6B7280)" }}>
          {item.session_count}
        </span>
      </div>
    );
  };

  return (
    <div
      role="region"
      aria-label="Sessions by type chart and summaries"
      // Block-level container with vertical spacing and bottom padding to separate from following content
      className="sessions-by-type-container"
      style={{
        width: "100%",
        display: "block",
        marginBottom: 24, // acts like mb-6
        paddingBottom: 8, // pb-2
      }}
    >
      {/* Chart section */}
      <div
        style={{ width: "100%", height: 320 }}
        role="img"
        aria-label="Bar chart of sessions by type"
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
              data={rows}
              margin={{ top: 8, right: 24, bottom: 0, left: 0 }}
              barCategoryGap={18}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis
                dataKey="session_type"
                tick={{ fontSize: 12, fill: t.axisTick }}
                minTickGap={10}
                interval="preserveStartEnd"
                tickFormatter={(v) => truncateLabel(formatStatusLabel(v), 14)}
              />
              <YAxis tick={{ fontSize: 12, fill: t.axisTick }} allowDecimals={false} />
              <Tooltip
                content={<CustomTooltip />}
                wrapperStyle={{ outline: "none" }}
              />
              <Legend
                verticalAlign="top"
                height={24}
                wrapperStyle={{ fontSize: 12, color: t.legend.text }}
                payload={legendPayload}
              />
              <Bar
                dataKey="session_count"
                name="Sessions"
                aria-label="Sessions count"
                radius={[4, 4, 0, 0]}
              >
                {rows.map((entry, idx) => (
                  <Cell key={`cell-${idx}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Summaries below chart */}
      <div
        role="group"
        aria-label="Service usage summaries"
        // Responsive wrap: stack on small screens, two-column feel on md+, with gaps
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          gap: 12,
          marginTop: 16, // like space-y-4
          flexWrap: "wrap",
        }}
      >
        <div
          className="card"
          style={{
            padding: 12,
            borderRadius: "var(--radius-md, 12px)",
            boxShadow: "var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.05))",
            border: "1px solid var(--border-subtle, #E5E7EB)",
            background: "var(--bg-surface, #fff)",
            overflow: "visible", // ensure internal content/legend won't clip
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "var(--text-primary, #111827)" }}>
              Most Used Services
            </h4>
            <span style={{ fontSize: 12, color: "var(--text-tertiary, #6B7280)" }}>
              Top {Math.max(0, Number(maxItems) || 5)}
            </span>
          </div>
          <div
            // Use grid for list items with consistent spacing
            style={{ display: "grid", gap: 8 }}
          >
            {loading ? (
              <div className="skeleton" style={{ height: 20 }} />
            ) : error ? (
              <div className="error" role="alert">{error}</div>
            ) : mostUsed.length === 0 ? (
              <div className="muted" style={{ color: "var(--text-tertiary, #6B7280)" }}>No items</div>
            ) : (
              mostUsed.map((it, idx) => <ListItem key={`${it.session_type}-${idx}`} item={it} />)
            )}
          </div>
        </div>

        <div
          className="card"
          style={{
            padding: 12,
            borderRadius: "var(--radius-md, 12px)",
            boxShadow: "var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.05))",
            border: "1px solid var(--border-subtle, #E5E7EB)",
            background: "var(--bg-surface, #fff)",
            overflow: "visible",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "var(--text-primary, #111827)" }}>
              Least Used Services
            </h4>
            <span style={{ fontSize: 12, color: "var(--text-tertiary, #6B7280)" }}>
              Bottom {Math.max(0, Number(maxItems) || 5)}
            </span>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {loading ? (
              <div className="skeleton" style={{ height: 20 }} />
            ) : error ? (
              <div className="error" role="alert">{error}</div>
            ) : leastUsed.length === 0 ? (
              <div className="muted" style={{ color: "var(--text-tertiary, #6B7280)" }}>No items</div>
            ) : (
              leastUsed.map((it, idx) => <ListItem key={`${it.session_type}-${idx}`} item={it} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
