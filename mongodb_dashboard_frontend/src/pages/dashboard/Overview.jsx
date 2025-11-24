import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import Skeleton from "../../components/ui/Skeleton.jsx";
import { listUsers, listSessions, listDeployments, health } from "../../api";
import { fetchSessionTracking } from "../../api/sessionTracking";
import LoadingState from "../../components/common/LoadingState";
import ErrorState from "../../components/common/ErrorState";
import KPIChart from "../../components/charts/KPIChart.jsx";
import TimeBucketFilter from "../../components/common/TimeBucketFilter.jsx";

/**
 * Utility functions to bucket sessions by day/week and compute counts.
 * We normalize dates to YYYY-MM-DD for day buckets and ISO week start for weekly buckets.
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

function toISODate(d) {
  const dd = new Date(d);
  dd.setHours(0, 0, 0, 0);
  return dd.toISOString();
}

/**
 * PUBLIC_INTERFACE
 * Overview
 */
export default function Overview() {
  /** Overview page with KPIs and sessions trend chart. */
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({ users: 0, sessions: 0, deployments: 0 });
  const [error, setError] = useState("");
  const [apiStatus, setApiStatus] = useState("checking");

  // Chart controls
  const [rangeKey, setRangeKey] = useState("7d"); // '7d' | '14d' | '30d' | 'custom'
  const [granularity, setGranularity] = useState("daily"); // 'daily' | 'weekly'
  const [customRange, setCustomRange] = useState({ start: null, end: null }); // ISO strings

  // Sessions data state
  const [sessionsSeries, setSessionsSeries] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState(null);

  // Derived start/end from chosen range
  const { startISO, endISO } = useMemo(() => {
    const now = new Date();
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    let start = new Date(end);
    if (rangeKey === "7d") start.setDate(end.getDate() - 6);
    else if (rangeKey === "14d") start.setDate(end.getDate() - 13);
    else if (rangeKey === "30d") start.setDate(end.getDate() - 29);
    else if (rangeKey === "custom" && customRange.start && customRange.end) {
      return { startISO: new Date(customRange.start).toISOString(), endISO: new Date(customRange.end).toISOString() };
    } else {
      // default 30d
      start.setDate(end.getDate() - 29);
    }
    start.setHours(0, 0, 0, 0);
    return { startISO: start.toISOString(), endISO: end.toISOString() };
  }, [rangeKey, customRange.start, customRange.end]);

  // Fetch KPI metric counts
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

  // Health ping stays as-is
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

  // Fetch sessions for chart explicitly passing start/end and honoring filters
  useEffect(() => {
    let aborted = false;
    async function loadSessions() {
      setSessionsLoading(true);
      setSessionsError(null);
      try {
        // Reuse existing filters pattern; we explicitly pass start/end to avoid backend default 30d
        const { items } = await fetchSessionTracking({
          start: startISO,
          end: endISO,
          // optionally pass search or tenant filters via UI state in future
          limit: 200, // lightweight cap for chart; backend supports pagination
          sort: "-createdAt",
        });

        if (aborted) return;

        // Normalize timestamps from each item (try last_updated or session_start or createdAt)
        const points = items.map((it) => {
          const t =
            it.last_updated ||
            it.updated_at ||
            it.session_start ||
            it.startedAt ||
            it.createdAt ||
            it.timestamp ||
            it.lastActivityAt ||
            it.endedAt ||
            it.date;
          return { t: t ? new Date(t) : null };
        }).filter((p) => p.t && !isNaN(p.t.getTime()));

        // Build bucket map
        const bucketMap = new Map();

        if (granularity === "weekly") {
          points.forEach(({ t }) => {
            const weekStart = startOfWeek(t);
            const key = toYMD(weekStart);
            bucketMap.set(key, (bucketMap.get(key) || 0) + 1);
          });
        } else {
          points.forEach(({ t }) => {
            const key = toYMD(t);
            bucketMap.set(key, (bucketMap.get(key) || 0) + 1);
          });
        }

        // Fill missing buckets in range
        const startDate = new Date(startISO);
        const endDate = new Date(endISO);
        const series = [];

        if (granularity === "weekly") {
          // iterate weeks from first weekStart >= startDate to <= endDate
          let cursor = startOfWeek(startDate);
          while (cursor <= endDate) {
            const key = toYMD(cursor);
            series.push({ label: key, value: bucketMap.get(key) || 0 });
            cursor = new Date(cursor);
            cursor.setDate(cursor.getDate() + 7);
          }
        } else {
          // daily
          let cursor = new Date(startDate);
          cursor.setHours(0, 0, 0, 0);
          while (cursor <= endDate) {
            const key = toYMD(cursor);
            series.push({ label: key, value: bucketMap.get(key) || 0 });
            cursor = new Date(cursor);
            cursor.setDate(cursor.getDate() + 1);
          }
        }

        setSessionsSeries(series);
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

      {/* Sessions Trend with time-range selector and weekly toggle */}
      <div className="block-full" style={{ gridColumn: "1 / -1" }}>
        <Card
          title="Sessions Trend"
          subtitle="Session counts over time"
          actions={
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {/* Time-range selector */}
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

              {/* Weekly aggregation toggle via TimeBucketFilter */}
              <TimeBucketFilter
                value={granularity}
                onChange={(v) => setGranularity(v === "monthly" ? "weekly" : v)} // limit to daily/weekly per requirement
                options={[
                  { value: "daily", label: "Daily" },
                  { value: "weekly", label: "Weekly" },
                ]}
              />
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

      {error && (
        <div className="block-full" role="alert" style={{ alignSelf: "start" }}>
          <div className="error">{error}</div>
        </div>
      )}
    </div>
  );
}
