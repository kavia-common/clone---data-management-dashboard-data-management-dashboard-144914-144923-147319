import React, { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";
import Card from "../ui/Card.jsx";
import Skeleton from "../ui/Skeleton.jsx";
import { getOceanTheme, getCategoricalPalette } from "../../theme/oceanTheme";
import { getChartTheme } from "./chartTheme";

/**
 * PUBLIC_INTERFACE
 * SessionDetailCharts
 * Renders three compact charts based on a single session context:
 * - Timeline: duration segments from session_breakdown
 * - Event types distribution: pie/donut by event/agent types
 * - Duration histogram: bar bins from breakdown durations
 *
 * Props:
 * - session: object (expects session_breakdown array or object)
 * - className?: string
 */
export function SessionDetailCharts({ session, className = "" }) {
  const theme = getOceanTheme();
  const ct = getChartTheme();
  const breakdownArray = useMemo(() => {
    const raw = session?.session_breakdown;
    return Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  }, [session]);

  const loading = false; // charts are derived from already-loaded props
  const empty = breakdownArray.length === 0;

  const segments = useMemo(() => {
    // Build ordered segments with numeric start for sorting and duration in seconds
    const arr = breakdownArray.map((b, idx) => {
      const startRaw = b?.session_start ?? b?.sessionStart ?? b?.start ?? b?.startedAt;
      const endRaw = b?.session_end ?? b?.sessionEnd ?? b?.end ?? b?.endedAt ?? b?.finishedAt;
      const durRaw = b?.duration ?? b?.total_duration ?? b?.elapsed;

      let startMs = null;
      let endMs = null;
      try { startMs = startRaw ? new Date(startRaw).getTime() : null; } catch { startMs = null; }
      try { endMs = endRaw ? new Date(endRaw).getTime() : null; } catch { endMs = null; }

      let seconds = Number(durRaw);
      if (!Number.isFinite(seconds)) {
        if (startMs != null && endMs != null && !isNaN(startMs) && !isNaN(endMs)) {
          seconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
        } else {
          seconds = 0;
        }
      } else {
        seconds = Math.max(0, Math.floor(seconds));
      }

      // event type: prefer agent, then type/name
      const typeRaw = b?.Agent ?? b?.agent ?? b?.agent_name ?? b?.agentName ?? b?.type ?? b?.name ?? "Unknown";
      const type = String(typeRaw || "Unknown").trim() || "Unknown";

      return {
        idx,
        label: `S${idx + 1}`,
        startMs,
        endMs,
        seconds,
        type,
      };
    });

    // Sort by start time; fallback by idx
    const sorted = arr.slice().sort((a, b) => {
      if (a.startMs == null && b.startMs == null) return a.idx - b.idx;
      if (a.startMs == null) return 1;
      if (b.startMs == null) return -1;
      return a.startMs - b.startMs;
    });

    // Build timeline data points: cumulative time index for X, seconds for Y
    let cum = 0;
    const timeline = sorted.map((s) => {
      const x = s.startMs != null ? s.startMs : (sorted[0]?.startMs ?? 0) + cum * 1000;
      const d = s.seconds || 0;
      cum += d;
      return {
        name: s.label,
        time: x,
        durationSec: d,
      };
    });

    // Distribution by type
    const typeMap = new Map();
    sorted.forEach((s) => {
      typeMap.set(s.type, (typeMap.get(s.type) || 0) + 1);
    });
    const typeData = Array.from(typeMap.entries()).map(([name, value]) => ({ name, value }));

    // Duration histogram (simple binning)
    const durations = sorted.map((s) => s.seconds || 0);
    const bins = buildBins(durations);

    return { timeline, typeData, histogram: bins };
  }, [breakdownArray]);

  function buildBins(values) {
    const arr = (values || []).filter((n) => Number.isFinite(n));
    if (!arr.length) return [];
    const max = Math.max(...arr);
    const binSize = Math.max(5, Math.ceil(max / 8)); // 8 buckets max; min width 5s
    const binCount = Math.max(1, Math.ceil(max / binSize));
    const counts = Array.from({ length: binCount }, () => 0);
    arr.forEach((v) => {
      let idx = Math.floor(v / binSize);
      if (idx >= binCount) idx = binCount - 1;
      counts[idx] += 1;
    });
    return counts.map((count, i) => {
      const start = i * binSize;
      const end = start + binSize - 1;
      return {
        range: `${start}-${end}s`,
        count,
      };
    });
  }

  const palette = getCategoricalPalette(Math.max(segments.typeData?.length || 1, 5));

  const renderSectionTitle = (title) => (
    <div style={{ marginBottom: 8 }}>
      <h4
        style={{
          margin: 0,
          fontSize: 14,
          fontWeight: 800,
          color: "var(--text-primary, #111827)",
        }}
      >
        {title}
      </h4>
    </div>
  );

  return (
    <div className={className} style={{ display: "grid", gap: 12 }}>
      <Card className="session-chart-card" title="Session Timeline" subtitle="Duration per segment">
        {loading ? (
          <div style={{ padding: 8 }}>
            <Skeleton width="40%" height={18} style={{ marginBottom: 12 }} />
            <Skeleton width="100%" height={220} />
          </div>
        ) : empty ? (
          <div className="screen-center" style={{ minHeight: 220 }}>No breakdown data</div>
        ) : (
          <div style={{ width: "100%", height: 260 }} role="img" aria-label="Timeline of session segments">
            <ResponsiveContainer>
              <LineChart data={segments.timeline} margin={{ top: 10, left: 4, right: 16, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis
                  dataKey="name"
                  tick={{ fill: ct.axisTick, fontSize: 12 }}
                  axisLine={{ stroke: ct.axisTick }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: ct.axisTick, fontSize: 12 }}
                  axisLine={{ stroke: ct.axisTick }}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{ background: ct.tooltip.bg, border: `1px solid ${ct.tooltip.border}`, color: ct.tooltip.text }}
                  wrapperStyle={{ outline: "none" }}
                  formatter={(val) => [`${val}s`, "Duration"]}
                  labelFormatter={(label) => `Segment ${label}`}
                />
                <Line
                  type="monotone"
                  dataKey="durationSec"
                  stroke={theme.colors.primary}
                  dot={{ r: 3, strokeWidth: 1 }}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div
        role="group"
        aria-label="Breakdown distributions"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}
      >
        <Card className="session-chart-card" title="Event Types" subtitle="Distribution">
          {loading ? (
            <div style={{ padding: 8 }}>
              <Skeleton width="40%" height={18} style={{ marginBottom: 12 }} />
              <Skeleton width="100%" height={220} />
            </div>
          ) : empty ? (
            <div className="screen-center" style={{ minHeight: 220 }}>No event types</div>
          ) : (
            <div style={{ width: "100%", height: 240 }} role="img" aria-label="Event types distribution">
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={segments.typeData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={1}
                  >
                    {segments.typeData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={palette[index % palette.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: ct.tooltip.bg, border: `1px solid ${ct.tooltip.border}`, color: ct.tooltip.text }}
                    wrapperStyle={{ outline: "none" }}
                    formatter={(value, name) => [value, String(name)]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="session-chart-card" title="Durations" subtitle="Histogram of segment lengths">
          {loading ? (
            <div style={{ padding: 8 }}>
              <Skeleton width="40%" height={18} style={{ marginBottom: 12 }} />
              <Skeleton width="100%" height={220} />
            </div>
          ) : empty ? (
            <div className="screen-center" style={{ minHeight: 220 }}>No durations</div>
          ) : (
            <div style={{ width: "100%", height: 240 }} role="img" aria-label="Histogram of durations">
              <ResponsiveContainer>
                <BarChart data={segments.histogram} margin={{ top: 6, left: 4, right: 12, bottom: 6 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis
                    dataKey="range"
                    tick={{ fill: ct.axisTick, fontSize: 11 }}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={48}
                    axisLine={{ stroke: ct.axisTick }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: ct.axisTick, fontSize: 12 }}
                    axisLine={{ stroke: ct.axisTick }}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{ background: ct.tooltip.bg, border: `1px solid ${ct.tooltip.border}`, color: ct.tooltip.text }}
                    wrapperStyle={{ outline: "none" }}
                    formatter={(val) => [val, "Segments"]}
                    labelFormatter={(label) => `Range: ${label}`}
                  />
                  <Bar dataKey="count" name="Segments" fill={theme.colors.secondary} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export default SessionDetailCharts;
