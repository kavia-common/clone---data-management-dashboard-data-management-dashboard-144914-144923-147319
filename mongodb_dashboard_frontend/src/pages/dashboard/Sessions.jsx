import React, { useEffect, useMemo, useRef, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import DataTable from "../../components/DataTable.jsx";
import { fetchSessionTracking } from "../../api/sessionTracking";
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
  // Sessions state and filters
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [meta, setMeta] = useState({ page: 1, limit: 10, total: 0 });

  // New UI filters
  const [filterUserName, setFilterUserName] = useState("");
  const [filterTenantId, setFilterTenantId] = useState("");

  // Only start/end filter for date range
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Dropdown options fetched from session aggregate
  const [userNameOptions, setUserNameOptions] = useState([]);
  const [tenantIdOptions, setTenantIdOptions] = useState([]);

  // Initial dropdown/URL logic (trimmed to only needed params)
  useEffect(() => {
    const usp = new URLSearchParams(window.location.search);
    if (filterUserName) usp.set("user_name", filterUserName);
    else usp.delete("user_name");
    if (filterTenantId) usp.set("tenant_id", filterTenantId);
    else usp.delete("tenant_id");
    if (startDate) usp.set("start", startDate);
    else usp.delete("start");
    if (endDate) usp.set("end", endDate);
    else usp.delete("end");
    const next = `${window.location.pathname}?${usp.toString()}`;
    window.history.replaceState({}, "", next);
  }, [filterUserName, filterTenantId, startDate, endDate]);

  useEffect(() => {
    const usp = new URLSearchParams(window.location.search);
    const initialUser = usp.get("user_name") || "";
    const initialTenant = usp.get("tenant_id") || "";
    const urlStart = usp.get("start") || "";
    const urlEnd = usp.get("end") || "";
    if (initialUser) setFilterUserName(initialUser);
    if (initialTenant) setFilterTenantId(initialTenant);
    if (urlStart) setStartDate(urlStart);
    if (urlEnd) setEndDate(urlEnd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Details modal state
  const [selectedSession, setSelectedSession] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const activeRequestRef = useRef(0);
  const lastSortRef = useRef({ key: "", dir: "asc" });

  // Table columns (restricted set)
  const allowedOrdered = useMemo(
    () => ["User_name", "tenant_id", "organization_name", "service_type"],
    []
  );
  function toLabel(key) {
    return String(key || "").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
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

  // Chart/aggregate states
  const [aggLoading, setAggLoading] = useState(false);
  const [aggError, setAggError] = useState("");
  const [byOrg, setByOrg] = useState([]);
  const [byType, setByType] = useState([]);

  // Aggregate loader (still paginates to collect max rows, but only applies start/end filters)
  async function loadAggregates(qStr = "") {
    setAggLoading(true);
    setAggError("");
    try {
      const limit = 200;
      const maxPages = 10;
      let page = 1;
      const all = [];
      while (page <= maxPages) {
        // Only supply start/end, tenant_id, and q (no from/to/page/limit)
        const params = {};
        if (startDate) params.start = new Date(startDate).toISOString();
        if (endDate) {
          params.end = !/T/.test(endDate)
            ? new Date(new Date(endDate).setHours(23, 59, 59, 999)).toISOString()
            : new Date(endDate).toISOString();
        }
        if (filterTenantId && filterTenantId.trim()) params.tenant_id = filterTenantId.trim();
        if (qStr) params.q = qStr;

        const res = await fetchSessionTracking(params);
        const arr = Array.isArray(res?.items) ? res.items : [];
        all.push(...arr);
        // If less than limit, assume last page
        if (arr.length < limit) break;
        page += 1;
      }

      // By organization
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

      // By type
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

      // User and tenant options for dropdowns
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

  // Perform session fetches with only supported query params (no from/to/page/limit)
  async function load(qStr = "", sortKey, sortDir) {
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

      // Only include supported filters
      const params = {};
      if (startDate) params.start = new Date(startDate).toISOString();
      if (endDate) {
        params.end = !/T/.test(endDate)
          ? new Date(new Date(endDate).setHours(23, 59, 59, 999)).toISOString()
          : new Date(endDate).toISOString();
      }
      if (filterTenantId && filterTenantId.trim()) params.tenant_id = filterTenantId.trim();
      if (qStr) params.q = qStr;

      if (sortKey) {
        const backendField = sortFieldMap[sortKey] || String(sortKey);
        params.sort = sortDir === "desc" ? `-${backendField}` : backendField;
      }

      const res = await fetchSessionTracking(params);
      const arr = res?.items ?? (Array.isArray(res) ? res : []);
      if (requestId !== activeRequestRef.current) return;
      setItems(Array.isArray(arr) ? arr : []);
      setMeta({
        page: 1,
        limit: arr.length,
        total: arr.length,
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

  useEffect(() => {
    load("", "", "asc");
    loadAggregates("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // initial

  // Debounce search effect for query
  const debouncedQuery = useDebouncedValue(query, 250);
  useEffect(() => {
    load(debouncedQuery, "", "asc");
    loadAggregates(debouncedQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, startDate, endDate]);

  useEffect(() => {
    load(query, "", "asc");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterUserName, filterTenantId, startDate, endDate]);

  // Modal open/close effect
  useEffect(() => {
    if (detailsOpen) {
      document.body.classList.add("modal-open");
    } else {
      document.body.classList.remove("modal-open");
    }
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

      {/* Main Table */}
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
          fetchPage={async (_page, _limit, sortKey, sortDir) => {
            if (sortKey) {
              lastSortRef.current = { key: sortKey, dir: sortDir || "asc" };
            } else if (!lastSortRef.current) {
              lastSortRef.current = { key: "", dir: "asc" };
            }
            await load(query, sortKey, sortDir);
          }}
          paginationTitle="Sessions pages"
          onRowClick={handleRowClick}
        />
      </Card>
    </div>
  );
}
