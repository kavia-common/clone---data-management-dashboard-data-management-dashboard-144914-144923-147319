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
} from "recharts";
import Card from "../ui/Card.jsx";
import Button from "../ui/Button.jsx";
import { listDeployments } from "../../api/client";

/**
 * PUBLIC_INTERFACE
 * DeploymentsOverTime
 * A responsive time-series chart showing deployment counts aggregated over time with filters.
 *
 * Features:
 * - Aggregation: day (default) or week
 * - Filters: service_name and environment
 * - Time range quick filters: 7d, 30d, 90d, All
 * - Brush to zoom/scroll over the time series
 * - Client-side aggregation using deployment records (deployment_id, service_name, environment, deployed_at)
 *
 * Props:
 * - height?: number (default 320)
 * - className?: string
 */
export default function DeploymentsOverTime({ height = 320, className = "" }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [raw, setRaw] = useState([]);
  const [aggregation, setAggregation] = useState("day"); // 'day' | 'week'
  const [service, setService] = useState("all");
  const [environment, setEnvironment] = useState("all");
  const [range, setRange] = useState("30d"); // '7d' | '30d' | '90d' | 'all'

  useEffect(() => {
    let mounted = true;
    async function fetchAll() {
      setLoading(true);
      setError("");
      try {
        // Fetch up to a reasonable cap (e.g., 2000 records) to keep client aggregation fast
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

  const distinctServices = useMemo(() => {
    const s = new Set();
    (raw || []).forEach((r) => {
      const v = r?.service_name || r?.service || "Unknown";
      if (v) s.add(String(v));
    });
    return ["all", ...Array.from(s).sort()];
  }, [raw]);

  const distinctEnvironments = useMemo(() => {
    // Prefer known environments; also include any that appear in data
    const known = ["prod", "staging", "dev"];
    const s = new Set(known);
    (raw || []).forEach((r) => {
      const v = r?.environment || r?.env;
      if (v) s.add(String(v));
    });
    return ["all", ...Array.from(s).filter(Boolean).sort()];
  }, [raw]);

  function toLocalDateString(dt) {
    try {
      const d = new Date(dt);
      // ISO date portion in local time
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    } catch {
      return "";
    }
  }

  function toIsoWeekLabel(dt) {
    // ISO week "YYYY-Www" label; week starts Monday
    const d = new Date(dt);
    // Convert to nearest Thursday: current date + 4 - current day number (Monday=1, Sunday=7)
    const target = new Date(d.valueOf());
    const dayNr = (d.getDay() + 6) % 7; // 0=Mon..6=Sun
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = new Date(target.getFullYear(), 0, 4);
    const dayDiff = (target - firstThursday) / 86400000;
    const weekNr = 1 + Math.floor((dayDiff - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
    const year = target.getFullYear();
    return `${year}-W${String(weekNr).padStart(2, "0")}`;
  }

  function applyFilters(items) {
    return (items || []).filter((r) => {
      const svc = String(r?.service_name || r?.service || "Unknown");
      const env = String(r?.environment || r?.env || "");
      const passSvc = service === "all" || svc === service;
      const passEnv = environment === "all" || env === environment;
      return passSvc && passEnv;
    });
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
    const items = applyTimeRange(applyFilters(raw));
    const counts = new Map();
    items.forEach((r) => {
      const t = r?.deployed_at || r?.created_at || r?.updated_at;
      if (!t) return;
      const key = aggregation === "week" ? toIsoWeekLabel(t) : toLocalDateString(t);
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    // Convert to sorted array
    const arr = Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    return arr;
  }, [raw, aggregation, service, environment, range]);

  const brandBlue = "#2563EB";
  const gridStroke = "rgba(0,0,0,0.08)";

  return (
    <Card
      title="Deployments Over Time"
      subtitle="Counts aggregated by day or week with filters and time range selection"
      className={`block-full ${className}`.trim()}
    >
      {error && <div className="error" role="alert">{error}</div>}

      <div className="toolbar" role="region" aria-label="Chart controls" style={{ position: "sticky", top: "var(--header-height, 0px)", zIndex: 1, background: "var(--bg-surface)" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label>
            <span>Aggregation</span>
            <select
              value={aggregation}
              onChange={(e) => setAggregation(e.target.value)}
              aria-label="Aggregation interval"
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
            </select>
          </label>

          <label>
            <span>Service</span>
            <select
              value={service}
              onChange={(e) => setService(e.target.value)}
              aria-label="Service filter"
            >
              {distinctServices.map((s) => (
                <option key={s} value={s}>{s === "all" ? "All services" : s}</option>
              ))}
            </select>
          </label>

          <label>
            <span>Environment</span>
            <select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
              aria-label="Environment filter"
            >
              {distinctEnvironments.map((env) => (
                <option key={env} value={env}>{env === "all" ? "All environments" : env}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="spacer" />

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

      <div style={{ width: "100%", height, marginTop: 8 }}>
        {loading ? (
          <div>Loading chart...</div>
        ) : (
          <ResponsiveContainer>
            <AreaChart data={chartData} margin={{ top: 8, right: 24, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="deploymentsArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={brandBlue} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={brandBlue} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12 }}
                minTickGap={24}
              />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip />
              <Area type="monotone" dataKey="count" name="Deployments" stroke={brandBlue} fillOpacity={1} fill="url(#deploymentsArea)" />
              {/* Brush enables drag-to-zoom/time window selection */}
              {chartData && chartData.length > 0 ? (
                <Brush dataKey="label" height={20} travellerWidth={10} />
              ) : null}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
