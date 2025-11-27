import React, { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
} from "recharts";

import LoadingState from "../common/LoadingState.jsx";
import ErrorState from "../common/ErrorState.jsx";
import { listSessions, listLlmCosts } from "../../api/baseClient";
import { getChartTheme } from "../charts/chartTheme";
import { formatUsdUpToSixDecimals } from "../../utils/formatCurrency";

/**
 * PUBLIC_INTERFACE
 * UsersAnalyticsPanelModal
 * Provides charts for a single user's analytics inside the Users modal.
 * - Sessions over time (from session_breakdown/date fields if available)
 * - Total session duration vs count (aggregate from session_breakdown)
 * - Agents usage distribution (from agents arrays in sessions)
 * - Credits consumed over time and by model/service (from /api/llm-costs)
 * - Optional project distribution/activity summary (from session records if available)
 *
 * Props:
 *  - userId: string (required for fetching)
 *  - tenantId: string (optional; scoping is handled by base client too)
 *  - from?: string|Date
 *  - to?: string|Date
 *
 * Behavior:
 * - Lazy fetches when mounted/active.
 * - No pagination; caps to reasonable fetch sizes.
 * - Minimal dependencies (uses recharts already present).
 * - Loading/empty/error states included.
 */
export default function UsersAnalyticsPanelModal({ userId, tenantId, from, to }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [sessions, setSessions] = useState([]); // filtered for this user
  const [costs, setCosts] = useState([]); // filtered for this user

  const theme = getChartTheme();

  const inRange = (dt) => {
    if (!dt) return true;
    const d = new Date(dt);
    if (Number.isNaN(d.getTime())) return true;
    const f = from ? new Date(from) : null;
    const t = to ? new Date(to) : null;
    if (f && d < f) return false;
    if (t && d > t) return false;
    return true;
  };

  // Fetch lazily on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!userId) {
        setLoading(false);
        setSessions([]);
        setCosts([]);
        return;
      }
      setLoading(true);
      setErr("");
      try {
        // Fetch recent sessions and costs; client enforces tenant/organization scope.
        const [sessResp, costResp] = await Promise.all([
          listSessions({ page: 1, limit: 500, sort: "-last_updated" }),
          listLlmCosts({ page: 1, limit: 1000, sort: "-timestamp" }),
        ]);

        const normalizedUserId = String(userId);

        // Normalize array items from envelopes
        const sessionItems = Array.isArray(sessResp?.items) ? sessResp.items : [];
        const costItems = Array.isArray(costResp?.items) ? costResp.items : [];

        const byUserSessions = sessionItems.filter((row) => {
          const uid =
            row?.user_id ??
            row?.userId ??
            row?.user?._id ??
            row?.user?.id ??
            row?.user?.user_id ??
            null;
        // Filter by user and date range
          return uid && String(uid) === normalizedUserId && inRange(row?.last_updated || row?.session_end || row?.session_start || row?.created_at);
        });

        const byUserCosts = costItems.filter((row) => {
          const uid =
            row?.user_id ??
            row?.userId ??
            row?.user?._id ??
            row?.user?.id ??
            row?.user?.user_id ??
            null;
          return uid && String(uid) === normalizedUserId && inRange(row?.timestamp || row?.created_at || row?.updated_at || row?.date);
        });

        if (!cancelled) {
          setSessions(byUserSessions);
          setCosts(byUserCosts);
        }
      } catch (e) {
        if (!cancelled) {
          setErr(e?.message || "Failed to load analytics.");
          setSessions([]);
          setCosts([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, tenantId, String(from || ""), String(to || "")]);

  // Helpers
  const toNumber = (v) => {
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    if (v == null) return 0;
    const s = String(v).replace(/[$,]/g, "").trim();
    const n = Number.parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  };

  const dateKey = (d) => {
    try {
      const dt = new Date(d);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, "0");
      const da = String(dt.getDate()).padStart(2, "0");
      return `${y}-${m}-${da}`;
    } catch {
      return String(d || "");
    }
  };

  // Aggregate charts data
  const charts = useMemo(() => {
    // 1) Sessions over time (count per day)
    const sessionsByDayMap = new Map();
    (sessions || []).forEach((s) => {
      const when =
        s?.last_updated ||
        s?.session_end ||
        s?.session_start ||
        s?.created_at ||
        s?.updated_at;
      if (!when) return;
      const k = dateKey(when);
      sessionsByDayMap.set(k, (sessionsByDayMap.get(k) || 0) + 1);
    });
    const sessionsOverTime = Array.from(sessionsByDayMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => (a.date > b.date ? 1 : -1));

    // 2) Total session duration vs count (aggregate duration from session_breakdown)
    // Derive total seconds across a day vs total count across that day for a scatter/area style
    const secondsFromStep = (step) => {
      if (!step || typeof step !== "object") return 0;
      if (Number.isFinite(Number(step.duration_seconds))) return Number(step.duration_seconds);
      if (Number.isFinite(Number(step.duration_sec))) return Number(step.duration_sec);
      if (Number.isFinite(Number(step.duration_ms))) return Number(step.duration_ms) / 1000;
      if (Number.isFinite(Number(step.time_ms))) return Number(step.time_ms) / 1000;
      if (Number.isFinite(Number(step.time_s))) return Number(step.time_s);
      if (Number.isFinite(Number(step.duration))) return Number(step.duration);
      return 0;
    };
    const durVsCountMap = new Map();
    (sessions || []).forEach((s) => {
      const when = s?.last_updated || s?.session_end || s?.session_start || s?.created_at;
      const k = when ? dateKey(when) : "unknown";
      let totalSec = 0;
      const bd = s?.session_breakdown ?? s?.breakdown ?? [];
      if (Array.isArray(bd)) {
        bd.forEach((st) => {
          totalSec += secondsFromStep(st);
        });
      } else if (bd && typeof bd === "object") {
        Object.values(bd).forEach((st) => {
          totalSec += secondsFromStep(st);
        });
      }
      const prev = durVsCountMap.get(k) || { date: k, seconds: 0, count: 0 };
      prev.seconds += totalSec;
      prev.count += 1;
      durVsCountMap.set(k, prev);
    });
    const durationVsCount = Array.from(durVsCountMap.values()).sort((a, b) =>
      a.date > b.date ? 1 : -1
    );

    // 3) Agents usage distribution (flatten agents arrays across sessions)
    const agentCounts = new Map();
    const readAgentName = (a) => {
      if (!a) return null;
      if (typeof a === "string") return a;
      if (typeof a === "object") {
        return (
          a.name ||
          a.agent_name ||
          a.agentName ||
          a.displayName ||
          a.username ||
          a.user_name ||
          null
        );
      }
      return null;
    };
    (sessions || []).forEach((s) => {
      const agents = s?.agents ?? s?.session_data?.agents ?? [];
      if (Array.isArray(agents)) {
        agents.forEach((a) => {
          const nm = readAgentName(a);
          if (!nm) return;
          agentCounts.set(nm, (agentCounts.get(nm) || 0) + 1);
        });
      } else if (agents && typeof agents === "object") {
        Object.values(agents).forEach((a) => {
          const nm = readAgentName(a);
          if (!nm) return;
          agentCounts.set(nm, (agentCounts.get(nm) || 0) + 1);
        });
      }
    });
    const agentsDistribution = Array.from(agentCounts.entries())
      .map(([agent, count]) => ({ agent, count }))
      .sort((a, b) => b.count - a.count);

    // 4) Credits consumed over time (sum per day) and by model/service
    const costByDay = new Map();
    const costByModel = new Map();
    const costByService = new Map();
    (costs || []).forEach((c) => {
      const when = c?.timestamp || c?.date || c?.created_at || c?.updated_at;
      const k = when ? dateKey(when) : null;
      const amt = toNumber(c?.total_cost ?? c?.cost ?? c?.amount);
      if (k) costByDay.set(k, (costByDay.get(k) || 0) + amt);

      const model =
        c?.model ||
        c?.llm_model ||
        c?.request?.model ||
        c?.session_data?.llm_model ||
        "Unknown";
      const service =
        c?.service ||
        c?.service_name ||
        c?.provider ||
        c?.session_data?.service_type ||
        "Unknown";

      costByModel.set(model, (costByModel.get(model) || 0) + amt);
      costByService.set(service, (costByService.get(service) || 0) + amt);
    });
    const creditsOverTime = Array.from(costByDay.entries())
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => (a.date > b.date ? 1 : -1));
    const creditsByModel = Array.from(costByModel.entries())
      .map(([model, total]) => ({ model, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);
    const creditsByService = Array.from(costByService.entries())
      .map(([service, total]) => ({ service, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);

    // 5) Optional project activity summary (deduce projects from sessions)
    const projMap = new Map();
    (sessions || []).forEach((s) => {
      const pid =
        s?.project_id ||
        s?.projectId ||
        s?.session_data?.project_id ||
        s?.project?.id ||
        null;
      if (!pid) return;
      const key = String(pid);
      const last =
        s?.last_updated ||
        s?.session_end ||
        s?.updated_at ||
        s?.created_at ||
        s?.session_start ||
        null;
      const prev = projMap.get(key) || { project_id: key, count: 0, last_activity: null };
      prev.count += 1;
      if (!prev.last_activity || (last && last > prev.last_activity)) {
        prev.last_activity = last;
      }
      projMap.set(key, prev);
    });
    const projectActivity = Array.from(projMap.values()).sort((a, b) =>
      (b.last_activity || "") > (a.last_activity || "") ? 1 : -1
    );

    return {
      sessionsOverTime,
      durationVsCount,
      agentsDistribution,
      creditsOverTime,
      creditsByModel,
      creditsByService,
      projectActivity,
    };
  }, [sessions, costs]);

  // Empty overall state
  const allEmpty =
    (!charts.sessionsOverTime || charts.sessionsOverTime.length === 0) &&
    (!charts.durationVsCount || charts.durationVsCount.length === 0) &&
    (!charts.agentsDistribution || charts.agentsDistribution.length === 0) &&
    (!charts.creditsOverTime || charts.creditsOverTime.length === 0) &&
    (!charts.creditsByModel || charts.creditsByModel.length === 0) &&
    (!charts.creditsByService || charts.creditsByService.length === 0);

  if (loading) {
    return <LoadingState message="Loading analytics…" height={220} />;
  }
  if (err) {
    return <ErrorState message={err} onRetry={() => {
      // simple retry by toggling loading
      setLoading(true);
      setErr("");
      // trigger effect by fake from change
      setTimeout(() => setLoading(false), 0);
    }} />;
  }
  if (allEmpty) {
    return <div className="screen-center" style={{ minHeight: 120 }}>No analytics available for this user.</div>;
  }

  const palette = [
    theme.primary,
    theme.primaryHover,
    theme.primaryActive,
    "#10B981",
    "#EF4444",
    "#6366F1",
    "#14B8A6",
    "#F59E0B",
    "#84CC16",
    "#06B6D4",
    "#A855F7",
  ];

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Row 1: Sessions over time + Duration vs Count */}
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12 }}>
        <section
          aria-label="Sessions over time"
          style={{
            background: "var(--bg-surface, #fff)",
            border: "1px solid var(--border-subtle, #e5e7eb)",
            borderRadius: 12,
            boxShadow: "var(--shadow, 0 1px 2px rgba(16,24,40,0.04))",
            padding: 12,
          }}
        >
          <header style={{ marginBottom: 6 }}>
            <h4 style={{ margin: 0 }}>Sessions over time</h4>
            <div style={{ color: "var(--text-secondary,#475569)", fontSize: 12 }}>Daily count</div>
          </header>
          {charts.sessionsOverTime.length === 0 ? (
            <div className="screen-center" style={{ minHeight: 220 }}>No sessions</div>
          ) : (
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={charts.sessionsOverTime} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
                  <XAxis dataKey="date" tick={{ fill: theme.label }} tickLine={false} axisLine={{ stroke: theme.axisTick }} minTickGap={24} />
                  <YAxis tick={{ fill: theme.label }} tickLine={false} axisLine={{ stroke: theme.axisTick }} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: "transparent" }}
                    contentStyle={{ background: theme.tooltip.bg, border: `1px solid ${theme.tooltip.border}`, borderRadius: 8, color: theme.tooltip.text }}
                    formatter={(value) => [value, "Sessions"]}
                    labelFormatter={(label) => `Date: ${label}`}
                  />
                  <Bar dataKey="count" fill={theme.primary} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section
          aria-label="Total duration vs count"
          style={{
            background: "var(--bg-surface, #fff)",
            border: "1px solid var(--border-subtle, #e5e7eb)",
            borderRadius: 12,
            boxShadow: "var(--shadow, 0 1px 2px rgba(16,24,40,0.04))",
            padding: 12,
          }}
        >
          <header style={{ marginBottom: 6 }}>
            <h4 style={{ margin: 0 }}>Total duration vs count</h4>
            <div style={{ color: "var(--text-secondary,#475569)", fontSize: 12 }}>Seconds aggregated per day vs number of sessions</div>
          </header>
          {charts.durationVsCount.length === 0 ? (
            <div className="screen-center" style={{ minHeight: 220 }}>No session duration</div>
          ) : (
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <AreaChart data={charts.durationVsCount} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
                  <XAxis dataKey="date" tick={{ fill: theme.label }} />
                  <YAxis tick={{ fill: theme.label }} />
                  <Tooltip
                    contentStyle={{ background: theme.tooltip.bg, border: `1px solid ${theme.tooltip.border}`, borderRadius: 8, color: theme.tooltip.text }}
                    formatter={(v, name) =>
                      name === "seconds"
                        ? [`${Number(v).toFixed(0)} sec`, "Total Duration"]
                        : [v, "Count"]
                    }
                  />
                  <Legend />
                  <Area type="monotone" dataKey="seconds" name="Total Duration (sec)" stroke={palette[1]} fill={palette[1]} fillOpacity={0.25} />
                  <Area type="monotone" dataKey="count" name="Sessions" stroke={palette[2]} fill={palette[2]} fillOpacity={0.18} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      {/* Row 2: Agents usage distribution + Credits over time */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 12 }}>
        <section
          aria-label="Agents usage distribution"
          style={{
            background: "var(--bg-surface, #fff)",
            border: "1px solid var(--border-subtle, #e5e7eb)",
            borderRadius: 12,
            boxShadow: "var(--shadow, 0 1px 2px rgba(16,24,40,0.04))",
            padding: 12,
          }}
        >
          <header style={{ marginBottom: 6 }}>
            <h4 style={{ margin: 0 }}>Agents usage distribution</h4>
            <div style={{ color: "var(--text-secondary,#475569)", fontSize: 12 }}>Relative counts across agents</div>
          </header>
          {charts.agentsDistribution.length === 0 ? (
            <div className="screen-center" style={{ minHeight: 220 }}>No agents data</div>
          ) : (
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Tooltip />
                  <Legend />
                  <Pie
                    data={charts.agentsDistribution}
                    dataKey="count"
                    nameKey="agent"
                    cx="50%"
                    cy="50%"
                    outerRadius="80%"
                    paddingAngle={2}
                  >
                    {charts.agentsDistribution.map((entry, idx) => (
                      <Cell key={entry.agent} fill={palette[idx % palette.length]} stroke={palette[idx % palette.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section
          aria-label="Credits consumed over time"
          style={{
            background: "var(--bg-surface, #fff)",
            border: "1px solid var(--border-subtle, #e5e7eb)",
            borderRadius: 12,
            boxShadow: "var(--shadow, 0 1px 2px rgba(16,24,40,0.04))",
            padding: 12,
          }}
        >
          <header style={{ marginBottom: 6 }}>
            <h4 style={{ margin: 0 }}>Credits consumed over time</h4>
            <div style={{ color: "var(--text-secondary,#475569)", fontSize: 12 }}>Daily totals</div>
          </header>
          {charts.creditsOverTime.length === 0 ? (
            <div className="screen-center" style={{ minHeight: 220 }}>No credits data</div>
          ) : (
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <AreaChart data={charts.creditsOverTime} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
                  <XAxis dataKey="date" tick={{ fill: theme.label }} />
                  <YAxis tick={{ fill: theme.label }} tickFormatter={(v) => `$${Number(v).toFixed(2)}`} />
                  <Tooltip
                    contentStyle={{ background: theme.tooltip.bg, border: `1px solid ${theme.tooltip.border}`, borderRadius: 8, color: theme.tooltip.text }}
                    formatter={(v) => [formatUsdUpToSixDecimals(v), "Total cost"]}
                    labelFormatter={(label) => `Date: ${label}`}
                  />
                  <Legend />
                  <Area type="monotone" dataKey="total" name="Total cost (USD)" stroke={palette[0]} fill={palette[0]} fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      {/* Row 3: Credits by model and service */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <section
          aria-label="Credits by model"
          style={{
            background: "var(--bg-surface, #fff)",
            border: "1px solid var(--border-subtle, #e5e7eb)",
            borderRadius: 12,
            boxShadow: "var(--shadow, 0 1px 2px rgba(16,24,40,0.04))",
            padding: 12,
          }}
        >
          <header style={{ marginBottom: 6 }}>
            <h4 style={{ margin: 0 }}>Credits by model</h4>
          </header>
          {charts.creditsByModel.length === 0 ? (
            <div className="screen-center" style={{ minHeight: 220 }}>No credits by model</div>
          ) : (
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={charts.creditsByModel} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
                  <XAxis dataKey="model" tick={{ fill: theme.label }} minTickGap={18} />
                  <YAxis tick={{ fill: theme.label }} tickFormatter={(v) => `$${Number(v).toFixed(2)}`} />
                  <Tooltip formatter={(v) => [formatUsdUpToSixDecimals(v), "Total cost"]} />
                  <Bar dataKey="total" name="Total cost (USD)" radius={[6, 6, 0, 0]} fill={palette[3]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section
          aria-label="Credits by service"
          style={{
            background: "var(--bg-surface, #fff)",
            border: "1px solid var(--border-subtle, #e5e7eb)",
            borderRadius: 12,
            boxShadow: "var(--shadow, 0 1px 2px rgba(16,24,40,0.04))",
            padding: 12,
          }}
        >
          <header style={{ marginBottom: 6 }}>
            <h4 style={{ margin: 0 }}>Credits by service</h4>
          </header>
          {charts.creditsByService.length === 0 ? (
            <div className="screen-center" style={{ minHeight: 220 }}>No credits by service</div>
          ) : (
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={charts.creditsByService} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
                  <XAxis dataKey="service" tick={{ fill: theme.label }} minTickGap={18} />
                  <YAxis tick={{ fill: theme.label }} tickFormatter={(v) => `$${Number(v).toFixed(2)}`} />
                  <Tooltip formatter={(v) => [formatUsdUpToSixDecimals(v), "Total cost"]} />
                  <Bar dataKey="total" name="Total cost (USD)" radius={[6, 6, 0, 0]} fill={palette[4]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      {/* Row 4: Optional project activity summary (scatter or simple list) */}
      <section
        aria-label="Project activity summary"
        style={{
          background: "var(--bg-surface, #fff)",
          border: "1px solid var(--border-subtle, #e5e7eb)",
          borderRadius: 12,
          boxShadow: "var(--shadow, 0 1px 2px rgba(16,24,40,0.04))",
          padding: 12,
        }}
      >
        <header style={{ marginBottom: 6 }}>
          <h4 style={{ margin: 0 }}>Project activity</h4>
          <div style={{ color: "var(--text-secondary,#475569)", fontSize: 12 }}>Distinct projects with last activity</div>
        </header>
        {charts.projectActivity.length === 0 ? (
          <div className="screen-center" style={{ minHeight: 120 }}>No project activity</div>
        ) : (
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
                <XAxis
                  dataKey="last_activity"
                  name="Last activity"
                  tick={{ fill: theme.label }}
                  tickFormatter={(v) => {
                    try {
                      const d = new Date(v);
                      return `${d.getMonth() + 1}/${d.getDate()}`;
                    } catch {
                      return String(v);
                    }
                  }}
                />
                <YAxis dataKey="count" name="Count" tick={{ fill: theme.label }} />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                <Scatter
                  data={charts.projectActivity.map((p) => ({
                    last_activity: new Date(p.last_activity).getTime() || 0,
                    count: p.count,
                    project_id: p.project_id,
                  }))}
                  name="Projects"
                  fill={palette[5]}
                />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  );
}

UsersAnalyticsPanelModal.propTypes = {
  userId: PropTypes.string,
  tenantId: PropTypes.string,
  from: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
  to: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
};
