import React, { useEffect, useState, useMemo, useCallback } from "react";
import Card from "../../components/ui/Card.jsx";
import Skeleton from "../../components/ui/Skeleton.jsx";
import LoadingState from "../../components/common/LoadingState";
import ErrorState from "../../components/common/ErrorState";
import KPIChart from "../../components/charts/KPIChart.jsx";
import { listUsers, listSessions, listDeployments, listLlmCosts, health } from "../../api";
import { fetchSessionTracking } from "../../api/sessionTracking";
import { getActiveUsersTrend } from "../../api/usersActiveTrend";
import "../../styles/globals.css";

/**
 * Helper, get YYYY-MM-DD string for a Date.
 */
function toYMD(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

/**
 * Helper, get start of week (Monday).
 */
function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

/**
 * Helper, format date to API ISO, or empty string if invalid/null/etc.
 */
function formatDateISO(dt) {
  if (!dt) return "";
  try {
    const asDate = dt instanceof Date ? dt : new Date(dt);
    return asDate.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

/**
 * Chart granularity and defaults.
 */
const GRANULARITY_OPTIONS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];
const DEFAULT_GRANULARITY = "day";
const DEFAULT_RANGE_KEY = "last30";
const PRESETS = [
  { key: "last7", label: "Last 7 days", getRange: () => ({ from: toYMD(new Date(Date.now() - 6 * 24 * 3600 * 1000)), to: toYMD(new Date()) }) },
  { key: "last30", label: "Last 30 days", getRange: () => ({ from: toYMD(new Date(Date.now() - 29 * 24 * 3600 * 1000)), to: toYMD(new Date()) }) },
  { key: "thisMonth", label: "This month", getRange: () => {
    const d = new Date(); return { from: toYMD(new Date(d.getFullYear(), d.getMonth(), 1)), to: toYMD(d) };
  } },
];

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "all", label: "All" }
];

function getPresetRangeByKey(key) {
  const match = PRESETS.find((p) => p.key === key);
  return match ? match.getRange() : PRESETS[1].getRange(); // default last30
}

function DateInput({ label, value, onChange, max, min }) {
  return (
    <label style={{ fontSize: 12, color: "#374151", marginRight: 12 }}>
      {label}
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={e => onChange(e.target.value)}
        style={{
          marginLeft: 6,
          borderRadius: 6,
          border: "1px solid #cfd3da",
          padding: "2px 6px",
          fontSize: 14,
          background: "#fff"
        }}
      />
    </label>
  );
}

/**
 * PUBLIC_INTERFACE
 * Overview Page with per-chart Filters
 */
