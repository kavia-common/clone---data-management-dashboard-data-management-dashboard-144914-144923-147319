import React, { useEffect, useMemo, useState } from "react";
import "./UsersAnalytics.css";
import UICard from "../../components/ui/Card";
import LoadingState from "../../components/common/LoadingState";
import ErrorState from "../../components/common/ErrorState";
import DataTable from "../../components/DataTable";
import {
  fetchUsersAnalyticsOverview,
  fetchDailyActiveUsers,
  fetchByDepartment,
  fetchActiveVsInactive,
  fetchTopActiveUsers,
} from "../../api/usersAnalyticsOverview";
import { format } from "date-fns";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, Legend, PieChart, Pie, Cell } from "recharts";

/**
 * Users Analytics Page
 * - KPI cards: totalActiveUsers, newUsersThisWeek, inactiveUsers30d, compliancePercent
 * - Line chart: Daily Active Users (last 30 days)
 * - Bar chart: Active Users by Department
 * - Pie chart: Active vs Inactive
 * - Table: Top 10 Most Active Users
 * - Organization filter: appends ?organization_id=... to all requests if set
 */

// lightweight KPI Card
function KpiCard({ title, value, accent = "#2563EB" }) {
  return (
    <div className="ua-kpi-card">
      <div className="ua-kpi-title">{title}</div>
      <div className="ua-kpi-value" style={{ color: accent }}>{value ?? "-"}</div>
    </div>
  );
}

const PIE_COLORS = ["#2563EB", "#F59E0B"];

function numberOrDash(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return v;
}

function ensureQSParams(params) {
  const copy = { ...params };
  Object.keys(copy).forEach((k) => {
    if (copy[k] === undefined || copy[k] === null || copy[k] === "") delete copy[k];
  });
  return copy;
}

export default function UsersAnalytics() {
  const [organizationId, setOrganizationId] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const [overview, setOverview] = useState(null);
  const [dailyActive, setDailyActive] = useState([]);
  const [byDept, setByDept] = useState([]);
  const [activeSplit, setActiveSplit] = useState({ active: 0, inactive: 0 });
  const [topUsers, setTopUsers] = useState([]);

  const queryBase = useMemo(() => ensureQSParams({ organization_id: organizationId }), [organizationId]);

  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      setLoading(true);
      setErr(null);
      try {
        const [ov, dau, dept, split, top] = await Promise.all([
          fetchUsersAnalyticsOverview(queryBase),
          fetchDailyActiveUsers({ ...queryBase, days: 30 }),
          fetchByDepartment(queryBase),
          fetchActiveVsInactive(queryBase),
          fetchTopActiveUsers({ ...queryBase, limit: 10 }),
        ]);

        if (cancelled) return;

        setOverview(ov || {});
        // daily active normalization: supports either {items:[{date,total}]} or array [{bucket/count}] or [{date/count}]
        let dauPoints = [];
        if (Array.isArray(dau)) {
          dauPoints = dau;
        } else if (dau && Array.isArray(dau.items)) {
          dauPoints = dau.items;
        } else if (dau && Array.isArray(dau.points)) {
          dauPoints = dau.points;
        }
        const shapedDau = dauPoints.map((p) => {
          const dateStr = p.date || p.bucket;
          const count = p.count ?? p.total ?? 0;
          // Try human-friendly date label
          let label = dateStr;
          try {
            // accept YYYY-MM-DD or ISO
            const d = new Date(dateStr);
            label = isNaN(d.getTime()) ? dateStr : format(d, "MMM d");
          } catch {
            // keep original
          }
          return { date: label, count };
        });
        setDailyActive(shapedDau);

        // department normalization: accept array of {department, count} or envelope {items:[]}
        let deptItems = Array.isArray(dept) ? dept : (dept?.items || []);
        const shapedDept = deptItems.map((d) => ({
          department: d.department || d._id || "Unknown",
          count: d.count ?? d.total ?? 0,
        }));
        setByDept(shapedDept);

        // active vs inactive normalization
        const splitData = {
          active: split?.active ?? split?.activeUsers ?? 0,
          inactive: split?.inactive ?? split?.inactiveUsers ?? 0,
        };
        setActiveSplit(splitData);

        // top users: accept array or {items:[]}
        const t = Array.isArray(top) ? top : (top?.items || []);
        setTopUsers(t.slice(0, 10));
      } catch (e) {
        console.error(e);
        setErr(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadAll();
    return () => {
      cancelled = true;
    };
  }, [queryBase]);

  const pieData = useMemo(
    () => [
      { name: "Active", value: activeSplit.active || 0 },
      { name: "Inactive", value: activeSplit.inactive || 0 },
    ],
    [activeSplit]
  );

  const topUsersColumns = useMemo(
    () => [
      { Header: "Name", accessor: (r) => r.name || r.full_name || r.displayName || "-" },
      { Header: "Email", accessor: (r) => r.email || "-" },
      { Header: "Department", accessor: (r) => r.department || "-" },
      {
        Header: "Last Active",
        accessor: (r) => {
          const ts = r.lastActive || r.updated_at || r.last_activity || r.last_activity_at;
          if (!ts) return "-";
          try {
            const d = new Date(ts);
            return isNaN(d.getTime()) ? ts : format(d, "PP p");
          } catch {
            return ts;
          }
        },
      },
      {
        Header: "Activity Score",
        accessor: (r) => numberOrDash(r.activityScore ?? r.activity_score),
      },
    ],
    []
  );

  return (
    <div className="ua-container">
      <div className="ua-header">
        <h2>Users Analytics</h2>
        <div className="ua-filters">
          <label className="ua-filter-label" htmlFor="orgId">Organization ID</label>
          <input
            id="orgId"
            className="ua-filter-input"
            placeholder="e.g. org_123"
            value={organizationId}
            onChange={(e) => setOrganizationId(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <LoadingState message="Loading users analytics..." />
      ) : err ? (
        <ErrorState title="Failed to load Users Analytics" error={err?.message || String(err)} />
      ) : (
        <>
          <div className="ua-kpi-grid">
            <UICard>
              <KpiCard title="Active Users" value={numberOrDash(overview?.totalActiveUsers)} accent="#2563EB" />
            </UICard>
            <UICard>
              <KpiCard title="New Users (This Week)" value={numberOrDash(overview?.newUsersThisWeek)} accent="#10B981" />
            </UICard>
            <UICard>
              <KpiCard title="Inactive (30d)" value={numberOrDash(overview?.inactiveUsers30d)} accent="#EF4444" />
            </UICard>
            <UICard>
              <KpiCard title="Compliance %" value={overview?.compliancePercent != null ? `${overview.compliancePercent}%` : "-"} accent="#F59E0B" />
            </UICard>
          </div>

          <div className="ua-charts-grid">
            <UICard>
              <div className="ua-card-title">Daily Active Users (30 days)</div>
              <div className="ua-chart-area">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={dailyActive}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Line type="monotone" dataKey="count" stroke="#2563EB" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </UICard>

            <UICard>
              <div className="ua-card-title">Active Users by Department</div>
              <div className="ua-chart-area">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={byDept}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="department" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#F59E0B" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </UICard>

            <UICard>
              <div className="ua-card-title">Active vs Inactive</div>
              <div className="ua-chart-area">
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Legend />
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </UICard>
          </div>

          <UICard>
            <div className="ua-card-title">Top 10 Most Active Users</div>
            <DataTable
              data={topUsers}
              columns={topUsersColumns}
              pageSize={10}
            />
          </UICard>
        </>
      )}
    </div>
  );
}
