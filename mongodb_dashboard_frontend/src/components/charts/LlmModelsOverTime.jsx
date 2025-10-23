import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Card from "../ui/Card.jsx";
import Skeleton from "../ui/Skeleton.jsx";
import { getLlmUsageOverTime, seedLlmCostsDemo } from "../../api/client";
import { getChartTheme, withAlpha } from "./chartTheme";

/**
// ============================================================================
// REQUIREMENT TRACEABILITY
// ============================================================================
// Requirement ID: REQ-FE-LLM-CHART-OT-001
// User Story: As a dashboard viewer, I want to see a stacked area chart showing total_cost
//             by llm_model per day for a selectable range (7/30/90/180 days).
// Acceptance Criteria:
//  - Visible and accessible range control with options 7d, 30d, 90d, 180d
//  - Selecting an option updates the chart by requesting /api/llm-costs/usage-over-time?range=<Nd>
//  - Active option is visually indicated; default is 90d
//  - Chart title reflects the selected range
//  - Empty-state still displays and offers retry/seed
// GxP Impact: NO (read-only visualization), backend audit logs range.
// Risk Level: LOW
// Validation Protocol: VP-FE-LLM-CHART-OT-001
// ============================================================================
 */

/**
 * PUBLIC_INTERFACE
 * LlmModelsOverTime
 * Props:
 *  - days?: number (default 90)
 *  - height?: number (default 300)
 */
