import React, { useEffect, useMemo, useRef, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import DataTable from "../../components/DataTable.jsx";
import { listSessions } from "../../api";
import SessionDetailsModal from "../../components/sessions/SessionDetailsModal";
import SessionsByOrganization from "../../components/charts/SessionsByOrganization.jsx";
import SessionsByType from "../../components/charts/SessionsByType.jsx";
import useDebouncedValue from "../../hooks/useDebouncedValue";
import { SessionTrackingChart } from "../../components/sessions/SessionTrackingChart.jsx";

// Simple helper to get distinct, sorted, non-empty values
function distinctSorted(arr) {
  const set = new Set();
  (arr || []).forEach((v) => {
    const s = String(v ?? "").trim();
    if (s) set.add(s);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// PUBLIC_INTERFACE
export default function Sessions() {
  /**
   * Sessions page with server-side search and pagination.
   * - Debounced search (300ms) across the entire dataset via backend query param `q`.
   * - Keeps existing pagination using server-provided meta.total and page/limit.
   * - Minimal loading and error states shown within the table and above toolbar.
   */
  const [items, setItems] = useState([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [meta, setMeta] = useState({ page: 1, limit: 10, total: 0 });

  // New UI filters
  const [filterUserName, setFilterUserName] = useState("");
  const [filterTenantId, setFilterTenantId] = useState("");

  // Date filters: start date and optional end date (range)
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Dropdown options populated from fetched session data (distinct lists)
  const [userNameOptions, setUserNameOptions] = useState([]);
  const [tenantIdOptions, setTenantIdOptions] = useState([]);

  // Keep URL query params in sync for dropdowns (so back/forward works)
  useEffect(() => {
    const usp = new URLSearchParams(window.location.search);
    if (filterUserName) usp.set("user_name", filterUserName);
    else usp.delete("user_name");
    if (filterTenantId) usp.set("tenant_id", filterTenantId);
    else usp.delete("tenant_id");
    if (startDate) usp.set("from", startDate);
    else usp.delete("from");
    if (endDate) usp.set("to", endDate);
    else usp.delete("to");
    const next = `${window.location.pathname}?${usp.toString()}`;
    window.history.replaceState({}, "", next);
  }, [filterUserName, filterTenantId, startDate, endDate]);

  // Initialize dropdown selections from URL on first mount
  useEffect(() => {
    const usp = new URLSearchParams(window.location.search);
    const initialUser = usp.get("user_name") || "";
    const initialTenant = usp.get("tenant_id") || "";
    const urlFrom = usp.get("from") || "";
    const urlTo = usp.get("to") || "";
    if (initialUser) setFilterUserName(initialUser);
    if (initialTenant) setFilterTenantId(initialTenant);
    if (urlFrom) setStartDate(urlFrom);
    if (urlTo) setEndDate(urlTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Details modal state
  const [selectedSession, setSelectedSession] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Lock for concurrent load protection
  const activeRequestRef = useRef(0);
  const lastSortRef = useRef({ key: "", dir: "asc" });

  // Allowed and ordered fields
  const allowedOrdered = useMemo(
    () => ["User_name", "tenant_id", "organization_name", "service_type"],
    []
  );

  // PUBLIC_INTERFACE
  function toLabel(key) {
    /** Convert snake_case to Title Case label. */
    return String(key || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (m) => m.toUpperCase());
  }

  // PUBLIC_INTERFACE
  function buildRestrictedColumns(rows = []) {
    /** Build DataTable columns strictly from the allowed list, preserving order. */
    const presentKeys = new Set();
    (rows || []).forEach((r) => Object.keys(r || {}).forEach((k) => presentKeys.add(k)));

    function formatLocal(val) {
      if (!val) return "\u2014";
      try {
        const d = new Date(val);
        if (isNaN(d.getTime())) return "\u2014";
        return d.toLocaleString();
      } catch {
        return "\u2014";
      }
    }
    function toHms(seconds) {
      const secs = Math.max(0, Math.floor(Number(seconds) || 0));
      const h = String(Math.floor(secs / 3600)).padStart(2, "0");
      const m = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
      const sRem = String(secs % 60).padStart(2, "0");
      return `${h}:${m}:${sRem}`;
    }
    function computeDuration(start, end) {
      if (!start || !end) return null;
      try {
        const s = new Date(start).getTime();
        const e = new Date(end).getTime();
        if (isNaN(s) || isNaN(e)) return null;
        const secs = Math.max(0, Math.floor((e - s) / 1000));
        return toHms(secs);
      } catch {
        return null;
      }
    }

    return allowedOrdered.map((k) => {
      const label = k === "User_name" ? "User name" : toLabel(k);

      const render = (v, row) => {
        if (k === "User_name") {
          const val =
            row?.User_name ??
            row?.user_name ??
            row?.user?.name ??
            row?.username ??
            row?.email ??
            v;
          return val == null || val === "" ? "\u2014" : String(val);
        }
        return v == null || v === "" ? "\u2014" : String(v);
      };

      return {
        key: k,
        label,
        render,
        priority: 2,
      };
    });
  }

  const [columns, setColumns] = useState(buildRestrictedColumns([]));

  // Aggregates for charts
  const [aggLoading, setAggLoading] = useState(false);
  const [aggError, setAggError] = useState("");
  const [byOrg, setByOrg] = useState([]);   // [{ organization_name, session_count }]
  const [byType, setByType] = useState([]); // [{ session_type, session_count }]

  async function loadAggregates(qStr = "") {
    /**
     * Fetch sessions data across multiple pages (capped) and build client-side aggregates
     * for charts: by organization_name and by session_type.
     */
    setAggLoading(true);
    setAggError("");
    try {
      const limit = 200;
      const maxPages = 10;
      let page = 1;
      const all = [];
      while (page <= maxPages) {
        const params = { page, limit, q: qStr };
        if (startDate) {
          params.start = new Date(startDate).toISOString();
        }
        if (endDate) {
          params.end =
            endDate && !/T/.test(endDate)
              ? new Date(new Date(endDate).setHours(23, 59, 59, 999)).toISOString()
              : new Date(endDate).toISOString();
        }
        const res = await listSessions(params);
        const arr = Array.isArray(res?.items) ? res.items : [];
        all.push(...arr);
        if (arr.length < limit) break;
        page += 1;
      }

      // Aggregate by organization
      const orgCounts = new Map();
      all.forEach((it) => {
        let org =
          it?.organization_name ||
          it?.organization?.name ||
          it?.tenant_id ||
          "";
        org = String(org || "").trim();
        if (!org) org = "Unknown";
        orgCounts.set(org, (orgCounts.get(org) || 0) + 1);
      });
      const orgArr = Array.from(orgCounts.entries())
        .map(([organization_name, session_count]) => ({ organization_name, session_count }))
        .sort((a, b) => b.session_count - a.session_count);

      // Aggregate by type
      const typeCounts = new Map();
      all.forEach((it) => {
        let t = it?.session_type || it?.type || it?.service_type || "";
        t = String(t || "").trim();
        if (!t) t = "Unknown";
        typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
      });
      const typeArr = Array.from(typeCounts.entries())
        .map(([session_type, session_count]) => ({ session_type, session_count }))
        .sort((a, b) => b.session_count - a.session_count);

      setByOrg(orgArr);
      setByType(typeArr);

      // Build distinct options for dropdowns from the aggregated dataset (all collected pages)
      const userPairs = all
        .map((it) => ({
          id: it?.user_id,
          name:
            it?.User_name ??
            it?.user_name ??
            it?.user?.name ??
            it?.username ??
            it?.email ??
            "",
        }))
        .filter((u) => u.id && u.name);

      const uniqueUsers = [];
      const seen = new Set();
      userPairs.forEach((u) => {
        if (!seen.has(u.id)) {
          seen.add(u.id);
          uniqueUsers.push(u);
        }
      });

      // Build distinct tenant IDs
      const tenantIds = distinctSorted(all.map((it) => it?.tenant_id ?? ""));

      setUserNameOptions(uniqueUsers);
      setTenantIdOptions(tenantIds);

    } catch (e) {
      setByOrg([]);
      setByType([]);
      setAggError(e?.response?.data?.message || e?.message || "Failed to load session aggregates.");
    } finally {
      setAggLoading(false);
    }
  }

  // PUBLIC_INTERFACE
  async function load(page = 1, limit = meta.limit || 10, qStr = "", sortKey, sortDir) {
    /**
     * Load sessions from server with pagination, optional query string, and server-driven sorting.
     */
    const requestId = ++activeRequestRef.current;
    setLoading(true);
    setError("");
    try {
      const sortFieldMap = {
        User_name: "user_name",
        tenant_id: "tenant_id",
        organization_name: "organization_name",
        service_type: "service_type",
        task_id: "task_id",
      };
      const params = { page, limit, q: qStr };
      if (startDate) {
        params.start = new Date(startDate).toISOString();
      }
      if (endDate) {
        params.end =
          endDate && !/T/.test(endDate)
            ? new Date(new Date(endDate).setHours(23, 59, 59, 999)).toISOString()
            : new Date(endDate).toISOString();
      }
      const filter = {};
      if (filterTenantId && filterTenantId.trim()) {
        filter.tenant_id = filterTenantId.trim();
      }
      if (filterUserName && filterUserName.trim()) {
        filter.user_id = filterUserName.trim();
      }
      if (Object.keys(filter).length > 0) {
        params.filter = filter;
      }
      if (sortKey) {
        const backendField = sortFieldMap[sortKey] || String(sortKey);
        params.sort = sortDir === "desc" ? `-${backendField}` : backendField;
      }
      const res = await listSessions(params);
      const arr = res?.items ?? (Array.isArray(res) ? res : []);
      if (requestId !== activeRequestRef.current) return;
      let filtered = Array.isArray(arr) ? arr : [];
      if (startDate || endDate) {
        const fromMs = startDate ? new Date(startDate).getTime() : null;
        const toMs =
          endDate
            ? (/T/.test(endDate)
                ? new Date(endDate).getTime()
                : new Date(new Date(endDate).setHours(23, 59, 59, 999)).getTime())
            : null;
        filtered = filtered.filter((it) => {
          const s =
            it?.session_start ||
            it?.start_time ||
            it?.started_at ||
            it?.created_at ||
            it?.timestamp ||
            null;
          const e =
            it?.session_end ||
            it?.end_time ||
            it?.completed_at ||
            it?.last_updated ||
            null;
          const sMs = s ? new Date(s).getTime() : null;
          const eMs = e ? new Date(e).getTime() : null;
          const inFrom = fromMs == null || (sMs != null ? sMs >= fromMs : eMs != null ? eMs >= fromMs : false);
          const inTo = toMs == null || (sMs != null ? sMs <= toMs : eMs != null ? eMs <= toMs : true);
          return inFrom && inTo;
        });
      }
      setItems(filtered);
      setMeta({
        page: res?.meta?.page || page,
        limit: res?.meta?.limit || limit,
        total:
          res?.meta?.total ??
          (Array.isArray(filtered) ? filtered.length : Array.isArray(arr) ? arr.length : 0),
      });
      setColumns(buildRestrictedColumns(arr));
    } catch (e) {
      if (requestId !== activeRequestRef.current) return;
      setItems([]);
      setColumns(buildRestrictedColumns([]));
      setError(e?.response?.data?.message || e?.message || "Failed to load sessions.");
    } finally {
      if (requestId === activeRequestRef.current) setLoading(false);
    }
  }

  // Initial load
  useEffect(() => {
    const { key, dir } = lastSortRef.current || { key: "", dir: "asc" };
    load(1, meta.limit || 10, "", key, dir);
    loadAggregates("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced server-side search on query change (250ms default)
  const debouncedQuery = useDebouncedValue(query, 250);
  useEffect(() => {
    const q = (debouncedQuery || "").trim();
    const { key, dir } = lastSortRef.current || { key: "", dir: "asc" };
    load(1, meta.limit || 10, q, key, dir);
    loadAggregates(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, startDate, endDate]);

  // Immediate refetch when dropdown filters change (no debounce)
  useEffect(() => {
    const q = (query || "").trim();
    const { key, dir } = lastSortRef.current || { key: "", dir: "asc" };
    load(1, meta.limit || 10, q, key, dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterUserName, filterTenantId, startDate, endDate]);

  // Toggle global dimming class while modal is open
  useEffect(() => {
    if (detailsOpen) {
      document.body.classList.add("modal-open");
    } else {
      document.body.classList.remove("modal-open");
    }
    return () => document.body.classList.remove("modal-open");
  }, [detailsOpen]);

  // Row click -> open modal
  const handleRowClick = (row) => {
    if (process.env.NODE_ENV !== "production") {
      try {
        const keys = Object.keys(row || {});
        // eslint-disable-next-line no-console
        console.debug("[Sessions] Row clicked (tenant_id scoped) -> opening details modal with keys:", keys);
      } catch {
        // ignore logging errors
      }
    }
    setSelectedSession(row);
    setDetailsOpen(true);
  };

  // --- Additional: Add new SessionTrackingChart section ---

  // Chart filter state and chart data
  const [chartFilters, setChartFilters] = useState({});
  const availableEventTypes = Array.from(new Set(items.map(s => s.event_type).filter(Boolean)));
  const availableBrowsers = Array.from(new Set(items.map(s => s.browser).filter(Boolean)));
  const availableDevices = Array.from(new Set(items.map(s => s.device).filter(Boolean)));
  const dateField = "session_start" in (items[0] || {}) ? "session_start" : "created_at";
  const minDate = items.length ? new Date(Math.min(...items.map(s => new Date(s[dateField] || Infinity)))) : null;
  const maxDate = items.length ? new Date(Math.max(...items.map(s => new Date(s[dateField] || 0)))) : null;
  function handleChartFilterChange(filters) {
    setChartFilters(filters);
  }
  let chartData = items;
  if (chartFilters.event_type) {
    chartData = chartData.filter(s => s.event_type === chartFilters.event_type);
  }
  if (chartFilters.browser) {
    chartData = chartData.filter(s => s.browser === chartFilters.browser);
  }
  if (chartFilters.device) {
    chartData = chartData.filter(s => s.device === chartFilters.device);
  }
  if (chartFilters.date) {
    chartData = chartData.filter(s => {
      const d = s[dateField] ? s[dateField].slice(0, 10) : "";
      return d === chartFilters.date;
    });
  }
  function buildBarData(data) {
    const byEvent = {};
    for (let s of data) {
      const key = s.event_type || "Unknown";
      byEvent[key] = (byEvent[key] || 0) + 1;
    }
    return Object.entries(byEvent).map(([k, v]) => ({
      x: k,
      y: v
    }));
  }
  const chartFiltersConfig = {
    fields: [
      ...(availableEventTypes.length ? [{
        name: "event_type", label: "Event Type", type: "string", options: availableEventTypes
      }] : []),
      ...(availableBrowsers.length ? [{
        name: "browser", label: "Browser", type: "string", options: availableBrowsers
      }] : []),
      ...(availableDevices.length ? [{
        name: "device", label: "Device", type: "string", options: availableDevices
      }] : []),
      ...(minDate && maxDate ? [{
        name: "date", label: "Date", type: "string", options: (() => {
          const result = [];
          let d = new Date(minDate);
          while (d <= maxDate) {
            result.push(d.toISOString().slice(0,10));
            d.setDate(d.getDate() + 1);
          }
          return result;
        })()
      }] : [])
    ],
    xKey: "x",
    yKey: "y",
    initialFilters: {}
  };

  return (
    <div>
      {/* Details Modal */}
      <SessionDetailsModal
        open={detailsOpen}
        onClose={() => {
          setDetailsOpen(false);
          setTimeout(() => setSelectedSession(null), 0);
        }}
        session={selectedSession}
      />

      {/* New Chart Section */}
      <div className="mb-3">
        <SessionTrackingChart
          data={buildBarData(items)}
          loading={loading}
          error={error}
          chartType="bar"
          filtersConfig={chartFiltersConfig}
          ariaLabel="Session Event Overview"
          label="Session Activity Distribution"
          onFilterChange={handleChartFilterChange}
          theme={{
            colors: ["#2563EB", "#F59E0B", "#EF4444", "#4ade80"]
          }}
        />
      </div>

      {/* Existing charts and table */}
      <div
        className="sessions-charts"
        role="region"
        aria-label="Session insights"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 24,
          marginBottom: 32,
        }}
      >
        <Card
          className="chart-card"
          title="Sessions by Organization"
          subtitle="Count of sessions per organization"
        >
          <div className="chart-wrapper" style={{ height: 320 }}>
            <SessionsByOrganization
              data={byOrg}
              loading={aggLoading}
              error={aggError}
            />
          </div>
        </Card>

        <Card
          className="chart-card"
          title="Sessions by Type"
          subtitle="Count of sessions per type"
        >
          <div className="chart-wrapper" style={{ minHeight: 320 }}>
            <SessionsByType
              data={byType}
              loading={aggLoading}
              error={aggError}
              maxItems={5}
            />
          </div>
        </Card>
      </div>
      <Card title="Session Tracking" subtitle="Search and filter sessions without page reloads">
        <div className="toolbar" aria-label="Sessions toolbar" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <input
            className="input-search"
            placeholder="Search sessions (user, org, service, status, etc.)..."
            aria-label="Search sessions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ minWidth: 280 }}
          />
          <label htmlFor="filter-user" className="sr-only">Filter by User name</label>
          <select
            id="filter-user"
            className="input-filter"
            aria-label="Filter by User"
            value={filterUserName}
            onChange={(e) => setFilterUserName(e.target.value)}
            style={{ minWidth: 220 }}
          >
            <option value="">All users</option>
            {userNameOptions.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>

          <label htmlFor="filter-tenant" className="sr-only">Filter by Tenant ID</label>
          <select
            id="filter-tenant"
            className="input-filter"
            aria-label="Filter by Tenant ID"
            value={filterTenantId}
            onChange={(e) => setFilterTenantId(e.target.value)}
            style={{ minWidth: 180 }}
          >
            <option value="">All tenants</option>
            {tenantIdOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          {/* Date range controls */}
          <div role="group" aria-label="Date filters" style={{ display: "inline-flex", gap: 8, alignItems: "center", marginLeft: 8 }}>
            <label htmlFor="start-date" style={{ fontSize: 12, color: "#374151" }}>Start</label>
            <input
              id="start-date"
              type="date"
              className="input-filter"
              aria-label="Start date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <label htmlFor="end-date" style={{ fontSize: 12, color: "#374151" }}>End</label>
            <input
              id="end-date"
              type="date"
              className="input-filter"
              aria-label="End date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className="spacer" style={{ flex: 1 }} />
        </div>
        {error && (
          <div className="error" role="alert" style={{ marginBottom: 8 }}>
            {error}
          </div>
        )}
        <DataTable
          columns={columns}
          data={items}
          loading={loading}
          pageSize={meta.limit || 10}
          initialPage={meta.page || 1}
          serverTotal={meta.total}
          fetchPage={async (page, limit, sortKey, sortDir) => {
            if (sortKey) {
              lastSortRef.current = { key: sortKey, dir: sortDir || "asc" };
            } else if (!lastSortRef.current) {
              lastSortRef.current = { key: "", dir: "asc" };
            }
            await load(page, limit, (query || "").trim(), sortKey, sortDir);
          }}
          paginationTitle="Sessions pages"
          onRowClick={handleRowClick}
        />
      </Card>
    </div>
  );
}
