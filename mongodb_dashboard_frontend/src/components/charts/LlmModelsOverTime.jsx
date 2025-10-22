import React, { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Card from "../ui/Card.jsx";
import Skeleton from "../ui/Skeleton.jsx";
import { getLlmUsageOverTime } from "../../api/client";
import { getChartTheme, withAlpha } from "./chartTheme";

/**
// ============================================================================
// REQUIREMENT TRACEABILITY
// ============================================================================
// Requirement ID: REQ-FE-LLM-CHART-OT-001
// User Story: As a dashboard viewer, I want to see a stacked area chart showing total_cost
//             by llm_model per day for the last 30 days.
// Acceptance Criteria:
//  - Fetches /api/llm-costs/usage-over-time?days=30
//  - Renders stacked area chart by model with date X-axis (YYYY-MM-DD)
//  - Legend, tooltip (per model and total), themed colors, accessible labels
//  - Graceful loading and error states
// GxP Impact: NO (read-only visualization), but audit is handled on backend.
// Risk Level: LOW
// Validation Protocol: VP-FE-LLM-CHART-OT-001
// ============================================================================
 */

/**
 * PUBLIC_INTERFACE
 * LlmModelsOverTime
 * Props:
 *  - days?: number (default 30)
 *  - height?: number (default 300)
 */
export default function LlmModelsOverTime({ days = 30, height = 300 }) {
  const theme = getChartTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);
  const [models, setModels] = useState([]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");
    getLlmUsageOverTime(days)
      .then((payload) => {
        if (!mounted) return;
        const its = Array.isArray(payload?.items) ? payload.items : [];
        const mods = Array.isArray(payload?.meta?.models) ? payload.meta.models : [];
        setItems(its);
        setModels(mods);
      })
      .catch((e) => {
        if (!mounted) return;
        setError(e?.response?.data?.message || e?.message || "Failed to load LLM usage data.");
      })
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [days]);

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

  return (
    <Card
      title="LLM Model Usage (30d)"
      subtitle="Daily total_cost by LLM model (stacked)"
      aria-label="LLM model usage over time card"
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
              <XAxis dataKey="date" stroke={theme.axisTick} tick={{ fontSize: 12 }} />
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
