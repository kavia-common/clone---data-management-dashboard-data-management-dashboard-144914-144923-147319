import React, { useEffect, useMemo, useState } from "react";
import "./overview.css";
import { fetchJson } from "../../utils/api"; // existing util is api.js, but we use a small inline fetch if not found
import Card from "../common/Card";
import LoadingState from "../common/LoadingState";
import ErrorState from "../common/ErrorState";
import Button from "../ui/Button";
import Input from "../ui/Input";
import { oceanColors } from "../charts/chartTheme.extension";

/**
 * PUBLIC_INTERFACE
 * UsersByTenantChart
 * This component renders a "Total Users by Tenant" bar chart with time filters.
 * - Fetches data from /api/users and aggregates per tenant within the selected period
 * - Supports Daily, Weekly, Monthly quick filters and Custom date range
 * - Provides loading and error states
 * - Styled to Ocean Professional theme (#2563EB primary, #F59E0B hover/accents)
 *
 * Assumptions:
 * - users endpoint returns an array or envelope { data: [] }
 * - user record has a createdAt (or created_at) date field and a tenant identifier (tenant, tenantId, tenant_id, organization_id)
 *   TODO: If your backend uses different field names, update extractTenantKey and extractCreatedAt accordingly.
 */
export default function UsersByTenantChart() {
  const [period, setPeriod] = useState("daily"); // daily | weekly | monthly | custom
  const [startDate, setStartDate] = useState(getISODateNDaysAgo(6)); // shows last 7 days for daily by default
  const [endDate, setEndDate] = useState(getISODateNDaysAgo(0));
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Update dates when period changes (except custom)
  useEffect(() => {
    if (period === "custom") return;
    const now = new Date();
    if (period === "daily") {
      setStartDate(getISODateNDaysAgo(6));
      setEndDate(formatDateOnly(now));
    } else if (period === "weekly") {
      // last 8 weeks range for an overview
      const past = new Date();
      past.setDate(now.getDate() - 7 * 7);
      setStartDate(formatDateOnly(past));
      setEndDate(formatDateOnly(now));
    } else if (period === "monthly") {
      // last 6 months
      const past = new Date();
      past.setMonth(now.getMonth() - 5);
      past.setDate(1);
      setStartDate(formatDateOnly(past));
      setEndDate(formatDateOnly(now));
    }
  }, [period]);

  // Fetch users on mount and when we need fresh data
  useEffect(() => {
    let ignore = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetchUsers();
        if (!ignore) {
          setUsers(res);
        }
      } catch (e) {
        if (!ignore) {
          setError(e?.message || "Failed to load users");
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, []); // initial fetch once; client-side filtering below

  const range = useMemo(() => {
    const s = period === "custom" ? customStart || startDate : startDate;
    const e = period === "custom" ? customEnd || endDate : endDate;
    return { start: s, end: e };
  }, [period, startDate, endDate, customStart, customEnd]);

  const { labels, values, totalCount } = useMemo(() => {
    const filtered = filterByDate(users, range.start, range.end);
    const grouped = aggregateByTenant(filtered);
    const entries = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
    const x = entries.map(([k]) => k);
    const y = entries.map(([, v]) => v);
    const sum = y.reduce((acc, n) => acc + n, 0);
    return { labels: x, values: y, totalCount: sum };
  }, [users, range]);

  const subtitle = useMemo(() => {
    if (!range.start && !range.end) return "All time";
    if (range.start && range.end) return `${range.start} to ${range.end}`;
    if (range.start) return `From ${range.start}`;
    return `Until ${range.end}`;
  }, [range]);

  return (
    <Card>
      <div className="overview-card-header">
        <div>
          <h3 className="overview-card-title">Total Users by Tenant</h3>
          <p className="overview-card-subtitle">{subtitle}</p>
        </div>
        <div className="users-by-tenant-controls">
          <div className="segmented">
            <FilterButton active={period === "daily"} onClick={() => setPeriod("daily")}>
              Daily
            </FilterButton>
            <FilterButton active={period === "weekly"} onClick={() => setPeriod("weekly")}>
              Weekly
            </FilterButton>
            <FilterButton active={period === "monthly"} onClick={() => setPeriod("monthly")}>
              Monthly
            </FilterButton>
            <FilterButton active={period === "custom"} onClick={() => setPeriod("custom")}>
              Custom
            </FilterButton>
          </div>
          {period === "custom" && (
            <div className="custom-range">
              <Input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                aria-label="Start date"
              />
              <span className="to-sep">to</span>
              <Input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                aria-label="End date"
              />
              <Button
                onClick={() => {
                  if (customStart) setStartDate(customStart);
                  if (customEnd) setEndDate(customEnd);
                }}
                style={{ backgroundColor: oceanColors.primary, color: "#fff" }}
              >
                Apply
              </Button>
            </div>
          )}
        </div>
      </div>

      {loading && <LoadingState message="Loading users…" />}
      {!loading && error && <ErrorState message={error} />}

      {!loading && !error && (
        <>
          {labels.length === 0 ? (
            <div className="overview-empty-state">
              <p>No users found for the selected period.</p>
            </div>
          ) : (
            <div className="users-by-tenant-chart-wrap">
              <SimpleBarChart
                labels={labels}
                values={values}
                primary={oceanColors.primary}
                hover={oceanColors.accent}
              />
            </div>
          )}
          <div className="overview-footer-note">
            <span className="kpi-pill" title="Total users across tenants in the selected range">
              Total: {totalCount}
            </span>
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * Fetches users from /api/users and returns a flat array.
 * Supports the API returning an envelope with data or a raw array.
 */
async function fetchUsers() {
  const res = await fetch("/api/users");
  if (!res.ok) {
    throw new Error(`API error ${res.status}`);
  }
  const body = await res.json();
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.data)) return body.data;
  // If a seeded response or envelope variant
  if (body && body.items && Array.isArray(body.items)) return body.items;
  return [];
}

/**
 * Filter array of user docs by date range. Uses createdAt or created_at fallback.
 * TODO: Adjust field extraction here if your user date field differs.
 */
function filterByDate(users, startDate, endDate) {
  if (!startDate && !endDate) return users;
  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;
  return users.filter((u) => {
    const dStr = extractCreatedAt(u);
    if (!dStr) return false;
    const d = new Date(dStr);
    if (Number.isNaN(d.getTime())) return false;
    if (start && d < start) return false;
    if (end) {
      const endDay = new Date(end);
      endDay.setHours(23, 59, 59, 999);
      if (d > endDay) return false;
    }
    return true;
  });
}

/**
 * Groups users by tenant and returns a map { tenantLabel: count }.
 * Attempts to extract tenant using common keys.
 * TODO: Adjust extractTenantKey if tenant key differs in your dataset.
 */
function aggregateByTenant(users) {
  const map = {};
  for (const u of users) {
    const t = extractTenantKey(u) || "Unknown";
    map[t] = (map[t] || 0) + 1;
  }
  return map;
}

/**
 * Try common tenant keys: tenant, tenantId, tenant_id, organization_id, organizationId
 */
function extractTenantKey(u) {
  return (
    u?.tenant ||
    u?.tenantId ||
    u?.tenant_id ||
    u?.organization_id ||
    u?.organizationId ||
    null
  );
}

/**
 * Try common date keys: createdAt, created_at, timestamp, last_activity
 */
function extractCreatedAt(u) {
  return u?.createdAt || u?.created_at || u?.timestamp || u?.last_activity || null;
}

/**
 * A minimal responsive bar chart without external deps.
 * Uses CSS for layout; renders bars proportionally with tooltips and value labels.
 */
function SimpleBarChart({ labels, values, primary = "#2563EB", hover = "#F59E0B" }) {
  const max = Math.max(...values, 1);
  return (
    <div className="simple-bar-chart" role="img" aria-label="Users by tenant bar chart">
      {labels.map((label, i) => {
        const v = values[i] ?? 0;
        const heightPct = Math.round((v / max) * 100);
        return (
          <div key={label} className="bar-item" title={`${label}: ${v}`}>
            <div
              className="bar"
              style={{
                height: `${heightPct}%`,
                backgroundColor: primary,
              }}
            />
            <div className="bar-label" title={label}>
              {label}
            </div>
            <div className="bar-value">{v}</div>
            <style>
              {`
                .bar-item:hover .bar {
                  background-color: ${hover};
                }
              `}
            </style>
          </div>
        );
      })}
    </div>
  );
}

/** Utilities */
function getISODateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return formatDateOnly(d);
}
function formatDateOnly(d) {
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Styled button for segmented control using theme colors */
function FilterButton({ active, onClick, children }) {
  return (
    <button
      className={`seg-btn ${active ? "active" : ""}`}
      onClick={onClick}
      type="button"
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
