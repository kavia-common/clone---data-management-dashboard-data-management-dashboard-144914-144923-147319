import React, { useMemo } from "react";
import { ResponsiveContainer, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Cell, PieChart, Pie, Legend } from "recharts";
import Card from "../ui/Card";
import Skeleton from "../ui/Skeleton";
import { getChartTheme } from "./chartTheme";
import { getOceanTheme, getCategoricalPalette, getCategoryColorMap } from "../../theme/oceanTheme";

// Utilities for bucketing and bucket fill
import { bucketByDay, fillSeries } from "../../utils/sessions/bucketing";

// PUBLIC_INTERFACE
// SessionsChartsPanel
// Section with four charts: Sessions over time, Status distribution, Duration histogram, Top projects by session count.
// All accept loading, error and raw session data as props.
export default function SessionsChartsPanel({
  sessions = [],
  aggLoading = false,
  aggError = "",
  // Optionally allow custom style for spacing
  style = {},
}) {
  const theme = getOceanTheme();
  const t = getChartTheme();

  // Prepare loading/emptiness states
  const empty = !aggLoading && (!sessions || sessions.length === 0);

  // === CHART 1: Sessions Over Time (Line/Area) ===
  // Use session_start or last_updated as timestamp.
  const timeStamps = useMemo(
    () =>
      (sessions || [])
        .map(
          (s) =>
            s?.session_start ||
            s?.start_time ||
            s?.started_at ||
            s?.created_at ||
            s?.timestamp ||
            s?.last_updated ||
            null
        )
        .filter(Boolean),
    [sessions]
  );
  const dailyBuckets = useMemo(() => bucketByDay(timeStamps), [timeStamps]);
  // Find range for all days present
  const minDay = useMemo(() => {
    if (timeStamps.length === 0) return null;
    return new Date(Math.min(...timeStamps.map((d) => new Date(d).getTime())));
  }, [timeStamps]);
  const maxDay = useMemo(() => {
    if (timeStamps.length === 0) return null;
    return new Date(Math.max(...timeStamps.map((d) => new Date(d).getTime())));
  }, [timeStamps]);
  const timeSeries = useMemo(() => {
    if (!minDay || !maxDay) return [];
    // Use util to fill buckets for all days in range
    return fillSeries(dailyBuckets, minDay, maxDay, "daily").map(({ label, value }) => ({
      date: label,
      sessions: value,
    }));
  }, [dailyBuckets, minDay, maxDay]);

  // === CHART 2: Session Status Distribution (Donut) ===
  const statusData = useMemo(() => {
    const counts = {};
    (sessions || []).forEach((s) => {
      let status =
        s?.status || s?.session_status || s?.state || "Unknown";
      status = String(status || "Unknown");
      counts[status] = (counts[status] || 0) + 1;
    });
    return Object.keys(counts).map((k) => ({
      status: k,
      count: counts[k],
    }));
  }, [sessions]);
  // Assign deterministic Ocean palette colors per status:
  const statusColorMap = useMemo(
    () => getCategoryColorMap(statusData.map((d) => d.status)),
    [statusData]
  );

  // === CHART 3: Session Duration Histogram ===
  // Sessions often have start/end times or duration in seconds.
  const durationSecs = useMemo(
    () =>
      (sessions || [])
        .map((s) => {
          const start =
            s?.session_start ||
            s?.start_time ||
            s?.started_at ||
            s?.created_at ||
            s?.timestamp ||
            null;
          const end =
            s?.session_end ||
            s?.end_time ||
            s?.completed_at ||
            s?.last_updated ||
            null;
          if (start && end) {
            // As seconds
            const sMs = new Date(start).getTime();
            const eMs = new Date(end).getTime();
            return Math.max(0, Math.floor((eMs - sMs) / 1000));
          } else if (
            typeof s?.duration === "number" &&
            Number.isFinite(s.duration)
          ) {
            return Math.max(0, Math.floor(s.duration));
          } else if (
            s?.duration &&
            !Number.isNaN(Number(s.duration))
          ) {
            return Math.max(0, Math.floor(Number(s.duration)));
          }
          return null;
        })
        .filter((x) => x !== null && x >= 0),
    [sessions]
  );
  // Use log scale buckets: <1min, 1-5min, 5-15min, 15-60min, >1hr.
  const durationHist = useMemo(() => {
    const buckets = [
      { key: "<1 min", min: 0, max: 60 },
      { key: "1-5 min", min: 60, max: 5 * 60 },
      { key: "5-15 min", min: 5 * 60, max: 15 * 60 },
      { key: "15-60 min", min: 15 * 60, max: 60 * 60 },
      { key: ">1 hr", min: 60 * 60 + 1, max: Infinity }
    ];
    const counts = buckets.map((b) => ({ ...b, count: 0 }));
    durationSecs.forEach((sec) => {
      for (const b of counts) {
        if (sec >= b.min && sec <= b.max) {
          b.count += 1;
          break;
        }
      }
    });
    return counts.map(({ key, count }) => ({ bucket: key, count }));
  }, [durationSecs]);

  // === CHART 4: Top Projects by Session Count ===
  const projectsArr = useMemo(() => {
    const counts = {};
    (sessions || []).forEach((s) => {
      let pid = s?.project_id || s?.projectId || s?.project || "Unknown";
      pid = String(pid || "Unknown");
      counts[pid] = (counts[pid] || 0) + 1;
    });
    // If project_name available, show as label
    const nameMap = {};
    (sessions || []).forEach((s) => {
      const pid = s?.project_id || s?.projectId || s?.project || "Unknown";
      let pname =
        s?.project_name ||
        s?.projectName ||
        s?.project_label ||
        s?.projectLabel;
      if (pid && pname) nameMap[pid] = pname;
    });
    return (
      Object.keys(counts)
        .map((pid) => ({
          project: nameMap[pid] || pid,
          session_count: counts[pid]
        }))
        .sort((a, b) => b.session_count - a.session_count)
        .slice(0, 7)
    );
  }, [sessions]);
  const projectColorMap = useMemo(
    () => getCategoryColorMap(projectsArr.map((d) => d.project)),
    [projectsArr]
  );

  // Helper for showing loading skeletons
  const showSkeleton = aggLoading && !sessions?.length;

  return (
    <div
      className="sessions-charts-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        marginBottom: 40,
        ...style,
      }}
      role="region"
      aria-label="Session Analytics Charts"
    >
      {/* Chart 1: Sessions Over Time */}
      <Card
        className="chart-card"
        title="Sessions Over Time"
        subtitle="Line chart of sessions created per day"
      >
        <div style={{ minHeight: 290, width: "100%" }}>
          {showSkeleton ? (
            <Skeleton width="100%" height={36} style={{ marginBottom: 18 }} />
          ) : aggError ? (
            <div className="error" role="alert">
              {aggError}
            </div>
          ) : empty || timeSeries.length === 0 ? (
            <div style={{ color: theme.colors.muted }}>No data</div>
          ) : (
            <ResponsiveContainer height={240}>
              <AreaChart data={timeSeries} margin={{ top: 16, right: 24, left: 10, bottom: 16 }}>
                <defs>
                  <linearGradient id="sessionsArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={theme.colors.primary} stopOpacity={0.90} />
                    <stop offset="100%" stopColor={theme.colors.primary} stopOpacity={0.18} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={t.grid} />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: t.axisTick }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: t.axisTick }} />
                <Tooltip
                  contentStyle={{
                    background: t.tooltip.bg,
                    border: `1px solid ${t.tooltip.border}`,
                    borderRadius: 8,
                    color: t.tooltip.text,
                  }}
                  formatter={(value) => [value, "Sessions"]}
                  labelFormatter={(label) => `Date: ${label}`}
                />
                <Area
                  type="monotone"
                  dataKey="sessions"
                  stroke={theme.colors.primary}
                  fill="url(#sessionsArea)"
                  strokeWidth={3}
                  dot={{ stroke: theme.colors.primary, strokeWidth: 2, r: 3 }}
                  isAnimationActive={false}
                  name="Sessions"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      {/* Chart 2: Status Distribution */}
      <Card
        className="chart-card"
        title="Session Status Distribution"
        subtitle="Pie chart distribution of current session statuses"
      >
        <div style={{ minHeight: 290, width: "100%", display: "flex", justifyContent: "center", alignItems: "center" }}>
          {showSkeleton ? (
            <Skeleton width={150} height={150} circle style={{ alignSelf: "center" }} />
          ) : aggError ? (
            <div className="error" role="alert">
              {aggError}
            </div>
          ) : empty || statusData.length === 0 ? (
            <div style={{ color: theme.colors.muted }}>No data</div>
          ) : (
            <ResponsiveContainer width={320} height={220}>
              <PieChart>
                <Pie
                  data={statusData}
                  dataKey="count"
                  nameKey="status"
                  cx="50%"
                  cy="50%"
                  outerRadius={78}
                  label={({ status, percent }) => `${status}: ${(percent * 100).toFixed(0)}%`}
                  isAnimationActive={false}
                >
                  {statusData.map((entry, idx) => (
                    <Cell key={`cell-status-${idx}`} fill={statusColorMap[entry.status]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name, props) => [`${value}`, props?.payload?.status]}
                  contentStyle={{
                    background: t.tooltip.bg,
                    border: `1px solid ${t.tooltip.border}`,
                    color: t.tooltip.text,
                  }}
                />
                <Legend layout="vertical" align="right" verticalAlign="middle" />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      {/* Chart 3: Session Duration Histogram */}
      <Card
        className="chart-card"
        title="Session Duration Histogram"
        subtitle="Histogram of session durations (bucketed)"
      >
        <div style={{ minHeight: 290, width: "100%" }}>
          {showSkeleton ? (
            <Skeleton width="100%" height={32} style={{ marginBottom: 14 }} />
          ) : aggError ? (
            <div className="error" role="alert">
              {aggError}
            </div>
          ) : empty || durationHist.every((b) => b.count === 0) ? (
            <div style={{ color: theme.colors.muted }}>No data</div>
          ) : (
            <ResponsiveContainer height={180}>
              <BarChart data={durationHist} margin={{ top: 16, right: 16, left: 8, bottom: 28 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={t.grid} />
                <XAxis dataKey="bucket" tick={{ fontSize: 12, fill: t.axisTick }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: t.axisTick }} />
                <Tooltip
                  formatter={(value) => [value, "Sessions"]}
                  contentStyle={{
                    background: t.tooltip.bg,
                    border: `1px solid ${t.tooltip.border}`,
                    color: t.tooltip.text,
                  }}
                />
                <Bar dataKey="count" fill={theme.colors.secondary} radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      {/* Chart 4: Top Projects by Session Count */}
      <Card
        className="chart-card"
        title="Top Projects by Session Count"
        subtitle="Bar chart of top projects"
      >
        <div style={{ minHeight: 290, width: "100%" }}>
          {showSkeleton ? (
            <Skeleton width="100%" height={32} style={{ marginBottom: 14 }} />
          ) : aggError ? (
            <div className="error" role="alert">
              {aggError}
            </div>
          ) : empty || projectsArr.length === 0 ? (
            <div style={{ color: theme.colors.muted }}>No data</div>
          ) : (
            <ResponsiveContainer height={220}>
              <BarChart
                data={projectsArr}
                margin={{ top: 16, right: 16, left: 10, bottom: 32 }}
                layout="vertical"
                barCategoryGap={16}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={t.grid} />
                <XAxis
                  type="number"
                  dataKey="session_count"
                  allowDecimals={false}
                  tick={{ fontSize: 12, fill: t.axisTick }}
                />
                <YAxis
                  type="category"
                  dataKey="project"
                  tick={{ fontSize: 13, fill: t.axisTick }}
                  width={140}
                  interval={0}
                  tickFormatter={(name) =>
                    String(name).length > 19 ? String(name).slice(0, 18) + "…" : name
                  }
                />
                <Tooltip
                  formatter={(value, name, props) => [`${value}`, "Sessions"]}
                  labelFormatter={(label) => `Project: ${label}`}
                  contentStyle={{
                    background: t.tooltip.bg,
                    border: `1px solid ${t.tooltip.border}`,
                    color: t.tooltip.text,
                  }}
                />
                <Bar dataKey="session_count" fill={theme.colors.primary} radius={[0, 8, 8, 0]}>
                  {projectsArr.map((entry, idx) => (
                    <Cell key={`bar-project-${idx}`} fill={projectColorMap[entry.project]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>
    </div>
  );
}
