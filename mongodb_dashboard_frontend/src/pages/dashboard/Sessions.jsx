import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import DataTable from "../../components/DataTable.jsx";
import Button from "../../components/ui/Button.jsx";
import { listSessions } from "../../api/client";

// PUBLIC_INTERFACE
export default function Sessions() {
  /**
   * Session Tracking table restricted to show only the following columns (in this exact order):
   * - Task Id
   * - Tenant Id
   * - Organization Name
   * - Service Type
   * - Total Cost
   *
   * Adds a tenant filter consistent with the Users tab:
   * - Dropdown lists unique tenant IDs from loaded data with default "All Tenant".
   * - Applying the filter updates the visible rows (client-side) and resets pagination to page 1.
   */
  const [allItems, setAllItems] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [meta, setMeta] = useState({ page: 1, limit: 10, total: 0 });

  // New: Tenant filter state (mirrors Users tab behavior/labeling)
  const [tenantFilter, setTenantFilter] = useState("");

  // Allowed and ordered fields per requirement (User Name removed)
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

  // Build tenant options from loaded data (unique, sorted)
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

  async function load(page = 1, limit = meta.limit || 10) {
    setLoading(true);
    setError("");
    try {
      const res = await listSessions({ page, limit });
      const arr = res?.items ?? (Array.isArray(res) ? res : []);
      setAllItems(arr);
      setItems(arr);
      setMeta({
        page: res?.meta?.page || page,
        limit: res?.meta?.limit || limit,
        total: res?.meta?.total ?? arr.length,
      });
      setColumns(buildRestrictedColumns(arr));
    } catch (e) {
      setAllItems([]);
      setItems([]);
      setColumns(buildRestrictedColumns([]));
      setError(e?.response?.data?.message || e?.message || "Failed to load sessions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Client-side filter to match Users tab: text search over visible fields + tenant filter
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

  // Force DataTable to re-init pagination when filters change
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
          serverTotal={meta.total}
          fetchPage={async (page, limit) => {
            await load(page, limit);
          }}
          paginationTitle="Sessions pages"
        />
      </Card>
    </div>
  );
}
