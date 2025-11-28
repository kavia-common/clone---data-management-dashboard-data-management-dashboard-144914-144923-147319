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
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { useUsers } from "../../hooks/useUsers";
import { getApiClient } from "../../api";
import { getActiveTenant } from "../../utils/tenantClient";
import Skeleton from "../../components/ui/Skeleton";

/**
 * PUBLIC_INTERFACE
 * UsersAnalyticsPanel
 * A charts/analytics panel for the Users page, with independent filters.
 * - Projects by User (bar)
 * - Projects by Department (pie/donut)
 * - Projects timeline (daily created counts without server-side aggregation)
 *
 * Data source:
 * - Reuses /api/users to get users, then uses /api/users/:userId/projects
 *   to fetch per-user projects when available. Falls back to client-side
 *   aggregation from data already loaded if needed.
 *
 * Filters:
 * - Date range (start, end with explicit ISO)
 * - Tenant scoped via base client and active tenant helper.
 *
 * Accessibility:
 * - Proper aria-labels and live region updates for date label.
 */
export default function UsersAnalyticsPanel({
  style,
  className,
  defaultDays = 30,
}) {
  // Filter state (independent from Overview)
  // Aggregation removed: charts render unbucketed timeline based on raw activity dates
  const [days, setDays] = useState(defaultDays);
  const [customStart, setCustomStart] = useState(null);
  const [customEnd, setCustomEnd] = useState(null);
  const [dateLiveLabel, setDateLiveLabel] = useState("");

  // Active tenant (scoped by client too, but visible here for explicit query params when needed)
  const activeTenantId = getActiveTenant?.() || null;

  // Compute date range ISO strings; end is set to 23:59:59.999
  const { startISO, endISO } = useMemo(() => {
    let start;
    let end;
    if (customStart && customEnd) {
      start = new Date(customStart);
      end = new Date(customEnd);
    } else {
      end = new Date();
      // end to end-of-day
      end.setHours(23, 59, 59, 999);
      start = new Date();
      start.setDate(end.getDate() - days + 1);
      start.setHours(0, 0, 0, 0);
    }
    return { startISO: start.toISOString(), endISO: end.toISOString() };
  }, [customStart, customEnd, days]);

  // Live label for date range for accessibility
  useEffect(() => {
    const start = new Date(startISO);
    const end = new Date(endISO);
    const fmt = (d) =>
      d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    const label = `${fmt(start)} \u2013 ${fmt(end)}`;
    setDateLiveLabel(label);
  }, [startISO, endISO]);

  // Fetch users; table is unchanged elsewhere
  const { users, loading: usersLoading, error: usersError } = useUsers({
    limit: 200,
  });

  // Fetch projects per user when needed
  const [projectsByUser, setProjectsByUser] = useState({});
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      // Lazily fetch projects for each user for better accuracy of counts over time.
      // If endpoint not available or fails, gracefully continue with partial data.
      if (!Array.isArray(users) || users.length === 0 || !activeTenantId) {
        setProjectsByUser({});
        return;
      }
      setProjectsLoading(true);
      setProjectsError("");
      const api = getApiClient();
      const acc = {};
      try {
        // Fetch in small batches to avoid overloading backend
        const batchSize = 8;
        for (let i = 0; i < users.length; i += batchSize) {
          const slice = users.slice(i, i + batchSize);
          await Promise.all(
            slice.map(async (u) => {
              if (!u?._id) return;
              try {
                const res = await api.get(
                  `/users/${encodeURIComponent(String(u._id))}/projects`,
                  {
                    params: {
                      organization_id: activeTenantId,
                      from: startISO,
                      to: endISO,
                    },
                  }
                );
                const payload = res.data?.data ?? res.data;
                const list = Array.isArray(payload?.projects)
                  ? payload.projects
                  : [];
                acc[String(u._id)] = list;
              } catch {
                // Ignore individual user fetch errors; rely on others or fallback
                acc[String(u._id)] = acc[String(u._id)] || [];
              }
            })
          );
          if (cancelled) return;
        }
        if (!cancelled) setProjectsByUser(acc);
      } catch (e) {
        if (!cancelled) {
          setProjectsError(e?.message || "Failed to load user projects.");
          setProjectsByUser({});
        }
      } finally {
        if (!cancelled) setProjectsLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [users, activeTenantId, startISO, endISO]);

  // Aggregations
  const aggregates = useMemo(() => {
    // Projects by user count
    const projectsCountByUser = [];
    // Projects by department (from users)
    const projectsByDepartment = new Map();
    // Timeline map by day (no weekly aggregation)
    const byDay = new Map();

    const dayKey = (iso) => {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return null;
      const d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      return d0.toISOString().slice(0, 10);
    };

    const departmentOf = (u) =>
      u?.department ||
      u?.profile?.department ||
      u?.metadata?.department ||
      u?.details?.department ||
      "Unknown";

    // Iterate users
    for (const u of users || []) {
      const uid = String(u?._id || u?.id || "");
      const dept = String(departmentOf(u) || "Unknown");
      const projs = projectsByUser[uid];

      if (Array.isArray(projs)) {
        // Projects by User count
        projectsCountByUser.push({
          user: u?.name || u?.full_name || u?.email || uid,
          user_id: uid,
          count: projs.length,
        });

        // Department contribution: number of projects for user's department
        const prev = projectsByDepartment.get(dept) || 0;
        projectsByDepartment.set(dept, prev + projs.length);

        // Timeline (per-day only)
        for (const p of projs) {
          const lastAct =
            p?.last_activity || p?.lastActivity || p?.created_at || p?.createdAt;
          if (!lastAct) continue;
          const k = dayKey(lastAct);
          if (!k) continue;
          byDay.set(k, (byDay.get(k) || 0) + 1);
        }
      } else {
        // No project list; fall back to user presence (count 0 projects)
        projectsCountByUser.push({
          user: u?.name || u?.full_name || u?.email || uid,
          user_id: uid,
          count: 0,
        });
        const prev = projectsByDepartment.get(dept) || 0;
        projectsByDepartment.set(dept, prev);
      }
    }

    // Normalize department pie data
    const departmentData = Array.from(projectsByDepartment.entries())
      .map(([department, count]) => ({ department, count }))
      .filter(
        (d) =>
          d.department &&
          String(d.department).trim().toLowerCase() !== "unknown"
      );

    // Normalize timeline by filling from selected range
    const start = new Date(startISO);
    const end = new Date(endISO);
    const timeline = [];
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      for (let c = new Date(start); c <= end; c.setDate(c.getDate() + 1)) {
        const key = c.toISOString().slice(0, 10);
        timeline.push({ bucket: key, total: byDay.get(key) || 0 });
      }
    }

    // Sort projectsCountByUser desc
    projectsCountByUser.sort((a, b) => b.count - a.count);

    return { projectsCountByUser, departmentData, timeline };
  }, [users, projectsByUser, startISO, endISO]);

  // Theme colors
  const primary = "#2563EB";
  const secondary = "#F59E0B";
  const grid = "#E5E7EB";
  const subtle = "#6B7280";
  const palette = [
    "#2563EB",
    "#F59E0B",
    "#10B981",
    "#EF4444",
    "#6366F1",
    "#14B8A6",
    "#F97316",
    "#84CC16",
    "#06B6D4",
    "#A855F7",
  ];

  const ariaDateId = "users-analytics-date-label";

  // Handlers
  const handlePreset = (d) => {
    setCustomStart(null);
    setCustomEnd(null);
    setDays(d);
  };

  const onCustomStartChange = (e) => setCustomStart(e.target.value || null);
  const onCustomEndChange = (e) => setCustomEnd(e.target.value || null);

  return (
    <div className={className} style={{ ...style }}>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-header" style={{ paddingBottom: 0, gap: 12 }}>
          <div>
            <h3 className="card-title">Users Analytics</h3>
            <div className="card-subtitle">Projects distribution and timeline</div>
          </div>
          <div
            className="card-actions"
            style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
          >
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: subtle }}>Quick range</span>
              <select
                aria-label="Quick date range"
                value={customStart && customEnd ? "custom" : String(days)}
                onChange={(e) => {
                  if (e.target.value === "custom") {
                    // leave as-is; user will pick dates below
                  } else {
                    handlePreset(Number(e.target.value));
                  }
                }}
                className="ui-input"
                style={{ minWidth: 140 }}
              >
                <option value="7">Last 7 days</option>
                <option value="14">Last 14 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="custom">Custom...</option>
              </select>
            </label>

            <div
              role="group"
              aria-label="Custom date range"
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <input
                type="date"
                aria-label="Start date"
                className="ui-input"
                onChange={onCustomStartChange}
              />
              <span aria-hidden="true" style={{ color: subtle }}>
                to
              </span>
              <input
                type="date"
                aria-label="End date"
                className="ui-input"
                onChange={onCustomEndChange}
              />
            </div>
          </div>
        </div>
        <div className="card-content" style={{ paddingTop: 8 }}>
          <div
            id={ariaDateId}
            aria-live="polite"
            style={{ fontSize: 12, color: subtle, marginBottom: 8 }}
          >
            {dateLiveLabel}
          </div>

          {/* Charts grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 1fr",
              gap: 12,
            }}
          >
            {/* Projects by User */}
            <div className="card" aria-label="Projects by User">
              <div className="card-header" style={{ paddingBottom: 0 }}>
                <h4 className="card-title">Projects by User</h4>
                <div className="card-subtitle">Number of projects per user</div>
              </div>
              <div className="card-content" style={{ height: 340 }}>
                {usersLoading || projectsLoading ? (
                  <div aria-busy="true">
                    <Skeleton width="60%" height={14} className="mb-2" />
                    <Skeleton width="50%" height={12} className="mb-2" />
                    <Skeleton width="100%" height={300} />
                  </div>
                ) : usersError ? (
                  <div className="error" role="alert">
                    {usersError.message || "Failed to load users"}
                  </div>
                ) : projectsError ? (
                  <div className="error" role="alert">
                    {projectsError}
                  </div>
                ) : aggregates.projectsCountByUser.length === 0 ? (
                  <div className="screen-center">No project data</div>
                ) : (
                  <ResponsiveContainer>
                    <BarChart
                      data={aggregates.projectsCountByUser.slice(0, 20)}
                      margin={{ top: 8, right: 16, bottom: 24, left: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={grid} />
                      <XAxis
                        dataKey="user"
                        tick={{ fill: subtle, fontSize: 12 }}
                        interval={0}
                        angle={-25}
                        textAnchor="end"
                        height={50}
                      />
                      <YAxis
                        tick={{ fill: subtle, fontSize: 12 }}
                        allowDecimals={false}
                      />
                      <Tooltip />
                      <Legend />
                      <Bar
                        dataKey="count"
                        name="Projects"
                        fill={primary}
                        stroke={primary}
                        radius={[6, 6, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Projects by Department */}
            <div className="card" aria-label="Projects by Department">
              <div className="card-header" style={{ paddingBottom: 0 }}>
                <h4 className="card-title">Projects by Department</h4>
                <div className="card-subtitle">
                  Distribution of projects by department
                </div>
              </div>
              <div className="card-content" style={{ height: 340 }}>
                {usersLoading || projectsLoading ? (
                  <div aria-busy="true">
                    <div
                      className="skeleton"
                      style={{ height: 14, width: "60%", marginBottom: 8 }}
                    />
                    <div
                      className="skeleton"
                      style={{ height: 12, width: "50%", marginBottom: 8 }}
                    />
                    <div
                      className="skeleton"
                      style={{ height: 260, width: "100%" }}
                    />
                  </div>
                ) : usersError ? (
                  <div className="error" role="alert">
                    {usersError.message || "Failed to load users"}
                  </div>
                ) : projectsError ? (
                  <div className="error" role="alert">
                    {projectsError}
                  </div>
                ) : aggregates.departmentData.length === 0 ? (
                  <div className="screen-center">No department project data</div>
                ) : (
                  <ResponsiveContainer>
                    <PieChart>
                      <Tooltip />
                      <Legend />
                      <Pie
                        data={aggregates.departmentData}
                        dataKey="count"
                        nameKey="department"
                        cx="50%"
                        cy="50%"
                        outerRadius="80%"
                        paddingAngle={2}
                      >
                        {aggregates.departmentData.map((entry, idx) => (
                          <Cell
                            key={entry.department}
                            fill={palette[idx % palette.length]}
                            stroke={palette[idx % palette.length]}
                          />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Timeline across full width */}
            <div
              className="card"
              style={{ gridColumn: "1 / span 2" }}
              aria-label="Projects timeline"
            >
              <div className="card-header" style={{ paddingBottom: 0 }}>
                <h4 className="card-title">Projects timeline</h4>
                <div className="card-subtitle">Projects created over time</div>
              </div>
              <div className="card-content" style={{ height: 320 }}>
                {usersLoading || projectsLoading ? (
                  <div aria-busy="true">
                    <Skeleton width="60%" height={14} className="mb-2" />
                    <Skeleton width="50%" height={12} className="mb-2" />
                    <Skeleton width="100%" height={260} />
                  </div>
                ) : usersError ? (
                  <div className="error" role="alert">
                    {usersError.message || "Failed to load users"}
                  </div>
                ) : projectsError ? (
                  <div className="error" role="alert">
                    {projectsError}
                  </div>
                ) : aggregates.timeline.length === 0 ? (
                  <div className="screen-center">No timeline data</div>
                ) : (
                  <ResponsiveContainer>
                    <LineChart data={aggregates.timeline}>
                      <CartesianGrid strokeDasharray="3 3" stroke={grid} />
                      <XAxis
                        dataKey="bucket"
                        tick={{ fill: subtle, fontSize: 12 }}
                      />
                      <YAxis
                        tick={{ fill: subtle, fontSize: 12 }}
                        allowDecimals={false}
                      />
                      <Tooltip />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="total"
                        name="Projects"
                        stroke={secondary}
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

UsersAnalyticsPanel.propTypes = {
  style: PropTypes.object,
  className: PropTypes.string,
  defaultDays: PropTypes.number,
};
