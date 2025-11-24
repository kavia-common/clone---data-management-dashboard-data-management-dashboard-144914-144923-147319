import React, { useEffect, useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Brush,
  Legend,
} from "recharts";
import Card from "../ui/Card.jsx";
import Button from "../ui/Button.jsx";
import Skeleton from "../ui/Skeleton.jsx";
import { listDeployments } from "../../api";
import { darkThemeTokens as tokens, getCurrentTheme } from "../../theme";

/**
 * PUBLIC_INTERFACE
 * DeploymentsOverTime
 * A responsive time-series chart showing deployment counts aggregated over time with time range selection.
 *
 * Adjusted per requirements:
 * - Accent color updated to orange (#FF6600) from theme tokens for stroke/fill/active states.
 * - Hover/active/point highlights use subtle alpha variants.
 * - Tooltip/legend swatch match accent color.
 * - Grid/tick colors adapt for dark theme contrast.
 *
 * Props:
 * - height?: number (default 320)
 * - className?: string
 */
function DeploymentsOverTime({ height = 320, className = "" }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [raw, setRaw] = useState([]);
  const [range, setRange] = useState("30d"); // '7d' | '30d' | '90d' | 'all'

  // Utility: convert hex to rgba string with alpha
  function withAlpha(hex, alpha) {
    const rawHex = String(hex || "").replace("#", "");
    const bigint = parseInt(rawHex.length === 3 ? rawHex.split("").map(c => c + c).join("") : rawHex, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    const a = Math.max(0, Math.min(1, Number(alpha) || 0));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  const isDark = getCurrentTheme() === "dark";
  const accent = tokens?.accent || "#FF6600";
  const gridStroke = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const tickColor = isDark ? (tokens?.text?.secondary || "#B0A8A0") : "#4B5563";
  const brushStroke = withAlpha(accent, 0.6);
  const brushTraveller = accent;

  useEffect(() => {
    let mounted = true;
    async function fetchAll() {
      setLoading(true);
      setError("");
      try {
        // Fetch up to a reasonable cap to keep client aggregation fast
        const limit = 200;
        const maxPages = 10;
        let page = 1;
        const all = [];
        while (page <= maxPages) {
          const res = await listDeployments({ page, limit, sort: "-created_at" });
          const items = Array.isArray(res?.items) ? res.items : [];
          all.push(...items);
          if (items.length < limit) break;
          page += 1;
        }
        if (mounted) {
          setRaw(all);
        }
      } catch (e) {
        if (mounted) setError(e?.response?.data?.message || e?.message || "Failed to load deployments data.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    fetchAll();
    return () => {
      mounted = false;
    };
  }, []);

  function toLocalDateString(dt) {
    try {
      const d = new Date(dt);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    } catch {
      return "";
    }
  }

  function applyTimeRange(items) {
    if (range === "all") return items;
    const now = new Date();
    let days = 30;
    if (range === "7d") days = 7;
    if (range === "30d") days = 30;
    if (range === "90d") days = 90;
    const from = new Date(now.valueOf() - days * 24 * 60 * 60 * 1000);
    return (items || []).filter((r) => {
      const t = r?.deployed_at || r?.created_at || r?.updated_at;
      if (!t) return false;
      try {
        const d = new Date(t);
        return d >= from && d <= now;
      } catch {
        return false;
      }
    });
  }

  const chartData = useMemo(() => {
    // Aggregate by day only (since Aggregation selector is removed)
    const items = applyTimeRange(raw);
    const counts = new Map();
    items.forEach((r) => {
      const t = r?.deployed_at || r?.created_at || r?.updated_at;
      if (!t) return;
      const key = toLocalDateString(t);
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const arr = Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    return arr;
  }, [raw, range]);

  return (
    <Card
      title="Deployments Over Time"
      subtitle="Counts aggregated by day with time range selection"
      className={`block-full chart-card ${className}`.trim()}
    >
      {error && <div className="error" role="alert">{error}</div>}

      <div className="toolbar chart-toolbar" role="region" aria-label="Chart controls">
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="group" aria-label="Time range">
          <Button
            variant={range === "7d" ? "primary" : "secondary"}
            onClick={() => setRange("7d")}
          >
            Last 7d
          </Button>
          <Button
            variant={range === "30d" ? "primary" : "secondary"}
            onClick={() => setRange("30d")}
          >
            Last 30d
          </Button>
          <Button
            variant={range === "90d" ? "primary" : "secondary"}
            onClick={() => setRange("90d")}
          >
            Last 90d
          </Button>
          <Button
            variant={range === "all" ? "primary" : "secondary"}
            onClick={() => setRange("all")}
          >
            All
          </Button>
        </div>
      </div>

      <div className="chart-wrapper" style={{ width: "100%", height, marginTop: 8 }}>
        {loading ? (
          <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateRows: "1fr 1fr 1fr", gap: 12 }}>
            <Skeleton width="100%" height="100%" />
          </div>
        ) : (
          <ResponsiveContainer>
            <AreaChart data={chartData} margin={{ top: 8, right: 24, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="deploymentsArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={accent} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={accent} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: tickColor }}
                minTickGap={24}
              />
              <YAxis tick={{ fontSize: 12, fill: tickColor }} allowDecimals={false} />
              <Tooltip />
              <Legend
                verticalAlign="top"
                height={24}
                wrapperStyle={{ color: tickColor }}
              />
              <Area
                type="monotone"
                dataKey="count"
                name="Deployments"
                stroke={accent}
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#deploymentsArea)"
                activeDot={{ r: 3, fill: withAlpha(accent, 0.9), stroke: accent, strokeWidth: 2 }}
              />
              {chartData && chartData.length > 0 ? (
                <Brush
                  dataKey="label"
                  height={20}
                  travellerWidth={10}
                  stroke={brushStroke}
                  travellerStroke={brushTraveller}
                />
              ) : null}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
export default React.memo(DeploymentsOverTime);