export default function Overview() {
  // Top-of-page KPIs (total cards)
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({ users: 0, sessions: 0, deployments: 0 });
  const [error, setError] = useState("");
  const [, setApiStatus] = useState("checking");

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
    return () => { mounted = false; };
  }, []);

  // Load metrics
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError("");
      try {
        const [users, sessions, deployments] = await Promise.all([
          listUsers({ limit: 1 }),
          listSessions({ limit: 1 }),
          listDeployments({ limit: 1 }),
        ]);
        setMetrics({
          users: users?.total || users?.length || 0,
          sessions: sessions?.total || sessions?.length || 0,
          deployments: deployments?.total || deployments?.length || 0,
        });
      } catch (e) {
        setError(e?.message || "Failed to load overview data.");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // --- Session Trend Chart State/Controls ---
  const [sessionsGranularity, setSessionsGranularity] = useState(DEFAULT_GRANULARITY);
  const [sessionsRangePreset, setSessionsRangePreset] = useState(DEFAULT_RANGE_KEY);
  const [sessionsCustomRange, setSessionsCustomRange] = useState(() => getPresetRangeByKey(DEFAULT_RANGE_KEY));
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsData, setSessionsData] = useState([]);
  const [sessionsError, setSessionsError] = useState(null);

  // --- Users Chart State/Controls ---
  const [usersGranularity, setUsersGranularity] = useState(DEFAULT_GRANULARITY);
  const [usersRangePreset, setUsersRangePreset] = useState(DEFAULT_RANGE_KEY);
  const [usersCustomRange, setUsersCustomRange] = useState(() => getPresetRangeByKey(DEFAULT_RANGE_KEY));
  const [usersStatus, setUsersStatus] = useState("active");
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersData, setUsersData] = useState([]);
  const [usersError, setUsersError] = useState(null);

  // --- Costs Chart State/Controls ---
  const [costsGranularity, setCostsGranularity] = useState(DEFAULT_GRANULARITY);
  const [costsRangePreset, setCostsRangePreset] = useState(DEFAULT_RANGE_KEY);
  const [costsCustomRange, setCostsCustomRange] = useState(() => getPresetRangeByKey(DEFAULT_RANGE_KEY));
  const [costsLoading, setCostsLoading] = useState(false);
  const [costsData, setCostsData] = useState([]);
  const [costsError, setCostsError] = useState(null);

  // --- Fetch: Sessions Trend ---
  useEffect(() => {
    let aborted = false;
    async function fetchSessions() {
      setSessionsLoading(true); setSessionsError(null);
      try {
        const from = sessionsCustomRange.from;
        const to = sessionsCustomRange.to;
        // Use fetchSessionTracking (API mapped to start_date/end_date and granularity)
        const { items } = await fetchSessionTracking({
          start_date: from,
          end_date: to,
          granularity: sessionsGranularity,
          limit: 200,
        });
        if (aborted) return;
        // Map and fill series (date, count)
        const map = new Map();
        (items || []).forEach(it => {
          const d = it.date || it.session_start || it.created_at || it.createdAt || it.timestamp;
          const date = d ? formatDateISO(d) : "";
          if (!date) return;
          map.set(date, (map.get(date) || 0) + 1);
        });
        // Create time-bucketed series
        let s = new Date(from), e = new Date(to), series = [];
        while (s <= e) {
          const label = formatDateISO(s);
          series.push({ label, value: map.get(label) || 0 });
          s.setDate(s.getDate() + (sessionsGranularity === "day" ? 1 : sessionsGranularity === "week" ? 7 : 30));
        }
        setSessionsData(series);
      } catch (e) {
        if (!aborted) {
          setSessionsError(e); setSessionsData([]);
        }
      } finally {
        if (!aborted) setSessionsLoading(false);
      }
    }
    fetchSessions();
    return () => { aborted = true; };
  }, [sessionsGranularity, sessionsCustomRange.from, sessionsCustomRange.to]);

  // --- Fetch: Users Trend ---
  useEffect(() => {
    let aborted = false;
    async function fetchUsers() {
      setUsersLoading(true); setUsersError(null);
      try {
        const from = usersCustomRange.from;
        const to = usersCustomRange.to;
        const gran = usersGranularity === "month" ? "week" : usersGranularity;
        const statusParam = usersStatus === "active" ? "completed|active" : undefined;
        let items = [];
        try {
          // getActiveUsersTrend API (created_at range and status)
          const resp = await getActiveUsersTrend({
            from: from,
            to: to,
            granularity: gran,
            status: statusParam,
          });
          items = Array.isArray(resp?.items) ? resp.items : [];
        } catch (e) {
          items = [];
        }
        const map = new Map();
        (items || []).forEach((row) => {
          const date = row.date || row.label || row.day || row.week;
          const total = Number(row.total ?? row.count ?? row.value ?? 0);
          if (!date) return;
          map.set(String(date), Number.isFinite(total) ? total : 0);
        });
        // Fill series for selected granularity
        let s = new Date(from), e = new Date(to), series = [];
        while (s <= e) {
          const label = formatDateISO(s);
          series.push({ label, value: map.get(label) || 0 });
          s.setDate(s.getDate() + (usersGranularity === "day" ? 1 : usersGranularity === "week" ? 7 : 30));
        }
        setUsersData(series);
      } catch (e) {
        if (!aborted) { setUsersError(e); setUsersData([]); }
      } finally {
        if (!aborted) setUsersLoading(false);
      }
    }
    fetchUsers();
    return () => { aborted = true; };
  }, [usersGranularity, usersCustomRange.from, usersCustomRange.to, usersStatus]);

  // --- Fetch: Costs Trend ---
  useEffect(() => {
    let aborted = false;
    async function fetchCosts() {
      setCostsLoading(true); setCostsError(null);
      try {
        const from = costsCustomRange.from;
        const to = costsCustomRange.to;
        // listLlmCosts, grouping by date buckets
        const filter = {
          $or: [
            { timestamp: { $gte: from, $lte: to } },
            { created_at: { $gte: from, $lte: to } },
            { createdAt: { $gte: from, $lte: to } }
          ]
        };
        const res = await listLlmCosts({
          filter: JSON.stringify(filter),
          limit: 500,
          sort: "-timestamp",
        });
        const items = res?.items || (Array.isArray(res) ? res : []);
        const map = new Map();
        (items || []).forEach(doc => {
          const d = doc.timestamp || doc.created_at || doc.createdAt || doc.date;
          const date = d ? formatDateISO(d) : "";
          const raw =
            doc.total_cost ?? doc.total_usd ?? doc.usd ?? doc.amount_usd ?? doc.cost ?? doc.price ?? doc.amount ?? 0;
          const num = typeof raw === "number" ? raw : Number(String(raw).replace(/[$,]/g, ""));
          const value = Number.isFinite(num) ? num : 0;
          if (!date) return;
          map.set(date, (map.get(date) || 0) + value);
        });
        // Fill series for buckets
        let s = new Date(from), e = new Date(to), series = [];
        while (s <= e) {
          const label = formatDateISO(s);
          series.push({ label, value: map.get(label) || 0 });
          s.setDate(s.getDate() + (costsGranularity === "day" ? 1 : costsGranularity === "week" ? 7 : 30));
        }
        setCostsData(series);
      } catch (e) {
        if (!aborted) { setCostsError(e); setCostsData([]); }
      } finally {
        if (!aborted) setCostsLoading(false);
      }
    }
    fetchCosts();
    return () => { aborted = true; };
  }, [costsGranularity, costsCustomRange.from, costsCustomRange.to]);

  // --- Chart Controls Components ---
  function GranularitySelector({ granularity, setGranularity }) {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 13, marginRight: 4, fontWeight: 500 }}>Granularity:</span>
        {GRANULARITY_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setGranularity(opt.value)}
            style={{
              fontWeight: granularity === opt.value ? 700 : 400,
              padding: "7px 13px",
              borderRadius: 15,
              border: granularity === opt.value ? "2px solid #2563EB" : "1.5px solid #E0E7EF",
              background: granularity === opt.value ? "#EFF6FF" : "#fff",
              color: granularity === opt.value ? "#2563EB" : "#111827",
              fontSize: 13,
              marginRight: 2,
              cursor: "pointer",
              outline: "none",
              transition: "all 0.13s"
            }}
            aria-pressed={granularity === opt.value}
          >
            {opt.label}
          </button>
        ))}
      </div>
    );
  }

  function DateRangeControls({ preset, setPreset, customRange, setCustomRange, min, max }) {
    return (
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        {PRESETS.map(p =>
          <button
            key={p.key}
            onClick={() => {
              setPreset(p.key);
              setCustomRange(p.getRange());
            }}
            aria-pressed={preset === p.key}
            style={{
              padding: "6px 13px",
              borderRadius: 12,
              border: preset === p.key ? "2px solid #2563EB" : "1.3px solid #E0E7EF",
              background: preset === p.key ? "#DBEAFE" : "#fff",
              color: preset === p.key ? "#2563EB" : "#111827",
              fontWeight: preset === p.key ? 700 : 500,
              marginRight: 3,
              cursor: "pointer", fontSize: 13
            }}
          >
            {p.label}
          </button>)}
        <DateInput
          label="From"
          value={customRange.from}
          min={min}
          max={customRange.to}
          onChange={d => {
            setPreset(null);
            setCustomRange(r => ({ ...r, from: d }));
          }}
        />
        <DateInput
          label="To"
          value={customRange.to}
          min={customRange.from}
          max={max}
          onChange={d => {
            setPreset(null);
            setCustomRange(r => ({ ...r, to: d }));
          }}
        />
      </div>
    )
  }

  function StatusSelector({ status, setStatus }) {
    return (
      <div>
        <span style={{ fontSize: 13, fontWeight: 600, marginRight: 8 }}>Status:</span>
        <select value={status} onChange={e => setStatus(e.target.value)} style={{
          padding: "6px 10px",
          borderRadius: 8,
          border: "1px solid #cfd3da",
          background: "#fff"
        }}>
          {STATUS_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    );
  }

  // --- Main Render ---
  return (
    <div className="dashboard overview-page" style={{ paddingBottom: 24 }}>
      {/* --- KPI Row --- */}
      <div style={{ display: "flex", gap: 18, marginBottom: 16, flexWrap: "wrap" }}>
        <Card title="Users" className="kpi-card">
          <div className="kpi">
            <div className="kpi-value">
              {loading ? (<Skeleton width={72} height={28} aria-label="Loading users metric" />) : metrics.users}
            </div>
            <div className="kpi-label">Users</div>
          </div>
        </Card>
        <Card title="Sessions" className="kpi-card">
          <div className="kpi">
            <div className="kpi-value">
              {loading ? (<Skeleton width={72} height={28} aria-label="Loading sessions metric" />) : metrics.sessions}
            </div>
            <div className="kpi-label">Sessions</div>
          </div>
        </Card>
        <Card title="Deployments" className="kpi-card">
          <div className="kpi">
            <div className="kpi-value">
              {loading ? (<Skeleton width={72} height={28} aria-label="Loading deployments metric" />) : metrics.deployments}
            </div>
            <div className="kpi-label">Deployments</div>
          </div>
        </Card>
      </div>

      {/* --- Sessions Trend Chart --- */}
      <Card
        title="Sessions trend"
        subtitle="Session count over time"
        actions={(
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
            <GranularitySelector granularity={sessionsGranularity} setGranularity={setSessionsGranularity} />
            <DateRangeControls
              preset={sessionsRangePreset}
              setPreset={setSessionsRangePreset}
              customRange={sessionsCustomRange}
              setCustomRange={setSessionsCustomRange}
              min="2020-01-01"
              max={toYMD(new Date())}
            />
          </div>
        )}
      >
        {sessionsLoading ? (
          <LoadingState message="Loading sessions trend…" height={220} />
        ) : sessionsError ? (
          <ErrorState message={sessionsError?.message || "Failed to load sessions."} />
        ) : (
          <KPIChart data={sessionsData} xKey="label" yKey="value" color="#2563EB" />
        )}
      </Card>

      {/* --- Users over time Chart --- */}
      <Card
        title="Users over time"
        subtitle="Active users trend"
        actions={(
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
            <GranularitySelector granularity={usersGranularity} setGranularity={setUsersGranularity} />
            <DateRangeControls
              preset={usersRangePreset}
              setPreset={setUsersRangePreset}
              customRange={usersCustomRange}
              setCustomRange={setUsersCustomRange}
              min="2020-01-01"
              max={toYMD(new Date())}
            />
            <StatusSelector status={usersStatus} setStatus={setUsersStatus} />
          </div>
        )}
      >
        {usersLoading ? (
          <LoadingState message="Loading users trend…" height={220} />
        ) : usersError ? (
          <ErrorState message={usersError?.message || "Failed to load users trend."} />
        ) : (
          <KPIChart data={usersData} xKey="label" yKey="value" color="#0EA5E9" />
        )}
      </Card>

      {/* --- Costs over time Chart --- */}
      <Card
        title="Costs over time"
        subtitle="Total USD by time"
        actions={(
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
            <GranularitySelector granularity={costsGranularity} setGranularity={setCostsGranularity} />
            <DateRangeControls
              preset={costsRangePreset}
              setPreset={setCostsRangePreset}
              customRange={costsCustomRange}
              setCustomRange={setCostsCustomRange}
              min="2020-01-01"
              max={toYMD(new Date())}
            />
          </div>
        )}
      >
        {costsLoading ? (
          <LoadingState message="Loading costs trend…" height={220} />
        ) : costsError ? (
          <ErrorState message={costsError?.message || "Failed to load costs trend."} />
        ) : (
          <KPIChart data={costsData} xKey="label" yKey="value" color="#F59E0B" />
        )}
      </Card>

      {/* Global overview error */}
      {error && (
        <div className="block-full" role="alert" style={{ alignSelf: "start" }}>
          <div className="error">{error}</div>
        </div>
      )}
    </div>
  );
}