export default function LlmModelsOverTime({ days = 90, height = 300 }) {
  const theme = getChartTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);
  const [models, setModels] = useState([]);
  const [reload, setReload] = useState(0);
  const [seeding, setSeeding] = useState(false);

  // Local UI state for selected range (in days)
  const [selectedDays, setSelectedDays] = useState(Number.isFinite(days) ? days : 90);
  // Keep local state in sync if prop changes externally
  useEffect(() => {
    if (Number.isFinite(days) && days !== selectedDays) {
      setSelectedDays(days);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const fetchData = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    getLlmUsageOverTime(selectedDays)
      .then((payload) => {
        if (cancelled) return;
        const its = Array.isArray(payload?.items) ? payload.items : [];
        const mods = Array.isArray(payload?.meta?.models) ? payload.meta.models : [];
        setItems(its);
        setModels(mods);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.response?.data?.message || e?.message || "Failed to load LLM usage data.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDays]);

  useEffect(() => {
    const cancel = fetchData();
    return () => cancel && cancel();
  }, [selectedDays, reload, fetchData]);

  const onRetry = () => setReload((v) => v + 1);

  const onSeedDemo = async () => {
    setSeeding(true);
    setError("");
    try {
      await seedLlmCostsDemo();
      setReload((v) => v + 1);
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || "Failed to seed demo LLM usage data.");
    } finally {
      setSeeding(false);
    }
  };

  // Map series into flat keys per model for recharts
  const data = useMemo(() => {
    return (items || []).map((row) => {
      const flat = { date: row.date, total: 0 };
      if (row && row.series) {
        Object.entries(row.series).forEach(([model, value]) => {
          flat[model] = Number(value || 0);
          flat.total += Number(value || 0);
        });
      }
      return flat;
    });
  }, [items]);

  // Compute whether there is any non-zero data
  const hasAnyData = useMemo(() => {
    if (!models || models.length === 0) return false;
    for (const row of data) {
      if (row.total && row.total > 0) return true;
    }
    return false;
  }, [models, data]);

  // Deterministic color palette aligned with Ocean Professional theme
  const palette = useMemo(
    () => [
      "#2563EB", // blue-600 (primary)
      "#F59E0B", // amber-500 (secondary)
      "#14B8A6", // teal-500
      "#7C3AED", // purple-600
      "#4F46E5", // indigo-600
      "#10B981", // emerald-500
      "#0EA5E9", // sky-500
      "#F43F5E", // rose-500
      "#22C55E", // green-500
      "#D946EF", // fuchsia-500
      "#A78BFA", // violet-400
    ],
    []
  );

  const colorForModel = (model, idx) => {
    const base = palette[idx % palette.length];
    return base || theme.primary;
  };

  // Compute X-axis tick configuration for varying ranges
  const tickCount = useMemo(() => {
    const n = data?.length || 0;
    if (n <= 14) return n; // show all for small ranges
    // Aim for ~10-12 ticks for readability
    return Math.min(12, Math.ceil(n / 7) + 1);
  }, [data]);

  // Format YYYY-MM-DD -> 'MMM d' for compact axis labels
  const formatDateTick = useCallback((value) => {
    if (typeof value !== "string") return value;
    const [y, m, d] = value.split("-").map((s) => parseInt(s, 10));
    if (!y || !m || !d) return value;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }, []);

  const renderTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    const items = payload.filter((p) => p.dataKey !== "total");
    const total = payload.find((p) => p.dataKey === "total");
    return (
      <div
        role="dialog"
        aria-label={`Usage details for ${label}`}
        style={{
          background: theme.tooltip.bg,
          border: `1px solid ${theme.tooltip.border}`,
          borderRadius: 8,
          padding: 10,
          color: theme.tooltip.text,
          fontSize: 12,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
        {items.map((p) => (
          <div key={p.dataKey} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 10, height: 10, background: p.color, display: "inline-block", borderRadius: 2 }} />
            <span>{p.dataKey}</span>
            <span style={{ marginLeft: "auto" }}>{Number(p.value || 0).toFixed(4)}</span>
          </div>
        ))}
        <hr style={{ border: 0, borderTop: `1px solid ${theme.tooltip.border}`, margin: "6px 0" }} />
        <div style={{ display: "flex", gap: 8 }}>
          <span>Total</span>
          <span style={{ marginLeft: "auto", fontWeight: 600 }}>{Number(total?.value || 0).toFixed(4)}</span>
        </div>
      </div>
    );
  };

  // Accessible date range selector (segmented control)
  const RangeButton = ({ value }) => {
    const isActive = Number(selectedDays) === Number(value);
    return (
      <button
        type="button"
        onClick={() => setSelectedDays(Number(value))}
        disabled={loading}
        className={`btn ${isActive ? "btn-primary" : "btn-secondary"}`}
        aria-pressed={isActive}
        aria-label={`Set LLM usage date range to ${value} days`}
      >
        {value}d
      </button>
    );
  };

  return (
    <Card
      title={`LLM Model Usage (${Number.isFinite(selectedDays) ? selectedDays : 90}d)`}
      subtitle="Daily total_cost by LLM model (stacked)"
      aria-label="LLM model usage over time card"
      actions={
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div role="group" aria-label="Date range" style={{ display: "flex", gap: 6 }}>
            <RangeButton value={7} />
            <RangeButton value={30} />
            <RangeButton value={90} />
            <RangeButton value={180} />
          </div>
          <div aria-hidden="true" style={{ width: 8 }} />
          <button
            type="button"
            onClick={onRetry}
            disabled={loading}
            aria-label="Retry loading LLM usage"
            className="btn btn-secondary"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={onSeedDemo}
            disabled={loading || seeding}
            aria-label="Seed demo LLM usage data"
            className="btn btn-primary"
          >
            {seeding ? "Seeding..." : "Seed demo data"}
          </button>
        </div>
      }
    >
      {error && (
        <div className="error" role="alert" aria-live="assertive">
          {error}
        </div>
      )}
      {loading ? (
        <div style={{ width: "100%", height }}>
          <Skeleton width="100%" height="100%" aria-label="Loading LLM model usage chart" />
        </div>
      ) : !hasAnyData ? (
        <div
          role="note"
          aria-live="polite"
          style={{
            width: "100%",
            minHeight: height,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: theme.label,
            fontSize: 14,
            padding: 16,
            textAlign: "center",
          }}
        >
          No LLM usage data for the last {selectedDays} days. Use "Seed demo data" to insert sample usage or try Retry if data was recently ingested.
        </div>
      ) : (
        <div style={{ width: "100%", height }}>
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data} margin={{ left: 16, right: 12, top: 10, bottom: 0 }}>
              <defs>
                {models.map((m, idx) => {
                  const c = colorForModel(m, idx);
                  return (
                    <linearGradient key={m} id={`grad-${m}`} x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor={withAlpha(c, 0.35)} />
                      <stop offset="100%" stopColor={withAlpha(c, 0.05)} />
                    </linearGradient>
                  );
                })}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
              <XAxis
                dataKey="date"
                stroke={theme.axisTick}
                tick={{ fontSize: 12, angle: -20 }}
                tickFormatter={formatDateTick}
                tickCount={tickCount}
                minTickGap={8}
                interval="preserveStartEnd"
              />
              <YAxis stroke={theme.axisTick} tick={{ fontSize: 12 }} />
              <Tooltip content={renderTooltip} />
              <Legend
                verticalAlign="top"
                height={32}
                wrapperStyle={{ color: theme.legend.text, fontSize: 12 }}
              />
              {models.map((m, idx) => {
                const c = colorForModel(m, idx);
                return (
                  <Area
                    key={m}
                    type="monotone"
                    dataKey={m}
                    stackId="1"
                    stroke={c}
                    fill={`url(#grad-${m})`}
                    dot={false}
                    isAnimationActive={false}
                  />
                );
              })}
              {/* invisible total line for tooltip aggregation */}
              <Area type="monotone" dataKey="total" stroke="transparent" fill="transparent" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
