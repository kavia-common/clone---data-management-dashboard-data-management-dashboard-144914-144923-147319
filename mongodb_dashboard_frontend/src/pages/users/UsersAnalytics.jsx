import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  fetchUsersAnalyticsFilters,
  fetchUsersSummary,
  fetchDailyActiveUsers,
  fetchActiveVsInactive,
  fetchUsersByDepartment,
  fetchTopActiveUsers,
} from "../../api/usersAnalytics";
import LoadingState from "../../components/common/LoadingState";
import ErrorState from "../../components/common/ErrorState";
import Card from "../../components/common/Card";
import UsersAnalyticsFilters from "../../components/users/UsersAnalyticsFilters";
import {
  ResponsiveContainer,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from "recharts";

/**
 * PUBLIC_INTERFACE
 * UsersAnalytics
 * Users Analytics page that renders KPI cards, charts, and tables for user activity.
 * Applies filters (organization_id, department, start_date, end_date) to all widgets,
 * persists them in the URL, and handles loading and error states.
 */
export default function UsersAnalytics() {
  /** Users Analytics page with filters persisted via URL and applied to all widgets. */

  // Read/write filters from URL
  const [filters, setFilters] = useUrlQueryState({
    organization_id: "",
    department: "",
    start_date: "",
    end_date: "",
  });

  const [options, setOptions] = useState({ organizations: [], departments: [] });

  // Data states
  const [summary, setSummary] = useState(null);
  const [dailyActive, setDailyActive] = useState([]);
  const [activeVsInactive, setActiveVsInactive] = useState(null);
  const [byDepartment, setByDepartment] = useState([]);
  const [topActive, setTopActive] = useState([]);

  const [loading, setLoading] = useState(true);
  const [loadingFilters, setLoadingFilters] = useState(true);
  const [error, setError] = useState(null);

  // Fetch filter options
  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        setLoadingFilters(true);
        const res = await fetchUsersAnalyticsFilters();
        if (!ignore) setOptions(res);
      } catch (e) {
        // non-fatal; component renders dropdowns empty
        // eslint-disable-next-line no-console
        console.warn("Failed to load analytics filters", e);
      } finally {
        if (!ignore) setLoadingFilters(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, []);

  // Build params for API calls
  const computedParams = useMemo(() => {
    const base = {};
    if (filters.organization_id) base.organization_id = filters.organization_id;
    if (filters.department) base.department = filters.department;

    const haveRange = Boolean(filters.start_date && filters.end_date);
    if (haveRange) {
      base.start_date =
        filters.start_date.length === 10
          ? `${filters.start_date}T00:00:00Z`
          : filters.start_date;
      base.end_date =
        filters.end_date.length === 10
          ? `${filters.end_date}T23:59:59Z`
          : filters.end_date;
    }
    return { base, haveRange };
  }, [filters]);

  // Load all widgets
  const loadAll = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const kpiParams = { ...computedParams.base };
      const dailyParams = computedParams.haveRange
        ? { ...computedParams.base }
        : { ...computedParams.base, days: 30 };
      const aviParams = computedParams.haveRange
        ? { ...computedParams.base }
        : { ...computedParams.base, windowDays: 14 };
      const byDeptParams = computedParams.haveRange
        ? { ...computedParams.base }
        : { ...computedParams.base, windowDays: 14 };
      const topParams = computedParams.haveRange
        ? { ...computedParams.base, limit: 10 }
        : { ...computedParams.base, limit: 10, windowDays: 30 };

      const [summaryRes, dailyRes, aviRes, byDeptRes, topRes] = await Promise.all([
        fetchUsersSummary(kpiParams),
        fetchDailyActiveUsers(dailyParams),
        fetchActiveVsInactive(aviParams),
        fetchUsersByDepartment(byDeptParams),
        fetchTopActiveUsers(topParams),
      ]);

      setSummary(summaryRes || null);
      setDailyActive(Array.isArray(dailyRes) ? dailyRes : []);
      setActiveVsInactive(aviRes || null);
      setByDepartment(Array.isArray(byDeptRes) ? byDeptRes : []);
      setTopActive(Array.isArray(topRes) ? topRes : []);
    } catch (e) {
      setError(e?.message || "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [computedParams]);

  // Initial and on-filter-change load
  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Handle filter changes from filter bar
  const onFiltersChange = useCallback(
    (next) => {
      setFilters(next);
    },
    [setFilters]
  );

  const dauSeries = useMemo(
    () =>
      (dailyActive || []).map((d) => ({
        date: d?.date || "",
        activeCount: Number(d?.activeCount || 0),
      })),
    [dailyActive]
  );

  const deptSeries = useMemo(
    () =>
      (byDepartment || []).map((d) => ({
        department: d?.department || "Unknown",
        activeCount: Number(d?.activeCount || 0),
      })),
    [byDepartment]
  );

  const splitSeries = useMemo(() => {
    const active = Number(activeVsInactive?.active || 0);
    const inactive = Number(activeVsInactive?.inactive || 0);
    return [
      { name: "Active", value: active },
      { name: "Inactive", value: inactive },
    ];
  }, [activeVsInactive]);
  const totalSplit = splitSeries.reduce((s, x) => s + x.value, 0);
  const pieColors = ["#2563EB", "#F59E0B"];

  return (
    <div className="users-analytics-page" style={{ padding: 8 }}>
      <UsersAnalyticsFilters
        organizations={options.organizations}
        departments={options.departments}
        values={filters}
        onChange={onFiltersChange}
        loading={loading || loadingFilters}
        error={null}
      />

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={loadAll} />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card title="KPIs">
              <div
                className="kpi-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: 12,
                }}
              >
                <Kpi label="Total Active (14d)" value={summary?.totalActive ?? 0} />
                <Kpi label="New Users This Week" value={summary?.newUsersThisWeek ?? 0} />
                <Kpi label="Inactive (30d)" value={summary?.inactive30Days ?? 0} />
                <Kpi
                  label="Compliance"
                  value={`${Math.round(summary?.compliancePct ?? 0)}%`}
                />
                <Kpi label="WAU" value={summary?.WAU ?? 0} />
                <Kpi
                  label="MAU"
                  value={summary?.MAU ?? 0}
                  hint={
                    summary?.generatedAt
                      ? `as of ${new Date(summary.generatedAt).toLocaleString()}`
                      : undefined
                  }
                />
              </div>
            </Card>

            <Card title="Active vs Inactive">
              <div style={{ height: 280, display: "grid", alignItems: "center" }}>
                {totalSplit === 0 ? (
                  <div className="screen-center">No data</div>
                ) : (
                  <ResponsiveContainer>
                    <PieChart>
                      <Legend verticalAlign="top" height={24} wrapperStyle={{ fontSize: 12 }} />
                      <Tooltip wrapperStyle={{ outline: "none" }} />
                      <Pie
                        data={splitSeries}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
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

            <Card title="Top Active Users">
              <div style={{ overflowX: "auto" }}>
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
                    {topActive.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ padding: 12, textAlign: "center" }}>
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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
            <Card title="Active by Department">
              <div style={{ height: 320 }}>
                {deptSeries.length === 0 ? (
                  <div className="screen-center">No data</div>
                ) : (
                  <ResponsiveContainer>
                    <BarChart data={deptSeries} margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="department" tick={{ fontSize: 12 }} minTickGap={24} />
                      <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                      <Tooltip wrapperStyle={{ outline: "none" }} />
                      <Bar dataKey="activeCount" name="Active" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            <Card title="Daily Active Users">
              <div style={{ height: 280 }}>
                {dauSeries.length === 0 ? (
                  <div className="screen-center">No data</div>
                ) : (
                  <ResponsiveContainer>
                    <LineChart data={dauSeries} margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 12 }} tickMargin={8} minTickGap={28} />
                      <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                      <Tooltip wrapperStyle={{ outline: "none" }} />
                      <Legend verticalAlign="top" height={24} wrapperStyle={{ fontSize: 12 }} />
                      <Line
                        type="monotone"
                        dataKey="activeCount"
                        name="Active"
                        stroke="#2563EB"
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function useUrlQueryState(defaults) {
  const location = useLocation();
  const navigate = useNavigate();

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const state = useMemo(() => {
    const entries = {};
    for (const key of Object.keys(defaults)) {
      const v = params.get(key);
      entries[key] = v ?? defaults[key];
    }
    return entries;
  }, [params, defaults]);

  const setState = useCallback(
    (next) => {
      const np = new URLSearchParams(location.search);
      Object.entries(next).forEach(([k, v]) => {
        if (v === undefined || v === null || v === "") {
          np.delete(k);
        } else {
          np.set(k, v);
        }
      });
      navigate({ search: np.toString() }, { replace: false });
    },
    [location.search, navigate]
  );

  return [state, setState];
}

function Kpi({ label, value, hint }) {
  return (
    <div className="kpi" role="group" aria-label={`${label} metric`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {hint ? <div className="kpi-hint">{hint}</div> : null}
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
