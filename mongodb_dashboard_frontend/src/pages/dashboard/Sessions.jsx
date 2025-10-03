import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import DataTable from "../../components/DataTable.jsx";
import Button from "../../components/ui/Button.jsx";
import { listSessions } from "../../api/client";

/**
 * PUBLIC_INTERFACE
 * Sessions
 * Session Tracking page that:
 * - Loads the entire sessions dataset initially, so client-side filters (tenant + search) are applied across ALL records before pagination.
 * - Ensures pagination and counts reflect only the filtered data.
 * - Keeps a restricted, predictable set of columns and consistent Ocean Professional UX.
 */
export default function Sessions() {
  /**
   * Restricted columns (exact order):
   * - Task Id
   * - Tenant Id
   * - Organization Name
   * - Service Type
   * - Total Cost
   */
  const [allItems, setAllItems] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  // Pagination state (client-side): only used to define page size for DataTable; DataTable slices client-side.
  const [meta, setMeta] = useState({ page: 1, limit: 10, total: 0 });

  // Tenant filter state
  const [tenantFilter, setTenantFilter] = useState("");

  // Allowed and ordered fields per requirement
  const allowedOrdered = useMemo(
    () => ["task_id", "tenant_id", "organization_name", "service_type", "total_cost"],
    []
  );

  // Build tenant options from the entire dataset
  const tenantOptions = useMemo(() => {
    const set = new Set();
    (allItems || []).forEach((s) => {
      const t = s?.tenant_id ?? s?.organization_name ?? s?.organization ?? s?.organization_id;
      if (t !== undefined && t !== null) {
        const v = String(t).trim();
        if (v) set.add(v);
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allItems]);

  // PUBLIC_INTERFACE
  function toLabel(key) {
    /** Convert snake_case to Title Case label. */
    return String(key || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (m) => m.toUpperCase());
  }

  // PUBLIC_INTERFACE
  function buildRestrictedColumns() {
    /** Build DataTable columns from the allowed list, preserving order. */
    return allowedOrdered.map((k) => {
      if (k === "total_cost") {
        return {
          key: k,
          label: toLabel(k),
          render: (v) =>
            typeof v === "number" ? (
              <span className="amount-positive">
                {v.toLocaleString(undefined, { style: "currency", currency: "USD" })}
              </span>
            ) : v == null || v === "" ? "—" : String(v),
          priority: 2,
        };
      }
      return {
        key: k,
        label: toLabel(k),
        render: (v) => (v == null || v === "" ? "—" : String(v)),
        priority: 2,
      };
    });
  }

  const [columns] = useState(buildRestrictedColumns());

  /**
   * Load ALL sessions once so client-side filters are applied globally before pagination.
   * We intentionally do not pass page/limit to the API here to encourage a full dataset return where feasible.
   * If the backend enforces pagination, normalize and still apply client-side filters on the items we have.
   */
  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      // Intentionally request without page/limit to get all if backend supports raw array response.
      const res = await listSessions({});
      const arr = res?.items ?? (Array.isArray(res) ? res : []);
      setAllItems(arr);
      setItems(arr);
      setMeta((m) => ({ ...m, page: 1, total: arr.length }));
    } catch (e) {
      setAllItems([]);
      setItems([]);
      setError(e?.response?.data?.message || e?.message || "Failed to load sessions.");
      setMeta({ page: 1, limit: 10, total: 0 });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  /**
   * Apply text search + tenant filter across the entire dataset BEFORE pagination.
   * We then update items (the client-side dataset given to the table) and refresh total/page=1.
   */
  useEffect(() => {
    const q = (query || "").trim().toLowerCase();
    let filtered = allItems || [];

    if (q) {
      filtered = filtered.filter((s) => {
        const vals = allowedOrdered
          .map((f) => s?.[f])
          .filter((v) => v !== undefined && v !== null)
          .map((v) => String(v).toLowerCase());
        return vals.some((v) => v.includes(q));
      });
    }

    if (tenantFilter) {
      filtered = filtered.filter((s) => {
        const t = s?.tenant_id ?? s?.organization_name ?? s?.organization ?? s?.organization_id;
        return String(t ?? "").trim() === tenantFilter;
      });
    }

    setItems(filtered);
    setMeta((m) => ({ ...m, total: filtered.length, page: 1 }));
  }, [query, allItems, allowedOrdered, tenantFilter]);

  // Reset both filters to show all sessions from the complete dataset
  function resetFilters() {
    setQuery("");
    setTenantFilter("");
    setItems(allItems);
    setMeta((m) => ({ ...m, total: allItems.length, page: 1 }));
  }

  // Force DataTable to reset pagination to page 1 when filters change by altering key
  const tableKey = useMemo(
    () => `${(query || "").trim().toLowerCase()}|${tenantFilter}|${items.length}`,
    [query, tenantFilter, items.length]
  );

  return (
    <div>
      <Card title="Session Tracking" subtitle="Selected columns only">
        <div className="toolbar" aria-label="Sessions toolbar">
          <input
            className="input-search"
            placeholder="Search by visible fields..."
            aria-label="Search sessions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {/* Tenant filter (applies to full dataset before pagination) */}
          <select
            aria-label="Filter by tenant"
            title="Filter by tenant"
            value={tenantFilter}
            onChange={(e) => setTenantFilter(e.target.value)}
            style={{ width: 220 }}
          >
            <option value="">All Tenant</option>
            {tenantOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <Button
            variant="secondary"
            onClick={resetFilters}
            aria-label="Reset filters"
            title="Reset filters"
          >
            Reset
          </Button>

          <div className="spacer" />
        </div>
        {error && <div className="error" role="alert">{error}</div>}

        {/* Client-side pagination; counts reflect filtered data via meta.total */}
        <DataTable
          key={tableKey}
          columns={columns}
          data={items}
          loading={loading}
          // We intentionally do not pass fetchPage here to keep client-side mode,
          // ensuring pagination applies only to the filtered dataset.
          pageSize={meta.limit || 10}
          initialPage={1}
          paginationTitle="Sessions pages"
        />
      </Card>
    </div>
  );
}
