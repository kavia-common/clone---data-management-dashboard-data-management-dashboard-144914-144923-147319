import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import Skeleton from "../../components/ui/Skeleton.jsx";
import { listUsers, listSessions, listDeployments, listLlmCosts, health } from "../../api";
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
  // normalize to midnight
  d.setHours(0, 0, 0, 0);
  // week starts on Monday; getDay(): 0..6 (Sun..Sat)
  const diff = (d.getDay() + 6) % 7; // 0 for Monday
  d.setDate(d.getDate() - diff);
  return d;
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

  // Chart controls
  const [rangeKey, setRangeKey] = useState("7d"); // '7d' | '14d' | '30d' | 'custom'
  const [granularity, setGranularity] = useState("daily"); // 'daily' | 'weekly'
  const [customRange, setCustomRange] = useState({ start: null, end: null }); // ISO-like yyyy-mm-dd from input[type="date"]

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

  // Derived start/end from chosen range (explicit ISO, end set to 23:59:59.999)
  const { startISO, endISO } = useMemo(() => {
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
      // default 30d
      start.setDate(end.getDate() - 29);
    }
    start.setHours(0, 0, 0, 0);
    return { startISO: start.toISOString(), endISO: end.toISOString() };
  }, [rangeKey, customRange.start, customRange.end]);

  // Fetch KPI metric counts (kept minimal)
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
  function fillSeries(map, start, end, bucket = "daily") {
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
  }

  // Sessions trend fetcher — respects explicit start/end and tenant via base client
  useEffect(() => {
    let aborted = false;
    async function loadSessions() {
      setSessionsLoading(true);
      setSessionsError(null);
      try {
        const { items } = await fetchSessionTracking({
          start: startISO,
          end: endISO,
          limit: 200,
          sort: "-session_start",
        });
        if (aborted) return;

        // Normalize timestamps (prefer session_start; fallbacks)
        const pts = (items || []).map((it) => {
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
        }).filter((d) => d && !Number.isNaN(d.getTime()));

        const map = new Map();
        if (granularity === "weekly") {
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

        setSessionsSeries(fillSeries(map, startISO, endISO, granularity));
      } catch (e) {
        if (aborted) return;
        setSessionsError(e);
        setSessionsSeries([]);
      } finally {
        if (!aborted) setSessionsLoading(false);
      }
    }
    if (startISO && endISO) loadSessions();
    return () => {
      aborted = true;
    };
  }, [startISO, endISO, granularity]);

  // Users trend fetcher — prefer users collection; fallback to backend sessions-based endpoint
  useEffect(() => {
    let aborted = false;
    async function loadUsers() {
      setUsersLoading(true);
      setUsersError(null);
      try {
        // Prefer backend active users trend (from users collection) if available
        const backendGranularity = granularity === "weekly" ? "week" : "day";
        let items = [];
        let backendOk = false;
        try {
          const resp = await getActiveUsersTrend({
            from: startISO,
            to: endISO,
            granularity: backendGranularity,
          });
          items = Array.isArray(resp?.items) ? resp.items : [];
          backendOk = items.length > 0 || Array.isArray(resp?.items);
        } catch {
          backendOk = false;
        }

        if (!backendOk) {
          // Client-side aggregation from /api/users
          // Active user definition: updated_at within [startISO, endISO], status !== 'deleted'
          // Bucket by day/week based on updated_at and count distinct users per bucket.
          const filter = {
            $and: [
              {
                $or: [
                  { updated_at: { $gte: startISO, $lte: endISO } },
                  { updatedAt: { $gte: startISO, $lte: endISO } },
                  { last_activity_at: { $gte: startISO, $lte: endISO } },
                  { lastActivityAt: { $gte: startISO, $lte: endISO } },
                ],
              },
              {
                $or: [
                  { status: { $exists: false } },
                  { status: { $ne: "deleted" } },
                ],
              },
            ],
          };

          // listUsers is already imported for KPIs; we reuse it for fetching raw users
          const usersRes = await listUsers({
            filter: JSON.stringify(filter),
            limit: 1000,
            sort: "-updated_at",
          });

          const users = usersRes?.items || (Array.isArray(usersRes) ? usersRes : []);
          const bucketUsers = new Map();
          users.forEach((u) => {
            const t =
              u.updated_at ||
              u.updatedAt ||
              u.last_activity_at ||
              u.lastActivityAt ||
              u.created_at ||
              u.createdAt ||
              u.date;
            const d = t ? new Date(t) : null;
            if (!d || Number.isNaN(d.getTime())) return;
            const key = granularity === "weekly" ? toYMD(startOfWeek(d)) : toYMD(d);
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

        const series = fillSeries(map, startISO, endISO, granularity);
        setUsersSeries(series);
      } catch (e) {
        if (aborted) return;
        setUsersError(e);
        setUsersSeries([]);
      } finally {
        if (!aborted) setUsersLoading(false);
      }
    }
    if (startISO && endISO) loadUsers();
    return () => {
      aborted = true;
    };
  }, [startISO, endISO, granularity]);

  // Costs trend fetcher — list /api/llm-costs and aggregate total_cost by bucket client-side
  useEffect(() => {
    let aborted = false;
    async function loadCosts() {
      setCostsLoading(true);
      setCostsError(null);
      try {
        // Fetch costs within explicit time range; base client ensures tenant scope
        // The /api/llm-costs supports 'filter' where server enforces tenant scoping; we pass explicit range filter.
        const filter = {
          // Try common timestamp fields on backend: timestamp, created_at, createdAt
          $or: [
            { timestamp: { $gte: startISO, $lte: endISO } },
            { created_at: { $gte: startISO, $lte: endISO } },
            { createdAt: { $gte: startISO, $lte: endISO } },
          ],
        };
        const res = await listLlmCosts({
          // server ignores tenant fields in filter and enforces by header/JWT; base client will add organization_id header
          filter: JSON.stringify(filter),
          limit: 500,
          sort: "-timestamp",
        });

        const items = res?.items || (Array.isArray(res) ? res : []);
        if (aborted) return;

        // Build bucket map summing numeric cost
        const map = new Map();
        (items || []).forEach((doc) => {
          const t = doc.timestamp || doc.created_at || doc.createdAt || doc.date;
          const d = t ? new Date(t) : null;
          if (!d || Number.isNaN(d.getTime())) return;

          // Normalize cost fields; handle string like "$0.12"
          const raw =
            doc.total_cost ??
            doc.total_usd ??
            doc.usd ??
            doc.amount_usd ??
            doc.cost ??
            doc.price ??
            doc.amount ??
            0;
          const num = typeof raw === "number" ? raw : Number(String(raw).replace(/[$,]/g, ""));
          const value = Number.isFinite(num) ? num : 0;

          const key = granularity === "weekly" ? toYMD(startOfWeek(d)) : toYMD(d);
          map.set(key, (map.get(key) || 0) + value);
        });

        const series = fillSeries(map, startISO, endISO, granularity);
        setCostsSeries(series);
      } catch (e) {
        if (aborted) return;
        setCostsError(e);
        setCostsSeries([]);
      } finally {
        if (!aborted) setCostsLoading(false);
      }
    }
    if (startISO && endISO) loadCosts();
    return () => {
      aborted = true;
    };
  }, [startISO, endISO, granularity]);

  // UI for custom range minimal placeholder (could be replaced with a datepicker later)
  function CustomRangeControls() {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, color: "#6B7280" }}>
          Start:
          <input
            type="date"
            onChange={(e) => setCustomRange((r) => ({ ...r, start: e.target.value }))}
            style={{ marginLeft: 6 }}
          />
        </label>
        <label style={{ fontSize: 12, color: "#6B7280" }}>
          End:
          <input
            type="date"
            onChange={(e) => setCustomRange((r) => ({ ...r, end: e.target.value }))}
            style={{ marginLeft: 6 }}
          />
        </label>
      </div>
    );
  }

  // Memoized locale-formatted date range label derived from startISO/endISO
  const dateRangeLabel = useMemo(() => {
    if (!startISO || !endISO) return "";
    const start = new Date(startISO);
    const end = new Date(endISO);
    // Use consistent locale formatting options
    const opts = { year: "numeric", month: "short", day: "numeric" };
    const fromStr = start.toLocaleDateString(undefined, opts);
    const toStr = end.toLocaleDateString(undefined, opts);
    return `Filtered: ${fromStr} — ${toStr}`;
  }, [startISO, endISO]);

  // Reusable compact badge style for the date-range label (Ocean Professional)
  const labelPill = (
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
        color: "#374151", // subtle text
        background: "#F3F4F6", // light gray pill
        border: "1px solid #E5E7EB",
        whiteSpace: "nowrap",
      }}
    >
      {dateRangeLabel}
    </span>
  );

  const timeRangeSelector = (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <div style={{ display: "flex", gap: 6, background: "#fff", border: "1px solid #E5E7EB", borderRadius: 8, padding: 4 }}>
        {["7d", "14d", "30d", "custom"].map((key) => (
          <button
            key={key}
            onClick={() => setRangeKey(key)}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "none",
              background: rangeKey === key ? "#2563EB" : "transparent",
              color: rangeKey === key ? "#fff" : "#111827",
              cursor: "pointer",
            }}
            aria-pressed={rangeKey === key}
          >
            {key.toUpperCase()}
          </button>
        ))}
      </div>
      {labelPill}
    </div>
  );

  const bucketToggle = (
    <TimeBucketFilter
      value={granularity}
      onChange={(v) => setGranularity(v === "monthly" ? "weekly" : v)} // only allow daily/weekly
      options={[
        { value: "daily", label: "Daily" },
        { value: "weekly", label: "Weekly" },
      ]}
    />
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
          actions={
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {timeRangeSelector}
              {bucketToggle}
            </div>
          }
        >
          {rangeKey === "custom" ? <CustomRangeControls /> : null}
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
          actions={
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {timeRangeSelector}
              {bucketToggle}
            </div>
          }
        >
          {rangeKey === "custom" ? <CustomRangeControls /> : null}
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
          actions={
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {timeRangeSelector}
              {bucketToggle}
            </div>
          }
        >
          {rangeKey === "custom" ? <CustomRangeControls /> : null}
          {costsLoading && <LoadingState message="Loading costs trend…" height={220} />}
          {costsError && <ErrorState message={costsError?.message || "Failed to load costs trend."} />}
          {!costsLoading && !costsError && (
            <KPIChart data={costsSeries} xKey="label" yKey="value" color="#F59E0B" />
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
