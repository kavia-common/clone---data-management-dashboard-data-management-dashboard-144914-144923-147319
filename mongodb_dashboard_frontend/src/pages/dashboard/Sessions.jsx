import React, { useEffect, useMemo, useRef, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import DataTable from "../../components/DataTable.jsx";
import { listSessions } from "../../api";
import SessionDetailsModal from "../../components/sessions/SessionDetailsModal";
import SessionsByOrganization from "../../components/charts/SessionsByOrganization.jsx";
import SessionsByType from "../../components/charts/SessionsByType.jsx";
import useDebouncedValue from "../../hooks/useDebouncedValue";



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
  // IMPORTANT: only sync filters to URL. Do NOT mutate current dataset from here.
  useEffect(() => {
    const usp = new URLSearchParams(window.location.search);
    if (filterUserName) usp.set("user_name", filterUserName);
    else usp.delete("user_name");
    if (filterTenantId) usp.set("tenant_id", filterTenantId);
    else usp.delete("tenant_id");

    // Date query string sync note:
    // We persist raw YYYY-MM-DD values in URL for UX. The API serialization to UTC ISO is done in load().
    if (startDate) usp.set("startDate", startDate);
    else usp.delete("startDate");
    if (endDate) usp.set("endDate", endDate);
    else usp.delete("endDate");

    const next = `${window.location.pathname}?${usp.toString()}`;
    window.history.replaceState({}, "", next);
  }, [filterUserName, filterTenantId, startDate, endDate]);

  // Initialize dropdown selections from URL on first mount
  // Regression note: prefer startDate/endDate over from/to; both accepted for back-compat.
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

  // Details modal state (session details; unrelated to deprecated "View All" costs modal)
  const [selectedSession, setSelectedSession] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Lock to prevent race conditions when multiple loads are inflight (e.g., debounce vs pagination)
  const activeRequestRef = useRef(0);
  // Remember the last known sort so search/debounced reloads preserve sort order across pages
  const lastSortRef = useRef({ key: "", dir: "asc" });

  // Allowed and ordered fields (column visibility)
  // Replace Task Id column with User name per requirements
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
      if (!val) return "—";
      try {
        const d = new Date(val);
        if (isNaN(d.getTime())) return "—";
        return d.toLocaleString();
      } catch {
        return "—";
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
          return val == null || val === "" ? "—" : String(val);
        }

        return v == null || v === "" ? "—" : String(v);
      };

      return {
        key: k,
        label,
        render,
        priority: 2,
        // Slightly widen column if session list is present

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
     * Mirrors the same UTC date serialization behavior used in load().
     */
    setAggLoading(true);
    setAggError("");
    try {
      const limit = 200;
      const maxPages = 10;
      let page = 1;
      const all = [];

      const toUtcIso = (d) => {
        if (!d) return null;
        if (!/T/.test(d)) {
          const parts = d.split("-");
          const year = Number(parts[0] || 0);
          const month = Number(parts[1] || 1) - 1;
          const day = Number(parts[2] || 1);
          return new Date(Date.UTC(year, month, day, 0, 0, 0, 0)).toISOString();
        }
        return new Date(d).toISOString();
      };
      const toUtcIsoEndOfDay = (d) => {
        if (!d) return null;
        if (!/T/.test(d)) {
          const parts = d.split("-");
          const year = Number(parts[0] || 0);
          const month = Number(parts[1] || 1) - 1;
          const day = Number(parts[2] || 1);
          return new Date(Date.UTC(year, month, day, 23, 59, 59, 999)).toISOString();
        }
        return new Date(d).toISOString();
      };

      while (page <= maxPages) {
        const params = { page, limit, q: qStr };

        const startIso = toUtcIso(startDate);
        const endIso = toUtcIsoEndOfDay(endDate);
        if (startIso) {
          params.startDate = startIso;
          params.from = startIso;
          params.start = startIso;
        }
        if (endIso) {
          params.endDate = endIso;
          params.to = endIso;
          params.end = endIso;
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
      // Keep pairs of { id, name } for filtering
      // ✅ Build distinct options for dropdowns from the aggregated dataset (all collected pages)

      // Build unique user list with IDs and names
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

      // Update dropdown options
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
     * IMPORTANT:
     * - Serialize dates as UTC ISO.
     * - Apply endDate as inclusive end-of-day (23:59:59.999) on client.
     * - Do not re-filter or re-expand data on the client: render exactly the API response.
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

      // Normalize to UTC ISO. Handle pure date input by constructing UTC date boundaries.
      const toUtcIso = (d) => {
        if (!d) return null;
        // If no time component, treat as YYYY-MM-DD in local and convert to UTC ISO at 00:00:00.000Z
        if (!/T/.test(d)) {
          const parts = d.split("-");
          const year = Number(parts[0] || 0);
          const month = Number(parts[1] || 1) - 1; // 0-based
          const day = Number(parts[2] || 1);
          // Construct as UTC explicitly to avoid TZ skew
          const date = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
          return date.toISOString();
        }
        return new Date(d).toISOString();
      };
      const toUtcIsoEndOfDay = (d) => {
        if (!d) return null;
        if (!/T/.test(d)) {
          const parts = d.split("-");
          const year = Number(parts[0] || 0);
          const month = Number(parts[1] || 1) - 1;
          const day = Number(parts[2] || 1);
          const date = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
          return date.toISOString();
        }
        // If time component supplied, assume caller provided correct bound
        return new Date(d).toISOString();
      };

      // For session-tracking, use startDate/endDate query param names per request notes.
      const startIso = toUtcIso(startDate);
      const endIso = toUtcIsoEndOfDay(endDate);
      if (startIso) {
        params.startDate = startIso;
      }
      if (endIso) {
        params.endDate = endIso;
      }

      // Also include generic aliases for broader backend compatibility (non-breaking)
      if (startIso) {
        params.from = startIso;
        params.start = startIso;
      }
      if (endIso) {
        params.to = endIso;
        params.end = endIso;
      }

      // Server-side filter for tenant and user
      const filter = {};
      if (filterTenantId && filterTenantId.trim()) {
        filter.tenant_id = filterTenantId.trim();
      }
      if (filterUserName && filterUserName.trim()) {
        // Note: filter by user_id instead of user_name; UI provides user id from distinct list
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

      // Render exactly what server returned; do not client-filter.
      setItems(Array.isArray(arr) ? arr : []);
      setMeta({
        page: res?.meta?.page || page,
        limit: res?.meta?.limit || limit,
        total: typeof res?.meta?.total === "number" ? res.meta.total : (Array.isArray(arr) ? arr.length : 0),
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
  }, []); // initial mount only

  // Debounced server-side search on query change (250ms default)
  const debouncedQuery = useDebouncedValue(query, 250);
  // Debounced text search only
  useEffect(() => {
    const q = (debouncedQuery || "").trim();
    const { key, dir } = lastSortRef.current || { key: "", dir: "asc" };
    load(1, meta.limit || 10, q, key, dir);
    // Aggregates should reflect same API filters; keep but ensure they use the same date params logic internally.
    loadAggregates(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, startDate, endDate]);

  // Immediate refetch when dropdown filters change (no debounce)
  useEffect(() => {
    const q = (query || "").trim();
    const { key, dir } = lastSortRef.current || { key: "", dir: "asc" };
    load(1, meta.limit || 10, q, key, dir);
    // Do not reload aggregates on dropdown change to keep options broad; charts are based on search/date only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterUserName, filterTenantId, startDate, endDate]);



  // Toggle global dimming class while modal is open (align with user modal UX)
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

      {/* Charts stacked vertically (normal flow, with spacing below so table doesn't overlap) */}
      <div
        className="sessions-charts"
        role="region"
        aria-label="Session insights"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 24,
          marginBottom: 32, // ensure spacing before the table card
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
          {/* Wrapper participates in normal flow; no absolute positioning */}
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

      {/* Existing table card remains below charts */}
      {/* Regression guard: Rendering exactly the API response. No client-side date re-filtering or merging. */}
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
        {/* Render exactly API response without local re-filtering or dataset merging */}
        <DataTable
          columns={columns}
          data={items}
          loading={loading}

          pageSize={meta.limit || 10}
          initialPage={meta.page || 1}
          serverTotal={meta.total}
          fetchPage={async (page, limit, sortKey, sortDir) => {
            // Remember current sort so external triggers (search) keep ordering consistent
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
