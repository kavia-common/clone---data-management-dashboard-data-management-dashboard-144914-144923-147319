import React, { useEffect, useMemo, useRef, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import DataTable from "../../components/DataTable.jsx";
import { fetchSessionTracking } from "../../api/sessionTracking";
import SessionDetailsModal from "../../components/sessions/SessionDetailsModal";
import SessionsByOrganization from "../../components/charts/SessionsByOrganization.jsx";
import SessionsByType from "../../components/charts/SessionsByType.jsx";
import useDebouncedValue from "../../hooks/useDebouncedValue";
import { requestCache, buildStableParamsKey, normalizeString, normalizeIsoMinute, paramsKeyEqual } from "../../utils/requestCache";

const isDev = typeof process !== "undefined" && process.env && process.env.NODE_ENV !== "production";

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
   * After optimization:
   * - Unified single effect driven by a debounced params object (tenant_id, page, limit, q, start, end, sort)
   * - AbortController-based in-flight cancellation
   * - Strict param key equality and 60s client-side cache to avoid redundant requests
   * - Maintains existing UI elements and DataTable integration
   */

  // Table data
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Controls
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

  // Track AbortController for in-flight cancellation
  const abortRef = useRef(null);
  // Track last successful paramsKey to skip redundant network calls
  const lastSuccessKeyRef = useRef(null);
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
      };
    });
  }

  const [columns, setColumns] = useState(buildRestrictedColumns([]));

  // Aggregates for charts
  const [aggLoading, setAggLoading] = useState(false);
  const [aggError, setAggError] = useState("");
  const [byOrg, setByOrg] = useState([]);   // [{ organization_name, session_count }]
  const [byType, setByType] = useState([]); // [{ session_type, session_count }]

  async function loadAggregates(qStr = "", debouncedRange = { start: null, end: null }) {
    /**
     * Fetch sessions data across multiple pages (capped) and build client-side aggregates
     * for charts: by organization_name and by session_type.
     * Reuses the same date range normalization as the table fetch.
     */
    setAggLoading(true);
    setAggError("");
    try {
      const limit = 200;
      const maxPages = 10;
      let page = 1;
      const all = [];
      while (page <= maxPages) {
        const params = {
          page,
          limit,
          q: qStr,
          // note: backend path uses start/end for date filters per project conventions
          start: debouncedRange?.start || undefined,
          end: debouncedRange?.end || undefined,
          // Preserve sort
          sort: lastSortRef.current?.dir === "desc"
            ? `-${(lastSortRef.current?.key || "").toString()}`
            : (lastSortRef.current?.key || "").toString(),
        };
        const res = await fetchSessionTracking(params);
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

      // Build distinct options for dropdowns
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

  // Initial aggregates load (no table fetch here; unified effect below will fetch table)
  useEffect(() => {
    const debouncedRange = {
      start: normalizeIsoMinute(startDate || null),
      end: normalizeIsoMinute(endDate || null),
    };
    loadAggregates("", debouncedRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // on mount

  // Build unified raw params from all controls
  const rawParams = useMemo(() => {
    // Build sort from last remembered sort for server sorting (used in table and aggregates fetch pagination loop)
    const sortKey = normalizeString(lastSortRef.current?.key) || "";
    const sortDir = normalizeString(lastSortRef.current?.dir) || "asc";
    return {
      tenant_id: normalizeString(filterTenantId),
      page: meta.page,
      limit: meta.limit,
      q: normalizeString(query),
      start: normalizeIsoMinute(startDate || null),
      end: normalizeIsoMinute(endDate || null),
      sortKey,
      sortDir,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterTenantId, meta.page, meta.limit, query, startDate, endDate]);

  // Single debounce (300–400ms). Use 350ms
  const debouncedParams = useDebouncedValue(rawParams, 350);

  // Stable sort string
  const sortParam = useMemo(() => {
    const key = debouncedParams?.sortKey || "";
    const dir = debouncedParams?.sortDir || "asc";
    if (!key) return undefined;
    return dir === "desc" ? `-${key}` : key;
  }, [debouncedParams]);

  // Build stable params key
  const paramsKey = useMemo(() => buildStableParamsKey(debouncedParams), [debouncedParams]);

  // Unified effect for table list fetch with cancellation and cache
  useEffect(() => {
    let didCancel = false;

    async function run() {
      if (isDev) console.info("[Sessions] debounced params", debouncedParams, "key=", paramsKey);

      // Strict skip: if same as last success, do nothing
      if (paramsKeyEqual(paramsKey, lastSuccessKeyRef.current)) {
        if (isDev) console.info("[Sessions] params unchanged – skipping fetch");
        return;
      }

      // Check cache
      const cached = requestCache.get(paramsKey);
      if (cached) {
        if (isDev) console.info("[Sessions] cache hit – using cached result");
        lastSuccessKeyRef.current = paramsKey;
        if (!didCancel) {
          setItems(cached.data || []);
          setMeta(cached.meta || { page: debouncedParams?.page || 1, limit: debouncedParams?.limit || 10, total: (cached.data || []).length });
          setLoading(false);
          setError("");
          setColumns(buildRestrictedColumns(cached.data || []));
        }
        return;
      }

      // Abort previous in-flight request
      if (abortRef.current) {
        abortRef.current.abort();
        if (isDev) console.info("[Sessions] previous request aborted");
      }
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError("");

      try {
        const params = {
          page: debouncedParams?.page || 1,
          limit: debouncedParams?.limit || 10,
          q: debouncedParams?.q || undefined,
          start: debouncedParams?.start || undefined,
          end: debouncedParams?.end || undefined,
          sort: sortParam,
          tenant_id: debouncedParams?.tenant_id || undefined,
        };

        if (isDev) console.info("[Sessions] fetching with params", params);
        // fetchSessionTracking uses axios instance; axios v1 supports AbortController signal via config.signal
        const res = await fetchSessionTracking(params, { signal: controller.signal });

        if (didCancel) return;
        if (controller.signal.aborted) {
          if (isDev) console.info("[Sessions] request aborted – ignoring response");
          return;
        }

        const arr = Array.isArray(res?.items) ? res.items : [];
        const metaResp = res?.meta || { page: params.page, limit: params.limit, total: Array.isArray(arr) ? arr.length : 0 };

        // Save to cache
        requestCache.set(paramsKey, { data: arr, meta: metaResp });

        // Mark success and update UI
        lastSuccessKeyRef.current = paramsKey;
        setItems(arr);
        setMeta(metaResp);
        setError("");
        setColumns(buildRestrictedColumns(arr));
      } catch (e) {
        if (didCancel) return;
        if (e && (e.name === "AbortError" || e.code === "ERR_CANCELED")) {
          if (isDev) console.info("[Sessions] request canceled", e?.message || "");
          return;
        }
        if (isDev) console.info("[Sessions] fetch error", e);
        setItems([]);
        setColumns(buildRestrictedColumns([]));
        setError(e?.response?.data?.message || e?.message || "Failed to load sessions.");
      } finally {
        if (!didCancel) setLoading(false);
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    }

    run();

    return () => {
      didCancel = true;
      // No abort here; the next effect run aborts previous before starting.
    };
  }, [paramsKey, sortParam, debouncedParams]);

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
        console.debug("[Sessions] Row clicked -> opening details modal with keys:", keys);
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

      {/* Charts stacked vertically */}
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

      {/* Table */}
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
          columns={Array.isArray(columns) ? columns : []}
          data={Array.isArray(items) ? items : []}
          loading={!!loading}
          pageSize={meta.limit || 10}
          initialPage={meta.page || 1}
          serverTotal={meta.total}
          fetchPage={async (page, limit, sortKey, sortDir) => {
            // Update sort memory so unified debounced fetch uses it
            if (sortKey) {
              lastSortRef.current = { key: sortKey, dir: sortDir || "asc" };
            } else if (!lastSortRef.current) {
              lastSortRef.current = { key: "", dir: "asc" };
            }
            // Update meta; unified effect will trigger fetch
            setMeta((m) => ({ ...m, page, limit }));
          }}
          paginationTitle="Sessions pages"
          onRowClick={handleRowClick}
        />
      </Card>
    </div>
  );
}
