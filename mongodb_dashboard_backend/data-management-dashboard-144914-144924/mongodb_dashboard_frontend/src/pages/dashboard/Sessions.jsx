import React, { useEffect, useMemo, useRef, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import DataTable from "../../components/DataTable.jsx";
import { listSessions, listSessionDistinct } from "../../api";
import SessionDetailsModal from "../../components/sessions/SessionDetailsModal";
import SessionsByOrganization from "../../components/charts/SessionsByOrganization.jsx";
import SessionsByType from "../../components/charts/SessionsByType.jsx";
import useDebouncedValue from "../../hooks/useDebouncedValue";
import DateRangeFilter from "../../components/common/DateRangeFilter";
import useDateRangeQuery from "../../hooks/useDateRangeQuery";

// PUBLIC_INTERFACE
export default function Sessions() {
  /**
   * Sessions page with server-side search and pagination.
   * - Debounced search (300ms) across the entire dataset via backend query param `q`.
   * - Keeps existing pagination using server-provided meta.total and page/limit.
   */
  const [items, setItems] = useState([]);

  // Date range state (persisted via query params)
  const { startDate, endDate, setDates, clearDates, withDateParams } = useDateRangeQuery();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [meta, setMeta] = useState({ page: 1, limit: 10, total: 0 });

  // UI filters
  const [filterUserName, setFilterUserName] = useState("");
  const [filterTenantId, setFilterTenantId] = useState("");

  // Dropdown options populated from backend distinct endpoints (scoped by date range)
  const [userNameOptions, setUserNameOptions] = useState([]);
  const [tenantIdOptions, setTenantIdOptions] = useState([]);

  // Keep URL query params in sync for dropdowns (so back/forward works)
  useEffect(() => {
    const usp = new URLSearchParams(window.location.search);
    if (filterUserName) usp.set("user_name", filterUserName);
    else usp.delete("user_name");
    if (filterTenantId) usp.set("tenant_id", filterTenantId);
    else usp.delete("tenant_id");
    const next = `${window.location.pathname}?${usp.toString()}`;
    window.history.replaceState({}, "", next);
  }, [filterUserName, filterTenantId]);

  // Initialize dropdown selections from URL on first mount
  useEffect(() => {
    const usp = new URLSearchParams(window.location.search);
    const initialUser = usp.get("user_name") || "";
    const initialTenant = usp.get("tenant_id") || "";
    if (initialUser) setFilterUserName(initialUser);
    if (initialTenant) setFilterTenantId(initialTenant);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Details modal state
  const [selectedSession, setSelectedSession] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Locks
  const activeRequestRef = useRef(0);
  const lastSortRef = useRef({ key: "", dir: "asc" });

  // Allowed columns
  const allowedOrdered = useMemo(
    () => ["User_name", "tenant_id", "organization_name", "service_type"],
    []
  );

  function toLabel(key) {
    return String(key || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (m) => m.toUpperCase());
  }

  function buildRestrictedColumns(rows = []) {
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
      return { key: k, label, render, priority: 2 };
    });
  }

  const [columns, setColumns] = useState(buildRestrictedColumns([]));

  // Aggregates for charts
  const [aggLoading, setAggLoading] = useState(false);
  const [aggError, setAggError] = useState("");
  const [byOrg, setByOrg] = useState([]);   // [{ organization_name, session_count }]
  const [byType, setByType] = useState([]); // [{ session_type, session_count }]

  async function loadAggregates(qStr = "") {
    setAggLoading(true);
    setAggError("");
    try {
      const limit = 200;
      const maxPages = 10;
      let page = 1;
      const all = [];
      while (page <= maxPages) {
        const res = await listSessions(withDateParams({ page, limit, q: qStr }));
        const arr = Array.isArray(res?.items) ? res.items : [];
        all.push(...arr);
        if (arr.length < limit) break;
        page += 1;
      }

      // Aggregate by organization name
      const orgCounts = new Map();
      all.forEach((it) => {
        let org = it?.organization_name || it?.organization?.name || it?.tenant_id || "";
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
      const params = withDateParams({ page, limit, q: qStr });

      const filter = {};
      if (filterTenantId && filterTenantId.trim()) {
        filter.tenant_id = filterTenantId.trim();
      }
      if (filterUserName && filterUserName.trim()) {
        filter.user_name = filterUserName.trim();
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

      setItems(arr);
      setMeta({
        page: res?.meta?.page || page,
        limit: res?.meta?.limit || limit,
        total: res?.meta?.total ?? (Array.isArray(arr) ? arr.length : 0),
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

  // Load distinct options from backend
  async function loadDistinctOptions() {
    try {
      const params = withDateParams({});
      const [users, tenants] = await Promise.all([
        listSessionDistinct("User_name", params),
        listSessionDistinct("tenant_id", params),
      ]);
      setUserNameOptions(Array.isArray(users) ? users : []);
      setTenantIdOptions(Array.isArray(tenants) ? tenants : []);
    } catch (e) {
      setUserNameOptions([]);
      setTenantIdOptions([]);
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn("Failed to load distinct options:", e);
      }
    }
  }

  // Initial load
  useEffect(() => {
    const { key, dir } = lastSortRef.current || { key: "", dir: "asc" };
    load(1, meta.limit || 10, "", key, dir);
    loadAggregates("");
    loadDistinctOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // initial mount only

  // Debounced search
  const debouncedQuery = useDebouncedValue(query, 250);
  useEffect(() => {
    const q = (debouncedQuery || "").trim();
    const { key, dir } = lastSortRef.current || { key: "", dir: "asc" };
    load(1, meta.limit || 10, q, key, dir);
    loadAggregates(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  // Immediate refetch when dropdown filters change
  useEffect(() => {
    const q = (query || "").trim();
    const { key, dir } = lastSortRef.current || { key: "", dir: "asc" };
    load(1, meta.limit || 10, q, key, dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterUserName, filterTenantId]);

  // Re-fetch when date filters change (also refresh options)
  useEffect(() => {
    const q = (debouncedQuery || "").trim();
    const { key, dir } = lastSortRef.current || { key: "", dir: "asc" };
    load(1, meta.limit || 10, q, key, dir);
    loadAggregates(q);
    loadDistinctOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  // Toggle body class while modal is open
  useEffect(() => {
    if (detailsOpen) document.body.classList.add("modal-open");
    else document.body.classList.remove("modal-open");
    return () => document.body.classList.remove("modal-open");
  }, [detailsOpen]);

  const handleRowClick = (row) => {
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

      {/* Charts */}
      <div
        className="sessions-charts"
        role="region"
        aria-label="Session insights"
        style={{ display: "flex", flexDirection: "column", gap: 24 }}
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
          <div className="chart-wrapper" style={{ height: 320 }}>
            <SessionsByType
              data={byType}
              loading={aggLoading}
              error={aggError}
            />
          </div>
        </Card>
      </div>

      {/* Table */}
      <Card title="Session Tracking" subtitle="Search and filter sessions without page reloads">
        <div className="toolbar" aria-label="Sessions toolbar">
          <input
            className="input-search"
            placeholder="Search sessions (user, org, service, status, etc.)..."
            aria-label="Search sessions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label htmlFor="filter-user" className="sr-only">Filter by User name</label>
          <select
            id="filter-user"
            className="input-filter"
            aria-label="Filter by User name"
            value={filterUserName}
            onChange={(e) => setFilterUserName(e.target.value)}
            style={{ marginLeft: 8, minWidth: 220 }}
          >
            <option value="">All users</option>
            {userNameOptions.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>

          <label htmlFor="filter-tenant" className="sr-only">Filter by Tenant ID</label>
          <select
            id="filter-tenant"
            className="input-filter"
            aria-label="Filter by Tenant ID"
            value={filterTenantId}
            onChange={(e) => setFilterTenantId(e.target.value)}
            style={{ marginLeft: 8, minWidth: 180 }}
          >
            <option value="">All tenants</option>
            {tenantIdOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          <DateRangeFilter
            startDate={startDate}
            endDate={endDate}
            onChange={setDates}
            onClear={clearDates}
          />
          <div className="spacer" />
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
