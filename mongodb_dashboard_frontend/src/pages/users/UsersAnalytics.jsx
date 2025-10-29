import React, { useEffect, useMemo, useState } from "react";
import {
  getActiveVsInactive,
  getDailyActiveUsers,
  getTopActiveUsers,
  getUsersAnalyticsSummary,
  getUsersByDepartment,
  getDepartmentsFilterOptions,
  getOrganizationsFilterOptions,
} from "../../api/usersAnalytics";
import { getChartTheme } from "../../components/charts/chartTheme";
import LoadingState from "../../components/common/LoadingState";
import ErrorState from "../../components/common/ErrorState";
import Card from "../../components/ui/Card.jsx";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from "recharts";

/**
 * PUBLIC_INTERFACE
 * UsersAnalytics
 * Users Analytics dashboard page rendering:
 * - KPIs (summary)
 * - Daily Active Users (line)
 * - Active by Department (bar)
 * - Active vs Inactive (pie)
 * - Top Active Users (table)
 * Includes scaffold filters (date range, department, organization) as UI only for now.
 */
export default function UsersAnalytics() {
  // Filters scaffold (only date range currently influences DAU via 'days')
  const [days, setDays] = useState(30);
  const [department, setDepartment] = useState("all");
  const [organization, setOrganization] = useState("all");

  // Filter option lists and their states
  const [departments, setDepartments] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [filtersLoading, setFiltersLoading] = useState(true);
  const [filtersError, setFiltersError] = useState("");

  // Data states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [kpis, setKpis] = useState(null);
  const [dau, setDau] = useState([]);
  const [byDept, setByDept] = useState([]);
  const [activeSplit, setActiveSplit] = useState({ active: 0, inactive: 0 });
  const [topActive, setTopActive] = useState([]);

  // Filtered sections specific loading/error
  const [byDeptLoading, setByDeptLoading] = useState(false);
  const [byDeptError, setByDeptError] = useState("");
  const [topActiveLoading, setTopActiveLoading] = useState(false);
  const [topActiveError, setTopActiveError] = useState("");

  const theme = getChartTheme();
  const anim = theme.animation;
  const orange = "#F59E0B"; // Ocean Professional accent for highlights
  const primary = theme.primary; // usually blue
  const pieColors = [orange, theme.primaryActive];

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [summary, dauResp, deptResp, splitResp, topResp] = await Promise.all([
        getUsersAnalyticsSummary(),
        getDailyActiveUsers({ days }),
        getUsersByDepartment({ windowDays: 14 }),
        getActiveVsInactive({ windowDays: 14 }),
        getTopActiveUsers({ limit: 10, windowDays: 30 }),
      ]);

      setKpis(summary || null);
      setDau(Array.isArray(dauResp) ? dauResp : []);
      setByDept(Array.isArray(deptResp) ? deptResp : []);
      setActiveSplit({
        active: Number(splitResp?.active || 0),
        inactive: Number(splitResp?.inactive || 0),
      });
      setTopActive(Array.isArray(topResp) ? topResp : []);
    } catch (e) {
      setError(e?.message || "Failed to load Users Analytics");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  // Load dropdown filter options on mount
  useEffect(() => {
    let mounted = true;
    async function loadFilters() {
      setFiltersLoading(true);
      setFiltersError("");
      try {
        const [deps, orgs] = await Promise.all([
          getDepartmentsFilterOptions(),
          getOrganizationsFilterOptions(),
        ]);
        if (!mounted) return;
        setDepartments(["all", ...deps]);
        setOrganizations(["all", ...orgs]);
      } catch (e) {
        if (!mounted) return;
        setFiltersError(e?.message || "Failed to load filters");
        setDepartments(["all"]);
        setOrganizations(["all"]);
      } finally {
        if (mounted) setFiltersLoading(false);
      }
    }
    loadFilters();
    return () => {
      mounted = false;
    };
  }, []);

  // Memos to shape chart data
  const dauSeries = useMemo(
    () =>
      (dau || []).map((d) => ({
        date: d?.date || "",
        activeCount: Number(d?.activeCount || 0),
      })),
    [dau]
  );

  // Fetch Active by Department with filters
  async function loadByDepartmentFiltered() {
    setByDeptLoading(true);
    setByDeptError("");
    try {
      const params = {
        windowDays: 14,
      };
      if (department && department !== "all") params.department = department;
      if (organization && organization !== "all") params.organization_id = organization;
      const data = await getUsersByDepartment(params);
      setByDept(Array.isArray(data) ? data : []);
    } catch (e) {
      setByDept([]);
      setByDeptError(e?.message || "Failed to load Active by Department");
    } finally {
      setByDeptLoading(false);
    }
  }

  // Fetch Top Active Users with filters
  async function loadTopActiveFiltered() {
    setTopActiveLoading(true);
    setTopActiveError("");
    try {
      const params = { limit: 10, windowDays: 30 };
      if (department && department !== "all") params.department = department;
      if (organization && organization !== "all") params.organization_id = organization;
      const data = await getTopActiveUsers(params);
      setTopActive(Array.isArray(data) ? data : []);
    } catch (e) {
      setTopActive([]);
      setTopActiveError(e?.message || "Failed to load Top Active Users");
    } finally {
      setTopActiveLoading(false);
    }
  }

  // Watch filters and refetch filtered sections
  useEffect(() => {
    loadByDepartmentFiltered();
    loadTopActiveFiltered();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [department, organization]);

  const deptSeries = useMemo(
    () =>
      (byDept || []).map((d) => ({
        department: d?.department || "Unknown",
        activeCount: Number(d?.activeCount || 0),
      })),
    [byDept]
  );

  const splitSeries = useMemo(
    () => [
      { name: "Active", value: Number(activeSplit.active || 0) },
      { name: "Inactive", value: Number(activeSplit.inactive || 0) },
    ],
    [activeSplit]
  );

  const totalSplit = splitSeries.reduce((s, x) => s + x.value, 0);

  // KPI Card component
  const Kpi = ({ label, value, hint }) => (
    <div
      className="kpi"
      role="group"
      aria-label={`${label} metric`}
    >
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {hint ? <div className="kpi-hint">{hint}</div> : null}
    </div>
  );

  // Filters toolbar
  const Filters = (
    <div
      className="toolbar"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
      }}
      aria-label="Users analytics filters"
    >
      <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Date range</span>
        <select
          aria-label="Date range"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="ui-input"
          style={{ minWidth: 160 }}
        >
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={60}>Last 60 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </label>

      <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Department</span>
        <select
          aria-label="Department"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          className="ui-input"
          style={{ minWidth: 180, borderColor: "var(--ocean-border)", borderRadius: 8, padding: "8px 10px" }}
          disabled={filtersLoading}
        >
          {(departments.length ? departments : ["all"]).map((opt) => (
            <option key={`dept-${opt}`} value={opt}>
              {opt === "all" ? "All" : opt}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Organization</span>
        <select
          aria-label="Organization"
          value={organization}
          onChange={(e) => setOrganization(e.target.value)}
          className="ui-input"
          style={{ minWidth: 200, borderColor: "var(--ocean-border)", borderRadius: 8, padding: "8px 10px" }}
          disabled={filtersLoading}
        >
          {(organizations.length ? organizations : ["all"]).map((opt) => (
            <option key={`org-${opt}`} value={opt}>
              {opt === "all" ? "All" : opt}
            </option>
          ))}
        </select>
      </label>

      {filtersError ? (
        <div style={{ color: "#EF4444", fontSize: 12 }} role="alert">
          {filtersError}
        </div>
      ) : null}

      <div style={{ marginLeft: "auto", display: "inline-flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => {
            setDepartment("all");
            setOrganization("all");
          }}
          className="btn btn-ghost"
          style={{ borderColor: "var(--ocean-border)" }}
          aria-label="Clear Filters"
        >
          Clear Filters
        </button>
        <button
          type="button"
          onClick={loadAll}
          className="btn btn-secondary"
          aria-label="Refresh analytics"
        >
          Refresh
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ padding: 8 }}>
      {/* Header */}
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 22 }}>Users Analytics</h2>
        <div style={{ color: "var(--color-text-secondary, #6B7280)", marginTop: 4, fontSize: 14 }}>
          Insights into user activity across your organization
        </div>
      </div>

      {/* Filters */}
      <Card title={null} subtitle={null} actions={Filters} variant="brown" />

      {/* Loading / Error */}
      {loading ? (
        <LoadingState message="Loading analytics..." height={220} />
      ) : error ? (
        <ErrorState message={error} onRetry={loadAll} />
      ) : (
        <>
          {/* KPIs */}
          <div
            className="kpi-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 12,
              margin: "12px 0",
            }}
          >
            <Kpi label="Total Active (14d)" value={kpis?.totalActive ?? 0} />
            <Kpi label="New Users This Week" value={kpis?.newUsersThisWeek ?? 0} />
            <Kpi label="Inactive (30d)" value={kpis?.inactive30Days ?? 0} />
            <Kpi label="Compliance" value={`${(kpis?.compliancePct ?? 0).toFixed(0)}%`} />
            <Kpi label="WAU" value={kpis?.WAU ?? 0} />
            <Kpi label="MAU" value={kpis?.MAU ?? 0} hint={kpis?.generatedAt ? `as of ${new Date(kpis.generatedAt).toLocaleString()}` : undefined} />
          </div>

          {/* Charts Grid */}
          <div
            className="charts-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 12,
            }}
          >
            {/* Daily Active Users Line */}
            <Card title="Daily Active Users" subtitle={`Last ${days} days`} variant="brown">
              <div style={{ height: 280 }}>
                {dauSeries.length === 0 ? (
                  <div className="screen-center">No data</div>
                ) : (
                  <ResponsiveContainer>
                    <LineChart data={dauSeries} margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
                      <XAxis dataKey="date" tick={{ fontSize: 12, fill: theme.axisTick }} tickMargin={8} minTickGap={28} />
                      <YAxis tick={{ fontSize: 12, fill: theme.axisTick }} allowDecimals={false} />
                      <Tooltip
                        wrapperStyle={{ outline: "none" }}
                        contentStyle={{
                          background: theme.tooltip.bg,
                          border: `1px solid ${theme.tooltip.border}`,
                          borderRadius: 8,
                          color: theme.tooltip.text,
                        }}
                      />
                      <Legend verticalAlign="top" height={24} wrapperStyle={{ fontSize: 12 }} />
                      <Line
                        type="monotone"
                        dataKey="activeCount"
                        name="Active"
                        stroke={primary}
                        strokeWidth={2}
                        isAnimationActive={Boolean(anim?.isActive)}
                        animationBegin={anim?.begin ?? 0}
                        animationDuration={anim?.duration ?? 450}
                        animationEasing={anim?.easing ?? "ease-out"}
                        dot={{ r: 2, stroke: theme.primaryActive, strokeWidth: 1, fill: "rgba(37,99,235,0.1)" }}
                        activeDot={{ r: 4, stroke: theme.primaryActive, strokeWidth: 2 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            {/* Active by Department Bar */}
            <Card title="Active by Department" subtitle="Recent 14d" variant="brown">
              <div style={{ height: 320 }}>
                {byDeptLoading ? (
                  <LoadingState message="Loading by department..." height={320} />
                ) : byDeptError ? (
                  <ErrorState message={byDeptError} onRetry={loadByDepartmentFiltered} />
                ) : deptSeries.length === 0 ? (
                  <div className="screen-center">No data</div>
                ) : (
                  <ResponsiveContainer>
                    <BarChart
                      data={deptSeries}
                      margin={{ top: 8, right: 24, bottom: 8, left: 8 }}
                      barCategoryGap={12}
                      aria-label="Active users by department"
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
                      <XAxis dataKey="department" tick={{ fontSize: 12, fill: theme.axisTick }} minTickGap={24} />
                      <YAxis tick={{ fontSize: 12, fill: theme.axisTick }} allowDecimals={false} />
                      <Tooltip
                        wrapperStyle={{ outline: "none" }}
                        contentStyle={{
                          background: theme.tooltip.bg,
                          border: `1px solid ${theme.tooltip.border}`,
                          borderRadius: 8,
                          color: theme.tooltip.text,
                        }}
                      />
                      <Bar
                        dataKey="activeCount"
                        name="Active"
                        fill={orange}
                        stroke={theme.primaryActive}
                        isAnimationActive={Boolean(anim?.isActive)}
                        animationBegin={anim?.begin ?? 0}
                        animationDuration={anim?.duration ?? 450}
                        animationEasing={anim?.easing ?? "ease-out"}
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            {/* Active vs Inactive Pie */}
            <Card title="Active vs Inactive" subtitle="Recent 14d" variant="brown">
              <div style={{ height: 320, display: "grid", gridTemplateColumns: "1fr", alignItems: "center" }}>
                {totalSplit === 0 ? (
                  <div className="screen-center">No data</div>
                ) : (
                  <ResponsiveContainer>
                    <PieChart>
                      <Legend verticalAlign="top" height={24} wrapperStyle={{ fontSize: 12 }} />
                      <Tooltip
                        wrapperStyle={{ outline: "none" }}
                        contentStyle={{
                          background: theme.tooltip.bg,
                          border: `1px solid ${theme.tooltip.border}`,
                          borderRadius: 8,
                          color: theme.tooltip.text,
                        }}
                      />
                      <Pie
                        data={splitSeries}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        isAnimationActive={Boolean(anim?.isActive)}
                        animationBegin={anim?.begin ?? 0}
                        animationDuration={anim?.duration ?? 450}
                        animationEasing={anim?.easing ?? "ease-out"}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      >
                        {splitSeries.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={pieColors[index % pieColors.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            {/* Top Active Users Table */}
            <Card title="Top Active Users" subtitle="Recent 30d" variant="brown">
              <div style={{ overflowX: "auto" }}>
                {topActiveLoading ? (
                  <LoadingState message="Loading top active users..." height={220} />
                ) : topActiveError ? (
                  <ErrorState message={topActiveError} onRetry={loadTopActiveFiltered} />
                ) : null}
                <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>User</th>
                      <th style={thStyle}>Email</th>
                      <th style={thStyle}>Department</th>
                      <th style={thStyle}>Organization</th>
                      <th style={thStyle}>Last Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!topActiveLoading && !topActiveError && topActive.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ padding: 12, textAlign: "center", color: "var(--color-text-secondary)" }}>
                          No data
                        </td>
                      </tr>
                    ) : (
                      topActive.map((u, idx) => (
                        <tr key={`${u.user_id}-${idx}`} style={idx % 2 ? trAlt : undefined}>
                          <td style={tdStyle}>{u?.name || u?.user_id || "Unknown"}</td>
                          <td style={tdStyle}>{u?.email || "-"}</td>
                          <td style={tdStyle}>{u?.department || "-"}</td>
                          <td style={tdStyle}>{u?.organization_id || "-"}</td>
                          <td style={tdStyle}>
                            {u?.last_active_at ? new Date(u.last_active_at).toLocaleString() : "-"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

const thStyle = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid var(--color-border, #E5E7EB)",
  color: "var(--color-text-secondary, #6B7280)",
  fontWeight: 600,
  fontSize: 12,
};
const tdStyle = {
  padding: "10px 8px",
  borderBottom: "1px solid var(--color-border, #E5E7EB)",
  fontSize: 13,
  color: "var(--color-text-primary, #111827)",
};
const trAlt = { background: "rgba(0,0,0,0.015)" };
