import React, { useEffect, useMemo, useState, useCallback } from "react";
import Card from "../../components/ui/Card.jsx";
import Skeleton from "../../components/ui/Skeleton.jsx";
import { listUsers, listSessions, listDeployments, health } from "../../api";
import { fetchSessionTracking } from "../../api/sessionTracking";
import LoadingState from "../../components/common/LoadingState";
import ErrorState from "../../components/common/ErrorState";
import KPIChart from "../../components/charts/KPIChart.jsx";
import TimeBucketFilter from "../../components/common/TimeBucketFilter.jsx";
import { getActiveUsersTrend } from "../../api/usersActiveTrend";

/**
 * Utility functions to bucket timestamps by day/week and compute counts.
 * We normalize dates to YYYY-MM-DD for day buckets and ISO week start for weekly buckets.
 * These mirror utils/sessions/bucketing.js to avoid cross-import churn in this page.
 */
function toYMD(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

/**
 * Compute ISO start/end based on a range key and optional custom date inputs.
 */
function computeRange(rangeKey, customRange) {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  let start = new Date(end);
  if (rangeKey === "7d") start.setDate(end.getDate() - 6);
  else if (rangeKey === "14d") start.setDate(end.getDate() - 13);
  else if (rangeKey === "30d") start.setDate(end.getDate() - 29);
  else if (rangeKey === "custom" && customRange.start && customRange.end) {
    const s = new Date(customRange.start);
    const e = new Date(customRange.end);
    s.setHours(0, 0, 0, 0);
    e.setHours(23, 59, 59, 999);
    return { startISO: s.toISOString(), endISO: e.toISOString() };
  } else {
    start.setDate(end.getDate() - 29);
  }
  start.setHours(0, 0, 0, 0);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

/**
 * PUBLIC_INTERFACE
 * Overview
 */
export default function Overview() {
  /** Overview page with KPIs and three trend charts (Sessions, Users, Costs). */
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({ users: 0, sessions: 0, deployments: 0 });
  const [error, setError] = useState("");
  const [, setApiStatus] = useState("checking");

  // Sessions controls (independent)
  const [sessionsRangeKey, setSessionsRangeKey] = useState("30d"); // default last 30 days
  const [sessionsCustomRange, setSessionsCustomRange] = useState({ start: null, end: null });
  const [sessionsGranularity, setSessionsGranularity] = useState("daily"); // 'daily' | 'weekly' (monthly maps to weekly)

  // Users controls (independent)
  const [usersRangeKey, setUsersRangeKey] = useState("30d");
  const [usersCustomRange, setUsersCustomRange] = useState({ start: null, end: null });
  const [usersGranularity, setUsersGranularity] = useState("daily");
  const [usersStatus, setUsersStatus] = useState("active"); // 'active' | 'all'

  // Costs controls (kept separate)
  const [costsRangeKey, setCostsRangeKey] = useState("30d");
  const [costsCustomRange, setCostsCustomRange] = useState({ start: null, end: null });
  const [costsGranularity, setCostsGranularity] = useState("daily");

  // Sessions chart state
  const [sessionsSeries, setSessionsSeries] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState(null);

  // Users chart state
  const [usersSeries, setUsersSeries] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState(null);

  // Costs chart state
  const [costsSeries, setCostsSeries] = useState([]);
  const [costsLoading, setCostsLoading] = useState(false);
  const [costsError, setCostsError] = useState(null);

  // KPI metrics
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError("");
      try {
        const [users, sessions, deployments] = await Promise.all([
          listUsers({ limit: 5 }),
          listSessions({ limit: 5 }),
          listDeployments({ limit: 5 }),
        ]);
        setMetrics({
          users: users?.total || users?.length || 0,
          sessions: sessions?.total || sessions?.length || 0,
          deployments: deployments?.total || deployments?.length || 0,
        });
      } catch (e) {
        setError(e?.response?.data?.message || e?.message || "Failed to load overview data.");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // Backend health check (non-blocking)
  useEffect(() => {
    let mounted = true;
    async function ping() {
      try {
        const info = await health();
        if (!mounted) return;
        setApiStatus(info ? "ok" : "error");
      } catch {
        if (!mounted) return;
        setApiStatus("error");
      }
    }
    ping();
    return () => {
      mounted = false;
    };
  }, []);

  // Helper to fill continuous daily/weekly series from a Map
  const fillSeries = useCallback(function fillSeries(map, start, end, bucket = "daily") {
    const s = new Date(start);
    const e = new Date(end);
    const series = [];
    if (bucket === "weekly") {
      let c = startOfWeek(s);
      while (c <= e) {
        const key = toYMD(c);
        series.push({ label: key, value: map.get(key) || 0 });
        c = new Date(c);
        c.setDate(c.getDate() + 7);
      }
    } else {
      let c = new Date(s);
      c.setHours(0, 0, 0, 0);
      while (c <= e) {
        const key = toYMD(c);
        series.push({ label: key, value: map.get(key) || 0 });
        c = new Date(c);
        c.setDate(c.getDate() + 1);
      }
    }
    return series;
  }, []);

  // Derived ISO ranges for each chart
  const sessionsRange = useMemo(
    () => computeRange(sessionsRangeKey, sessionsCustomRange),
    [sessionsRangeKey, sessionsCustomRange.start, sessionsCustomRange.end]
  );
  const usersRange = useMemo(
    () => computeRange(usersRangeKey, usersCustomRange),
    [usersRangeKey, usersCustomRange.start, usersCustomRange.end]
  );
  const costsRange = useMemo(
    () => computeRange(costsRangeKey, costsCustomRange),
    [costsRangeKey, costsCustomRange.start, costsCustomRange.end]
  );

  // Sessions trend fetcher — independent
  useEffect(() => {
    let aborted = false;
    async function loadSessions() {
      setSessionsLoading(true);
      setSessionsError(null);
      try {
        const { startISO, endISO } = sessionsRange;
        const { items } = await fetchSessionTracking({
          // Provide multiple shapes: from/to and start/end plus convenience keys
          from: startISO,
          to: endISO,
          start_date: startISO,
          end_date: endISO,
          limit: 200,
          sort: "-session_start",
          // Fallback server filter if direct params ignored
          filter: {
            $or: [
              { session_start: { $gte: startISO, $lte: endISO } },
              { session_end: { $gte: startISO, $lte: endISO } },
            ],
          },
        });
        if (aborted) return;

        const pts = (items || [])
          .map((it) => {
            const t =
              it.session_start ||
              it.last_updated ||
              it.updated_at ||
              it.startedAt ||
              it.createdAt ||
              it.timestamp ||
              it.lastActivityAt ||
              it.endedAt ||
              it.date;
            return t ? new Date(t) : null;
          })
          .filter((d) => d && !Number.isNaN(d.getTime()));

        const map = new Map();
        if (sessionsGranularity === "weekly") {
          pts.forEach((d) => {
            const wk = startOfWeek(d);
            const k = toYMD(wk);
            map.set(k, (map.get(k) || 0) + 1);
          });
        } else {
          pts.forEach((d) => {
            const k = toYMD(d);
            map.set(k, (map.get(k) || 0) + 1);
          });
        }

        setSessionsSeries(fillSeries(map, sessionsRange.startISO, sessionsRange.endISO, sessionsGranularity));
      } catch (e) {
        if (aborted) return;
        setSessionsError(e);
        setSessionsSeries([]);
      } finally {
        if (!aborted) setSessionsLoading(false);
      }
    }
    if (sessionsRange.startISO && sessionsRange.endISO) loadSessions();
    return () => {
      aborted = true;
    };
  }, [sessionsRange.startISO, sessionsRange.endISO, sessionsGranularity, fillSeries]);

  // Users trend fetcher — independent
  useEffect(() => {
    let aborted = false;
    async function loadUsers() {
      setUsersLoading(true);
      setUsersError(null);
      try {
        const { startISO, endISO } = usersRange;
        const backendGranularity = usersGranularity === "weekly" ? "week" : "day";
        const statusParam = usersStatus === "active" ? "completed|active" : undefined;

        let items = [];
        let backendOk = false;
        try {
          const resp = await getActiveUsersTrend({
            from: startISO,
            to: endISO,
            granularity: backendGranularity,
            status: statusParam,
          });
          items = Array.isArray(resp?.items) ? resp.items : [];
          backendOk = items.length > 0 || Array.isArray(resp?.items);
        } catch {
          backendOk = false;
        }

        if (!backendOk) {
          // Fallback: derive from users collection using created_at for bucketing plus status filter
          const createdFilter = {
            $and: [
              {
                $or: [
                  { created_at: { $gte: startISO, $lte: endISO } },
                  { createdAt: { $gte: startISO, $lte: endISO } },
                ],
              },
              // status filter: if 'active' exclude deleted; if 'all' do not filter
              ...(usersStatus === "active"
                ? [{ $or: [{ status: { $exists: false } }, { status: { $nin: ["deleted", "inactive"] } }] }]
                : []),
            ],
          };

          const usersRes = await listUsers({
            // Directly stringify the filter; listUsers will sanitize endpoint-specific params
            filter: JSON.stringify(createdFilter),
            limit: 2000,
            sort: "-created_at",
          });

          const users = usersRes?.items || (Array.isArray(usersRes) ? usersRes : []);
          const bucketUsers = new Map();
          users.forEach((u) => {
            const t = u.created_at || u.createdAt || u.date;
            const d = t ? new Date(t) : null;
            if (!d || Number.isNaN(d.getTime())) return;
            const key = usersGranularity === "weekly" ? toYMD(startOfWeek(d)) : toYMD(d);
            const uid = String(u._id ?? u.id ?? u.user_id ?? u.userId ?? u.email ?? "");
            if (!uid) return;
            if (!bucketUsers.has(key)) bucketUsers.set(key, new Set());
            bucketUsers.get(key).add(uid);
          });

          items = Array.from(bucketUsers.entries()).map(([date, set]) => ({
            date,
            total: (set && set.size) || 0,
          }));
        }

        if (aborted) return;

        const map = new Map();
        (items || []).forEach((row) => {
          const label = row.date || row.label || row.day || row.week;
          const total = Number(row.total ?? row.count ?? row.value ?? 0);
          if (!label) return;
          map.set(String(label), (map.get(String(label)) || 0) + (Number.isFinite(total) ? total : 0));
        });

        const series = fillSeries(map, usersRange.startISO, usersRange.endISO, usersGranularity);
        setUsersSeries(series);
      } catch (e) {
        if (aborted) return;
        setUsersError(e);
        setUsersSeries([]);
      } finally {
        if (!aborted) setUsersLoading(false);
      }
    }
    if (usersRange.startISO && usersRange.endISO) loadUsers();
    return () => {
      aborted = true;
    };
  }, [usersRange.startISO, usersRange.endISO, usersGranularity, usersStatus, fillSeries]);

  // Costs trend fetcher — independent (analytics-only)
  useEffect(() => {
    let aborted = false;
    async function loadCosts() {
      setCostsLoading(true);
      setCostsError(null);
      try {
        const { startISO, endISO } = costsRange;

        // Map UI granularity to backend enum
        const backendGranularity =
          costsGranularity === "weekly" ? "week" : costsGranularity === "daily" ? "day" : "month";

        const { getLlmCostsOverTime } = await import("../../api/llmCostsAnalytics.js"); // stable helper (aggregates from /api/llm-costs)
        const analytics = await getLlmCostsOverTime({
          granularity: backendGranularity,
          from: startISO,
          to: endISO,
        });

        // Normalize to aligned labels/data, parse currency to number
        const labels = Array.isArray(analytics?.labels) ? analytics.labels : [];
        const ds = Array.isArray(analytics?.datasets) ? analytics.datasets[0] : null;
        const dataRaw = Array.isArray(ds?.data) ? ds.data : [];

        const toNumber = (v) => {
          if (typeof v === "number") return Number.isFinite(v) ? v : 0;
          if (typeof v === "string") {
            const n = Number(v.replace(/[$,]/g, ""));
            return Number.isFinite(n) ? n : 0;
          }
          if (v == null) return 0;
          const n = Number(v);
          return Number.isFinite(n) ? n : 0;
        };

        const data = dataRaw.map(toNumber);
        const L = Math.min(labels.length, data.length);
        let series;

        if (L > 0) {
          series = labels.slice(0, L).map((label, idx) => ({
            label: String(label),
            value: data[idx],
          }));
        } else {
          // Safeguard for empty analytics: render zeroed series across the selected period
          const map = new Map();
          series = fillSeries(map, startISO, endISO, costsGranularity).map((p) => ({
            ...p,
            value: 0,
          }));
        }

        if (aborted) return;
        setCostsSeries(series);
      } catch (e) {
        if (aborted) return;
        setCostsError(e);
        setCostsSeries([]);
      } finally {
        if (!aborted) setCostsLoading(false);
      }
    }
    if (costsRange.startISO && costsRange.endISO) loadCosts();
    return () => {
      aborted = true;
    };
  }, [costsRange.startISO, costsRange.endISO, costsGranularity, fillSeries]);

  // Reusable controls renderers (per-chart)
  const renderDateRangeLabel = useCallback((rangeKey, customRange, range) => {
    if (rangeKey === "custom") {
      const opts = { year: "numeric", month: "short", day: "numeric" };
      const hasStart = Boolean(customRange.start);
      const hasEnd = Boolean(customRange.end);
      const fmtStart = hasStart ? new Date(customRange.start).toLocaleDateString(undefined, opts) : null;
      const fmtEnd = hasEnd ? new Date(customRange.end).toLocaleDateString(undefined, opts) : null;
      if (hasStart && hasEnd) return `Filtered: ${fmtStart} — ${fmtEnd}`;
      if (hasStart) return `From ${fmtStart}`;
      if (hasEnd) return `Until ${fmtEnd}`;
      return "";
    }
    if (!range?.startISO || !range?.endISO) return "";
    const start = new Date(range.startISO);
    const end = new Date(range.endISO);
    const opts = { year: "numeric", month: "short", day: "numeric" };
    return `Filtered: ${start.toLocaleDateString(undefined, opts)} — ${end.toLocaleDateString(undefined, opts)}`;
  }, []);

  const DateRangePill = ({ label }) => (
    <span
      aria-live="polite"
      aria-atomic="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 8px",
        borderRadius: 999,
        fontSize: 12,
        color: "#1F2937",
        background: "#EFF6FF",
        border: "1px solid #BFDBFE",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );

  // Per-chart time range selectors and bucket toggles
  const SessionsControls = (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <div style={{ display: "flex", gap: 6, background: "#fff", border: "1px solid #E5E7EB", borderRadius: 8, padding: 4 }}>
        {["7d", "14d", "30d", "custom"].map((key) => (
          <button
            key={key}
            onClick={() => setSessionsRangeKey(key)}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "none",
              background: sessionsRangeKey === key ? "#2563EB" : "transparent",
              color: sessionsRangeKey === key ? "#fff" : "#111827",
              cursor: "pointer",
              transition: "background 120ms ease, color 120ms ease",
            }}
            aria-pressed={sessionsRangeKey === key}
          >
            {key.toUpperCase()}
          </button>
        ))}
      </div>
      <DateRangePill label={renderDateRangeLabel(sessionsRangeKey, sessionsCustomRange, sessionsRange)} />
      <TimeBucketFilter
        value={sessionsGranularity}
        onChange={(v) => setSessionsGranularity(v === "monthly" ? "weekly" : v)}
        options={[
          { value: "daily", label: "Daily" },
          { value: "weekly", label: "Weekly" },
          { value: "monthly", label: "Monthly" },
        ]}
      />
      <button
        type="button"
        onClick={() => {
          setSessionsRangeKey("7d");
          setSessionsCustomRange({ start: null, end: null });
        }}
        className="btn btn-ghost"
        aria-label="Clear sessions filters"
        style={{ marginLeft: 8 }}
      >
        Clear
      </button>
    </div>
  );

  const UsersControls = (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 6, background: "#fff", border: "1px solid #E5E7EB", borderRadius: 8, padding: 4 }}>
        {["7d", "14d", "30d", "custom"].map((key) => (
          <button
            key={key}
            onClick={() => setUsersRangeKey(key)}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "none",
              background: usersRangeKey === key ? "#2563EB" : "transparent",
              color: usersRangeKey === key ? "#fff" : "#111827",
              cursor: "pointer",
              transition: "background 120ms ease, color 120ms ease",
            }}
            aria-pressed={usersRangeKey === key}
          >
            {key.toUpperCase()}
          </button>
        ))}
      </div>
      <DateRangePill label={renderDateRangeLabel(usersRangeKey, usersCustomRange, usersRange)} />
      <TimeBucketFilter
        value={usersGranularity}
        onChange={(v) => setUsersGranularity(v === "monthly" ? "weekly" : v)}
        options={[
          { value: "daily", label: "Daily" },
          { value: "weekly", label: "Weekly" },
          { value: "monthly", label: "Monthly" },
        ]}
      />
      <div style={{ marginLeft: "auto", display: "inline-flex", gap: 8, alignItems: "center" }}>
        <label htmlFor="users-status-filter" style={{ fontSize: 12, color: "#6B7280" }}>
          Status
        </label>
        <div
          id="users-status-filter"
          role="group"
          aria-label="Users status filter"
          style={{ display: "inline-flex", border: "1px solid #E5E7EB", borderRadius: 8, overflow: "hidden", background: "#fff" }}
        >
          {[
            { key: "active", label: "Active" },
            { key: "all", label: "All" },
          ].map((opt, idx) => {
            const active = usersStatus === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setUsersStatus(opt.key)}
                aria-pressed={active}
                style={{
                  padding: "6px 10px",
                  border: "none",
                  background: active ? "#0EA5E9" : "transparent",
                  color: active ? "#fff" : "#111827",
                  borderRight: idx === 0 ? "1px solid #E5E7EB" : "none",
                  cursor: "pointer",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          setUsersRangeKey("7d");
          setUsersCustomRange({ start: null, end: null });
          setUsersGranularity("daily");
          setUsersStatus("active");
        }}
        className="btn btn-ghost"
        aria-label="Clear users filters"
        style={{ marginLeft: 8 }}
      >
        Clear
      </button>
    </div>
  );

  const CostsControls = (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <div style={{ display: "flex", gap: 6, background: "#fff", border: "1px solid #E5E7EB", borderRadius: 8, padding: 4 }}>
        {["7d", "14d", "30d", "custom"].map((key) => (
          <button
            key={key}
            onClick={() => setCostsRangeKey(key)}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "none",
              background: costsRangeKey === key ? "#2563EB" : "transparent",
              color: costsRangeKey === key ? "#fff" : "#111827",
              cursor: "pointer",
              transition: "background 120ms ease, color 120ms ease",
            }}
            aria-pressed={costsRangeKey === key}
          >
            {key.toUpperCase()}
          </button>
        ))}
      </div>
      <DateRangePill label={renderDateRangeLabel(costsRangeKey, costsCustomRange, costsRange)} />
      <TimeBucketFilter
        value={costsGranularity}
        onChange={(v) => setCostsGranularity(v === "monthly" ? "weekly" : v)}
        options={[
          { value: "daily", label: "Daily" },
          { value: "weekly", label: "Weekly" },
          { value: "monthly", label: "Monthly" },
        ]}
      />
      <button
        type="button"
        onClick={() => {
          setCostsRangeKey("7d");
          setCostsCustomRange({ start: null, end: null });
          setCostsGranularity("daily");
        }}
        className="btn btn-ghost"
        aria-label="Clear costs filters"
        style={{ marginLeft: 8 }}
      >
        Clear
      </button>
    </div>
  );

  return (
    <div className="grid">
      {/* KPI cards row */}
      <Card title="Users" subtitle="Total referral users" className="kpi-card">
        <div className="kpi">
          <div className="kpi-value">
            {loading ? (
              <Skeleton width={72} height={28} aria-label="Loading users metric" />
            ) : (
              metrics.users
            )}
          </div>
          <div className="kpi-label">Users</div>
        </div>
      </Card>

      <Card title="Sessions" subtitle="Active and historical sessions" className="kpi-card">
        <div className="kpi">
          <div className="kpi-value">
            {loading ? (
              <Skeleton width={72} height={28} aria-label="Loading sessions metric" />
            ) : (
              metrics.sessions
            )}
          </div>
          <div className="kpi-label">Sessions</div>
        </div>
      </Card>

      <Card title="Deployments" subtitle="Recent app deployments" className="kpi-card">
        <div className="kpi">
          <div className="kpi-value">
            {loading ? (
              <Skeleton width={72} height={28} aria-label="Loading deployments metric" />
            ) : (
              metrics.deployments
            )}
          </div>
          <div className="kpi-label">Deployments</div>
        </div>
      </Card>

      {/* Sessions Trend */}
      <div className="block-full" style={{ gridColumn: "1 / -1" }}>
        <Card
          title="Sessions Trend"
          subtitle="Session counts over time"
          actions={SessionsControls}
        >
          {sessionsRangeKey === "custom" ? (
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ fontSize: 12, color: "#6B7280" }}>
                  Start:
                  <input
                    type="date"
                    onChange={(e) => setSessionsCustomRange((r) => ({ ...r, start: e.target.value }))}
                    value={sessionsCustomRange.start || ""}
                    style={{ marginLeft: 6 }}
                    aria-label="Sessions custom range start date"
                  />
                </label>
                <label style={{ fontSize: 12, color: "#6B7280" }}>
                  End:
                  <input
                    type="date"
                    onChange={(e) => setSessionsCustomRange((r) => ({ ...r, end: e.target.value }))}
                    value={sessionsCustomRange.end || ""}
                    style={{ marginLeft: 6 }}
                    aria-label="Sessions custom range end date"
                  />
                </label>
              </div>
            </div>
          ) : (
            sessionsRangeKey === "custom" && (!sessionsCustomRange.start || !sessionsCustomRange.end) ? (
              <div style={{ marginBottom: 8, color: "#6B7280", fontSize: 12 }}>
                Select start and end dates to apply custom range.
              </div>
            ) : null
          )}
          {sessionsLoading && <LoadingState message="Loading sessions trend…" height={220} />}
          {sessionsError && <ErrorState message={sessionsError?.message || "Failed to load sessions."} />}
          {!sessionsLoading && !sessionsError && (
            <KPIChart data={sessionsSeries} xKey="label" yKey="value" color="#2563EB" />
          )}
        </Card>
      </div>

      {/* Users Trend */}
      <div className="block-full" style={{ gridColumn: "1 / -1" }}>
        <Card
          title="Users over time"
          subtitle="Distinct active users by day/week"
          actions={UsersControls}
        >
          {usersRangeKey === "custom" ? (
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ fontSize: 12, color: "#6B7280" }}>
                  Start:
                  <input
                    type="date"
                    onChange={(e) => setUsersCustomRange((r) => ({ ...r, start: e.target.value }))}
                    value={usersCustomRange.start || ""}
                    style={{ marginLeft: 6 }}
                    aria-label="Users custom range start date"
                  />
                </label>
                <label style={{ fontSize: 12, color: "#6B7280" }}>
                  End:
                  <input
                    type="date"
                    onChange={(e) => setUsersCustomRange((r) => ({ ...r, end: e.target.value }))}
                    value={usersCustomRange.end || ""}
                    style={{ marginLeft: 6 }}
                    aria-label="Users custom range end date"
                  />
                </label>
              </div>
            </div>
          ) : (
            usersRangeKey === "custom" && (!usersCustomRange.start || !usersCustomRange.end) ? (
              <div style={{ marginBottom: 8, color: "#6B7280", fontSize: 12 }}>
                Select start and end dates to apply custom range.
              </div>
            ) : null
          )}
          {usersLoading && <LoadingState message="Loading users trend…" height={220} />}
          {usersError && <ErrorState message={usersError?.message || "Failed to load users trend."} />}
          {!usersLoading && !usersError && (
            <KPIChart data={usersSeries} xKey="label" yKey="value" color="#0EA5E9" />
          )}
        </Card>
      </div>

      {/* Costs Trend */}
      <div className="block-full" style={{ gridColumn: "1 / -1" }}>
        <Card
          title="Costs over time"
          subtitle="Total USD by day/week"
          actions={CostsControls}
        >
          {costsRangeKey === "custom" ? (
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ fontSize: 12, color: "#6B7280" }}>
                  Start:
                  <input
                    type="date"
                    onChange={(e) => setCostsCustomRange((r) => ({ ...r, start: e.target.value }))}
                    value={costsCustomRange.start || ""}
                    style={{ marginLeft: 6 }}
                    aria-label="Costs custom range start date"
                  />
                </label>
                <label style={{ fontSize: 12, color: "#6B7280" }}>
                  End:
                  <input
                    type="date"
                    onChange={(e) => setCostsCustomRange((r) => ({ ...r, end: e.target.value }))}
                    value={costsCustomRange.end || ""}
                    style={{ marginLeft: 6 }}
                    aria-label="Costs custom range end date"
                  />
                </label>
              </div>
            </div>
          ) : (
            costsRangeKey === "custom" && (!costsCustomRange.start || !costsCustomRange.end) ? (
              <div style={{ marginBottom: 8, color: "#6B7280", fontSize: 12 }}>
                Select start and end dates to apply custom range.
              </div>
            ) : null
          )}
          {costsLoading && <LoadingState message="Loading costs trend…" height={220} />}
          {costsError && <ErrorState message={costsError?.message || "Failed to load costs trend."} />}
          {!costsLoading && !costsError && (
            <>
              <KPIChart data={costsSeries} xKey="label" yKey="value" color="#F59E0B" />
              {(Array.isArray(costsSeries) && costsSeries.length > 0 && costsSeries.every(d => !d.value)) && (
                <div style={{ marginTop: 8, color: "#6B7280", fontSize: 12, textAlign: "center" }}>
                  No cost data found for the selected range. Showing zeroed series.
                </div>
              )}
              {Array.isArray(costsSeries) && costsSeries.length === 0 && (
                <div style={{ marginTop: 8, color: "#6B7280", fontSize: 12, textAlign: "center" }}>
                  No cost data available.
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      {error && (
        <div className="block-full" role="alert" style={{ alignSelf: "start" }}>
          <div className="error">{error}</div>
        </div>
      )}
    </div>
  );
}
