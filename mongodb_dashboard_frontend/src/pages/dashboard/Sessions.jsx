import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import DataTable from "../../components/DataTable.jsx";
import Button from "../../components/ui/Button.jsx";
import { listSessions } from "../../api/client";

/**
 * PUBLIC_INTERFACE
 * Sessions
 * Session Tracking table restricted to the following columns (in this exact order):
 * - Task Id
 * - Tenant Id
 * - Organization Name
 * - Service Type
 * - Total Cost
 *
 * Filters are applied to the FULL dataset before pagination:
 * - The page loads all sessions (no backend pagination) to allow global client-side filtering.
 * - Tenant filter and text search both apply to the entire dataset.
 * - Pagination/counts reflect only the filtered subset.
 */
// PUBLIC_INTERFACE
export default function Sessions() {
  /**
   * Session Tracking page: client-side filtering over the full dataset, then client-side pagination.
   * This ensures filtered results appear across all pages and counts are accurate for the filtered subset.
   */
  const [allItems, setAllItems] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  // Keep a local page-size setting for DataTable
  const [meta, setMeta] = useState({ page: 1, limit: 10, total: 0 });

  // Tenant filter state
  const [tenantFilter, setTenantFilter] = useState("");

  // Allowed and ordered fields per requirement
  const allowedOrdered = useMemo(
    () => [
      "task_id",
      "tenant_id",
      "organization_name",
      "service_type",
      "total_cost",
    ],
    []
  );

  // Unique tenant options built from the full dataset
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
  function buildRestrictedColumns(rows = []) {
    /** Build DataTable columns strictly from the allowed list, preserving order, with appropriate renderers. */
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

  const [columns, setColumns] = useState(buildRestrictedColumns([]));

  /**
   * Load ALL sessions without server-side pagination so filters can be applied globally.
   * This aligns with the requirement: apply tenant filters to the whole dataset before pagination.
   */
  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const res = await listSessions({}); // no page/limit => expect full array or normalized items
      const arr = res?.items ?? (Array.isArray(res) ? res : []);
      setAllItems(arr);
      setItems(arr);
      setMeta((m) => ({
        page: 1,
        limit: m.limit || 10,
        total: arr.length,
      }));
      setColumns(buildRestrictedColumns(arr));
    } catch (e) {
      setAllItems([]);
      setItems([]);
      setColumns(buildRestrictedColumns([]));
      setMeta({ page: 1, limit: 10, total: 0 });
      setError(e?.response?.data?.message || e?.message || "Failed to load sessions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Client-side filtering applied to the full dataset:
   * - text search across the visible/allowed fields
   * - exact tenant match filter (using tenant_id or organization fallbacks)
   * After filtering, update items and total; reset page to 1 for DataTable.
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

  // Reset both filters to show all sessions
  function resetFilters() {
    setQuery("");
    setTenantFilter("");
    setItems(allItems);
    setMeta((m) => ({ ...m, total: allItems.length, page: 1 }));
  }

  // Force DataTable to re-init pagination when filters change by keying on filter states and current length
  const tableKey = useMemo(
    () => `${(query || "").trim().toLowerCase()}|${tenantFilter}|${items.length}`,
    [query, tenantFilter, items.length]
  );

  return (
    <div>
      <Card title="Session Tracking" subtitle="Selected columns only — filters apply to all data">
        <div className="toolbar" aria-label="Sessions toolbar">
          <input
            className="input-search"
            placeholder="Search by visible fields..."
            aria-label="Search sessions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {/* Tenant filter (consistent with Users tab UI) */}
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
        <DataTable
          key={tableKey}
          columns={columns}
          data={items}
          loading={loading}
          // No actions (edit/delete) per requirement to remove actions column from UI
          pageSize={meta.limit || 10}
          initialPage={1}
          // Client-side mode: no serverTotal or fetchPage; pagination/counts reflect filtered results
          paginationTitle="Sessions pages"
        />
      </Card>
    </div>
  );
}
